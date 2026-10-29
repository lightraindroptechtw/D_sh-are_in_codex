import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createMarketOperations} from '../lib/market-operations.mjs';
import {writeCodexPackage} from '../lib/codex-package.mjs';
import {createCCMarketAdapter} from '../lib/cc-market-adapter.mjs';
import {matchEntry,newerVersion} from '../lib/cc-market-installed.mjs';
import {writeManagedPluginEnabled} from '../lib/codex-market-config.mjs';

const name='synthetic-market-managed',version='1.0.0';
const sourcePlugin={name,versions:[{version,source:{type:'npm'}}]};
const index={format:1,plugins:[{name,title:'合成受管插件',versions:[{version:'1.1.0',publishTimestamp:2,source:{type:'npm'}},{version,publishTimestamp:1,source:{type:'npm'}}]}]};
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-manage-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const calls=[],rows=[];let failList=false,failRemove=false,ignoreToggle=false,removeGate;
  const operations=await createMarketOperations({dataRoot:root,codexHome:path.join(root,'codex-home'),codexCommand:'synthetic-codex',
    reviewer:{review:async()=>({status:'skipped',sourceDigest:'synthetic'}),verify:async()=>{}},sandboxImpl:async()=>({enforced:true}),
    acquireImpl:async(plugin,selected,{sourcesRoot})=>{const dir=path.join(sourcesRoot,randomUUID());await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:plugin.name,version:selected.version}));return {root:dir,packageDir:'.',provenance:{type:'npm',name:plugin.name,version:selected.version}};},
    convertImpl:async(input,options)=>{await writeCodexPackage({outputDir:options.outputDir,name:options.name,description:'Synthetic fixture',skillText:'Synthetic fixture'});return {conversion:{status:'converted',components:[{kind:'skill',name:'fixture'}],omitted:[]}};},
    pluginEnabledWriter:async request=>{calls.push({writer:request});if(!ignoreToggle)rows.find(row=>row.pluginId===request.pluginId).enabled=request.enabled;return {ok:true};},
    runImpl:async(command,args,options)=>{calls.push({command,args,options});if(args[1]==='list')return failList?{code:1,stderr:'合成讀取失敗'}:{code:0,stdout:JSON.stringify({installed:rows,available:[]})};if(args[1]==='add'){rows.splice(0,rows.length,{pluginId:args[2],version,installed:true,enabled:true});return {code:0,stdout:'{"success":true}'};}if(args[1]==='remove'){if(removeGate){removeGate.start();await removeGate.wait;}if(failRemove)return {code:1,stderr:'合成移除失敗'};rows.length=0;}return {code:0,stdout:'{"success":true}'};},
  });
  const fetchText=async url=>{if(url.includes('catalog.json'))return JSON.stringify({items:[]});if(url.includes('index.json'))return JSON.stringify(index);if(url.includes('registry.npmjs.org'))return JSON.stringify({name,version:'1.1.0',icon:'./assets/icon.png'});throw Error(url);};
  const adapter=createCCMarketAdapter({operations,dataRoot:root,fetchText});t.after(()=>adapter.close());
  const request=(method,route,body)=>{const url=new URL(route,'http://fixture');return adapter.handle(method,url.pathname,url.searchParams,body);};
  await request('GET','/catalog');
  return {root,operations,adapter,request,fetchText,calls,rows,set failList(value){failList=value;},set failRemove(value){failRemove=value;},set ignoreToggle(value){ignoreToggle=value;},holdRemove(){let release,start;const wait=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{start=resolve;});removeGate={wait,start};return {release,started};}};
}

