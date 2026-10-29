import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createPluginSecurity} from '../lib/plugin-security.mjs';

test('host execute RPC wraps the tool object, preserves secret redaction and enforces posting denial',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'host-rpc-security-'));
  let runtime,security;
  t.after(async()=>{await runtime?.dispose();await security?.close();await fs.rm(root,{recursive:true,force:true});});
  const source=path.join(root,'source'),runtimeDir=path.join(root,'runtime'),dataRoot=path.join(root,'security');
  await fs.mkdir(source);await fs.mkdir(runtimeDir);
  const packageRoot=fileURLToPath(new URL('../',import.meta.url));
  await fs.symlink(packageRoot,path.join(runtimeDir,'host-env'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(runtimeDir,'dsh-host-worker.mjs'),`import ${JSON.stringify(pathToFileURL(path.join(packageRoot,'lib/dsh-host-worker.mjs')).href)};`);
  await fs.writeFile(path.join(source,'package.json'),'{"type":"module"}');
  await fs.writeFile(path.join(source,'index.js'),`
    import {defineTool} from '@deepseek-ai/dsh-tools';
    export const inject=['tools'];
    export function apply(ctx){let sends=0;
      const output={schema:{type:'json'},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]};
      ctx.tools.register(defineTool({name:'inspect_fixture',description:'Synthetic local state',parameters:{},output,execute:async()=>({secret:process.env.API_KEY,sends})}));
      ctx.tools.register(defineTool({name:'send_message',description:'Synthetic counter only; no network',parameters:{},output,execute:async()=>{sends++;return {sends};}}));
    }`);
  const secret='synthetic-host-secret-012345',policy={pluginId:'host-rpc-fixture',dataRoot,declaredSecrets:[{name:'API_KEY',provided:true,value:secret}]};
  security=createPluginSecurity(policy);await security.update({posting:{mode:'deny'}});
  // host-server captures the trusted native policy at module evaluation time.
  const previous=process.env.DSH_CODEX_EXECUTION_POLICY;
  let createDshHostRuntime;
  try{
    process.env.DSH_CODEX_EXECUTION_POLICY=JSON.stringify({pluginSecurity:policy});
    ({createDshHostRuntime}=await import('../lib/host-server.mjs?host-rpc-security-regression'));
  }finally{if(previous===undefined)delete process.env.DSH_CODEX_EXECUTION_POLICY;else process.env.DSH_CODEX_EXECUTION_POLICY=previous;}
  runtime=await createDshHostRuntime({root,options:{stateMode:'package',entry:'index.js',services:[],codexCommand:'dsh-test-no-codex-executable'}});

  const result=await runtime.rpc('execute',{name:'inspect_fixture',args:{}});
  assert.deepEqual(JSON.parse(result.content[0].text),{secret:'[已隱藏敏感值]',sends:0});
  assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));
  assert.ok(result._meta.securitySettingsUrl);
  await assert.rejects(runtime.rpc('execute',{name:'send_message',args:{to:'synthetic',content:'no external action'}}),{code:'SECURITY_POSTING_DENIED'});
  const after=await runtime.rpc('execute',{name:'inspect_fixture',args:{}});
  assert.equal(JSON.parse(after.content[0].text).sends,0);
  await assert.rejects(runtime.rpc('execute',{name:'missing_tool',args:{}}),/沒有啟用工具/);
});
