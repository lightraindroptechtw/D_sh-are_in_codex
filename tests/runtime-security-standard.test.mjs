import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPermissionBroker} from '../lib/permission-broker.mjs';
import {runGuarded} from '../lib/sandbox-launch.mjs';
import {resolveExecutionPolicy,SANDBOX_STATE_META} from '../lib/execution-policy.mjs';
import {createCodexTaskBroker,checkLocalShellRules} from '../lib/dsh-codex-task.mjs';
import {DEFAULT_PLUGIN_SECURITY,createPluginSecurity} from '../lib/plugin-security.mjs';

const fullMeta=cwd=>({[SANDBOX_STATE_META]:{permissionProfile:{type:'disabled'},sandboxCwd:pathToFileURL(cwd).href}});
const syntheticSecurity=(settings={})=>({settings:{...DEFAULT_PLUGIN_SECURITY,...settings},notices:[],approvals:[],async load(){return {settings:this.settings};},async notify(value){this.notices.push(value);},wrapTool:tool=>tool,async close(){},redact:value=>value,commandEnvironment:()=>({}),async requestApproval(input){this.approvals.push(input);return true;}});
const noopControl={onNotification:()=>()=>{},onClose:()=>()=>{},onRequest:()=>()=>{},request:async()=>({})};

test('real Node source allows workspace/state and network, denies outside paths and spawn under ordinary and full host mode',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-node-standard-'));
  let broker;t.after(async()=>{await broker?.close();await fs.rm(root,{recursive:true,force:true});});
  const pkg=path.join(root,'package'),state=path.join(root,'state'),workspace=path.join(root,'workspace');
  await Promise.all([fs.mkdir(path.join(pkg,'runtime'),{recursive:true}),fs.mkdir(state),fs.mkdir(workspace)]);
  await fs.copyFile(new URL('../lib/sandbox-entry.mjs',import.meta.url),path.join(pkg,'runtime/sandbox-entry.mjs'));await fs.copyFile(new URL('../lib/source-process-policy.mjs',import.meta.url),path.join(pkg,'runtime/source-process-policy.mjs'));
  const outside=path.join(root,'outside.txt');await fs.writeFile(outside,'outside');
  const source=`import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';import readline from 'node:readline';const attempt=fn=>{try{return fn()}catch(e){return e.code}};for await(const line of readline.createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.id===undefined)continue;let result={};if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};if(m.method==='tools/list')result={tools:[{name:'probe',inputSchema:{type:'object'}}]};if(m.method==='tools/call'){const listener=net.createServer(s=>s.destroy());await new Promise(r=>listener.listen(0,'127.0.0.1',r));const network=await new Promise(r=>{const c=net.connect(listener.address().port,'127.0.0.1');c.on('connect',()=>{c.destroy();r(true)});c.on('error',()=>r(false))});await new Promise(r=>listener.close(r));result={content:[{type:'text',text:JSON.stringify({state:attempt(()=>{fs.writeFileSync(${JSON.stringify(path.join(state,'ok'))},'ok');return true}),workspace:attempt(()=>{fs.writeFileSync(${JSON.stringify(path.join(workspace,'ok'))},'ok');return true}),read:attempt(()=>fs.readFileSync(${JSON.stringify(outside)},'utf8')),write:attempt(()=>{fs.writeFileSync(${JSON.stringify(outside)},'bad');return true}),child:attempt(()=>{const c=cp.spawnSync(process.execPath,['-e','process.exit(0)']);if(c.error)throw c.error;return true}),network})}]};}console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));}`;
  await fs.writeFile(path.join(pkg,'source.mjs'),source);
  const security=syntheticSecurity();
  broker=await createPermissionBroker({root:pkg,target:{entry:'source.mjs'},policy:{stateDir:state,workspace,sourceProcess:'inline'},runGuarded,security});
  for(const execution of [{},{requestMeta:fullMeta(workspace)}]){
    const result=JSON.parse((await broker.tools[0].execute({},execution)).content[0].text);
    assert.deepEqual(result,{state:true,workspace:true,read:'ERR_ACCESS_DENIED',write:'ERR_ACCESS_DENIED',child:'ERR_ACCESS_DENIED',network:true});
  }
  security.settings.restrictionsEnabled=false;
  const unrestricted=JSON.parse((await broker.tools[0].execute({}, {requestMeta:fullMeta(workspace)})).content[0].text);
  assert.equal(unrestricted.write,true);assert.equal(unrestricted.child,true);
  assert.ok(security.notices.some(n=>n.kind==='missing-host-metadata'));
});

