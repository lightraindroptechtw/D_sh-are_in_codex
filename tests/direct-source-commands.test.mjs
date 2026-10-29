import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseDirectSource,resolveDirectSource} from '../lib/market-direct-source.mjs';
import {createMarketOperations} from '../lib/market-operations.mjs';
import {createSecurityReviewer} from '../lib/security-review.mjs';
import {createMarketConversation} from '../lib/market-conversation.mjs';
import {startMarketServer} from '../lib/market-server.mjs';
import {writeCodexPackage} from '../lib/codex-package.mjs';
import {McpClient} from '../lib/protocol.mjs';
import {runPluginCommand} from '../bin/dsh-plugin.mjs';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-direct-source-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
async function localSource(root,{name='outside-catalog',version='1.2.3'}={}){
 const source=path.join(root,'input');await fs.mkdir(source,{recursive:true});
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name,version,type:'module',main:'index.mjs',scripts:{install:'node index.mjs'}}));
 await fs.writeFile(path.join(source,'index.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(root,'SOURCE_EXECUTED'))},'bad');throw Error('SOURCE MUST NOT EXECUTE');export const name='Synthetic';export function apply(ctx){ctx.tools.register({name:'fetch_data',description:'fetch',execute:()=>fetch('https://example.com/data')});}`);
 return source;
}
function entry(name,content){content=Buffer.from(content);const header=Buffer.alloc(512);header.write(name,0,100);header.write('0000644\0',100,8);header.write(content.length.toString(8).padStart(11,'0')+'\0',124,12);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257,6);header.write(header.reduce((sum,b)=>sum+b,0).toString(8).padStart(6,'0')+'\0 ',148,8);return Buffer.concat([header,content,Buffer.alloc((512-content.length%512)%512)]);}
function archive(name,version){return gzipSync(Buffer.concat([entry('package/package.json',JSON.stringify({name,version,type:'module',main:'index.mjs'})),entry('package/index.mjs',`throw Error('SOURCE MUST NOT RUN');export function apply(ctx){ctx.tools.register({name:'read',execute:()=>fetch('https://example.com')});}`),Buffer.alloc(1024)]));}
async function operationsFixture(root,extra={}){
 const calls=[],conversions=[],dataRoot=path.join(root,'market');
 const reviewer=await createSecurityReviewer({dataRoot,runImpl:()=>{throw Error('No model or CLI allowed during scan');}});
 const options={dataRoot,reviewer,sandboxImpl:async()=>({enforced:true}),pluginEnabledWriter:async()=>{},installDependencies:false,
  runImpl:async(command,args)=>{calls.push({command,args});return {code:0,stdout:'{"success":true}'};},
  convertImpl:async(input,opts)=>{conversions.push({input,opts});await writeCodexPackage({outputDir:opts.outputDir,name:opts.name,description:'Synthetic',skillText:'Synthetic'});return {capabilities:{toolRuntime:{tools:[{name:'synthetic_candidate'}]}},conversion:{status:'partial',components:[{kind:'skill',name:'synthetic'}],omitted:[{code:'SYNTHETIC_OMISSION',message:'synthetic omission'}]}};},...extra};
 return {options,calls,conversions,operations:await createMarketOperations(options)};
}

test('direct sources parse npm scope/version, GitHub commit and package directory, and local paths',async t=>{
 const root=await fixture(t),source=await localSource(root);
 assert.deepEqual(parseDirectSource('npm:@community/example@1.2.3'),{type:'npm',name:'@community/example',spec:'1.2.3',packageDir:'.'});
 assert.deepEqual(parseDirectSource('example'),{type:'npm',name:'example',spec:'latest',packageDir:'.'});
 assert.equal((await resolveDirectSource(source)).type,'local');
 const parsed=parseDirectSource('https://github.com/owner/repo/tree/main/plugins/sample');assert.equal(parsed.ref,'main');assert.equal(parsed.packageDir,'plugins/sample');
 const calls=[],commit='a'.repeat(40),resolved=await resolveDirectSource('https://github.com/owner/repo',{packageDir:'plugins/sample',readJsonUrl:async url=>{calls.push(url);return url.includes('/commits/')?{sha:commit}:{name:'sample',version:'2.3.4'};}});
 assert.equal(resolved.plugin.versions[0].source.commit,commit);assert.equal(resolved.plugin.versions[0].source.path,'plugins/sample');assert.equal(resolved.version,'2.3.4');assert.match(calls[1],new RegExp(commit+'/plugins/sample/package.json$'));
 for(const source of ['http://github.com/owner/repo','https://github.com/owner/repo?token=x','https://localhost/owner/repo','npm:../unsafe'])assert.throws(()=>parseDirectSource(source));
 assert.throws(()=>parseDirectSource('https://github.com/o/r',{packageDir:'../outside'}),/來源之內/);
});

