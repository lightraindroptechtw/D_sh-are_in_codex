import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketConversation} from '../lib/market-conversation.mjs';
function fixture(settings={}){
 const calls=[],record={url:'http://127.0.0.1:1234',accessToken:'test'},job={name:'synthetic',version:'1.0.0',resolvedVersion:'1.0.0',path:'C:/synthetic',handoff:{status:'awaiting-main-conversation',reviewId:'source-id'},result:{sourceReview:{id:'receipt-id',sourceDigest:'digest',scan:{files:[{file:'index.mjs'}],findings:[{file:'index.mjs',category:'network',label:'網路',line:2,excerpt:'fetch(url)'}]}}}};
 const client=createMarketConversation({dataRoot:'C:/test-only',readRecord:async()=>record,fetchImpl:async(url,options)=>{const route=new URL(url).pathname;calls.push({route,options});const result=route==='/api/cc/jobs'?{jobs:[job]}:route==='/api/review-settings'?{maxInputChars:60000,representativePerCategory:3,excerptChars:600,...settings}:route==='/api/config'?{csrfToken:'csrf'}:{reviewed:true};return {ok:true,json:async()=>result};}});
 return {client,calls,job};
}
test('main conversation receives bounded excerpts and no separate model invocation',async()=>{
 const f=fixture(),result=await f.client.pending();assert.equal(result.status,'awaiting-main-conversation');assert.equal(result.startedModel,false);assert.equal(result.aiPlan.model,'current-conversation');assert.equal(result.untrustedSourceData.files.length,1);assert.match(result.staticReportPath,/receipt-id/);assert.ok(f.calls.every(row=>row.options.method==='GET'));
 f.job.handoff.status='reviewed-main-conversation';assert.equal((await f.client.pending()).status,'no-pending-review');
});
test('over-budget main-conversation excerpts require a scope choice and allow explicit override',async()=>{
 const f=fixture({maxInputChars:10}),pending=await f.client.pending();assert.equal(pending.status,'needs-choice');assert.equal(pending.untrustedSourceData,undefined);assert.equal((await f.client.pending({aiScope:'all'})).untrustedSourceData.files.length,1);assert.equal((await f.client.pending({aiScope:'none'})).status,'static-only');
});
test('main conversation result uses authenticated CSRF protected market completion',async()=>{
 const f=fixture(),judgment={sourceDigest:'digest',verdict:'manual_review',risk:'medium',summary:'合成摘要',findings:[],coveredFiles:[]};assert.equal((await f.client.complete({reviewId:'source-id',judgment})).reviewed,true);const post=f.calls.at(-1);assert.equal(post.route,'/api/cc/review-complete');assert.equal(post.options.headers['X-CSRF-Token'],'csrf');assert.equal(JSON.parse(post.options.body).judgment.summary,'合成摘要');
});

test('a short chat request can discover its review ID without exposing it in the message',async()=>{
 const f=fixture();f.job.handoff.status='submitted-to-main-conversation';
 const pending=await f.client.pending();assert.equal(pending.reviewId,'source-id');assert.equal(pending.plugin,'synthetic');
 f.job.handoff.status='reviewed-main-conversation';
 assert.equal((await f.client.pending()).status,'no-pending-review');
});

test('first review includes host capabilities in the same bounded review plan',async()=>{
 const f=fixture(),pending=await f.client.pending();assert.ok(pending.capabilities);assert.ok(f.calls.some(row=>row.route==='/api/cc/capabilities'));assert.ok(pending.aiPlan.inputChars>0);
 f.job.handoff.aiScope='none';assert.equal((await f.client.pending()).status,'static-only');
});
