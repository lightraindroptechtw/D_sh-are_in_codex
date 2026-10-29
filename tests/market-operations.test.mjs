import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import dns from 'node:dns';
import {createMarketOperations,extractNpmArchive,downloadMarketSource} from '../lib/market-operations.mjs';
import {fetchPublicResource} from '../lib/market-catalog.mjs';
import {writeCodexPackage} from '../lib/codex-package.mjs';
import {createSecurityReviewer,snapshotSource} from '../lib/security-review.mjs';

// Trusted test boundary: no real model or OS sandbox is invoked by market fixtures.
function trustedReviewer(){
  const approved=new Map();
  return {
    async review(root){const source=await snapshotSource(root),receipt={id:String(approved.size),status:'approved',summary:'Synthetic trusted approval',sourceDigest:source.digest};approved.set(receipt.id,{root:source.sourceRoot,digest:source.digest});return receipt;},
    async verify(root,receipt){const source=await snapshotSource(root),record=approved.get(receipt?.id);if(!record||receipt.status!=='approved'||source.sourceRoot!==record.root||source.digest!==record.digest||receipt.sourceDigest!==record.digest)throw Error('Synthetic approved source does not match');return receipt;},
  };
}
function createTestOperations(options){return createMarketOperations({reviewer:trustedReviewer(),sandboxImpl:async()=>({enforced:true}),...options});}

const plugin={name:'@community/sample',versions:[{version:'1.2.3',source:{type:'npm'}}]};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-market-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
function tarEntry(name,content='',type='0',link=''){
  content=Buffer.from(content);const header=Buffer.alloc(512);
  const text=(offset,length,value)=>header.write(value,offset,length,'utf8');
  text(0,100,name);text(100,8,'0000644\0');text(108,8,'0000000\0');text(116,8,'0000000\0');text(124,12,content.length.toString(8).padStart(11,'0')+'\0');text(136,12,'00000000000\0');header.fill(32,148,156);header[156]=type.charCodeAt(0);text(157,100,link);text(257,6,'ustar\0');text(263,2,'00');const checksum=header.reduce((a,b)=>a+b,0);text(148,8,checksum.toString(8).padStart(6,'0')+'\0 ');
  return Buffer.concat([header,content,Buffer.alloc((512-content.length%512)%512)]);
}
function archive(entries){return gzipSync(Buffer.concat([...entries,Buffer.alloc(1024)]));}
function pax(key,value){const data=` ${key}=${value}\n`;let length=Buffer.byteLength(data)+1;while(String(length).length+Buffer.byteLength(data)!==length)length=String(length).length+Buffer.byteLength(data);return `${length}${data}`;}
function fakeFetch(bytes,{metadataName=plugin.name,metadataVersion='1.2.3',badIntegrity=false}={}){
  const calls=[];const fetchImpl=async url=>{calls.push(url);if(url==='https://cdn.npmjs.org/archive.tgz')return new Response(bytes);return new Response(JSON.stringify({name:metadataName,version:metadataVersion,dist:{tarball:'https://cdn.npmjs.org/archive.tgz',integrity:'sha512-'+(badIntegrity?'AAAA':createHash('sha512').update(bytes).digest('base64'))}}),{headers:{'content-type':'application/json'}});};return {fetchImpl,calls};
}
function npmArchive(name=plugin.name,version='1.2.3',extra=[]){return archive([tarEntry('package/package.json',JSON.stringify({name,version,license:'MIT'})),tarEntry('package/index.mjs',`throw Error('SOURCE MUST NOT RUN');`),...extra]);}
async function fakeConvert(input,options){await writeCodexPackage({outputDir:options.outputDir,name:options.name,description:'Synthetic test package',skillText:'Synthetic skill content'});return {name:plugin.name,license:'MIT',capabilities:{toolRuntime:{tools:[{name:'sample',description:'Static candidate'}]}},conversion:{status:'converted',components:[{kind:'skill',name:'sample'}],omitted:[],modelCalls:0}};}

test('npm preparation pins identity and preserves hook/background defaults with the Codex task carrier',async t=>{
  const root=await fixture(t),network=fakeFetch(npmArchive());let options;
  const operations=await createTestOperations({dataRoot:root,...network,convertImpl:async(input,opts)=>{options=opts;return fakeConvert(input,opts);},runImpl:()=>{throw Error('CLI must not run during prepare');}});
  const progress=[];const prepared=await operations.prepare(plugin,{version:'1.2.3',onProgress:event=>progress.push(event.stage)});
  assert.equal(prepared.status,'ready');assert.equal(prepared.version,'1.2.3');assert.equal(prepared.packageName,plugin.name);assert.equal(prepared.sourceToolCount,1);assert.equal(prepared.license,'MIT');assert.equal(options.hooks,undefined);assert.equal(options.homeMode,'isolated');assert.equal(options.background,undefined);assert.deepEqual(options.moduleOptions.agents,{allowModelCalls:true,backend:'codex-broker'});assert.deepEqual(options.moduleOptions.llm,{allowModelCalls:true,backend:'codex-broker'});assert.equal(options.installDependencies,true);
  assert.equal(network.calls[0],'https://registry.npmjs.org/%40community%2Fsample/1.2.3');assert.deepEqual(progress,['download','review','convert','sandbox','prepared']);
  assert.equal(JSON.parse(await fs.readFile(path.join(prepared.packageRoot,'.codex-plugin/plugin.json'))).version,'1.2.3');assert.deepEqual(await operations.installed(),[]);
  const second=await operations.prepare(plugin,{version:'1.2.3'});assert.notEqual(second.packageRoot,prepared.packageRoot);await fs.access(prepared.packageRoot);
});

