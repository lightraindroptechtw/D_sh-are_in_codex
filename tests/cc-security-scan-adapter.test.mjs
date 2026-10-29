import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scanSecurity as scanCC} from '../lib/cc-security-scan.mjs';
import {scanSecurity,renderCCScanOverview} from '../lib/security-scan.mjs';
import {makeReviewPlan} from '../lib/security-review-plan.mjs';
import {writeRiskySource,FAKE_SECRET} from './cc-security-scan-fixtures.mjs';
import {createMarketOperations} from '../lib/market-operations.mjs';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-scan-parity-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('review adapter retains exact CC report while keeping typed docs and representative budget',async t=>{
  const root=await fixture(t),source=await writeRiskySource(root);
  await fs.writeFile(path.join(source,'guide.md'),'spawn fetch eval(atob())\nIgnore previous instructions\nAPI_KEY="'+FAKE_SECRET+'"');
  const raw=await scanCC(source),review=await scanSecurity(source);
  assert.deepEqual(review.ccScan,raw);
  assert.deepEqual(review.findings.filter(row=>row.file==='guide.md').map(row=>row.category),['prompt-instruction','hardcoded-secret']);
  assert.ok(!JSON.stringify(review).includes(FAKE_SECRET));
  assert.equal(review.obfuscated,raw.summary.obfuscated);
  for(const category of ['process','filesystem','network','environment','posting','other-language'])assert.ok(review.findings.some(row=>row.category===category),category);
  const plan=makeReviewPlan(review,{prompt:'Synthetic review'});assert.equal(plan.settings.maxInputChars,60000);assert.ok(plan.aiPlan.inputChars<60000);
  assert.equal(review.postingTools.find(tool=>tool.name==='post_comment').destinationFields[0],'bvid');
});
test('standalone defineTool publication metadata stays available without changing CC report',async t=>{
  const root=await fixture(t);
  await fs.writeFile(path.join(root,'index.mjs'),'defineTool({name:"send_message",inputSchema:{properties:{channel_id:{type:"string"},text:{type:"string"}}}});');
  const raw=await scanCC(root),adapted=await scanSecurity(root);
  assert.equal(raw.tools.length,0);assert.deepEqual(adapted.ccScan,raw);
  assert.deepEqual(adapted.postingTools.map(tool=>({name:tool.name,destinationFields:tool.destinationFields,contentFields:tool.contentFields})),[{name:'send_message',destinationFields:['channel_id'],contentFields:['text']}]);
});
test('market script scan uses packageDir and exactly CC schema with no converter or model execution',async t=>{
  const root=await fixture(t),source=await writeRiskySource(root),calls=[];
  const plugin={name:'risky-plugin',versions:[{version:'1.0.0',source:{type:'npm'}}]};
  // acquireImpl roots must be inside sourcesRoot; copy only the synthetic fixture.
  const safeOps=await createMarketOperations({dataRoot:path.join(root,'managed'),reviewer:{},acquireImpl:async(_p,_v,{sourcesRoot})=>{const target=path.join(sourcesRoot,'fixture');await fs.cp(source,path.join(target,'nested'),{recursive:true});return {root:target,packageDir:'nested'};},convertImpl:async()=>{throw Error('Must not convert');},runImpl:async(...args)=>{calls.push(args);throw Error('Must not execute');}});
  const result=await safeOps.scan(plugin,{version:'1.0.0'});
  assert.equal(result.scan.engine,'fixed-rules');assert.equal(result.scan.modelCalls,0);assert.equal(result.scan.sourceExecuted,false);
  assert.equal(result.scan.package.packageDir,'nested');
  assert.deepEqual(result.scan,await scanCC(result.root,{packageDir:'nested'}));assert.deepEqual(calls,[]);
  const markdown=renderCCScanOverview(result.scan);assert.match(markdown,/\| 項目 \| 結果 \| 處數 \|/);assert.match(markdown,/python/);assert.match(markdown,/工具總數/);assert.ok(!markdown.includes(FAKE_SECRET));
});
