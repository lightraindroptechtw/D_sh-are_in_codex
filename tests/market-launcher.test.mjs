import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startMarketServer} from '../lib/market-server.mjs';
import {launchMarket,marketRecord,openMarketBrowser,canReplaceMarket} from '../lib/market-launcher.mjs';

async function fixture(t){
  const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-market-launcher-'));t.after(()=>fs.rm(dataRoot,{recursive:true,force:true}));
  const ui=await startMarketServer({dataRoot,operations:{installed:async()=>[]},idleTimeoutMs:0});t.after(()=>ui.close());
  const record={url:ui.url,accessToken:ui.accessToken,instanceId:ui.instanceId,version:ui.version,codexHome:ui.codexHome,converterRoot:ui.converterRoot};
  await fs.writeFile(path.join(dataRoot,'server.json'),JSON.stringify(record));return {ui,record,dataRoot};
}

test('launcher reuses a live authenticated instance and returns its token only in URL fragment',async t=>{
  const {ui,record,dataRoot}=await fixture(t);assert.deepEqual(await marketRecord(dataRoot),record);
  const result=await launchMarket({dataRoot,codexHome:ui.codexHome,open:false}),url=new URL(result.url);
  assert.equal(url.origin,ui.url);assert.equal(url.pathname,'/');assert.equal(url.search,'');assert.match(url.hash,/^#access=[a-f0-9]{64}$/);assert.equal(url.hash,'#access='+ui.accessToken);assert.equal(result.installedAnyPlugin,false);
  assert.equal((await fetch(url.origin+'/api/config')).status,401);
  const response=await fetch(url.origin+'/api/config',{headers:{authorization:`Bearer ${url.hash.slice(8)}`}});assert.equal(response.status,200);
});

test('launcher health verification rejects forged token and instance identity',async t=>{
  const {record,dataRoot}=await fixture(t);
  for(const alteration of [{accessToken:'0'.repeat(64)},{instanceId:'synthetic-other-instance'},{url:'https://127.0.0.1/'},{url:record.url+'/#access='+record.accessToken}]){
    await fs.writeFile(path.join(dataRoot,'server.json'),JSON.stringify({...record,...alteration}));assert.equal(await marketRecord(dataRoot),null);
  }
});

test('launcher refuses reuse across Codex homes without starting a replacement',async t=>{
  const {dataRoot}=await fixture(t);await assert.rejects(launchMarket({dataRoot,codexHome:path.join(dataRoot,'different-home'),open:false}),/另一個版本或設定資料夾/);
});

test('browser launcher rejects nonlocal targets and malformed access fragments before opening',()=>{
  for(const url of ['https://example.com/','http://localhost/','http://127.0.0.1/?access=secret','http://127.0.0.1/#access=bad','http://127.0.0.1/#other=value','http://127.0.0.1/other'])assert.throws(()=>openMarketBrowser(url),/只開啟本機頁面/);
});

test('only an older version of the same installed plugin and Codex home can be replaced',()=>{
 const parent=path.join(os.tmpdir(),'plugins/cache/market/dsh-to-codex'),home=path.join(os.tmpdir(),'codex-home');
 const record={converterRoot:path.join(parent,'0.9.1'),codexHome:home,version:'0.9.1'},next={converterRoot:path.join(parent,'0.9.2'),codexHome:home,version:'0.9.2'};
 assert.equal(canReplaceMarket(record,next),true);
 for(const change of [{codexHome:home+'-other'},{converterRoot:path.join(os.tmpdir(),'other/0.9.2')},{version:'0.8.0'},{version:'unversioned'}])assert.equal(canReplaceMarket(record,{...next,...change}),false);
 assert.equal(canReplaceMarket({...record,converterRoot:path.join(parent,'development')},next),false);
});
