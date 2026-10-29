import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {convert} from '../lib/converter.mjs';

async function fixture(t,options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-security-env-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),out=path.join(root,'generated');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'security-env-fixture',type:'module',main:'index.js'}));
  await fs.writeFile(path.join(source,'index.js'),`const observed=[process.env.DSH_SECURITY_UNTRUSTED_SECRET,process.env.HTTPS_PROXY];
export function apply(ctx){ctx.tools.register({name:'noop',description:'No operation',parameters:{type:'object'},execute:async()=>({ok:true})});}`);
  const report=await convert(source,{outputDir:out,stateRoot:path.join(root,'state'),engine:'portable-tools',hooks:false,installDependencies:false,...options});
  const manifest=JSON.parse(await fs.readFile(path.join(out,'.mcp.json'),'utf8'));
  return {report,servers:Object.values(manifest.mcpServers),out};
}

test('source environment references and ambient proxy names request access without authorizing forwarding',async t=>{
  const {report,servers,out}=await fixture(t);
  assert.deepEqual(report.environment.requestedEnvNames,['DSH_SECURITY_UNTRUSTED_SECRET','HTTPS_PROXY']);
  assert.equal(Object.hasOwn(report.environment,'requiredNames'),false);
  assert.deepEqual(report.conversion.runtimeOptions.passEnv,[]);
  for(const server of servers)assert.deepEqual(server.env_vars,[]);
  const saved=JSON.parse(await fs.readFile(path.join(out,'conversion-report.json'),'utf8'));
  assert.deepEqual(saved.environment.requestedEnvNames,report.environment.requestedEnvNames);
  assert.deepEqual(saved.conversion.runtimeOptions.passEnv,[]);
});

test('only explicit passEnv authorizes requested source and proxy environment forwarding',async t=>{
  const {report,servers}=await fixture(t,{passEnv:['HTTPS_PROXY','DSH_SECURITY_EXPLICIT','HTTPS_PROXY']});
  assert.deepEqual(report.conversion.runtimeOptions.passEnv,['DSH_SECURITY_EXPLICIT','HTTPS_PROXY']);
  for(const server of servers){
    assert.deepEqual(server.env_vars,['DSH_SECURITY_EXPLICIT','HTTPS_PROXY']);
    assert.equal(server.env_vars.includes('DSH_SECURITY_UNTRUSTED_SECRET'),false);
  }
});

test('explicit module credential mappings retain forwarding without granting source-requested names',async t=>{
  const moduleOptions={credentials:{envMapping:{configured:'DSH_SECURITY_MAPPED'}},llm:{allowedApiRoutes:[{provider:'test',model:'test',credentialEnv:'DSH_SECURITY_API'}]}};
  const {report,servers}=await fixture(t,{moduleOptions});
  assert.deepEqual(report.conversion.runtimeOptions.passEnv,['DSH_SECURITY_API','DSH_SECURITY_MAPPED']);
  for(const server of servers)assert.deepEqual(server.env_vars,['DSH_SECURITY_API','DSH_SECURITY_MAPPED']);
});
