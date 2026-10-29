import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {preparePluginUi} from '../lib/ui-assets.mjs';
import {createRpc} from '../ui/runtime.mjs';
import {createRemoteServices} from '../ui/remote.mjs';

test('real browser transport reaches worker credential provider and parent storage without exposing keys',{skip:process.env.CODEX_INTEGRATION!=='1',timeout:60000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ui-host-key-'));let runtime,remote;
  t.after(async()=>{remote?.dispose();await runtime?.dispose();await fs.rm(root,{recursive:true,force:true});});
  const converterRoot=fileURLToPath(new URL('../',import.meta.url)),sourceRoot=path.join(root,'source'),runtimeDir=path.join(root,'runtime');
  await fs.mkdir(sourceRoot);await fs.mkdir(runtimeDir);
  await fs.symlink(converterRoot,path.join(runtimeDir,'host-env'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(runtimeDir,'dsh-host-worker.mjs'),`import ${JSON.stringify(pathToFileURL(path.join(converterRoot,'lib/dsh-host-worker.mjs')).href)};`);
  await fs.writeFile(path.join(sourceRoot,'package.json'),JSON.stringify({name:'key-ui-fixture',type:'module',dsh:{client:'client.js'}}));
  await fs.writeFile(path.join(sourceRoot,'client.js'),'// Source frontend provenance fixture; no model or external effects.');
  await fs.writeFile(path.join(sourceRoot,'index.js'),`
    import {defineTool} from '@deepseek-ai/dsh-tools';
    export const inject=['connection','credentials','tools'];
    export function apply(ctx){
      const read=async()=>({secret:(await ctx.credentials.resolve('DEMO_KEY'))?.value});
      ctx.connection.rpc.handle('/fixture',async()=>({ok:true,value:await read()}));
      ctx.tools.register(defineTool({name:'reveal_fixture',description:'Synthetic local redaction probe',parameters:{},output:{schema:{type:'json'},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:read}));
    }
  `);
  await preparePluginUi({converterRoot,sourceRoot,outputDir:root});
  const previousHome=process.env.CODEX_HOME,previousPolicy=process.env.DSH_CODEX_EXECUTION_POLICY;
  try{
    process.env.CODEX_HOME=path.join(root,'private-home');delete process.env.DSH_CODEX_EXECUTION_POLICY;
    const {createDshHostRuntime}=await import('../lib/host-server.mjs?ui-key-roundtrip');
    runtime=await createDshHostRuntime({root,options:{stateMode:'package',entry:'index.js',services:['settings'],codexCommand:process.env.CODEX_BIN??'codex'}});
  }finally{if(previousHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousHome;if(previousPolicy===undefined)delete process.env.DSH_CODEX_EXECUTION_POLICY;else process.env.DSH_CODEX_EXECUTION_POLICY=previousPolicy;}
  const {url}=await runtime.rpc('ui.open');
  const rpc=createRpc((relative,options)=>fetch(new URL(relative,url),options));
  remote=createRemoteServices({rpc});
  const secret='synthetic-full-ui-key-123456';assert.equal((await remote.remote.credentials.set('DEMO_KEY',secret)).ok,true);
  assert.equal((await remote.remote.credentials.describe(['DEMO_KEY'])).value.DEMO_KEY.configured,true);
  const peek=await remote.connection.rpc.call('/fixture','peek',{});
  assert.equal(peek.value.secret,'[已隱藏敏感值]');
  assert.ok(!JSON.stringify(await runtime.rpc('execute',{name:'reveal_fixture'})).includes(secret));
  assert.ok(!JSON.stringify(await runtime.getTools().find(tool=>tool.name==='reveal_fixture').execute({})).includes(secret));
  const base=path.join(root,'private-home','dsh-to-codex-credentials'),directories=await fs.readdir(base);
  assert.equal(directories.length,1);assert.equal(JSON.parse(await fs.readFile(path.join(base,directories[0],'credentials.json'),'utf8')).refs.DEMO_KEY,secret);
  await remote.remote.credentials.unset('DEMO_KEY');assert.equal((await remote.remote.credentials.describe(['DEMO_KEY'])).value.DEMO_KEY.configured,false);
});