test('installation uses exact Codex argument arrays, isolated home, and retains other marketplace plugins',async t=>{
  const root=await fixture(t),calls=[],network=fakeFetch(npmArchive());
  const operations=await createTestOperations({dataRoot:root,...network,convertImpl:fakeConvert,codexCommand:'synthetic-codex.exe',codexHome:path.join(root,'test-home'),runImpl:async(command,args,options)=>{calls.push({command,args,options});return {code:0,stdout:'{"success":true}'};}});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'});
  const other=path.join(root,'packages','existing');await fs.mkdir(other,{recursive:true});const marketplace=path.join(root,'.agents','plugins','marketplace.json');await fs.mkdir(path.dirname(marketplace),{recursive:true});await fs.writeFile(marketplace,JSON.stringify({name:'dsh-community-converted',plugins:[{name:'existing',source:{source:'local',path:'./packages/existing'}}]}));
  const result=await operations.install(prepared);
  assert.equal(result.installed,true);assert.equal(result.message,'已安裝，請新開 Codex 聊天載入');assert.equal(result.pluginId,prepared.manifestName+'@dsh-community-converted');assert.equal(calls.length,2);assert.equal(calls[0].command,'synthetic-codex.exe');assert.deepEqual(calls[0].args,['plugin','marketplace','add',root,'--json']);assert.deepEqual(calls[1].args,['plugin','add',result.pluginId,'--json']);assert.equal(calls[0].options.env.CODEX_HOME,path.join(root,'test-home'));
  const catalog=JSON.parse(await fs.readFile(marketplace));assert.equal(catalog.plugins.length,2);assert.equal(catalog.plugins[0].name,'existing');assert.match(catalog.plugins[1].source.path,/^\.\/packages\//);assert.equal((await operations.installed())[0].version,'1.2.3');
  await operations.install(prepared);assert.equal((await operations.installed()).length,1);assert.equal(JSON.parse(await fs.readFile(marketplace)).plugins.length,2);
});

test('partial remains installable; unsupported and modified packages cannot install',async t=>{
  const root=await fixture(t),network=fakeFetch(npmArchive());let mode='partial',calls=0;
  const operations=await createTestOperations({dataRoot:root,...network,convertImpl:async(input,options)=>{const report=await fakeConvert(input,options);report.conversion.status=mode;report.conversion.omitted=[{code:'SYNTHETIC_LIMITATION',message:'Synthetic limitation'}];return report;},runImpl:async()=>{calls++;return {code:0};}});
  const partial=await operations.prepare(plugin,{version:'1.2.3'});assert.equal(partial.status,'partial');await operations.install(partial);assert.equal(calls,2);
  const manifestFile=path.join(partial.packageRoot,'.codex-plugin/plugin.json');await fs.appendFile(manifestFile,' ');await assert.rejects(operations.install(partial),/已變更/);assert.equal(calls,2);
  mode='unsupported';const unsupported=await operations.prepare(plugin,{version:'1.2.3'});await assert.rejects(operations.install(unsupported),/沒有.*可安裝|沒有本次程序/);await assert.rejects(operations.install({packageRoot:os.tmpdir()}),/超出/);assert.equal(calls,2);
});

test('npm mismatched metadata, mismatched package and corrupt integrity fail closed',async t=>{
  const root=await fixture(t);let index=0;
  for(const [bytes,configuration,message]of [[npmArchive(),{metadataVersion:'2.0.0'},/版本不符/],[npmArchive('different-name'),{},/名稱或版本不符/],[npmArchive(),{badIntegrity:true},/完整性/]]){
    const operations=await createTestOperations({dataRoot:path.join(root,String(index++)),...fakeFetch(bytes,configuration),convertImpl:()=>{throw Error('Conversion must not begin');}});
    await assert.rejects(operations.prepare(plugin,{version:'1.2.3'}),message);
  }
});

test('rejects unsafe names, version ranges, local git sources and noncommit git refs',async t=>{
  const root=await fixture(t),operations=await createTestOperations({dataRoot:root,convertImpl:fakeConvert});
  for(const name of ['../evil','@scope/../../evil','UpperCase','--option'])await assert.rejects(operations.prepare({...plugin,name},{version:'1.2.3'}),/名稱/);
  for(const version of ['latest','^1.2.3','1.2','v1.2.3'])await assert.rejects(operations.prepare(plugin,{version}),/固定/);
  await assert.rejects(operations.prepare({name:'sample',versions:[{version:'1.0.0',source:{type:'git',url:root,commit:'a'.repeat(40)}}]},{version:'1.0.0'}),/網址/);
  await assert.rejects(operations.prepare({name:'sample',versions:[{version:'1.0.0',source:{type:'git',url:'https://github.com/owner/repo',commit:'HEAD'}}]},{version:'1.0.0'}),/40 位/);
});

test('archive extraction supports npm PAX long paths and UTF-8 names',async t=>{
  const root=await fixture(t),longPath='package/'+('long-name/'.repeat(15))+'測試.txt';
  const bytes=archive([tarEntry('package/package.json','{}'),tarEntry('PaxHeader',pax('path',longPath),'x'),tarEntry('short-placeholder','long path content')]);
  const result=await extractNpmArchive(bytes,path.join(root,'source'));assert.equal(result.files,2);assert.equal(await fs.readFile(path.join(root,'source',longPath.slice(8)),'utf8'),'long path content');
});

test('archive traversal, Windows alternate streams, duplicate names and special files fail before extraction',async t=>{
  const root=await fixture(t);let index=0;
  const cases=[tarEntry('package/../../outside','bad'),tarEntry('package/a:stream','bad'),tarEntry('package/link','','2','/outside'),tarEntry('package/hard','','1','package/target'),tarEntry('package/fifo','','6'),tarEntry('package/CON','bad'),tarEntry('package/back\\slash','bad')];
  for(const entry of cases){const destination=path.join(root,'case'+index++);await assert.rejects(extractNpmArchive(archive([tarEntry('package/safe','safe'),entry]),destination));await assert.rejects(fs.access(destination),{code:'ENOENT'});}
  await assert.rejects(extractNpmArchive(archive([tarEntry('package/A','one'),tarEntry('package/a','two')]),path.join(root,'duplicate')),/重複/);
  await assert.rejects(extractNpmArchive(archive([tarEntry('pax',pax('linkpath','/outside'),'x'),tarEntry('package/a','bad')]),path.join(root,'pax-link')),/連結/);
});

test('archive and network byte ceilings, truncated archives and checksum failures fail closed',async t=>{
  const root=await fixture(t),bytes=npmArchive();
  await assert.rejects(extractNpmArchive(bytes,path.join(root,'too-large'),{expandedBytes:32}),/上限/);
  await assert.rejects(extractNpmArchive(bytes,path.join(root,'too-many'),{fileCount:1}),/上限/);
  await assert.rejects(extractNpmArchive(gzipSync(tarEntry('package/file','no terminator')),path.join(root,'truncated')),/結尾/);
  const corrupt=tarEntry('package/file','bad');corrupt[0]=33;await assert.rejects(extractNpmArchive(archive([corrupt]),path.join(root,'corrupt')),/校驗/);
  const operations=await createTestOperations({dataRoot:path.join(root,'market'),...fakeFetch(bytes),limits:{archiveBytes:16},convertImpl:fakeConvert});await assert.rejects(operations.prepare(plugin,{version:'1.2.3'}),/大小上限/);
});

test('failed Codex CLI does not record installation or disclose raw stderr',async t=>{
  const root=await fixture(t),operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:fakeConvert,runImpl:async()=>({code:1,stderr:'PRIVATE_TOKEN_VALUE'})});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'});await assert.rejects(operations.install(prepared),error=>/安裝命令失敗/.test(error.message)&&!error.message.includes('PRIVATE_TOKEN_VALUE'));assert.deepEqual(await operations.installed(),[]);await fs.access(prepared.packageRoot);
});

