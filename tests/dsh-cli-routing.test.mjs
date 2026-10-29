import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {installDshCli} from '../lib/dsh-cli-install.mjs';

test('bare dsh routes through a hash-verified CLI without leaking secrets',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-routing-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'dsh-codex-cli.mjs');
  const source='console.log(JSON.stringify({args:process.argv.slice(2),endpoint:process.env.DSH_CODEX_TASK_ENDPOINT,secret:process.env.TEST_SECRET}))';
  await fs.writeFile(file,source);
  const hash=createHash('sha256').update(source).digest('hex');
  const policy=pathToFileURL(path.resolve(import.meta.dirname,'../lib/source-process-policy.mjs')).href;
  const script=`import {installSourceProcessPolicy} from ${JSON.stringify(policy)};
import {spawnSync,execFile} from 'node:child_process';
installSourceProcessPolicy({runtimeRoot:${JSON.stringify(root)},trustedRuntimeHashes:{'dsh-codex-cli.mjs':${JSON.stringify(hash)}},taskEndpoint:'http://127.0.0.1:1234/token'});
const a=spawnSync('dsh',['--profile','headless','hello'],{encoding:'utf8'});
const b=await new Promise((resolve,reject)=>execFile('dsh.cmd',['hello'],{encoding:'utf8'},(e,out)=>e?reject(e):resolve(out)));
console.log(JSON.stringify({a:JSON.parse(a.stdout),b:JSON.parse(b)}));`;
  const output=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,TEST_SECRET:'private'}});
  const result=JSON.parse(output);
  assert.deepEqual(result.a.args,['--profile','headless','hello']);
  assert.deepEqual(result.b.args,['hello']);
  assert.equal(result.a.endpoint,'http://127.0.0.1:1234/token');
  assert.equal(result.b.secret,undefined);
  const rejected=script.replace(hash,'0'.repeat(64)).replace("const b=await new Promise((resolve,reject)=>execFile('dsh.cmd',['hello'],{encoding:'utf8'},(e,out)=>e?reject(e):resolve(out)));", "const b='{}';").replace('JSON.parse(a.stdout)','a.error?.code');
  const denied=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',rejected],{encoding:'utf8',env:{...process.env,PATH:root,Path:root}}));
  assert.equal(denied.a,'ENOENT');
});

test('installer copies the generic CLI and returns its hash',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-install-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const result=await installDshCli(root);
  const contents=await fs.readFile(path.join(root,'runtime',result.name));
  assert.equal(result.sha256,createHash('sha256').update(contents).digest('hex'));
});
