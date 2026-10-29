import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {precompileSource} from '../lib/precompile-source.mjs';
import {loadDshHost} from '../lib/dsh-host.mjs';

test('reviewed synthetic worker denies outside credentials, outside writes and child processes while allowing its own state',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-worker-permissions-'));
  let host;
  t.after(async()=>{await host?.dispose();await fs.rm(root,{recursive:true,force:true});});
  const packageRoot=path.join(root,'package'),source=path.join(packageRoot,'source'),runtime=path.join(packageRoot,'runtime','host-env'),stateDir=path.join(root,'state');
  const outsideKey=path.join(root,'synthetic-key.json'),outsideWrite=path.join(root,'outside-write'),ownWrite=path.join(stateDir,'own-write');
  await fs.mkdir(source,{recursive:true});await fs.mkdir(runtime,{recursive:true});
  await fs.writeFile(outsideKey,'SYNTHETIC_KEY_MUST_NOT_BE_READ');await fs.writeFile(path.join(source,'package.json'),'{}');await fs.writeFile(path.join(runtime,'package.json'),'{}');
  const trustedRuntime=path.resolve(import.meta.dirname,'..');
  await fs.symlink(path.join(trustedRuntime,'node_modules'),path.join(runtime,'node_modules'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(source,'entry.mjs'),`import fs from 'node:fs';import cp from 'node:child_process';import {defineTool} from '@deepseek-ai/dsh-tools';export const inject=['tools'];export function apply(ctx){ctx.tools.register(defineTool({name:'permission_probe',description:'Synthetic permission checks',parameters:{},output:{schema:{type:'json'},render:(_,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async()=>{const attempt=fn=>{try{fn();return 'allowed'}catch(error){return error.code}};return {read:attempt(()=>fs.readFileSync(${JSON.stringify(outsideKey)},'utf8')),write:attempt(()=>fs.writeFileSync(${JSON.stringify(outsideWrite)},'bad')),state:attempt(()=>fs.writeFileSync(${JSON.stringify(ownWrite)},'ok')),child:attempt(()=>{const r=cp.spawnSync(process.execPath,['-e','process.exit(0)']);if(r.error)throw r.error})}}}));}`);
  const compiled=await precompileSource({packageRoot,settings:{entry:'entry.mjs'}});
  host=await loadDshHost({entry:path.join(source,'entry.mjs'),sourceRoot:source,runtimeRoot:runtime,stateDir,services:[],modules:[],codexCapabilities:{codexVersion:'0.160.0',mcp:true,skills:true},precompiledSource:compiled.file,precompiledSourceMarker:compiled.marker,workerPermissions:{readRoots:[packageRoot,stateDir,trustedRuntime],writeRoots:[stateDir]}});
  const result=await host.tools.find(tool=>tool.name==='permission_probe').execute();
  assert.notEqual(result.isError,true,JSON.stringify(result));
  assert.deepEqual(result.structuredContent,{read:'ERR_ACCESS_DENIED',write:'ERR_ACCESS_DENIED',state:'allowed',child:'ERR_ACCESS_DENIED'});
  await assert.rejects(fs.access(outsideWrite));assert.equal(await fs.readFile(ownWrite,'utf8'),'ok');assert.equal(await fs.readFile(outsideKey,'utf8'),'SYNTHETIC_KEY_MUST_NOT_BE_READ');
});

test('sensitive source configuration reaches official apply in memory without persisting values into generated profile',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-sensitive-config-'));let host;
  t.after(async()=>{await host?.dispose();await fs.rm(root,{recursive:true,force:true});});
  const packageRoot=path.join(root,'package'),source=path.join(packageRoot,'source'),runtime=path.join(packageRoot,'runtime','host-env'),stateDir=path.join(root,'state');
  await fs.mkdir(source,{recursive:true});await fs.mkdir(runtime,{recursive:true});
  await fs.writeFile(path.join(source,'package.json'),'{}');await fs.writeFile(path.join(runtime,'package.json'),'{}');
  const trustedRuntime=path.resolve(import.meta.dirname,'..');
  await fs.symlink(path.join(trustedRuntime,'node_modules'),path.join(runtime,'node_modules'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(source,'entry.mjs'),`import{defineTool}from'@deepseek-ai/dsh-tools';export const inject=['tools'];export function apply(ctx,config){ctx.tools.register(defineTool({name:'config_probe',description:'Synthetic configuration',parameters:{},output:{schema:{type:'json'},render:(_,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async()=>({keyLength:config.apiKey.length,nestedLength:config.nested.token.length})}));}`);
  const compiled=await precompileSource({packageRoot,settings:{entry:'entry.mjs'}});
  const apiKey='SYNTHETIC_CONFIG_KEY_NOT_FOR_DISK',token='SYNTHETIC_NESTED_TOKEN_NOT_FOR_DISK';
  host=await loadDshHost({entry:path.join(source,'entry.mjs'),sourceRoot:source,runtimeRoot:runtime,stateDir,services:[],modules:[],config:{apiKey,nested:{token}},sensitiveConfigFields:[{path:['apiKey'],envName:'SOURCE_KEY'},{path:['nested','token'],envName:'SOURCE_TOKEN'}],codexCapabilities:{codexVersion:'0.160.0',mcp:true,skills:true},precompiledSource:compiled.file,precompiledSourceMarker:compiled.marker,workerPermissions:{readRoots:[packageRoot,stateDir,trustedRuntime],writeRoots:[stateDir]}});
  const result=await host.tools.find(tool=>tool.name==='config_probe').execute();assert.notEqual(result.isError,true,JSON.stringify(result));
  assert.deepEqual(result.structuredContent,{keyLength:apiKey.length,nestedLength:token.length});
  const persisted=await fs.readFile(path.join(stateDir,'profiles','codex-bridge','node_modules','codex-host-bundle','cordis.patch.yml'),'utf8');
  assert.ok(!persisted.includes(apiKey));assert.ok(!persisted.includes(token));
});
