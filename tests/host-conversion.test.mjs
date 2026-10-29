import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {convert} from '../lib/converter.mjs';
import {McpClient} from '../lib/protocol.mjs';
import {requestHostRoute} from '../lib/host-server.mjs';

test('official host conversion does not execute source; moved package runs tools, context, HTTP, settings and hooks',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh official conversion '));let client;
  t.after(async()=>{await client?.close();await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
  const source=path.join(root,'source'),out=path.join(root,'generated');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'native-full-probe',type:'module',main:'index.ts',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
  await fs.writeFile(path.join(source,'cordis.patch.yml'),'- insert:\n    - id: mounted-count-probe\n      name: native-full-probe\n');
  await fs.writeFile(path.join(source,'index.ts'),`import fs from'node:fs';import{defineTool}from'@deepseek-ai/dsh-tools';import z from'@deepseek-ai/schemastery';fs.writeFileSync(new URL('./initialized',import.meta.url),'yes');export const name='native-full-probe';export const inject=['tools','systemPrompt','settings','webServer','skills'];export const Config=z.object({count:z.natural().default(2).volatile()});export function apply(ctx,c){ctx.tools.register(defineTool({name:'count_probe',description:'Read live count',parameters:{},output:{schema:{type:'json'},render:(_,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async()=>({count:c.count.get()})}));ctx.skills.register({name:'packaged-skill',description:'A packaged dynamic skill',source:'runtime',content:'Original skill body from bundled services.'});ctx.systemPrompt.section({name:'probe-guide',order:5,text:'Original source instructions.'});ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/probe',handler:(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({source:'original'}));}}));}`);
  const report=await convert(source,{outputDir:out,hooks:true,stateRoot:path.join(root,'state')});assert.equal(report.conversion.components[0].kind,'dsh-host',JSON.stringify(report.conversion.omitted));
  assert.equal(JSON.parse(await fs.readFile(path.join(out,'runtime/settings.json'),'utf8')).entryId,'mounted-count-probe');
  await assert.rejects(fs.access(path.join(source,'initialized')));await assert.rejects(fs.access(path.join(out,'source/initialized')));
  const moved=path.join(root,'relocated with spaces');await fs.rename(out,moved);await fs.rm(source,{recursive:true});
  const mcp=JSON.parse(await fs.readFile(path.join(moved,'.mcp.json'),'utf8'));
  client=new McpClient({...Object.values(mcp.mcpServers)[0],cwd:moved},{cwd:moved,timeout:30000});await client.start();
  const call=(name,args={})=>client.request('tools/call',{name,arguments:args});
  const listed=await client.listTools();assert.equal(listed.length,11);assert.ok(listed.some(tool=>tool.name==='dsh_host_command_run'));assert.equal((await call('count_probe')).structuredContent.count,2);
  const context=await call('dsh_host_context');assert.match(context.structuredContent.text,/Original source instructions/);assert.doesNotMatch(context.structuredContent.text,/You are DSH/);
  const skillList=await call('dsh_host_skills_list');assert.ok(JSON.parse(skillList.content[0].text).some(skill=>skill.name==='packaged-skill'));
  const skill=await call('dsh_host_skills_get',{name:'packaged-skill'});assert.equal(skill.structuredContent.content,'Original skill body from bundled services.');
  const settings=await call('dsh_host_settings_read');const form=settings.structuredContent??JSON.parse(settings.content[0].text);
  const descriptor=form.find(d=>d.ns==='mounted-count-probe');assert.ok(descriptor);
  const update=await call('dsh_host_settings_update',{ns:descriptor.ns,patch:{count:7},revision:descriptor.revision});assert.ok(!update.isError,JSON.stringify(update));assert.equal((await call('count_probe')).structuredContent.count,7);
  const http=await call('dsh_host_http',{path:'/probe',method:'GET'});assert.deepEqual(http.structuredContent.body,{source:'original'});
  const denied=await call('dsh_host_http',{path:'/probe/not-registered',method:'GET'});assert.equal(denied.isError,true);
  const hook=spawn(process.execPath,['./runtime/codex-hook.mjs'],{cwd:moved,windowsHide:true,stdio:['pipe','pipe','pipe']});let raw='',err='';hook.stdout.on('data',v=>raw+=v);hook.stderr.on('data',v=>err+=v);hook.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:'synthetic-session',cwd:moved,prompt:'DO NOT STORE THIS'}));
  const code=await new Promise(resolve=>hook.on('exit',resolve));assert.equal(code,0,err);assert.match(JSON.parse(raw).hookSpecificOutput.additionalContext,/Original source instructions/);
  await new Promise(resolve=>setTimeout(resolve,650));const status=(await call('dsh_host_status')).structuredContent;assert.equal(status.codexAdapters.agents.agents[0].id,'synthetic-session');assert.equal(status.codexAdapters.agents.backgroundJobsObserved,false);
});

test('HTTP control honors exact and prefix routes and rejects redirects to arbitrary origins',async()=>{
  const host={request:async()=>({origin:'http://127.0.0.1:1',routes:[{kind:'exact',path:'/exact'},{kind:'prefix',path:'/prefix'}]})};
  await assert.rejects(requestHostRoute(host,{path:'https://example.com',method:'GET'}),/relative/);
  await assert.rejects(requestHostRoute(host,{path:'//example.com/a',method:'GET'}),/relative/);
  await assert.rejects(requestHostRoute(host,{path:'/exact/a',method:'GET'}),/not registered/);
  await assert.rejects(requestHostRoute(host,{path:'/prefix/../../private',method:'GET'}),/not registered/);
  await assert.rejects(requestHostRoute(host,{path:'/prefix/a',method:'GET',headers:{host:'other'}}),/cannot be overridden/);
});