test('stable hash distinguishes scoped names with the same flattened stem',async t=>{
  const root=await fixture(t);const operations=await createTestOperations({dataRoot:root,acquireImpl:async(plugin,selected,{sourcesRoot})=>{const source=await fs.mkdtemp(path.join(sourcesRoot,'synthetic-'));await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:plugin.name,version:selected.version}));return {root:source};},convertImpl:fakeConvert});
  const results=[];for(const name of ['@a/b','a-b'])results.push(await operations.prepare({name,versions:[{version:'1.0.0',source:{type:'npm'}}]},{version:'1.0.0'}));assert.notEqual(results[0].manifestName,results[1].manifestName);
});

test('output compatibility is strict by default and accepts only explicit boolean recipe fields',async t=>{
  const root=await fixture(t),options=[];
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:async(input,configuration)=>{options.push(configuration);return fakeConvert(input,configuration);}});
  const strict=await operations.prepare(plugin,{version:'1.2.3'});assert.deepEqual(strict.appliedOutputCompatibility,{lenientOutput:false,allowUndeclaredOutput:false});assert.equal(options[0].lenientOutput,false);assert.equal(options[0].allowUndeclaredOutput,false);
  const recipe=await operations.prepare(plugin,{version:'1.2.3',conversionOptions:{lenientOutput:true,allowUndeclaredOutput:true}});assert.deepEqual(recipe.appliedOutputCompatibility,{lenientOutput:true,allowUndeclaredOutput:true});assert.equal(options[1].lenientOutput,true);assert.equal(options[1].allowUndeclaredOutput,true);
  for(const conversionOptions of [{unknown:true},{lenientOutput:'true'},{hooks:true},null,[]])await assert.rejects(operations.prepare(plugin,{version:'1.2.3',conversionOptions}),/布林值/);
  assert.equal(options.length,2);
});

