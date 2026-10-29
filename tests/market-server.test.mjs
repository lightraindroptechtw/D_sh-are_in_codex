import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startMarketServer} from '../lib/market-server.mjs';
import {normalizeMarketIndex} from '../lib/market-catalog.mjs';

async function fixture(t,{failFirstInstall=false,failPreparePhase}={}){
  const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'dsh market http '));
  const sources=[{id:'fixture',title:'合成市場',url:'https://fixture.invalid/index.json'}];
  const catalog=normalizeMarketIndex({format:1,title:{en:'Fixture',zh:'合成市場'},metadata:{categories:{tools:{title:{en:'Tools',zh:'工具'}}}},plugins:[{name:'fixture-tool',title:{en:'Local test',zh:'本機測試'},description:{en:'Synthetic',zh:'合成資料'},metadata:{category:'tools'},versions:[{version:'1.0.0',publishTimestamp:1,source:{type:'npm'}}]}]},{sourceUrl:sources[0].url});
  let prepared=0,installs=0,reviewed=0,lastPrepare,lastReview,settings={model:null,reasoningEffort:'low',maxInputChars:60000,representativePerCategory:3,excerptChars:600};const records=[];
  const ui=await startMarketServer({dataRoot,sources,idleTimeoutMs:0,fetchIndex:async()=>({...catalog,fetchedAt:new Date().toISOString()}),operations:{reviewSettings:async patch=>patch===undefined?{...settings}:(settings={...settings,...patch}),installed:async()=>records,review:async(plugin,options)=>{lastReview=options;const {version,onProgress}=options;reviewed++;onProgress({stage:'scan',message:'掃描完成'});return {reviewId:'fixture-review-id',packageName:plugin.name,version,status:'reviewed',sourceReview:{status:'unavailable'},scan:{findings:[],files:[],assets:[],obfuscated:false}};},prepare:async(plugin,options)=>{lastPrepare=options;const {version,onProgress}=options;prepared++;onProgress({stage:failPreparePhase??'convert',message:'轉換中'});if(failPreparePhase)throw Error('合成檢查失敗');return {packageName:plugin.name,version,status:'ready',components:[{kind:'synthetic'}],packageRoot:path.join(dataRoot,'package')};},install:async(result)=>{installs++;if(failFirstInstall&&installs===1)throw Error('temporary CLI failure');const row={name:result.packageName,version:result.version,pluginId:'fixture@market',installed:true};records.push(row);return row;}}});
  t.after(()=>ui.close());return {...ui,get prepared(){return prepared;},get installs(){return installs;},get reviewed(){return reviewed;},get lastPrepare(){return lastPrepare;},get lastReview(){return lastReview;}};
}
const authorized=(ui,headers={})=>({authorization:`Bearer ${ui.accessToken}`,...headers});
const read=async(ui,route)=>{const r=await fetch(ui.url+route,{headers:authorized(ui)});assert.equal(r.status,200);return r.json();};
async function settled(ui,id){for(let i=0;i<40;i++){const job=await read(ui,'/api/jobs/'+id);if(['completed','failed'].includes(job.state))return job;await new Promise(r=>setTimeout(r,5));}throw Error('job did not finish');}
test('market browsing is read-only and every write requires same-origin token and known inputs',async t=>{
  const ui=await fixture(t),config=await read(ui,'/api/config');assert.equal(config.mode,'local');
  const listing=await read(ui,'/api/catalog?q=本機');assert.equal(listing.total,1);assert.equal(listing.items[0].title,'本機測試');assert.equal(ui.prepared,0);assert.equal(ui.installs,0);
  const rejected=await fetch(ui.url+'/api/jobs',{method:'POST',headers:authorized(ui,{'content-type':'application/json'}),body:JSON.stringify({action:'install',preparedJobId:'arbitrary'})});assert.equal(rejected.status,403);
  const hostile=await fetch(ui.url+'/api/refresh',{method:'POST',headers:authorized(ui,{'content-type':'application/json','x-csrf-token':config.csrfToken,origin:'https://evil.invalid'}),body:'{}'});assert.equal(hostile.status,403);
  const unknown=await fetch(ui.url+'/api/catalog?sourceUrl='+encodeURIComponent('http://127.0.0.1/'),{headers:authorized(ui)});assert.equal(unknown.status,400);
  const response=await fetch(ui.url+'/');assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(ui.prepared,0);
});
test('failed installations can be retried without converting again',async t=>{
  const ui=await fixture(t,{failFirstInstall:true}),config=await read(ui,'/api/config');
  const post=async body=>(await fetch(ui.url+'/api/jobs',{method:'POST',headers:authorized(ui,{'content-type':'application/json','x-csrf-token':config.csrfToken}),body:JSON.stringify(body)})).json();
  const prepare=await post({action:'prepare',sourceUrl:config.sources[0].url,name:'fixture-tool',version:'1.0.0'});await settled(ui,prepare.id);
  const first=await post({action:'install',preparedJobId:prepare.id});assert.equal((await settled(ui,first.id)).state,'failed');
  const retry=await post({action:'install',preparedJobId:prepare.id});assert.notEqual(retry.id,first.id);assert.equal((await settled(ui,retry.id)).result.installed,true);assert.equal(ui.prepared,1);assert.equal(ui.installs,2);
});
test('failed preparation preserves the actual review or execution-check stage without installing',async t=>{
  for(const phase of ['review','dependency-review','sandbox']){
    const ui=await fixture(t,{failPreparePhase:phase}),config=await read(ui,'/api/config');
    const response=await fetch(ui.url+'/api/jobs',{method:'POST',headers:authorized(ui,{'content-type':'application/json','x-csrf-token':config.csrfToken}),body:JSON.stringify({action:'prepare',sourceUrl:config.sources[0].url,name:'fixture-tool',version:'1.0.0'})});
    const result=await settled(ui,(await response.json()).id);
    assert.equal(result.state,'failed');assert.equal(result.phase,'failed');assert.equal(result.failedPhase,phase);assert.equal(result.result,undefined);assert.equal(ui.installs,0);
  }
});
test('a data folder cannot silently switch its Codex installation target',async t=>{
  const ui=await fixture(t);await ui.close();
  await assert.rejects(startMarketServer({dataRoot:ui.dataRoot,codexHome:path.join(ui.dataRoot,'different-home'),operations:{}}),/另一個 Codex/);
});
test('human preparation and confirmation are separate, known jobs install once and appear in installed list',async t=>{
  const ui=await fixture(t),config=await read(ui,'/api/config');
  const post=body=>fetch(ui.url+'/api/jobs',{method:'POST',headers:authorized(ui,{'content-type':'application/json','x-csrf-token':config.csrfToken}),body:JSON.stringify(body)});
  assert.equal((await post({action:'install',preparedJobId:'missing'})).status,400);
  const prepare=await (await post({action:'prepare',sourceUrl:config.sources[0].url,name:'fixture-tool',version:'1.0.0'})).json();assert.equal((await settled(ui,prepare.id)).state,'completed');assert.equal(ui.prepared,1);assert.equal(ui.installs,0);
  const install=await (await post({action:'install',preparedJobId:prepare.id})).json();assert.equal((await settled(ui,install.id)).result.installed,true);
  const duplicate=await (await post({action:'install',preparedJobId:prepare.id})).json();assert.equal(duplicate.id,install.id);assert.equal(ui.installs,1);
  assert.equal((await read(ui,'/api/installed')).items[0].name,'fixture-tool');
});


