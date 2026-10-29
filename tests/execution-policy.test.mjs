import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveExecutionPolicy,SANDBOX_STATE_META} from '../lib/execution-policy.mjs';
import {sandboxArgs,runGuarded} from '../lib/sandbox-launch.mjs';
import {createPermissionBroker as actualCreatePermissionBroker} from '../lib/permission-broker.mjs';

const securityStub=()=>({async load(){return {settings:{restrictionsEnabled:true,allowDirectSpawn:false,allowModelCalls:true,allowAgents:true,nativeToolHooks:false,extraReadFolders:[],extraWriteFolders:[],missingHostMetadataMode:'workspace'}};},async notify(){},wrapTool:tool=>tool,async close(){}});
const createPermissionBroker=options=>actualCreatePermissionBroker({...options,security:securityStub()});
const hostMeta=(cwd,profile={type:'disabled'})=>({[SANDBOX_STATE_META]:{permissionProfile:profile,sandboxCwd:pathToFileURL(cwd).href,codexLinuxSandboxExe:null,useLegacyLandlock:false}});
test('only host transport metadata selects full access; manifest/arguments/env-like fields never grant it',()=>{
  const fallback=resolveExecutionPolicy({fullAccess:true,sandboxMode:'danger-full-access',arguments:hostMeta(process.cwd())});
  assert.equal(fallback.mode,'workspace-fallback');assert.equal(fallback.fullAccess,false);
  const full=resolveExecutionPolicy({requestMeta:hostMeta(process.cwd())});
  assert.equal(full.fullAccess,true);assert.equal(full.cwd,process.cwd());
  assert.throws(()=>sandboxArgs({stateDir:process.cwd(),executionPolicy:{...full}}),{code:'SECURITY_HOST_POLICY_UNTRUSTED'});
  assert.throws(()=>resolveExecutionPolicy({requestMeta:{[SANDBOX_STATE_META]:{permissionProfile:{type:'disabled'}}}}),{code:'SECURITY_HOST_POLICY_INVALID'});
  assert.throws(()=>resolveExecutionPolicy({requestMeta:hostMeta(process.cwd(),{type:'external',network:'enabled'})}),{code:'SECURITY_EXTERNAL_SANDBOX_UNAVAILABLE'});
});
test('native policy transport preserves workspace writes and read/glob denials without a state-only override',()=>{
  const profile={type:'managed',network:'enabled',file_system:{type:'restricted',entries:[{path:{type:'special',value:{kind:'root'}},access:'read'},{path:{type:'path',path:process.cwd()},access:'write'},{path:{type:'glob_pattern',pattern:'**/synthetic-secret'},access:'deny'}]}};
  const policy=resolveExecutionPolicy({requestMeta:hostMeta(process.cwd(),profile)});
  const args=sandboxArgs({stateDir:path.join(process.cwd(),'state'),executionPolicy:policy,readRoots:[process.cwd()]});
  assert.deepEqual(JSON.parse(args[2]).permissionProfile,profile);
  assert.ok(!args.some(arg=>arg.includes('dsh_market_guard')));
  assert.ok(!args.some(arg=>arg.includes('denyRead')));
});
test('broker follows each host call, destroys previous authority, and ignores fake metadata in tool arguments',async()=>{
  const seen=[],closed=[];
  const broker=await createPermissionBroker({root:process.cwd(),target:{entry:'fixture.mjs'},policy:{stateDir:process.cwd(),sourceProcess:'inline'},runGuarded:()=>{throw Error('mock must not spawn');},stopProcess:async()=>{},clientFactory:({executionPolicy})=>({async start(){seen.push(executionPolicy);},async listTools(){return [{name:'probe',inputSchema:{type:'object',properties:{}}}];},async request(method,params){return {content:[{type:'text',text:'ok'}],mode:executionPolicy.mode};},async close(){closed.push(executionPolicy.mode);}})});
  try{
    assert.equal((await broker.tools[0].execute({fullAccess:true,_meta:hostMeta(process.cwd())})).mode,'workspace-fallback');
    assert.equal((await broker.tools[0].execute({}, {requestMeta:hostMeta(process.cwd())})).mode,'codex-host');
    assert.equal((await broker.tools[0].execute({})).mode,'workspace-fallback');
    assert.deepEqual(seen.map(p=>p.mode),['workspace-fallback','codex-host','workspace-fallback']);
    assert.deepEqual(closed,['workspace-fallback','codex-host']);
  }finally{await broker.close();}
});
test('broker checks Python tool allowlist and retains actual schemas',async()=>{
  const factory=()=>({async start(){},async listTools(){return [{name:'read',inputSchema:{type:'object',required:['file'],properties:{file:{type:'string'}}}},{name:'write',inputSchema:{type:'object'}}];},async close(){}});
  const options={root:process.cwd(),target:{type:'python',entry:'fixture.py',command:process.execPath,allowTools:['read']},policy:{stateDir:process.cwd()},clientFactory:factory,stopProcess:async()=>{}};
  const broker=await createPermissionBroker(options);assert.deepEqual(broker.tools.map(t=>t.name),['read']);assert.deepEqual(broker.tools[0].inputSchema.required,['file']);await broker.close();
  const missing=await createPermissionBroker({...options,target:{...options.target,allowTools:['missing']}});try{assert.ok(missing.tools.some(tool=>tool.name==='dsh_plugin_settings'));assert.equal((await missing.tools.find(tool=>tool.name==='dsh_plugin_status').execute({})).structuredContent.sourceReady,false);}finally{await missing.close();}
});

