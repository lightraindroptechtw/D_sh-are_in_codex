import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {startMarketServer} from '../lib/market-server.mjs';
import {createMarketOperations} from '../lib/market-operations.mjs';
import {createSecurityReviewer} from '../lib/security-review.mjs';
import {writeCodexPackage} from '../lib/codex-package.mjs';
import {codexMarketSearch,marketSearchCandidates,createCCMarketAdapter} from '../lib/cc-market-adapter.mjs';

const catalog={format:1,plugins:[{name:'fixture-port',title:'合成插件',description:'字幕工具',versions:[{version:'1.0.0',publishTimestamp:1,source:{type:'npm'}}]}]};
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-port-'));let acquired=0,converted=0;const cli=[];
 const reviewer=await createSecurityReviewer({dataRoot:root,runImpl:()=>{throw Error('No model calls in market source handoff');}});
 const operations=await createMarketOperations({dataRoot:root,reviewer,acquireImpl:async(plugin,version,{sourcesRoot})=>{acquired++;const source=path.join(sourcesRoot,randomUUID());await fs.mkdir(source,{recursive:true});await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:plugin.name,version:version.version,license:'MIT'}));await fs.writeFile(path.join(source,'index.mjs'),"throw Error('SOURCE MUST NOT EXECUTE');\n");return {root:source,packageDir:'.'};},convertImpl:async(input,options)=>{converted++;await writeCodexPackage({outputDir:options.outputDir,name:options.name,description:'Synthetic fixture',skillText:'Synthetic fixture'});return {license:'MIT',capabilities:{toolRuntime:{tools:[]}},conversion:{status:'converted',components:[{kind:'skill',name:'synthetic'}],omitted:[],modelCalls:0}};},sandboxImpl:async()=>({enforced:true}),runImpl:async(command,args)=>{cli.push({command,args});return {code:0,stdout:'{"success":true}'};}});
 const ui=await startMarketServer({dataRoot:root,operations,idleTimeoutMs:0,ccFetchText:async url=>{if(url.includes('catalog.json'))return JSON.stringify({items:[]});if(url.includes('index.json'))return JSON.stringify(catalog);if(url.includes('data.jsdelivr.com'))return JSON.stringify({files:[{name:'/README.md'}]});if(url.includes('README.md'))return '# 合成自述\n<script>throw 1</script>';if(url.includes('api.npmjs.org'))return JSON.stringify({package:'fixture-port',downloads:123,start:'2026-01-01',end:'2026-01-31'});throw Error('Unexpected URL '+url);},ccSearchImpl:async({query,entries})=>{assert.equal(query,'字幕');assert.equal(entries[0].name,'fixture-port');return [{name:'fixture-port',reason:'合成 AI 邊界測試'}];}});
 t.after(async()=>{await ui.close();await fs.rm(root,{recursive:true,force:true});});
 const headers={authorization:'Bearer '+ui.accessToken},config=await (await fetch(ui.url+'/api/config',{headers})).json();
 async function request(route,body){const response=await fetch(ui.url+route,{headers:{...headers,...(body?{'content-type':'application/json','x-csrf-token':config.csrfToken}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
 const post=body=>request('/api/cc/jobs',body);
 async function settle(job){for(let n=0;n<100;n++){const row=(await request('/api/cc/jobs')).jobs.find(j=>j.id===job.id);if(['done','error'].includes(row.phase))return row;await new Promise(r=>setTimeout(r,5));}throw Error('Job did not settle');}
 return {root,operations,ui,request,post,settle,cli,get acquired(){return acquired;},get converted(){return converted;}};
}
test('ported CC API exposes merged catalogs, README, honest counts and strict authorization',async t=>{
 const f=await fixture(t),listing=await f.request('/api/cc/catalog');assert.equal(listing.entries.length,1);assert.deepEqual(listing.entries[0].markets,['open','awesome']);assert.equal(listing.meta.markets.length,2);
 assert.match((await f.request('/api/cc/readme?name=fixture-port&version=1.0.0')).text,/合成自述/);
 assert.equal((await f.request('/api/cc/downloads?names=fixture-port')).counts['fixture-port'].downloads,123);
 assert.equal(f.acquired,0);assert.equal(f.converted,0);
 assert.equal((await fetch(f.ui.url+'/api/cc/catalog')).status,401);
 assert.equal((await fetch(f.ui.url+'/api/cc/jobs',{method:'POST',headers:{authorization:'Bearer '+f.ui.accessToken,'content-type':'application/json'},body:'{"action":"download"}'})).status,403);
 const failed=await fetch(f.ui.url+'/api/cc/jobs',{method:'POST',headers:{authorization:'Bearer '+f.ui.accessToken,'content-type':'application/json','x-csrf-token':(await f.request('/api/config')).csrfToken},body:'{"action":"download","name":"missing","version":"1.0.0"}'});assert.equal(failed.status,404);
});
test('download and scan do not execute source; main conversation handoff, consent, signed conversion and install connect',async t=>{
 const f=await fixture(t);await f.request('/api/cc/catalog');
 const download=await f.settle(await f.post({action:'download',name:'fixture-port',version:'1.0.0'}));assert.equal(download.phase,'done');assert.match(download.text,/未執行/);assert.equal(f.cli.length,0);
 const scan=await f.settle(await f.post({action:'scan',name:'fixture-port',version:'1.0.0'}));assert.equal(scan.phase,'done');assert.ok(scan.result.scan);assert.equal(f.converted,0);
 const reviewed=await f.settle(await f.post({action:'review',name:'fixture-port',version:'1.0.0'}));assert.equal(reviewed.phase,'done');assert.equal(reviewed.result.sourceReview.status,'skipped');assert.equal(reviewed.handoff.status,'awaiting-main-conversation');assert.equal(reviewed.handoff.sourceRoot,reviewed.path);assert.equal(f.cli.length,0);
 const mainResult=await f.request('/api/cc/review-complete',{reviewId:reviewed.result.reviewId,judgment:{verdict:'approve',risk:'low',summary:'合成主對話審查完成',findings:[],sourceDigest:reviewed.handoff.sourceDigest,coveredFiles:['index.mjs']}});assert.equal(mainResult.sourceReview.reviewOrigin,'main-conversation');assert.equal(mainResult.sourceReview.aiProgress.cliCalls,0);const after=(await f.request('/api/cc/jobs')).jobs.find(j=>j.id===reviewed.id);assert.equal(after.handoff.status,'reviewed-main-conversation');assert.equal(f.cli.length,0);
 const denied=await f.settle(await f.post({action:'prepare',job:reviewed.id}));assert.equal(denied.phase,'error');assert.equal(f.converted,0);
 const prepared=await f.settle(await f.post({action:'prepare',job:reviewed.id,consent:true}));assert.equal(prepared.phase,'done',prepared.text);assert.equal(prepared.result.status,'ready');assert.equal(f.cli.length,0);
 const installed=await f.settle(await f.post({action:'install',job:prepared.id}));assert.equal(installed.phase,'done',installed.text);assert.equal(installed.result.installed,true);assert.equal(f.cli.length,2);assert.equal((await f.operations.installed()).length,1);
 await assert.rejects(f.operations.openFolder(os.tmpdir()),/超出/);
 const opened=await f.settle(await f.post({action:'open-folder',job:download.id}));assert.equal(opened.phase,'done');assert.equal(f.cli.at(-1).args[0],download.path);
});
test('Luna search uses ChatGPT login, disables tools and validates returned catalog names without real AI',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-search-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const calls=[];
 const results=await codexMarketSearch({query:'字幕',lang:'zh-Hant',entries:[{name:'fixture-port',title:'字幕',description:'字幕工具',category:'媒體'}],dataRoot:root,runImpl:async(command,args,options)=>{calls.push({command,args,options});if(args[0]==='login')return {code:0,stdout:'Logged in using ChatGPT'};const output=args[args.indexOf('--output-last-message')+1];await fs.writeFile(output,JSON.stringify(output.includes('keywords-')?{keywords:[['字幕']]}:{results:[{name:'fixture-port',reason:'支援字幕'},{name:'invented',reason:'不得回傳'}]}));return {code:0};}});
 assert.equal(calls.length,3);assert.equal(calls[1].args[calls[1].args.indexOf('--model')+1],'gpt-6-luna');assert.ok(calls[1].args.includes('model_reasoning_effort="low"'));assert.equal(calls[1].options.env.OPENAI_API_KEY,undefined);assert.ok(calls[1].args.includes('shell_tool'));assert.deepEqual(results,[{name:'fixture-port',reason:'支援字幕'}]);
 await assert.rejects(codexMarketSearch({query:'字幕',entries:[],dataRoot:root,runImpl:async()=>({code:0,stdout:'Logged in using an API key'})}),/ChatGPT/);
});

test('review again respects the chosen scope and static-only conversion consumes the visible bypass choice',async t=>{
 const f=await fixture(t);await f.request('/api/cc/catalog');
 const initial=await f.settle(await f.post({action:'review',name:'fixture-port',version:'1.0.0'}));
 const again=await f.settle(await f.post({action:'review-again',job:initial.id,aiScope:'code'}));
 assert.equal(again.phase,'done',again.text);assert.equal(again.handoff.aiScope,'code');assert.equal(again.handoff.status,'awaiting-main-conversation');
 assert.equal((await f.request('/api/cc/jobs')).jobs.find(row=>row.id===initial.id).handoff.status,'superseded');
 const staticOnly=await f.settle(await f.post({action:'review-again',job:again.id,aiScope:'none'}));assert.equal(staticOnly.handoff.status,'static-only');
 const needsChoice=await f.settle(await f.post({action:'prepare',job:staticOnly.id,consent:true}));assert.equal(needsChoice.phase,'error');assert.equal(f.converted,0);
 const prepared=await f.settle(await f.post({action:'prepare',job:staticOnly.id,consent:true,skipMainReview:true}));assert.equal(prepared.phase,'done',prepared.text);assert.equal(f.converted,1);assert.equal(f.cli.length,0);
});

test('CC candidate ranking uses synonym groups, English word boundaries and a forty-item cap',()=>{
 const entries=Array.from({length:100},(_,i)=>({name:'dsh-video-'+i,title:'影片 Video',description:'字幕 subtitles',category:'媒體',keywords:[],downloads:i}));
 assert.equal(marketSearchCandidates(entries,[['字幕','subtitles']]).length,40);assert.equal(marketSearchCandidates(entries,['ds']).length,0);assert.equal(marketSearchCandidates(entries,['video']).length,40);
});
test('site-only floating npm and GitHub sources resolve immutable identity before downloading',async()=>{
 const received=[],commit='a'.repeat(40);
 const adapter=createCCMarketAdapter({dataRoot:'.',operations:{download:async(plugin,options)=>{received.push({plugin,options});return {path:'/synthetic/source'};}},fetchText:async url=>{if(url.endsWith('index.json'))return JSON.stringify({plugins:[]});if(url.endsWith('catalog.json'))return JSON.stringify({items:[{npm:1,cmd:'dsh plugin --profile web add floating-npm',name:'NPM',slug:'author/npm'},{cmd:'dsh plugin --profile web add github:owner/repo#path:plugin',name:'Git',slug:'owner/repo'}]});if(url.includes('registry.npmjs.org'))return JSON.stringify({version:'2.3.4'});if(url.includes('commits/HEAD'))return JSON.stringify({sha:commit});if(url.includes('raw.githubusercontent.com'))return JSON.stringify({name:'real-package',version:'3.4.5'});throw Error(url);}});
 const listing=await adapter.handle('GET','/catalog',new URLSearchParams());assert.equal(listing.entries.length,2);
 for(const entry of listing.entries){const job=await adapter.handle('POST','/jobs',new URLSearchParams(),{action:'download',name:entry.name,version:entry.versions[0].version});await adapter.close();assert.equal(adapter.jobs.get(job.id).phase,'done');}
 assert.equal(received[0].options.version,'2.3.4');assert.equal(received[1].plugin.name,'real-package');assert.equal(received[1].plugin.versions[0].source.commit,commit);assert.equal(received[1].plugin.versions[0].source.path,'plugin');
});