test('CC installed/manage uses signed prepared receipts plus actual Codex list, then confirms install/toggle/remove',async t=>{
  const f=await fixture(t),prepared=await f.operations.prepare(sourcePlugin,{version});
  assert.equal(prepared.catalogName,name);
  const converted=await f.request('GET','/installed?fresh=1');assert.equal(converted.known,true);assert.deepEqual(converted.items[name],{plugin:prepared.manifestName,status:'converted',version,update:'1.1.0'});
  assert.equal((await f.request('POST','/manage',{name,action:'enable'})).ok,false);
  const installed=await f.request('POST','/manage',{name,action:'install'});assert.equal(installed.ok,true,installed.text);assert.equal(installed.installed.items[name].status,'enabled');
  assert.deepEqual(f.calls.find(call=>call.args?.[1]==='add').args,['plugin','add',prepared.manifestName+'@dsh-community-converted','--json']);
  const disabled=await f.request('POST','/manage',{name,action:'disable'});assert.equal(disabled.ok,true);assert.equal(disabled.installed.items[name].status,'disabled');
  const enabled=await f.request('POST','/manage',{name,action:'enable'});assert.equal(enabled.ok,true);assert.equal(enabled.installed.items[name].status,'enabled');
  const secret=path.join(f.root,'states',prepared.manifestName,'secret.txt');await fs.mkdir(path.dirname(secret),{recursive:true});await fs.writeFile(secret,'retained-user-secret');
  const removed=await f.request('POST','/manage',{name,action:'remove'});assert.equal(removed.ok,true,removed.text);assert.deepEqual(Object.keys(removed.installed.items),[]);await assert.rejects(fs.access(prepared.packageRoot),{code:'ENOENT'});assert.equal(await fs.readFile(secret,'utf8'),'retained-user-secret');assert.deepEqual(await f.operations.installed(),[]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root,'.agents/plugins/marketplace.json'))).plugins,[]);
});

test('management does not claim toggles or removals succeeded when Codex disagrees; failed inventory refuses mutation',async t=>{
  const f=await fixture(t),prepared=await f.operations.prepare(sourcePlugin,{version});await f.request('POST','/manage',{name,action:'install'});
  f.ignoreToggle=true;const toggled=await f.request('POST','/manage',{name,action:'disable'});assert.equal(toggled.ok,false);assert.equal(toggled.installed.items[name].status,'enabled');
  f.failRemove=true;const removed=await f.request('POST','/manage',{name,action:'remove'});assert.equal(removed.ok,false);await fs.access(prepared.packageRoot);assert.equal((await f.operations.installed()).length,1);
  f.failList=true;const before=f.calls.length,result=await f.request('POST','/manage',{name,action:'remove'});assert.equal(result.ok,false);assert.equal(result.installed.known,false);assert.equal(result.installed.items[name].status,'unknown');assert.equal(f.calls.length,before+1);await fs.access(prepared.packageRoot);
  await assert.rejects(f.request('POST','/manage',{name:'../outside',action:'remove'}),error=>error.status===404);
});

test('converted removal needs no Codex uninstall; tampered receipts and path escapes are not trusted',async t=>{
  const f=await fixture(t),prepared=await f.operations.prepare(sourcePlugin,{version});
  await assert.rejects(f.operations.setManagedEnabled('third-party@other-market',false),/有效簽章/);
  const receipt=path.join(prepared.packageRoot,'.market-prepared.json'),original=await fs.readFile(receipt,'utf8');const changed=JSON.parse(original);changed.packageRoot=os.tmpdir();await fs.writeFile(receipt,JSON.stringify(changed));assert.equal((await f.operations.managedPackages()).items.length,0);await assert.rejects(f.operations.forgetManaged(prepared.manifestName),/有效簽章/);await fs.access(prepared.packageRoot);
  await fs.writeFile(receipt,original);const removed=await f.request('POST','/manage',{name,action:'remove'});assert.equal(removed.ok,true);assert.equal(f.calls.some(call=>call.args?.[1]==='remove'),false);
});