test('local scan never executes, converts, installs or requires a catalog; consent installs its signed snapshot after restart',async t=>{
 const root=await fixture(t),source=await localSource(root),f=await operationsFixture(root);
 const reviewed=await f.operations.reviewSource({source});
 assert.equal(reviewed.packageName,'outside-catalog');assert.equal(reviewed.version,'1.2.3');assert.equal(reviewed.startedModel,false);assert.equal(reviewed.converted,false);assert.equal(reviewed.installed,false);assert.equal(f.calls.length,0);assert.equal(f.conversions.length,0);assert.notEqual(reviewed.path,source);
 await fs.access(reviewed.reportPath);assert.equal(await fs.readFile(reviewed.markdownPath,'utf8'),reviewed.markdown);assert.deepEqual(JSON.parse(await fs.readFile(reviewed.reportPath)),reviewed.ccScan);
 await assert.rejects(fs.access(path.join(root,'SOURCE_EXECUTED')),{code:'ENOENT'});
 await assert.rejects(f.operations.installReviewed({reviewId:reviewed.reviewId,consent:false}),/明確同意/);assert.equal(f.conversions.length,0);assert.equal(f.calls.length,0);
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'outside-catalog',version:'9.9.9'}));
 const restarted=await createMarketOperations(f.options),installed=await restarted.installReviewed({reviewId:reviewed.reviewId,consent:true});
 assert.equal(installed.installed,true);assert.equal(installed.version,'1.2.3');assert.equal(installed.status,'partial');assert.equal(installed.toolsVerified,false);assert.equal(installed.sourceToolCount,1);assert.equal(installed.omitted[0].code,'SYNTHETIC_OMISSION');assert.equal(f.conversions.length,1);assert.equal(f.conversions[0].input,reviewed.path);assert.equal(f.calls.length,2);await assert.rejects(fs.access(path.join(root,'SOURCE_EXECUTED')),{code:'ENOENT'});
});

test('npm tag is pinned before download and later installation never fetches a newer version',async t=>{
 const root=await fixture(t),name='npm-direct-synthetic',bytes=archive(name,'1.2.3'),network=[];
 const f=await operationsFixture(root,{fetchImpl:async url=>{network.push(url);return url.endsWith('/archive.tgz')?new Response(bytes):new Response(JSON.stringify({name,version:'1.2.3',dist:{tarball:'https://cdn.npmjs.org/archive.tgz',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}}));}});
 const reviewed=await f.operations.reviewSource({source:name});assert.equal(reviewed.pinnedSource,'npm:'+name+'@1.2.3');assert.deepEqual(network,['https://registry.npmjs.org/'+name+'/latest','https://registry.npmjs.org/'+name+'/1.2.3','https://cdn.npmjs.org/archive.tgz']);
 assert.equal(f.calls.length,0);assert.equal(f.conversions.length,0);await f.operations.installReviewed({reviewId:reviewed.reviewId,consent:true});assert.equal(network.length,3);assert.equal(f.conversions.length,1);
});

test('tampered signed source cannot be installed even with consent',async t=>{
 const root=await fixture(t),source=await localSource(root),f=await operationsFixture(root),reviewed=await f.operations.reviewSource({source});
 await fs.appendFile(path.join(reviewed.path,'index.mjs'),'\n// altered');await assert.rejects(f.operations.installReviewed({reviewId:reviewed.reviewId,consent:true}),/快照不符/);assert.equal(f.conversions.length,0);assert.equal(f.calls.length,0);
});

test('GitHub source pins a commit, scans the selected nested package and installs without re-fetching',async t=>{
 const root=await fixture(t),commit='b'.repeat(40),prefix='repo-'+commit+'/',manifest={name:'nested-direct-plugin',version:'2.3.4',type:'module',main:'index.mjs'},bytes=gzipSync(Buffer.concat([entry(prefix+'plugins/sample/package.json',JSON.stringify(manifest)),entry(prefix+'plugins/sample/index.mjs',`throw Error('MUST NOT EXECUTE');export function apply(ctx){ctx.tools.register({name:'read',execute:()=>fetch('https://example.com')});}`),Buffer.alloc(1024)])),network=[];
 const f=await operationsFixture(root,{fetchImpl:async url=>{network.push(url);return url.includes('api.github.com')?new Response(JSON.stringify({sha:commit})):url.includes('raw.githubusercontent.com')?new Response(JSON.stringify(manifest)):new Response(bytes);}});
 const reviewed=await f.operations.reviewSource({source:'https://github.com/owner/repo',packageDir:'plugins/sample'});assert.equal(reviewed.version,'2.3.4');assert.equal(reviewed.source.commit,commit);assert.equal(reviewed.ccScan.package.packageDir,'plugins/sample');assert.equal(reviewed.ccScan.package.name,manifest.name);assert.equal(network.length,3);assert.ok(network[2].endsWith('/tar.gz/'+commit));assert.equal(f.calls.length,0);assert.equal(f.conversions.length,0);
 await f.operations.installReviewed({reviewId:reviewed.reviewId,consent:true});assert.equal(network.length,3);assert.equal(f.conversions[0].opts.packageDir,'plugins/sample');
});

