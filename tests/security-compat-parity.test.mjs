import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPluginSecurity} from '../lib/plugin-security.mjs';
import {scanSecurity,obfuscationMetrics,judgeObfuscation} from '../lib/security-scan.mjs';
import {loadDshHost} from '../lib/dsh-host.mjs';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-parity-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('concrete obfuscation markers distinguish ordinary compressed code and embedded image data',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'compressed.mjs'),'export const values=['+Array.from({length:5000},(_,i)=>i).join(',')+'];');
  await fs.writeFile(path.join(root,'image.mjs'),'export const image="data:image/png;base64,'+'a'.repeat(8000)+'";');
  await fs.writeFile(path.join(root,'README.md'),'agent eval(atob("example")) '+'x'.repeat(10000));
  let scan=await scanSecurity(root);assert.equal(scan.obfuscated,false);assert.equal(scan.findings.some(row=>row.file==='README.md'),false);
  assert.equal(judgeObfuscation(obfuscationMetrics('const value="'+'x'.repeat(8000)+'";')).minified,true);
  await fs.writeFile(path.join(root,'packed.mjs'),'eval(atob("c3ludGhldGlj"));');
  scan=await scanSecurity(root);assert.equal(scan.obfuscated,true);assert.ok(scan.findings.some(row=>row.file==='packed.mjs'&&row.unreadable&&row.reasons.some(reason=>reason.includes('eval'))));
  const renamed=Array.from({length:30},(_,i)=>`const _0x${i.toString(16).padStart(3,'0')}=${i};`).join('');assert.equal(judgeObfuscation(obfuscationMetrics(renamed)).obfuscated,true);
});

test('automatic posting limits use rolling windows, zero disables each limit, and manual pause persists',async t=>{
  const root=await fixture(t);let clock=Date.parse('2026-10-25T00:00:00Z');
  const s=createPluginSecurity({pluginId:'fixture',dataRoot:path.join(root,'security'),postingTools:['send_message'],now:()=>clock,openBrowser:async()=>{}});t.after(()=>s.close());await s.load();
  assert.equal(s.snapshot().settings.posting.hourLimit,10);assert.equal(s.snapshot().settings.posting.dayLimit,50);
  await s.update({posting:{mode:'auto',hourLimit:1,dayLimit:0}});
  async function reserve(){const ticket=await s.gatePosting({toolName:'send_message',args:{to:'synthetic',content:'no external send'}});await ticket.finish(true);}
  await reserve();await assert.rejects(reserve(),error=>error.code==='SECURITY_POSTING_RATE_LIMIT'&&error.retryAt==='2026-10-25T01:00:00.000Z');assert.equal(s.snapshot().settings.posting.paused,false);
  clock+=3600000;await reserve();
  await s.update({posting:{hourLimit:0,dayLimit:2}});await assert.rejects(reserve(),{code:'SECURITY_POSTING_RATE_LIMIT'});assert.equal(s.snapshot().settings.posting.paused,false);
  clock+=86400000;await reserve();
  await s.update({posting:{hourLimit:0,dayLimit:0}});for(let i=0;i<3;i++)await reserve();
  await s.update({posting:{paused:true}});clock+=86400000;await assert.rejects(reserve(),{code:'SECURITY_POSTING_RATE_LIMIT'});assert.equal(s.snapshot().settings.posting.paused,true);
  await s.update({posting:{paused:false}});await reserve();
  for(const value of [-1,0.5,'0'])await assert.rejects(s.update({posting:{hourLimit:value}}),{code:'SECURITY_SETTINGS_INVALID'});
  const ui=await s.ensureUi(),client=await (await fetch(ui.origin+'/client.js')).text();assert.match(client,/i\.min='0'/);assert.match(client,/0 表示不限/);
});

test('synthetic host starts with default restrictions, direct launch flags, and restrictions omitted',async t=>{
  const root=await fixture(t),workerPath=path.join(root,'synthetic-worker.mjs');
  await fs.writeFile(workerPath,`import {spawnSync} from 'node:child_process';import {Worker} from 'node:worker_threads';
process.on('message',async m=>{let result={tools:[],metadata:{}};if(m.method==='probe'){let child,worker;try{child=spawnSync(process.execPath,['-e','process.stdout.write("synthetic")'],{encoding:'utf8'});child={output:child.stdout,code:child.error?.code??child.status};}catch(e){child={code:e.code};}try{worker=await new Promise((resolve,reject)=>{const w=new Worker('require("node:worker_threads").parentPort.postMessage("synthetic")',{eval:true});w.once('message',resolve);w.once('error',reject);});}catch(e){worker=e.code;}result={args:process.execArgv,child,worker};}process.send({id:m.id,result});});`);
  const readRoots=[root,path.dirname(process.execPath)],writeRoots=[root];
  for(const mode of ['default','direct','unrestricted']){
    const host=await loadDshHost({entry:workerPath,workerPath,stateDir:path.join(root,mode),runtimeRoot:root,...(mode==='unrestricted'?{}:{workerPermissions:{readRoots,writeRoots,allowDirectSpawn:mode==='direct'}})});
    try{const result=await host.request('probe');const flags=['--allow-child-process','--allow-worker','--allow-addons','--allow-wasi'];
      for(const flag of flags)assert.equal(result.args.includes(flag),mode==='direct');
      if(mode==='default'){assert.equal(result.child.code,'ERR_ACCESS_DENIED');assert.equal(result.worker,'ERR_ACCESS_DENIED');}
      else{assert.equal(result.child.code,0);assert.equal(result.child.output,'synthetic');assert.equal(result.worker,'synthetic');}
    }finally{await host.dispose();}
  }
});


test('Python byte palettes and cryptographic test vectors do not trigger JavaScript obfuscation enforcement',async t=>{
  const root=await fixture(t),escapedBytes='\\x01\\x02\\x03'.repeat(256).replaceAll('\\\\','\\');
  const palette='# Image palette bytes\nquake2palette = b"'+escapedBytes+'"\nimage.putpalette(quake2palette)\n';
  const vectors='import unittest\nclass DerTests(unittest.TestCase):\n    def test_encoding(self):\n        self.assertEqual(encode(value), b"'+escapedBytes+'")\n';
  // Both examples exceed the JS hexadecimal-escape density heuristic.
  for(const content of [palette,vectors])assert.equal(judgeObfuscation(obfuscationMetrics(content)).obfuscated,true);
  await fs.writeFile(path.join(root,'palette.py'),palette);await fs.writeFile(path.join(root,'test_vectors.py'),vectors);
  await fs.writeFile(path.join(root,'decode.py'),'import base64\nvalue = base64.b64decode("c3ludGhldGlj")\n');
  let scan=await scanSecurity(root);assert.equal(scan.obfuscated,false);assert.equal(scan.findings.some(row=>row.unreadable===true),false);assert.ok(scan.findings.some(row=>row.file==='decode.py'&&row.category==='obfuscation'));
  await fs.writeFile(path.join(root,'packed.mjs'),'eval(atob("c3ludGhldGlj"));');
  scan=await scanSecurity(root);assert.equal(scan.obfuscated,true);assert.ok(scan.findings.some(row=>row.file==='packed.mjs'&&row.unreadable===true));
});