test('installation verifies the whole prepared artifact including MCP, skills, runtime, additions and removals',async t=>{
  const root=await fixture(t);let calls=0;
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:async(input,options)=>{
    const report=await fakeConvert(input,options);await fs.mkdir(path.join(options.outputDir,'runtime'),{recursive:true});await fs.writeFile(path.join(options.outputDir,'runtime','entry.mjs'),'export const synthetic = true;');await fs.writeFile(path.join(options.outputDir,'.mcp.json'),'{}');return report;
  },runImpl:async()=>{calls++;return {code:0};}});
  for(const mutation of [
    prepared=>fs.writeFile(path.join(prepared.packageRoot,'.mcp.json'),'{"changed":true}'),
    prepared=>fs.appendFile(path.join(prepared.packageRoot,'skills',prepared.manifestName,'SKILL.md'),'\nAltered instruction'),
    prepared=>fs.writeFile(path.join(prepared.packageRoot,'runtime','entry.mjs'),'throw Error("ALTERED");'),
    prepared=>fs.writeFile(path.join(prepared.packageRoot,'added-file.txt'),'unexpected addition'),
    prepared=>fs.unlink(path.join(prepared.packageRoot,'runtime','entry.mjs')),
  ]){
    const prepared=await operations.prepare(plugin,{version:'1.2.3'});await mutation(prepared);await assert.rejects(operations.install(prepared),/已變更/);
  }
  assert.equal(calls,0);
  const intact=await operations.prepare(plugin,{version:'1.2.3'});const receiptFile=path.join(intact.packageRoot,'.market-prepared.json'),receipt=JSON.parse(await fs.readFile(receiptFile));assert.match(receipt.packageDigest,/^[a-f0-9]{64}$/);await fs.writeFile(receiptFile,JSON.stringify({...receipt,nonfunctionalNote:'Receipt itself is excluded from the artifact digest'}));await assert.rejects(operations.install(intact),/已變更|簽章/);assert.equal(calls,0);
});

test('source downloads reject private DNS answers before any connection, including redirects',async()=>{
  const previous=dns.lookup;const queries=[];
  dns.lookup=(hostname,options,callback)=>{queries.push(hostname);queueMicrotask(()=>callback(null,[{address:'127.0.0.1',family:4}]));};
  try{
    await assert.rejects(downloadMarketSource('https://fixture.security.example/source.tgz',{limit:1024}),/下載失敗/);
    assert.deepEqual(queries,['fixture.security.example']);
    const calls=[];
    await assert.rejects(downloadMarketSource('https://public.security.example/metadata',{
      limit:1024,fetchImpl:async(url,options)=>{calls.push(url);return calls.length===1?new Response(null,{status:302,headers:{location:'https://private.security.example/source.tgz'}}):fetchPublicResource(url,options);},
    }),/下載失敗/);
    assert.deepEqual(calls,['https://public.security.example/metadata','https://private.security.example/source.tgz']);
    assert.deepEqual(queries,['fixture.security.example','private.security.example']);
    await assert.rejects(downloadMarketSource('https://127.0.0.1/source.tgz',{limit:1024}),/公開 HTTPS/);
  }finally{dns.lookup=previous;}
});

test('source DNS rejects mixed public/private answers instead of choosing a public answer',async()=>{
  const previous=dns.lookup;
  dns.lookup=(hostname,options,callback)=>queueMicrotask(()=>callback(null,[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]));
  try{await assert.rejects(downloadMarketSource('https://mixed.security.example/source.tgz',{limit:1024}),/下載失敗/);}
  finally{dns.lookup=previous;}
});

test('source timeout covers stalled headers and response body and cancels the reader',async()=>{
  await assert.rejects(downloadMarketSource('https://fixture.security.example/archive',{limit:1024,timeoutMs:20,fetchImpl:()=>new Promise(()=>{})}),/逾時/);
  let cancelled=false;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}});
  await assert.rejects(downloadMarketSource('https://fixture.security.example/archive',{limit:1024,timeoutMs:20,fetchImpl:async()=>new Response(body)}),/逾時/);
  assert.equal(cancelled,true);
});


