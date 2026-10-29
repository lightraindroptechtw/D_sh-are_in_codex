import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {convert} from '../lib/converter.mjs';
import {McpClient} from '../lib/protocol.mjs';
import {controlDaemon} from '../lib/daemon-control.mjs';

test('generated trusted hook transports a real official deny; explicit background start/stop owns no MCP lifecycle',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v040 generated ')),source=path.join(root,'source'),outputDir=path.join(root,'generated');let client;
  t.after(async()=>{await client?.close();try{await controlDaemon(outputDir,'stop');}catch{}await fs.rm(root,{recursive:true,force:true});});
  await fs.mkdir(source);
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'synthetic-hook-background',type:'module',main:'index.mjs'}));
  await fs.writeFile(path.join(source,'index.mjs'),`import{defineTool}from'@deepseek-ai/dsh-tools';export const inject=['tools'];export function apply(ctx){ctx.on('tools/pre-execute',async(exec,next)=>exec.name==='Bash'?{kind:'deny',reason:'synthetic deny'}:next());ctx.tools.register(defineTool({name:'local_probe',description:'synthetic constant',parameters:{},output:{schema:{type:'json'},render:()=>[]},execute:async()=>({ok:true})}));}`);
  const report=await convert(source,{outputDir,stateRoot:path.join(root,'state'),installDependencies:false});assert.equal(report.conversion.components.find(row=>row.kind==='dsh-host')?.status,'configured-not-executed');
  const settingsFile=path.join(outputDir,'runtime/settings.json'),settings=JSON.parse(await fs.readFile(settingsFile,'utf8'));settings.interception=true;settings.nativeToolHooks=true;await fs.writeFile(settingsFile,JSON.stringify(settings));
  assert.equal((await controlDaemon(outputDir,'status')).running,false);
  client=new McpClient({command:process.execPath,args:['./runtime/server.mjs'],cwd:outputDir},{cwd:outputDir,timeout:30000});await client.start();
  const child=spawn(process.execPath,['runtime/codex-hook.mjs'],{cwd:outputDir,windowsHide:true,stdio:['pipe','pipe','pipe']});let raw='',stderr='';child.stdout.on('data',v=>raw+=v);child.stderr.on('data',v=>stderr+=v);child.stdin.end(JSON.stringify({hook_event_name:'PreToolUse',session_id:'synthetic',tool_name:'Bash',tool_input:{command:'DO_NOT_EXECUTE'}}));
  assert.equal(await new Promise(resolve=>child.once('exit',resolve)),0,stderr);assert.equal(JSON.parse(raw).hookSpecificOutput.permissionDecision,'deny');
  await assert.rejects(controlDaemon(outputDir,'stop'),/belongs to Codex/);
  await client.close();client=undefined;
  const started=await controlDaemon(outputDir,'start',{waitMs:20000});assert.equal(started.mode,'daemon');assert.equal(started.running,true);
  assert.equal((await controlDaemon(outputDir,'stop')).stopping,true);
  for(let i=0;i<50;i++){if(!(await controlDaemon(outputDir,'status')).running)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal((await controlDaemon(outputDir,'status')).running,false);
});