test('a queued install cannot interleave with Codex uninstall and managed artifact removal',async t=>{
  const f=await fixture(t),prepared=await f.operations.prepare(sourcePlugin,{version});await f.operations.install(prepared);
  const gate=f.holdRemove(),removal=f.operations.removeManaged(prepared.manifestName);await gate.started;
  const installAgain=f.operations.install(prepared),rejected=assert.rejects(installAgain,/ENOENT|找不到|不存在/);assert.equal(f.calls.filter(call=>call.args?.[1]==='add').length,1);
  gate.release();await removal;await rejected;assert.equal(f.calls.filter(call=>call.args?.[1]==='add').length,1);assert.deepEqual(f.rows,[]);assert.deepEqual(await f.operations.installed(),[]);
});

test('favorites survive adapter restart and concurrent updates; icon metadata follows CC response contract',async t=>{
  const f=await fixture(t);await Promise.all([f.request('POST','/favorites',{name,on:true}),f.request('POST','/favorites',{name,on:false}),f.request('POST','/favorites',{name,on:true})]);
  assert.deepEqual(await f.request('GET','/favorites'),{names:[name]});
  const reopened=createCCMarketAdapter({operations:f.operations,dataRoot:f.root,fetchText:f.fetchText});t.after(()=>reopened.close());assert.deepEqual(await reopened.handle('GET','/favorites',new URLSearchParams()),{names:[name]});
  await assert.rejects(f.request('POST','/favorites',{name:'unlisted',on:true}),error=>error.status===404);
  assert.deepEqual(await f.request('POST','/favorites',{name:'previously-unlisted',on:false}),{names:[name]});
  const icons=await f.request('GET','/icons?names='+name+',missing');assert.match(icons.icons[name],/^https:\/\/cdn\.jsdelivr\.net\/npm\/synthetic-market-managed@1\.1\.0\/assets\/icon\.png$/);assert.equal(Object.hasOwn(icons.icons,'missing'),false);
});

test('source matching distinguishes GitHub subdirectories and version hints never suggest a downgrade',()=>{
  const entries=['one','two'].map(part=>({name:part,versions:[{version:'2.0.0',source:{type:'git',url:'https://github.com/owner/repo',path:part,commit:'b'.repeat(40)}}]}));
  assert.equal(matchEntry({origin:'https://github.com/OWNER/repo.git',packageDir:'two'},entries).name,'two');assert.equal(matchEntry({origin:'https://github.com/owner/repo',packageDir:'missing'},entries),undefined);
  assert.equal(newerVersion({version:'2.0.0'},{versions:[{version:'1.0.0',source:{type:'npm'}}]}),undefined);assert.equal(newerVersion({commit:'a'.repeat(40)},entries[0]),'2.0.0');
});

test('trusted setting writer sends only initialize and the managed boolean setting through app-server',async()=>{
  const requests=[],pluginId='dsh-synthetic-0123456789@dsh-community-converted';let launched;
  const spawnImpl=(command,args,options)=>{launched={command,args,options};const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new Writable({write(chunk,encoding,callback){const request=JSON.parse(String(chunk));requests.push(request);if(request.id!==undefined)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:request.id,result:request.method==='initialize'?{}:{status:'ok'}})+'\n'));callback();}});child.kill=()=>{child.killed=true;child.emit('close',0);};return child;};
  assert.deepEqual(await writeManagedPluginEnabled({pluginId,enabled:false,codexHome:'C:/synthetic-home',command:'synthetic-codex',spawnImpl}),{ok:true});
  assert.deepEqual(requests.filter(request=>request.id!==undefined).map(request=>request.method),['initialize','config/value/write']);assert.deepEqual(requests.at(-1).params,{keyPath:`plugins."${pluginId}".enabled`,value:false,mergeStrategy:'replace'});
  assert.equal(launched.options.windowsHide,true);assert.equal(launched.options.env.CODEX_HOME,'C:/synthetic-home');assert.equal(launched.options.env.OPENAI_API_KEY,undefined);
  await assert.rejects(writeManagedPluginEnabled({pluginId:'third-party@other',enabled:false,codexHome:'C:/synthetic-home',spawnImpl}),/受管插件/);
});