test('source review verdicts and unavailable AI remain human decisions and conversion can proceed',async t=>{
  const root=await fixture(t);
  for(const status of ['rejected','manual_review','unavailable']){
    const base=trustedReviewer();let conversions=0;
    const reviewer={review:async directory=>({...await base.review(directory),status}),verify:async(directory,receipt)=>base.verify(directory,{...receipt,status:'approved'})};
    const operations=await createTestOperations({dataRoot:path.join(root,status),...fakeFetch(npmArchive()),reviewer,convertImpl:async(input,options)=>{conversions++;return fakeConvert(input,options);}});
    const reviewed=await operations.review(plugin,{version:'1.2.3'});assert.equal(conversions,0);assert.equal(reviewed.sourceReview.status,status);
    await assert.rejects(operations.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId}),/同意/);
    const prepared=await operations.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,consent:true});assert.equal(prepared.status,'ready');assert.equal(conversions,1);
  }
});

test('failed OS isolation is disclosed and can be installed by the user',async t=>{
  const root=await fixture(t);
  for(const [index,sandboxImpl] of [async()=>({enforced:false}),async()=>{throw Error('Synthetic restriction probe failed');}].entries()){
    let commands=0;const operations=await createTestOperations({dataRoot:path.join(root,String(index)),...fakeFetch(npmArchive()),convertImpl:fakeConvert,sandboxImpl,runImpl:async()=>{commands++;return {code:0};}});
    const prepared=await operations.prepare(plugin,{version:'1.2.3'});assert.equal(prepared.security.sandbox.enforced,false);assert.ok(prepared.preparationNotices.length);assert.equal(commands,0);await operations.install(prepared);assert.equal(commands,2);
  }
});

test('a new operations instance installs a signed unchanged artifact without re-conversion',async t=>{
  const root=await fixture(t);let commands=0;const reviewer=trustedReviewer();
  const options={dataRoot:root,...fakeFetch(npmArchive()),reviewer,convertImpl:fakeConvert,runImpl:async()=>{commands++;return {code:0};}};
  const first=await createTestOperations(options),prepared=await first.prepare(plugin,{version:'1.2.3'});
  const restarted=await createTestOperations(options);await restarted.install(prepared);assert.equal(commands,2);assert.equal((await restarted.installed()).length,1);
});

// Independent attacker-side recomputation of the public artifact hash.
async function attackerDigest(root){
  const hash=createHash('sha256'),digest=value=>createHash('sha256').update(value).digest('hex');root=await fs.realpath(root);
  async function visit(directory){for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const absolute=path.join(directory,entry.name),relative=path.relative(root,absolute).split(path.sep).join('/');if(relative==='.market-prepared.json')continue;
    const stat=await fs.lstat(absolute);if(stat.isDirectory()){hash.update(JSON.stringify(['directory',relative,stat.mode&0o777])+'\n');await visit(absolute);}else if(stat.isFile())hash.update(JSON.stringify(['file',relative,stat.mode&0o777,stat.size,digest(await fs.readFile(absolute))])+'\n');else throw Error('Unexpected synthetic entry');
  }}
  await visit(root);return hash.digest('hex');
}

test('editing a prepared artifact and recomputing its public receipt hash cannot manufacture approval',async t=>{
  const root=await fixture(t);let commands=0;
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:fakeConvert,runImpl:async()=>{commands++;return {code:0};}});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'}),receiptFile=path.join(prepared.packageRoot,'.market-prepared.json'),receipt=JSON.parse(await fs.readFile(receiptFile));
  assert.equal(await attackerDigest(prepared.packageRoot),receipt.packageDigest);
  await fs.appendFile(path.join(prepared.packageRoot,'skills',prepared.manifestName,'SKILL.md'),'\nSynthetic unreviewed replacement instructions.');
  receipt.packageDigest=await attackerDigest(prepared.packageRoot);await fs.writeFile(receiptFile,JSON.stringify(receipt));
  await assert.rejects(operations.install({...prepared,security:{sourceReview:{status:'approved'},sandbox:{enforced:true}}}),/已變更/);assert.equal(commands,0);assert.deepEqual(await operations.installed(),[]);
});

test('changing approved source after preparation blocks installation before CLI execution',async t=>{
  const root=await fixture(t);let commands=0;
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:fakeConvert,runImpl:async()=>{commands++;return {code:0};}});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'}),sourceDirectory=(await fs.readdir(path.join(root,'sources')))[0];
  await fs.appendFile(path.join(root,'sources',sourceDirectory,'index.mjs'),'\n// Synthetic mutation');
  await assert.rejects(operations.install(prepared),/approved source does not match/);assert.equal(commands,0);
});

