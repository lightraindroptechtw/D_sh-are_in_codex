import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {buildOfficialHost} from '../lib/host-build.mjs';

test('disabled hooks are not compiled and cannot seed an enabled-hook cache entry',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-host-build-selection-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3}));
  const converterRoot=path.join(root,'converter'),lib=path.join(converterRoot,'lib');
  await fs.mkdir(lib,{recursive:true});await fs.mkdir(path.join(converterRoot,'ui'));
  const sdk=path.join(converterRoot,'node_modules/@deepseek-ai/cordis');await fs.mkdir(sdk,{recursive:true});
  await fs.writeFile(path.join(sdk,'package.json'),JSON.stringify({name:'@deepseek-ai/cordis',version:'4.0.5'}));
  await fs.writeFile(path.join(converterRoot,'package.json'),JSON.stringify({dependencies:{'@deepseek-ai/cordis':'4.0.5'}}));
  await fs.writeFile(path.join(converterRoot,'package-lock.json'),'{}');
  await fs.writeFile(path.join(lib,'host-server.mjs'),'export async function serveDshHost(){};export async function runDshDaemon(){};');
  await fs.writeFile(path.join(lib,'dsh-host-worker.mjs'),'process.env.SYNTHETIC_HOST_WORKER_EXECUTED="yes";');
  // Deliberately omit the hook dependencies: a disabled hook must never be built.
  const plan={name:'synthetic-host',entry:'index.mjs',defaultConfig:{}};
  const disabled=path.join(root,'disabled');
  const result=await buildOfficialHost({converterRoot,outputDir:disabled,plan,hooks:false});
  assert.equal(result.hooksGenerated,false);assert.equal(result.sourceExecuted,false);
  for(const file of ['server.mjs','dsh-host-worker.mjs','background.mjs'])await fs.access(path.join(disabled,'runtime',file));
  await assert.rejects(fs.access(path.join(disabled,'runtime/codex-hook.mjs')),{code:'ENOENT'});
  await assert.rejects(fs.access(path.join(disabled,'hooks/hooks.json')),{code:'ENOENT'});
  assert.equal(process.env.SYNTHETIC_HOST_WORKER_EXECUTED,undefined);
  // Same source bytes with hooks enabled must try to compile the missing hook;
  // silently reusing the no-hook template would instead return corrupt output.
  await assert.rejects(buildOfficialHost({converterRoot,outputDir:path.join(root,'missing-hook'),plan,hooks:true}),/Could not resolve/);
  await fs.writeFile(path.join(lib,'codex-events.mjs'),'export async function recordCodexHook(){return {output:{}}}');
  await fs.writeFile(path.join(lib,'state-paths.mjs'),'export function resolvePluginState(){return ".state"}');
  await fs.writeFile(path.join(lib,'hook-broker.mjs'),'export async function runNativeHook(){return {}}');
  const enabled=path.join(root,'enabled');
  const enabledResult=await buildOfficialHost({converterRoot,outputDir:enabled,plan,hooks:true});
  assert.equal(enabledResult.hooksGenerated,true);
  assert.notEqual(enabledResult.runtimeTemplate.hash,result.runtimeTemplate.hash);
  await fs.access(path.join(enabled,'runtime/codex-hook.mjs'));
  const manifest=JSON.parse(await fs.readFile(path.join(enabled,'hooks/hooks.json'),'utf8'));
  assert.ok(Object.keys(manifest.hooks).length>0);
});