test('direct install retains default obfuscation rule and accepts only explicit force',async t=>{
 const root=await fixture(t),source=await localSource(root);await fs.writeFile(path.join(source,'unreadable.mjs'),'eval(atob("'+Buffer.from('console.log("synthetic")').toString('base64')+'"));');
 const f=await operationsFixture(root),reviewed=await f.operations.reviewSource({source});assert.equal(reviewed.scan.obfuscated,true);
 await assert.rejects(f.operations.installReviewed({reviewId:reviewed.reviewId,consent:true}),error=>error.code==='OBFUSCATED_SOURCE_CONFIRMATION_REQUIRED');assert.equal(f.conversions.length,0);assert.equal(f.calls.length,0);
 assert.equal((await f.operations.installReviewed({reviewId:reviewed.reviewId,consent:true,forceObfuscated:true})).installed,true);
});

test('direct source HTTP uses authentication and CSRF, returns original CC report and main-conversation excerpts, and reuses completion',async t=>{
 const root=await fixture(t),source=await localSource(root),f=await operationsFixture(root);let dispatched=0;
 const server=await startMarketServer({dataRoot:f.options.dataRoot,operations:f.operations,idleTimeoutMs:0,ccFetchText:()=>{throw Error('Catalog must not be fetched');},desktopConversation:{sendReview:()=>{dispatched++;throw Error('No followup');},close:async()=>{}}});t.after(()=>server.close());
 const record={url:server.url,accessToken:server.accessToken},client=createMarketConversation({dataRoot:f.options.dataRoot,readRecord:async()=>record,launchImpl:async()=>{}});
 assert.equal((await fetch(record.url+'/api/cc/source-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source})})).status,401);
 assert.equal((await fetch(record.url+'/api/cc/source-review',{method:'POST',headers:{authorization:'Bearer '+record.accessToken,'content-type':'application/json'},body:JSON.stringify({source})})).status,403);
 const reviewed=await client.reviewSource({source,aiScope:'all'});assert.equal(dispatched,0);assert.equal(reviewed.startedModel,false);assert.equal(reviewed.aiPlan.expectedModelCalls,0);assert.ok(reviewed.untrustedSourceData);assert.equal(reviewed.markdown,undefined);assert.match(await fs.readFile(reviewed.originalMarkdownPath,'utf8'),/掃描/);assert.equal(reviewed.scan,undefined);assert.equal(reviewed.ccScan,undefined);assert.equal(reviewed.sourceReview,undefined);assert.equal(f.conversions.length,0);assert.equal(f.calls.length,0);
 const completed=await client.complete({reviewId:reviewed.reviewId,judgment:{verdict:'manual_review',risk:'high',summary:'Synthetic advisory, install remains user choice',findings:[],sourceDigest:reviewed.sourceDigest,coveredFiles:['index.mjs']}});assert.equal(completed.sourceReview.reviewOrigin,'main-conversation');assert.equal((await client.pending()).status,'no-pending-review');
 await assert.rejects(client.installReviewed({reviewId:reviewed.reviewId,consent:false}),/明確同意/);
 const installed=await client.installReviewed({reviewId:reviewed.reviewId,consent:true});assert.equal(installed.installed,true);assert.equal(installed.toolsVerified,false);assert.equal(f.calls.length,2);
});

test('large direct-review public response never embeds full scan, receipt, Markdown or unselected excerpts',async()=>{
 const findings=Array.from({length:4000},(_,i)=>({file:'file-'+i+'.mjs',category:'network',label:'網路',line:i+1,excerpt:'RAW_FINDING_'+i+'_'+('x'.repeat(800))}));
 const record={url:'http://127.0.0.1:1234',accessToken:'test'},job={id:'job-id',phase:'done',name:'large-synthetic',path:'C:/synthetic',handoff:{status:'awaiting-main-conversation',reviewId:'source-id',version:'1.2.3'},result:{reviewId:'source-id',packageName:'large-synthetic',version:'1.2.3',pinnedSource:'npm:large-synthetic@1.2.3',packageDir:'.',path:'C:/synthetic',reportPath:'C:/local/raw-report.json',markdownPath:'C:/local/original.md',markdown:'FULL_MARKDOWN_'+('y'.repeat(200000)),scan:{findings},ccScan:{raw:'FULL_CC_SCAN'},sourceReview:{id:'receipt-id',sourceDigest:'digest',scan:{files:findings.map(f=>({file:f.file})),findings}}}};
 let settings={maxInputChars:10,representativePerCategory:3,excerptChars:600};
 const client=createMarketConversation({dataRoot:'C:/local',readRecord:async()=>record,launchImpl:async()=>{},fetchImpl:async(url,options)=>{
  const route=new URL(url).pathname;
  return {ok:true,json:async()=>route==='/api/config'?{csrfToken:'csrf'}:route==='/api/cc/source-review'?{id:job.id}:route==='/api/cc/jobs'?{jobs:[job]}:route==='/api/review-settings'?settings:route==='/api/cc/review-complete'?{...job.result,sourceReview:{...job.result.sourceReview,status:'approved',reviewOrigin:'main-conversation',summary:'Synthetic bounded completion',coveredFiles:['file-0.mjs']}}:{}};
 }});
 const choice=await client.reviewSource({source:'large-synthetic'}),serialized=JSON.stringify(choice);
 assert.equal(choice.status,'needs-choice');assert.equal(choice.untrustedSourceData,undefined);assert.equal(choice.originalMarkdownPath,job.result.markdownPath);assert.equal(choice.reportPath,job.result.reportPath);
 for(const field of ['sourceReview','scan','ccScan','markdown','findings'])assert.equal(choice[field],undefined,field);
 for(const text of ['RAW_FINDING_0','RAW_FINDING_3999','FULL_MARKDOWN_','FULL_CC_SCAN'])assert.ok(!serialized.includes(text),text);assert.ok(serialized.length<6000);
 settings={...settings,maxInputChars:60000};
 const bounded=await client.reviewSource({source:'large-synthetic'}),boundedText=JSON.stringify(bounded);assert.equal(bounded.untrustedSourceData.files.length,3);assert.equal(bounded.aiPlan.findingCount,4000);assert.equal(bounded.aiPlan.selectedGroups,3);assert.ok(boundedText.includes('RAW_FINDING_0'));assert.ok(!boundedText.includes('RAW_FINDING_3999'));assert.ok(!boundedText.includes('FULL_MARKDOWN_'));assert.ok(boundedText.length<12000);
 const completed=await client.complete({reviewId:'source-id',judgment:{}});assert.equal(completed.sourceReview.scan,undefined);assert.equal(completed.scan,undefined);assert.ok(!JSON.stringify(completed).includes('RAW_FINDING_3999'));assert.equal(completed.sourceReview.reviewOrigin,'main-conversation');
});

test('CLI helper maps scan, consent, scope, force option and completion without source execution',async t=>{
 const root=await fixture(t),calls=[],createConversation=opts=>{calls.push(opts);return {reviewSource:async args=>({action:'scan',args}),installReviewed:async args=>({action:'install',args}),pending:async args=>args,complete:async args=>args};};
 const scan=await runPluginCommand(['scan','npm:example@1.2.3','--package-dir','.','--ai-scope','none','--data-root',root],{createConversation});assert.equal(scan.args.source,'npm:example@1.2.3');assert.equal(scan.args.aiScope,'none');assert.equal(calls[0].dataRoot,root);
 await assert.rejects(runPluginCommand(['install','source-id'],{createConversation}),/明確同意/);
 assert.equal((await runPluginCommand(['install','source-id','--consent'],{createConversation})).args.forceObfuscated,false);
 assert.equal((await runPluginCommand(['install','source-id','--consent','--force-obfuscated'],{createConversation})).args.forceObfuscated,true);
 const file=path.join(root,'judgment.json');await fs.writeFile(file,'{"summary":"合成"}');assert.equal((await runPluginCommand(['complete','source-id','--judgment',file],{createConversation})).judgment.summary,'合成');
});

test('MCP publishes scan and consent-gated reviewed installation schemas alongside all previous tools',async()=>{
 const client=new McpClient({command:process.execPath,args:[path.resolve(import.meta.dirname,'../bin/dsh-to-codex.mjs'),'serve']});
 try{await client.start();const tools=await client.listTools(),review=tools.find(tool=>tool.name==='review_dsh_plugin'),install=tools.find(tool=>tool.name==='install_reviewed_dsh_plugin');assert.ok(review);assert.ok(install);assert.deepEqual(review.inputSchema.required,['source']);assert.equal(install.inputSchema.properties.consent.const,true);assert.equal(install.inputSchema.properties.forceObfuscated.type,'boolean');assert.ok(tools.some(tool=>tool.name==='get_dsh_market_reviews'));assert.ok(tools.some(tool=>tool.name==='complete_dsh_market_review'));const invalid=await client.request('tools/call',{name:'install_reviewed_dsh_plugin',arguments:{reviewId:'a'.repeat(36),consent:false}});assert.equal(invalid.isError,true);}finally{await client.close();}
});