async function fakePythonDependencies(packageRoot){
  const reviewRoot=path.join(packageRoot,'runtime/python-environment'),textReviewRoot=path.join(reviewRoot,'text-review'),library=path.join(reviewRoot,'site-packages');await fs.mkdir(textReviewRoot,{recursive:true});await fs.mkdir(library,{recursive:true});
  const binary=Buffer.from([0,255,1]),artifacts=[{name:'synthetic',version:'1.0',source:'https://files.pythonhosted.org/packages/synthetic.whl',sha256:createHash('sha256').update(binary).digest('hex')}];
  await fs.writeFile(path.join(library,'synthetic.py'),'# fully reviewed synthetic dependency');await fs.writeFile(path.join(library,'synthetic.pyd'),binary);await fs.writeFile(path.join(textReviewRoot,'synthetic.py'),'# fully reviewed synthetic dependency');await fs.writeFile(path.join(textReviewRoot,'dependency-provenance.json'),JSON.stringify({artifacts,binaryReview:'fixed distribution hash; not instruction-reviewed'}));
  return {status:'needs-review',reviewRoot,textReviewRoot,pythonExecutable:process.execPath,pythonPaths:['runtime/python-environment/site-packages'],artifacts,requirements:['synthetic==1.0'],textFiles:1,binaryFiles:1,binaryReview:'fixed distribution hash; not instruction-reviewed'};
}
async function pythonConvert(input,options){const report=await fakeConvert(input,options);report.conversion.components=[{kind:'dsh-host',name:'host'},{kind:'python-mcp',entry:'vendor/service.py',entrySource:'user-selected-candidate',requirements:'vendor/requirements.txt'}];report.capabilities.pythonServers=[{path:'vendor/service.py'}];return report;}
test('Python source inventory alone never triggers dependency preparation',async t=>{
 const root=await fixture(t);let preparations=0;
 const convertImpl=async(input,options)=>{const report=await fakeConvert(input,options);report.conversion.components=[{kind:'dsh-host',name:'host'}];report.capabilities.pythonServers=[{path:'vendor/service.py',status:'candidate-not-enabled'}];return report;};
 const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl,pythonDependenciesImpl:async()=>{preparations++;throw Error('unexpected preparation');}});
 const prepared=await operations.prepare(plugin,{version:'1.2.3'});assert.equal(preparations,0);assert.equal(prepared.security.pythonDependencyStatus,'not-needed');assert.equal(prepared.components.some(c=>c.kind==='python-mcp'),false);
});
test('Python text and pinned binary provenance are reviewed before security setup and bound to installation',async t=>{
  const root=await fixture(t);let sandboxOptions,commands=0;const reviews=[],base=trustedReviewer();
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:pythonConvert,pythonDependenciesImpl:fakePythonDependencies,reviewer:{review:async directory=>{reviews.push(directory);return base.review(directory);},verify:base.verify},sandboxImpl:async(packageRoot,options)=>{sandboxOptions=options;assert.equal(reviews.length,2);return {enforced:true};},runImpl:async()=>{commands++;return {code:0};}});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'});assert.equal(prepared.security.pythonDependencyStatus,'reviewed');assert.equal(prepared.security.pythonArtifacts.length,1);assert.match(prepared.security.pythonDependencyDigest,/^[a-f0-9]{64}$/);assert.equal(sandboxOptions.pythonRuntime.command,process.execPath);assert.deepEqual(sandboxOptions.pythonRuntime.pythonPaths,['runtime/python-environment/site-packages']);assert.match(reviews[1],/text-review$/);
  await fs.appendFile(path.join(prepared.packageRoot,'runtime/python-environment/site-packages/synthetic.pyd'),'mutated');await assert.rejects(operations.install(prepared),/Python 依賴檔案已變更/);assert.equal(commands,0);
});
test('rejected Python dependency review remains advisory and reaches setup with a valid integrity record',async t=>{
  const root=await fixture(t),base=trustedReviewer();let reviews=0,isolations=0;
  const reviewer={review:async directory=>{const result=await base.review(directory);return ++reviews===1?result:{...result,status:'rejected'};},verify:async(directory,receipt)=>base.verify(directory,{...receipt,status:'approved'})};
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:pythonConvert,pythonDependenciesImpl:fakePythonDependencies,reviewer,sandboxImpl:async()=>{isolations++;return {enforced:true};}});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'});assert.equal(prepared.security.pythonDependencyReview.status,'rejected');assert.equal(isolations,1);assert.equal(prepared.status,'ready');
});
test('skipped Python dependency preparation is disclosed while other host tools remain available',async t=>{
  const root=await fixture(t);let preparations=0;const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:pythonConvert,installDependencies:false,pythonDependenciesImpl:async()=>{preparations++;}});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'});assert.equal(prepared.status,'partial');assert.equal(preparations,0);assert.equal(prepared.report.conversion.pythonDependencies.status,'unavailable');assert.equal(prepared.components[0].kind,'dsh-host');assert.equal(prepared.omitted[0].requirements,'vendor/requirements.txt');
});


test('obfuscated source defaults to no preparation but explicit human force can proceed',async t=>{
  const root=await fixture(t),operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive(plugin.name,'1.2.3',[tarEntry('package/unreadable.mjs','eval(atob("'+Buffer.from('console.log("synthetic only")').toString('base64')+'"));')])),convertImpl:fakeConvert});
  const reviewed=await operations.review(plugin,{version:'1.2.3'});assert.equal(reviewed.scan.obfuscated,true);
  await assert.rejects(operations.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,consent:true}),error=>error.code==='OBFUSCATED_SOURCE_CONFIRMATION_REQUIRED');
  const prepared=await operations.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,consent:true,forceObfuscated:true});assert.equal(prepared.status,'ready');
});