test('every API route rejects missing and incorrect access tokens before exposing state or accepting jobs',async t=>{
  const ui=await fixture(t);
  for(const route of ['/api/health','/api/config','/api/review-settings','/api/catalog','/api/plugin?name=fixture-tool','/api/installed','/api/jobs/missing','/api/unknown'])for(const token of [undefined,'0'.repeat(64)]){
    const response=await fetch(ui.url+route,{headers:token?{authorization:`Bearer ${token}`}:{}});assert.equal(response.status,401,route);const body=await response.json();assert.equal(body.error.code,'MARKET_ACCESS_REQUIRED');assert.equal(JSON.stringify(body).includes(ui.accessToken),false);
  }
  for(const route of ['/api/jobs','/api/review-settings','/api/refresh','/api/shutdown'])for(const token of [undefined,'wrong']){
    const response=await fetch(ui.url+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:'{}'});assert.equal(response.status,401,route);
  }
  assert.equal((await read(ui,'/api/health')).ok,true);assert.equal(ui.prepared,0);assert.equal(ui.installs,0);
  const config=await read(ui,'/api/config');assert.equal(Object.hasOwn(config,'accessToken'),false);
});

test('restarting the server invalidates the previous process access token',async t=>{
  const previous=await fixture(t),oldToken=previous.accessToken;await previous.close();
  const next=await startMarketServer({dataRoot:previous.dataRoot,operations:{installed:async()=>[]},idleTimeoutMs:0});t.after(()=>next.close());
  assert.notEqual(next.accessToken,oldToken);assert.equal((await fetch(next.url+'/api/config',{headers:{authorization:`Bearer ${oldToken}`}})).status,401);assert.equal((await read(next,'/api/config')).mode,'local');
});