test('visible native execpolicy forbidden rule prevents a real source shell marker',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-shell-forbidden-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'home'),rules=path.join(home,'rules');await fs.mkdir(rules,{recursive:true});
  await fs.writeFile(path.join(rules,'synthetic.rules'),`prefix_rule(pattern = [${JSON.stringify(process.execPath)}, "-e"], decision = "forbidden")`);
  const marker=path.join(root,'must-not-exist'),command=[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`];
  assert.equal((await checkLocalShellRules(command,{codexHome:home,workspace:root})).decision,'forbidden');
  const security=syntheticSecurity(),broker=await createCodexTaskBroker({control:noopControl,codexHome:home,workspace:root,options:{security,stateDir:root,nativePolicy:resolveExecutionPolicy({requestMeta:fullMeta(root)})}});
  t.after(()=>broker.close());
  await assert.rejects(broker.dispatch('codex.shell',{command,cwd:root}),{code:'DSH_SHELL_FORBIDDEN'});
  assert.equal(security.approvals.length,0);await assert.rejects(fs.access(marker));
});

test('ordinary shell approval resumes original function and returns real command result without a model',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-shell-approval-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const security=syntheticSecurity(),broker=await createCodexTaskBroker({control:noopControl,codexHome:root,workspace:root,options:{security,stateDir:root,nativePolicy:resolveExecutionPolicy({workspace:root})}});
  t.after(()=>broker.close());
  const result=await broker.dispatch('codex.shell',{command:[process.execPath,'-e','process.stdout.write("shell-result")'],cwd:root});
  assert.equal(result.exitCode,0);assert.equal(result.stdout,'shell-result');assert.equal(security.approvals.length,1);assert.equal(security.approvals[0].cwd,root);
});

test('visible native allow rule skips local approval for the complete command in ordinary mode',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-shell-allow-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'home'),rules=path.join(home,'rules');await fs.mkdir(rules,{recursive:true});
  const command=[process.execPath,'-e','process.stdout.write("rule-allowed")'];
  await fs.writeFile(path.join(rules,'synthetic.rules'),`prefix_rule(pattern = ${JSON.stringify(command)}, decision = "allow")`);
  assert.equal((await checkLocalShellRules(command,{codexHome:home,workspace:root})).decision,'allow');
  const security=syntheticSecurity(),broker=await createCodexTaskBroker({control:noopControl,codexHome:home,workspace:root,options:{security,stateDir:root,nativePolicy:resolveExecutionPolicy({workspace:root})}});t.after(()=>broker.close());
  const result=await broker.dispatch('codex.shell',{command,cwd:root});assert.equal(result.stdout,'rule-allowed');assert.equal(result.exitCode,0);assert.equal(security.approvals.length,0);
  const changed=await broker.dispatch('codex.shell',{command:[process.execPath,'-e','process.stdout.write("changed")'],cwd:root});assert.equal(changed.stdout,'changed');assert.equal(security.approvals.length,1);
});

test('separate installed plugin IDs use separate security settings under shared base',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-plugin-isolation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const base=path.join(root,'security'),pkg=path.join(root,'package');await fs.mkdir(pkg);
  const a=createPluginSecurity({pluginId:'a',dataRoot:path.join(base,'a'),pluginDir:pkg}),b=createPluginSecurity({pluginId:'b',dataRoot:path.join(base,'b'),pluginDir:pkg});
  t.after(async()=>{await a.close();await b.close();});
  await a.update({allowModelCalls:false});assert.equal((await a.load()).settings.allowModelCalls,false);assert.equal((await b.load()).settings.allowModelCalls,true);
  for(const pluginId of ['a','b']){
    const broker=await createPermissionBroker({root:pkg,target:{entry:'synthetic.mjs'},policy:{pluginId,securityDataRoot:base,stateDir:root,sourceProcess:'inline'},runGuarded:async()=>({}),stopProcess:async()=>{},clientFactory:({launchProcess})=>({async start(){const child=await launchProcess();},async listTools(){return [{name:'probe',inputSchema:{type:'object'}}];},async close(){}})});
    await broker.close();
  }
  assert.equal((await a.load()).settings.allowModelCalls,false);assert.equal((await b.load()).settings.allowModelCalls,true);
});

test('enabled direct source spawn scrubs inherited credentials and forwards only explicit provided credential names',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-direct-env-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const entry=path.join(root,'source.mjs'),bootstrap=path.join(root,'sandbox-entry.mjs');
  await fs.copyFile(new URL('../lib/sandbox-entry.mjs',import.meta.url),bootstrap);await fs.copyFile(new URL('../lib/source-process-policy.mjs',import.meta.url),path.join(root,'source-process-policy.mjs'));
  const childScript='process.stdout.write(JSON.stringify({key:process.env.EXAMPLE_API_KEY??null,endpoint:process.env.DSH_CODEX_TASK_ENDPOINT??null}))';
  await fs.writeFile(entry,`import cp from 'node:child_process';import {promisify} from 'node:util';const asyncResult=await promisify(cp.execFile)(process.execPath,['-e','process.stdout.write("async-result")']);const run=options=>{const r=cp.spawnSync(process.execPath,['-e',${JSON.stringify(childScript)}],{encoding:'utf8',...options});if(r.error)throw r.error;return JSON.parse(r.stdout)};process.stdout.write(JSON.stringify({inherited:run({}),explicit:run({providedSecrets:['EXAMPLE_API_KEY']}),asyncResult}));`);
  const child=await runGuarded({stateDir:root,sourceNode:true,command:process.execPath,args:[bootstrap,JSON.stringify({type:'node',entry,args:[],approvedEnvironment:{EXAMPLE_API_KEY:'synthetic-direct-secret'}}),root,'{}','http://127.0.0.1/synthetic-private-endpoint'],stdio:['ignore','pipe','pipe']});
  let output='',stderr='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>stderr+=data);
  assert.equal(await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}),0,stderr);
  assert.deepEqual(JSON.parse(output),{inherited:{key:null,endpoint:null},explicit:{key:'synthetic-direct-secret',endpoint:null},asyncResult:{stdout:'async-result',stderr:''}});
});
