import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSecurityReviewer,reviewSchema} from '../lib/security-review.mjs';
import Ajv from 'ajv';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'conversation-review-')),source=path.join(root,'source'),dataRoot=path.join(root,'data');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'main.mjs'),'fetch("https://example.com/synthetic");');await fs.writeFile(path.join(source,'README.md'),'Synthetic documentation.');
  t.after(()=>fs.rm(root,{recursive:true,force:true}));let commands=0;
  const options={dataRoot,runImpl:async()=>{commands++;throw Error('Conversation review must not start a process');},readUsage:async()=>{throw Error('Conversation review must not query a model account');}};
  const reviewer=await createSecurityReviewer(options),prior=await reviewer.review(source,{skipAI:true});
  const judgment={verdict:'approve',risk:'low',summary:'主對話只審查明確回報的來源檔案。',findings:[{severity:'info',file:'main.mjs',reason:'合成範例包含網路呼叫。'}],sourceDigest:prior.sourceDigest,coveredFiles:['main.mjs']};
  return {root,source,dataRoot,options,reviewer,prior,judgment,commands:()=>commands};
}

test('main-conversation verdicts produce fresh signed advisory receipts without running a model or CLI',async t=>{
  const f=await fixture(t),validate=new Ajv().compile(reviewSchema);assert.equal(validate(f.judgment),true);
  for(const [verdict,status]of [['approve','approved'],['manual_review','manual_review'],['reject','rejected']]){
    const receipt=await f.reviewer.completeConversationReview(f.source,f.prior,{...f.judgment,verdict});
    assert.notEqual(receipt.id,f.prior.id);assert.equal(receipt.priorReviewId,f.prior.id);assert.equal(receipt.status,status);assert.equal(receipt.reviewOrigin,'main-conversation');assert.equal(receipt.modelReview,true);
    assert.deepEqual(receipt.scan,f.prior.scan);assert.deepEqual(receipt.aiPlan,f.prior.aiPlan);assert.equal(receipt.summary,f.judgment.summary);assert.deepEqual(receipt.findings,f.judgment.findings);assert.deepEqual(receipt.coveredFiles,['main.mjs']);assert.deepEqual(receipt.uncoveredFiles,['README.md']);
    assert.match(receipt.coverageNotice,/不代表已閱讀檔案中的所有片段/);assert.match(receipt.scope,/advisory/);assert.match(receipt.scope,/no-install-gate/);
    assert.equal(receipt.aiProgress.cliCalls,0);assert.equal(receipt.aiProgress.usageMeasured,false);assert.equal(receipt.modelUsage.available,false);
    for(const field of ['sentChars','completedChars','remainingChars','submittedCalls','completedCalls'])assert.equal(Object.hasOwn(receipt.aiProgress,field),false);
    for(const field of ['inputTokens','cachedInputTokens','outputTokens'])assert.equal(Object.hasOwn(receipt.modelUsage,field),false);
    assert.deepEqual(await f.reviewer.verify(f.source,receipt),receipt);
    const restarted=await createSecurityReviewer(f.options);assert.deepEqual(await restarted.verify(f.source,receipt),receipt);
  }
  assert.equal(f.commands(),0);assert.deepEqual(await f.reviewer.verify(f.source,f.prior),f.prior);
});

test('coverage may be empty or partial and cannot include an unscanned or external path',async t=>{
  const f=await fixture(t);
  const receipt=await f.reviewer.completeConversationReview(f.source,f.prior,{...f.judgment,coveredFiles:[]});assert.deepEqual(receipt.coveredFiles,[]);assert.equal(receipt.uncoveredFiles.length,2);assert.match(receipt.coverageNotice,/沒有回報任何已覆蓋檔案/);
  for(const file of ['../outside.mjs','/outside.mjs','C:\\outside.mjs','missing.mjs','./main.mjs','main.mjs/../README.md'])await assert.rejects(f.reviewer.completeConversationReview(f.source,f.prior,{...f.judgment,coveredFiles:[file]}),{code:'SECURITY_INTEGRITY_FAILED'});
  assert.equal(f.commands(),0);
});

test('invalid schema, source digest mismatch, changed source and receipt tampering are rejected',async t=>{
  const f=await fixture(t);
  for(const judgment of [{...f.judgment,verdict:'unsafe'},{...f.judgment,summary:''},{...f.judgment,sourceDigest:'other'},{...f.judgment,extra:true},{...f.judgment,coveredFiles:undefined}])await assert.rejects(f.reviewer.completeConversationReview(f.source,f.prior,judgment),{code:'SECURITY_INTEGRITY_FAILED'});
  await assert.rejects(f.reviewer.completeConversationReview(f.source,{...f.prior,signature:'0'.repeat(64)},f.judgment),{code:'SECURITY_INTEGRITY_FAILED'});
  const completed=await f.reviewer.completeConversationReview(f.source,f.prior,f.judgment),file=path.join(f.dataRoot,'reviews',completed.id,'review.json'),record=JSON.parse(await fs.readFile(file));record.summary='tampered';await fs.writeFile(file,JSON.stringify(record));await assert.rejects(f.reviewer.verify(f.source,completed),{code:'SECURITY_INTEGRITY_FAILED'});
  await fs.appendFile(path.join(f.source,'main.mjs'),'\n// source changed');await assert.rejects(f.reviewer.completeConversationReview(f.source,f.prior,f.judgment),{code:'SECURITY_INTEGRITY_FAILED'});assert.equal(f.commands(),0);
});