test('review endpoint downloads and scans without conversion; prepare endpoint requires human consent',async t=>{
  const ui=await fixture(t),config=await read(ui,'/api/config'),headers=authorized(ui,{'content-type':'application/json','x-csrf-token':config.csrfToken});
  const post=(route,value)=>fetch(ui.url+route,{method:'POST',headers,body:JSON.stringify(value)}),identity={name:'fixture-tool',version:'1.0.0',sourceUrl:config.sources[0].url};
  const reviewResponse=await post('/api/review',identity);assert.equal(reviewResponse.status,202);const reviewed=await settled(ui,(await reviewResponse.json()).id);assert.equal(reviewed.result.reviewId,'fixture-review-id');assert.equal(reviewed.result.sourceReview.status,'unavailable');assert.equal(ui.prepared,0);assert.equal(ui.installs,0);assert.equal(ui.reviewed,1);
  assert.equal((await post('/api/prepare',{...identity,reviewId:reviewed.result.reviewId})).status,400);
  assert.equal((await post('/api/prepare',{...identity,consent:true})).status,400);
  const prepareResponse=await post('/api/prepare',{...identity,reviewId:reviewed.result.reviewId,consent:true,forceObfuscated:true});assert.equal(prepareResponse.status,202);await settled(ui,(await prepareResponse.json()).id);assert.equal(ui.prepared,1);assert.equal(ui.lastPrepare.consent,true);assert.equal(ui.lastPrepare.forceObfuscated,true);assert.equal(ui.installs,0);
});

test('review settings use existing access and write protections and scope choices reach the same review',async t=>{
  const ui=await fixture(t),config=await read(ui,'/api/config'),headers=authorized(ui,{'content-type':'application/json','x-csrf-token':config.csrfToken});
  assert.equal((await read(ui,'/api/review-settings')).maxInputChars,60000);
  const forbidden=await fetch(ui.url+'/api/review-settings',{method:'POST',headers:authorized(ui,{'content-type':'application/json'}),body:'{"maxInputChars":90000}'});assert.equal(forbidden.status,403);
  const patch={model:'synthetic-model',reasoningEffort:'high',maxInputChars:120000,representativePerCategory:5};
  const saved=await fetch(ui.url+'/api/review-settings',{method:'POST',headers,body:JSON.stringify(patch)});assert.equal(saved.status,200);assert.equal((await saved.json()).model,'synthetic-model');assert.equal((await read(ui,'/api/review-settings')).maxInputChars,120000);
  for(const aiScope of ['code','all','none']) {
    const response=await fetch(ui.url+'/api/review',{method:'POST',headers,body:JSON.stringify({name:'fixture-tool',version:'1.0.0',reviewId:'fixture-review-id',aiScope,reviewSettings:patch})});
    assert.equal(response.status,202);assert.equal((await settled(ui,(await response.json()).id)).state,'completed');assert.equal(ui.lastReview.reviewId,'fixture-review-id');assert.equal(ui.lastReview.aiScope,aiScope);assert.deepEqual(ui.lastReview.reviewSettings,patch);
  }
  assert.equal(ui.prepared,0);assert.equal(ui.installs,0);
});