test('signed downloaded review survives restart and detects context tampering',async t=>{
  const root=await fixture(t),reviewer=trustedReviewer(),options={dataRoot:root,...fakeFetch(npmArchive()),reviewer,convertImpl:fakeConvert};const first=await createTestOperations(options),reviewed=await first.review(plugin,{version:'1.2.3'}),restarted=await createTestOperations({...options,acquireImpl:()=>{throw Error('must reuse downloaded source');}});
  const prepared=await restarted.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,consent:true});assert.equal(prepared.status,'ready');
  const file=path.join(root,'reviewed-sources',reviewed.reviewId+'.json'),record=JSON.parse(await fs.readFile(file));record.sourceReview.summary='tampered';await fs.writeFile(file,JSON.stringify(record));await assert.rejects(restarted.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,consent:true}),/已變更|簽章/);
});


test('real signed source and prepared receipts survive a complete reviewer/operations restart',async t=>{
  const root=await fixture(t);let commands=0;const reviewOptions={dataRoot:root,runImpl:async()=>({code:1,stdout:'Not logged in'})},firstReviewer=await createSecurityReviewer(reviewOptions),options={dataRoot:root,...fakeFetch(npmArchive(plugin.name,'1.2.3',[tarEntry('package/network.mjs','fetch("https://example.com")')])),convertImpl:fakeConvert,runImpl:async()=>{commands++;return {code:0};}};
  const first=await createTestOperations({...options,reviewer:firstReviewer}),reviewed=await first.review(plugin,{version:'1.2.3'});assert.equal(reviewed.sourceReview.status,'skipped');
  const second=await createTestOperations({...options,reviewer:await createSecurityReviewer(reviewOptions)}),prepared=await second.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,consent:true});
  const third=await createTestOperations({...options,reviewer:await createSecurityReviewer(reviewOptions)});assert.deepEqual((await third.preparedPackages()).items.map(item=>item.packageRoot),[prepared.packageRoot]);await third.install({packageRoot:prepared.packageRoot});assert.equal(commands,2);assert.equal((await third.installed()).length,1);assert.equal((await third.preparedPackages()).items.length,0);
});
test('failed Python dependency acquisition is advisory and does not remove unrelated host tools',async t=>{
  const root=await fixture(t);let commands=0;const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),convertImpl:pythonConvert,pythonDependenciesImpl:async()=>{throw Error('Synthetic unsupported wheel');},runImpl:async()=>{commands++;return {code:0};}});const prepared=await operations.prepare(plugin,{version:'1.2.3'});assert.equal(prepared.status,'partial');assert.equal(prepared.security.pythonDependencyStatus,'unavailable');assert.equal(prepared.components[0].kind,'dsh-host');assert.ok(prepared.omitted.some(item=>item.code==='PYTHON_DEPENDENCIES_UNAVAILABLE'));await operations.install(prepared);assert.equal(commands,2);
});

test('no-AI selection and source quota stop also skip dependency AI without blocking installation',async t=>{
 for(const sourceStatus of ['skipped','quota-paused','unavailable','rejected']){
  const root=await fixture(t),calls=[];let installs=0;
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),reviewer:{async review(directory,options={}){calls.push(options);return {status:calls.length===1?sourceStatus:'skipped',sourceDigest:(await snapshotSource(directory)).digest,summary:'synthetic budget state',aiPlan:{softLimitChars:60000},aiProgress:{sentChars:0}};},async verify(_directory,receipt){return receipt;}},convertImpl:pythonConvert,pythonDependenciesImpl:fakePythonDependencies,runImpl:async()=>{installs++;return {code:0};}});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'});assert.equal(calls.length,2);assert.equal(calls[1].skipAI,true);await operations.install(prepared);assert.equal(installs,2);
 }
});

test('source and dependency stages share the same character budget',async t=>{
 const root=await fixture(t),calls=[];
 const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),reviewer:{async review(directory,options={}){calls.push(options);return {status:'approved',sourceDigest:(await snapshotSource(directory)).digest,summary:'synthetic budget state',aiPlan:{softLimitChars:60000},aiProgress:{sentChars:20000}};},async verify(_directory,receipt){return receipt;}},convertImpl:pythonConvert,pythonDependenciesImpl:fakePythonDependencies});
 await operations.prepare(plugin,{version:'1.2.3'});assert.equal(calls[1].reviewSettings.maxInputChars,40000);
});