test('a missing credential at startup preserves settings and retry recovers original tools without replaying a call',async()=>{
  let attempts=0,calls=0,changes=0;
  const broker=await createPermissionBroker({root:process.cwd(),target:{entry:'fixture.mjs'},policy:{stateDir:process.cwd(),sourceProcess:'inline'},stopProcess:async()=>{},clientFactory:()=>({async start(){if(++attempts===1)throw Error('缺少測試金鑰，請在敏感欄位填寫');},async listTools(){return [{name:'actual_tool',inputSchema:{type:'object'}}];},async request(){calls++;return {content:[{type:'text',text:'real result'}]};},async close(){}})});
  try{broker.onToolsChanged(()=>changes++);const status=await broker.tools.find(t=>t.name==='dsh_plugin_settings').execute({});assert.equal(status.structuredContent.sourceReady,false);assert.match(status.structuredContent.error,/金鑰/);
    const retry=await broker.tools.find(t=>t.name==='dsh_plugin_retry').execute({});assert.equal(retry.structuredContent.sourceReady,true);assert.equal(changes,1);assert.equal(calls,0);
    assert.equal((await broker.tools.find(t=>t.name==='actual_tool').execute({})).content[0].text,'real result');assert.equal(calls,1);
  }finally{await broker.close();}
});
test('trusted task endpoint is injected at bootstrap and destroyed when host authority changes',async()=>{
  const launches=[],taskOptions=[],taskClosed=[];
  const broker=await createPermissionBroker({root:process.cwd(),target:{entry:'fixture.mjs'},policy:{sourceProcess:'worker',stateDir:process.cwd(),codexHome:path.join(process.cwd(),'synthetic-codex-home')},runGuarded:async options=>{launches.push(options);return {};},stopProcess:async()=>{},taskBrokerFactory:async options=>{taskOptions.push(options);return {async startServer(){return {endpoint:'http://127.0.0.1/synthetic-task-token'};},async close(){taskClosed.push(options.executionPolicy.mode);}};},clientFactory:({launchProcess})=>({async start(){await launchProcess();},async listTools(){return [{name:'probe',inputSchema:{type:'object'}}];},async request(){return {content:[{type:'text',text:'ok'}]};},async close(){}})});
  try{
    assert.equal(launches[0].args.at(-1),'http://127.0.0.1/synthetic-task-token');
    await broker.tools[0].execute({}, {requestMeta:hostMeta(process.cwd())});
    assert.equal(launches[1].args.at(-1),'http://127.0.0.1/synthetic-task-token');assert.equal(taskOptions[0].executionPolicy.allowModelCalls,true);assert.deepEqual(taskOptions[1].executionPolicy.sandboxState.permissionProfile,{type:'disabled'});
    await broker.tools[0].execute({});assert.deepEqual(taskClosed,['workspace-fallback','codex-host']);assert.equal(launches[2].args.at(-1),'http://127.0.0.1/synthetic-task-token');
  }finally{await broker.close();}
});
test('native full policy reads and writes synthetic files outside plugin state',{skip:process.env.DSH_NATIVE_POLICY_TEST!=='1'||process.platform!=='win32'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-full-policy-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const stateDir=path.join(root,'state'),outside=path.join(root,'outside.txt');await fs.writeFile(outside,'synthetic ordinary file');
  const script=`const fs=require('node:fs');if(fs.readFileSync(${JSON.stringify(outside)},'utf8')!=='synthetic ordinary file')process.exit(2);fs.writeFileSync(${JSON.stringify(outside)},'full permission works');`;
  const executionPolicy=resolveExecutionPolicy({requestMeta:hostMeta(root)});
  const child=await runGuarded({stateDir,command:process.execPath,args:['-e',script],executionPolicy,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,0,stderr);assert.equal(await fs.readFile(outside,'utf8'),'full permission works');
});
test('native MCP broker changes actual source filesystem access full then restricted',{skip:process.env.DSH_NATIVE_POLICY_TEST!=='1'||process.platform!=='win32',timeout:60000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-native-broker-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const packageRoot=path.join(root,'package'),stateDir=path.join(root,'state'),outside=path.join(root,'ordinary.txt');
  await fs.mkdir(path.join(packageRoot,'runtime'),{recursive:true});await fs.writeFile(outside,'synthetic ordinary content');
  await fs.copyFile(path.resolve(import.meta.dirname,'../lib/sandbox-entry.mjs'),path.join(packageRoot,'runtime/sandbox-entry.mjs'));await fs.copyFile(path.resolve(import.meta.dirname,'../lib/source-process-policy.mjs'),path.join(packageRoot,'runtime/source-process-policy.mjs'));
  const source=`import fs from 'node:fs';import readline from 'node:readline';const attempt=fn=>{try{return fn()}catch(error){return error.code}};for await(const line of readline.createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.id===undefined)continue;let result;if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};else if(m.method==='tools/list')result={tools:[{name:'probe',inputSchema:{type:'object'}}]};else if(m.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({read:attempt(()=>fs.readFileSync(${JSON.stringify(outside)},'utf8')),write:attempt(()=>{fs.writeFileSync(${JSON.stringify(outside)},'full wrote');return 'allowed'}),state:attempt(()=>{fs.writeFileSync(${JSON.stringify(path.join(stateDir,'allowed.txt'))},'ok');return 'allowed'}),mode:JSON.parse(process.env.DSH_CODEX_EXECUTION_POLICY).mode})}]};else result={};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));}`;
  await fs.writeFile(path.join(packageRoot,'source.mjs'),source);
  const broker=await createPermissionBroker({root:packageRoot,target:{entry:'source.mjs',type:'node'},policy:{stateDir,sourceProcess:'inline',denyRead:[],readRoots:[packageRoot]},runGuarded});
  try{
    const probe=async execution=>JSON.parse((await broker.tools[0].execute({},execution)).content[0].text);
    const restricted=await probe();assert.equal(restricted.read,'ERR_ACCESS_DENIED');assert.equal(restricted.write,'ERR_ACCESS_DENIED');assert.equal(restricted.state,'allowed');
    const full=await probe({requestMeta:hostMeta(root)});assert.equal(full.read,'synthetic ordinary content');assert.equal(full.write,'allowed');assert.equal(full.mode,'codex-host');
    const again=await probe();assert.equal(again.read,'ERR_ACCESS_DENIED');assert.equal(again.write,'ERR_ACCESS_DENIED');assert.equal(again.mode,'workspace-fallback');
  }finally{await broker.close();}
  assert.equal(await fs.readFile(outside,'utf8'),'full wrote');
});
test('native managed host policy permits workspace writes and ordinary reads while blocking outside writes',{skip:process.env.DSH_NATIVE_POLICY_TEST!=='1'||process.platform!=='win32'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-workspace-policy-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const workspace=path.join(root,'workspace'),stateDir=path.join(root,'state'),ordinary=path.join(root,'ordinary.txt'),outsideWrite=path.join(root,'outside-write.txt');await fs.mkdir(workspace);await fs.writeFile(ordinary,'synthetic ordinary content');
  const profile={type:'managed',network:'restricted',file_system:{type:'restricted',entries:[{path:{type:'special',value:{kind:'root'}},access:'read'},{path:{type:'path',path:workspace},access:'write'}]}};
  const executionPolicy=resolveExecutionPolicy({requestMeta:hostMeta(workspace,profile)});
  const script=`const fs=require('node:fs');if(fs.readFileSync(${JSON.stringify(ordinary)},'utf8')!=='synthetic ordinary content')process.exit(2);fs.writeFileSync(${JSON.stringify(path.join(workspace,'allowed.txt'))},'allowed');try{fs.writeFileSync(${JSON.stringify(outsideWrite)},'unexpected');process.exit(3)}catch{}`;
  const child=await runGuarded({stateDir,command:process.execPath,args:['-e',script],executionPolicy,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,0,stderr);await assert.rejects(fs.access(outsideWrite));assert.equal(await fs.readFile(path.join(workspace,'allowed.txt'),'utf8'),'allowed');
});
