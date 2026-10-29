import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCredentialStore,credentialStoreRoot} from '../lib/credential-store.mjs';
import {install as installCredentials} from '../lib/modules/credentials.mjs';
import {createRemoteServices} from '../ui/remote.mjs';
import {dispatchOfficialUiCall} from '../lib/ui-official-services.mjs';
import {createPluginSecurity} from '../lib/plugin-security.mjs';

test('browser credentials save outside plugin code, survive restart, and expose metadata only',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ui-secrets-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const known=[],store=createCredentialStore({directory,onSecrets:values=>known.push(...values)});
  const events=[],provider=await installCredentials({capabilities:{codexVersion:'0.160.0'},requestHost:(method,args)=>store.request(method.slice('codex.credentials.'.length),args),emit:(...event)=>events.push(event)});
  const ctx={get:name=>name==='credentials'?provider.services.credentials:undefined};
  const {remote,dispose}=createRemoteServices({rpc:async(method,{channel,endpoint,payload})=>{assert.equal(channel,'/api');const [namespace,operation]=endpoint.split('/');return dispatchOfficialUiCall({ctx,namespace,method:operation,args:payload.args});}});t.after(dispose);
  const secret='synthetic-ui-key-123456';assert.equal((await remote.credentials.set('DEMO_KEY',secret)).ok,true);
  const described=await remote.credentials.describe(['DEMO_KEY','NOT_SET']);
  assert.deepEqual(described.value,{DEMO_KEY:{configured:true,writable:true,source:'file'},NOT_SET:{configured:false,writable:true}});
  assert.ok(!JSON.stringify(described).includes(secret));assert.ok(known.includes(secret));assert.equal(events[0][0],'credentials/reference-updated');
  const reopened=createCredentialStore({directory});assert.equal(await reopened.request('read',{ref:'DEMO_KEY'}),secret);
  assert.deepEqual(await provider.services.credentials.resolve('DEMO_KEY'),{value:secret,source:'file'});
  await remote.credentials.unset('DEMO_KEY');assert.equal((await remote.credentials.describe(['DEMO_KEY'])).value.DEMO_KEY.configured,false);
  assert.ok(!credentialStoreRoot({root:'/plugin/code',home:directory}).startsWith('/plugin/code'));
});

test('credential records preserve opaque grants, serialize mutations and do not lose simultaneous writes',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ui-records-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createCredentialStore({directory}),other=createCredentialStore({directory});
  await Promise.all([store.request('set',{ref:'ONE_KEY',value:'one-value'}),other.request('set',{ref:'TWO_KEY',value:'two-value'})]);
  assert.equal(await store.request('read',{ref:'ONE_KEY'}),'one-value');assert.equal(await store.request('read',{ref:'TWO_KEY'}),'two-value');
  assert.equal(await store.request('read',{ref:'constructor'}),null);
  const {services:{credentials}}=await installCredentials({capabilities:{codexVersion:'0.160.0'},requestHost:(method,args)=>store.request(method.slice('codex.credentials.'.length),args)});
  const change=()=>credentials.modifyRecord('example/login',async current=>({kind:'grant',payload:{count:(current?.payload.count??0)+1}}));
  const result=await Promise.all([change(),change(),change()]);assert.equal(result[2].payload.count,3);
  assert.deepEqual(await credentials.listRecords(),[{key:'example/login',kind:'grant'}]);
  assert.deepEqual(await credentials.describeRecord('example/login'),{configured:true,kind:'grant',writable:true});
  await credentials.deleteRecord('example/login');assert.equal(await credentials.readRecord('example/login'),undefined);
});

test('official settings keeps original revisions, redaction and write results',async()=>{
  let revision=2,value={title:'before'},redacted=false;
  const settings={writable:true,describe(options){redacted=options.redactSecrets;return [{ns:'demo',value:{...value},revision,secrets:[{path:['key'],set:true}],private:'must not cross wire'}];},async update(ns,patch,expected){assert.equal(ns,'demo');if(expected!==revision)throw Object.assign(Error('changed'),{code:'SETTINGS_CONFLICT'});value={...value,...patch};revision++;}};
  const ctx={get:name=>name==='settings'?settings:undefined};
  const read=await dispatchOfficialUiCall({ctx,namespace:'settings',method:'describe'});assert.equal(redacted,true);assert.equal(read.value.namespaces[0].private,undefined);
  const changed=await dispatchOfficialUiCall({ctx,namespace:'settings',method:'update',args:{ns:'demo',patch:{title:'after'},expectedRevision:2}});
  assert.equal(changed.value.value.title,'after');assert.equal(changed.value.revision,3);
  const stale=await dispatchOfficialUiCall({ctx,namespace:'settings',method:'update',args:{ns:'demo',patch:{title:'lost'},expectedRevision:2}});assert.equal(stale.error.code,'settings/conflict');assert.equal(value.title,'after');
  assert.equal(await dispatchOfficialUiCall({ctx,namespace:'settings',method:'internalDeleteEverything'}),undefined);
  assert.equal(await dispatchOfficialUiCall({ctx,namespace:'credentials',method:'resolve'}),undefined);
});

test('new stored keys redact exact matches in results, errors and notifications, retaining short values',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ui-redact-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const security=createPluginSecurity({pluginId:'ui-redaction',dataRoot:root});t.after(()=>security.close());security.rememberSecrets(['new-secret-123456','short']);
  assert.equal(security.redact({text:'value new-secret-123456 short'}).text,'value [已隱藏敏感值] short');
  assert.equal(security.redact(Error('new-secret-123456')).message,'[已隱藏敏感值]');
  await security.notify({kind:'test',what:'new-secret-123456',why:'test',setting:'test',impact:'test'});
  assert.ok(!JSON.stringify(security.snapshot().notifications).includes('new-secret-123456'));
});

test('official command bridge invokes the registered global handler and reports unsupported attachment receipts',async()=>{
  const calls=[],commands={list:async()=>[{name:'local-probe'}],find:(_agent,name)=>name==='local-probe'?{handler:async request=>{calls.push(request.rawInput);return {kind:'success',text:'ran'+request.rawInput};}}:undefined};
  const ctx={get:name=>name==='commands'?commands:undefined};
  const result=await dispatchOfficialUiCall({ctx,namespace:'commands',method:'execute',args:{line:'/local-probe actual text',submittedAttachments:[]}});
  assert.equal(result.ok,true);assert.equal(result.value.result.text,'ran actual text');assert.deepEqual(calls,[' actual text']);
  const unavailable=await dispatchOfficialUiCall({ctx,namespace:'commands',method:'execute',args:{line:'/local-probe x',submittedAttachments:[{type:'file',receiptId:'unmapped'}]}});
  assert.equal(unavailable.ok,false);assert.equal(calls.length,1);
});