test('AI scope choices reuse signed downloaded source without fetching again and remain installable',async t=>{
  const root=await fixture(t),network=fakeFetch(npmArchive()),base=trustedReviewer(),calls=[];let commands=0;
  const plan={findingCount:20,groupCount:2,selectedGroups:2,omittedFindings:18,inputChars:1000,estimatedTokens:{min:200,max:500},softLimitChars:500,exceedsBudget:true,model:null,reasoningEffort:'low',quota:{available:false}};
  let settings={model:null,reasoningEffort:'low',maxInputChars:60000,representativePerCategory:3,excerptChars:600};
  const reviewer={
    review:async(directory,options)=>{calls.push(options);return {...await base.review(directory),status:options.aiScope==='all'?'approved':options.aiScope==='none'?'skipped':'needs-choice',aiPlan:plan};},
    verify:async(directory,receipt)=>base.verify(directory,{...receipt,status:'approved'}),
    getSettings:async()=>({...settings}),updateSettings:async patch=>(settings={...settings,...patch}),
  };
  const options={dataRoot:root,...network,reviewer,convertImpl:fakeConvert,runImpl:async()=>{commands++;return {code:0};}};
  const operations=await createTestOperations(options);
  assert.equal((await operations.reviewSettings()).reasoningEffort,'low');assert.equal((await operations.reviewSettings({model:'synthetic-model'})).model,'synthetic-model');
  const reviewed=await operations.review(plugin,{version:'1.2.3'});assert.equal(reviewed.sourceReview.status,'needs-choice');assert.equal(network.calls.length,2);
  const restarted=await createTestOperations({...options,acquireImpl:()=>{throw Error('must reuse signed source');}});
  for(const aiScope of ['code','all','none']){
    const chosen=await restarted.review(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,aiScope,reviewSettings:{maxInputChars:1000}});
    assert.equal(chosen.reviewId,reviewed.reviewId);assert.equal(calls.at(-1).aiScope,aiScope);assert.equal(calls.at(-1).reviewSettings.maxInputChars,1000);assert.equal(network.calls.length,2);
  }
  const prepared=await restarted.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,consent:true});assert.equal(prepared.status,'ready');await restarted.install(prepared);assert.equal(commands,2);
  await assert.rejects(restarted.review({...plugin,name:'different-name'},{version:'1.2.3',reviewId:reviewed.reviewId}),/不符/);
  const file=path.join(root,'reviewed-sources',reviewed.reviewId+'.json'),context=JSON.parse(await fs.readFile(file));context.sourceReview.summary='tampered';await fs.writeFile(file,JSON.stringify(context));
  await assert.rejects(restarted.review(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,aiScope:'all'}),/簽章/);assert.equal(network.calls.length,2);
});

test('over-budget source and acquired dependencies attach scans and notices without raising install requirements',async t=>{
  const root=await fixture(t),base=trustedReviewer(),reviews=[];let commands=0;
  const reviewer={review:async(directory,options)=>{reviews.push(options);return {...await base.review(directory),status:'needs-choice',scan:{findings:[],obfuscated:false},aiPlan:{exceedsBudget:true,inputChars:90000}};},verify:async(directory,receipt)=>base.verify(directory,{...receipt,status:'approved'})};
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive()),reviewer,convertImpl:async(input,options)=>{
    const report=await pythonConvert(input,options);report.conversion.sourceDependencies={status:'installed',installed:['synthetic']};
    await fs.mkdir(path.join(options.outputDir,'source'),{recursive:true});await fs.writeFile(path.join(options.outputDir,'source','index.mjs'),'// synthetic');
    await fs.mkdir(path.join(options.outputDir,'runtime/source-deps'),{recursive:true});await fs.writeFile(path.join(options.outputDir,'runtime/source-deps','synthetic.mjs'),'// synthetic dependency');return report;
  },pythonDependenciesImpl:fakePythonDependencies,runImpl:async()=>{commands++;return {code:0};}});
  const prepared=await operations.prepare(plugin,{version:'1.2.3'});
  assert.equal(prepared.status,'ready');assert.equal(prepared.security.sourceReview.status,'needs-choice');assert.equal(prepared.security.dependencyReview.status,'needs-choice');assert.equal(prepared.security.pythonDependencyReview.status,'needs-choice');
  assert.equal(prepared.preparationNotices.filter(message=>message.includes('用量建議上限')).length,3);assert.equal(reviews.length,3);assert.ok(reviews.every(options=>options.aiScope!=='all'));
  await operations.install(prepared);assert.equal(commands,2);
});


test('compressed readable code and embedded image data prepare and install without obfuscation force',async t=>{
  const root=await fixture(t);let commands=0;
  const source='export const values=['+Array.from({length:4000},(_,i)=>i).join(',')+'];export const image="data:image/png;base64,'+'a'.repeat(5000)+'";';
  const operations=await createTestOperations({dataRoot:root,...fakeFetch(npmArchive(plugin.name,'1.2.3',[tarEntry('package/compressed.mjs',source)])),convertImpl:fakeConvert,runImpl:async()=>{commands++;return {code:0};}});
  const reviewed=await operations.review(plugin,{version:'1.2.3'});assert.equal(reviewed.scan.obfuscated,false);
  const prepared=await operations.prepare(plugin,{version:'1.2.3',reviewId:reviewed.reviewId,consent:true});assert.equal(prepared.status,'ready');
  await operations.install(prepared);assert.equal(commands,2);assert.equal((await operations.installed()).length,1);
});
