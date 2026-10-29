import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {LocalFileSystem} from '@deepseek-ai/dsh-fs-local';
import {dispatchFileResourceCall,dispatchWorkspaceFilesCall,dispatchWorkspaceFilesStream} from '../lib/ui-files.mjs';
import {createRemoteServices} from '../ui/remote.mjs';
import {encodeConnectionResult,decodeConnectionResult} from '../ui/transport.mjs';
import {loadDshHost} from '../lib/dsh-host.mjs';
import {fileURLToPath} from 'node:url';
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ui-files-')),workspace=path.join(directory,'workspace');await fs.mkdir(workspace);await fs.mkdir(path.join(workspace,'folder'));await fs.writeFile(path.join(workspace,'page.txt'),'第一行\n\n第三行\n最後');await fs.writeFile(path.join(directory,'outside.txt'),'外面的檔案');await fs.writeFile(path.join(workspace,'binary.bin'),new Uint8Array([0,128,255,3,4]));
  const root=new Context();t.after(async()=>{await root.fiber.dispose();await fs.rm(directory,{recursive:true,force:true});});const filesystem=new LocalFileSystem(root,{cwd:workspace,diffBasisMaxBytes:10*1024*1024});
  const queries=[],sessionQuery={async listSessions(){queries.push('metadata');return [{header:{id:'known',cwd:workspace}}];},async readSession(){throw Error('File scope must not read transcript');}};
  const environment={ctx:{get:key=>key==='fs'?filesystem:key==='sessionQuery'?sessionQuery:undefined},workspace,currentSessionId:'live-no-cwd',sessionQuery};
  const call=(method,args,extra={})=>dispatchWorkspaceFilesCall({...environment,namespace:'workspaceFiles',method,args,...extra});
  return {directory,workspace,filesystem,environment,queries,call};
}
const address=(id,file)=>'dsh-resource://file/session/'+encodeURIComponent(id)+'/'+file.split('/').map(encodeURIComponent).join('/');

test('file resources and standard Remote read real UTF-8 line pages with correct EOF and byte identity',async t=>{
  const f=await fixture(t),resource=await dispatchFileResourceCall({...f.environment,params:{address:address('known','page.txt'),operation:'read',offset:2,limit:2}});
  assert.equal(resource.ok,true,JSON.stringify(resource));assert.equal(resource.value.text,'\n第三行');assert.equal(resource.value.lines,2);assert.equal(resource.value.eof,false);assert.equal(resource.value.absolutePath,path.join(f.workspace,'page.txt'));
  const last=await f.call('read',['known','page.txt',{offset:4,limit:2}]);assert.equal(last.value.text,'最後');assert.equal(last.value.eof,true);
  const beyond=await f.call('read',['known','page.txt',{offset:9,limit:2}]);assert.equal(beyond.value.lines,0);assert.equal(beyond.value.text,'');assert.equal(beyond.value.eof,true);
  const stat=await f.call('stat',['known','page.txt']);assert.equal(stat.value.bytes,Buffer.byteLength('第一行\n\n第三行\n最後'));assert.equal(typeof stat.value.version,'string');assert.ok(f.queries.every(value=>value==='metadata'));
});

test('absolute Codex resources and regular files outside workspace use existing filesystem read authority',async t=>{
  const f=await fixture(t),outside=path.join(f.directory,'outside.txt'),absolute='dsh-resource://file/absolute/'+outside.split(path.sep).map(encodeURIComponent).join('/');
  const resource=await dispatchFileResourceCall({...f.environment,params:{address:absolute,operation:'read'}});assert.equal(resource.ok,true,JSON.stringify(resource));assert.equal(resource.value.text,'外面的檔案');
  const relative=await f.call('read',['known','../outside.txt',{}]);assert.equal(relative.value.text,'外面的檔案');assert.equal((await f.call('list',['known','..'])).error.code,'workspace-file/outside-workspace');
  const unknown=await f.call('read',['unknown','page.txt',{}]);assert.equal(unknown.error.code,'gateway/lookup-not-found');
  const current=await f.call('read',['live-no-cwd','page.txt',{}]);assert.equal(current.ok,true);assert.equal(current.value.text,'第一行\n\n第三行\n最後');
});

test('byte ranges and base-file resolution return exact native bytes; file/page caps fail without truncation',async t=>{
  const f=await fixture(t),window=await f.call('readBytes',['known','binary.bin',{range:{offset:1,length:3}}]);assert.deepEqual([...window.value.data],[128,255,3]);assert.equal(window.value.offset,1);assert.equal(window.value.eof,false);
  const base=await f.call('readBytes',['known','../binary.bin',{baseFile:'folder/base.txt'}]);assert.equal(base.error.code,'workspace-file/not-found');await fs.writeFile(path.join(f.workspace,'folder/base.txt'),'base');
  const fromBase=await f.call('readBytes',['known','../binary.bin',{baseFile:'folder/base.txt'}]);assert.deepEqual([...fromBase.value.data],[0,128,255,3,4]);
  assert.equal((await f.call('readBytes',['known','/absolute',{baseFile:'folder/base.txt'}])).error.code,'gateway/bad-request');
  assert.equal((await f.call('readBytes',['known','binary.bin',{}],{config:{maxFileBytes:2}})).error.code,'workspace-file/too-large');
  assert.equal((await f.call('read',['known','page.txt',{offset:1,limit:1}],{config:{maxBytes:3}})).error.code,'workspace-file/too-large');
  assert.equal((await f.call('read',['known','binary.bin',{}])).error.code,'workspace-file/not-text');
  const after=await f.call('readBytes',['known','binary.bin',{range:{offset:99,length:2}}]);assert.equal(after.value.data.length,0);assert.equal(after.value.eof,true);
});

test('directory results obey the official workspace and entry contract; missing/kind/cancellation failures are explicit',async t=>{
  const f=await fixture(t),listed=await f.call('list',['known','.'],{config:{maxEntries:2}});assert.equal(listed.ok,true);assert.equal(listed.value.path,'');assert.equal(listed.value.entries.length,2);assert.equal(listed.value.truncated,true);assert.ok(listed.value.entries.every(row=>!Object.hasOwn(row,'target')&&!Object.hasOwn(row,'version')));
  assert.equal((await f.call('stat',['known','folder'])).error.code,'workspace-file/not-regular-file');assert.equal((await f.call('list',['known','page.txt'])).error.code,'workspace-file/not-directory');assert.equal((await f.call('read',['known','missing',{}])).error.code,'workspace-file/not-found');
  const controller=new AbortController();controller.abort();assert.equal((await f.call('read',['known','page.txt',{}],{signal:controller.signal})).error.code,'gateway/cancelled');
});

test('real filesystem changes stream reports readiness, actual version invalidation and releases on cancellation',{timeout:10000},async t=>{
  const f=await fixture(t),controller=new AbortController(),target=path.join(f.workspace,'page.txt'),before=await f.call('stat',['known','page.txt']);
  const iterator=dispatchWorkspaceFilesStream({...f.environment,namespace:'workspaceFiles',method:'changes',args:['known','page.txt'],signal:controller.signal})[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value,{kind:'ready'});const next=iterator.next();await fs.writeFile(target,'真的修改內容');const changed=(await next).value;assert.equal(changed.kind,'change');assert.equal(changed.change.absolutePath,target);assert.notEqual(changed.change.version,before.value.version);
  controller.abort();await iterator.return();
});

test('standard workspaceFiles descriptors carry native binary results through the actual JSON codec',async t=>{
  const f=await fixture(t),remote=createRemoteServices({rpc:async(_method,params)=>{const [namespace,method]=params.endpoint.split('/');return decodeConnectionResult(JSON.parse(JSON.stringify(encodeConnectionResult(await dispatchWorkspaceFilesCall({...f.environment,namespace,method,args:params.payload.args})))));}});t.after(()=>remote.dispose());
  const bytes=await remote.remote.workspaceFiles.readBytes('known','binary.bin',{});assert.equal(bytes.ok,true);assert.ok(bytes.value.data instanceof Uint8Array);assert.deepEqual([...bytes.value.data],[0,128,255,3,4]);
});

test('actual worker serves file resources, standard byte reads and real watch frames without a model',{timeout:30000},async t=>{
  const f=await fixture(t),sourceRoot=path.join(f.directory,'source');await fs.mkdir(sourceRoot);await fs.writeFile(path.join(sourceRoot,'package.json'),'{"type":"module"}');await fs.writeFile(path.join(sourceRoot,'index.js'),'export function apply() {}');
  const calls=[],host=await loadDshHost({sourceRoot,entry:path.join(sourceRoot,'index.js'),runtimeRoot:fileURLToPath(new URL('../',import.meta.url)),stateDir:path.join(f.directory,'state'),workspace:f.workspace,services:[],conversationHistory:true,bridgeRequest:async(method)=>{calls.push(method);if(method==='codex.conversation.list')return [{header:{id:'known',cwd:f.workspace}}];throw Error('A file request must not read or execute conversations: '+method);}});
  const remote=createRemoteServices({rpc:(method,params,options)=>host.request(method,params,options)});
  try{
  const text=await host.request('ui.resources.file',{address:address('known','page.txt'),operation:'read',offset:1,limit:1});assert.equal(text.ok,true,JSON.stringify(text));assert.equal(text.value.text,'第一行');
  const binary=await remote.remote.workspaceFiles.readBytes('known','binary.bin',{range:{offset:1,length:2}});assert.equal(binary.ok,true,JSON.stringify(binary));assert.ok(binary.value.data instanceof Uint8Array);assert.deepEqual([...binary.value.data],[128,255]);
  const controller=new AbortController(),handle=remote.remote.workspaceFiles.changes('known','page.txt',controller.signal),iterator=handle[Symbol.asyncIterator]();assert.deepEqual((await iterator.next()).value,{kind:'ready'});const pending=iterator.next();await fs.writeFile(path.join(f.workspace,'page.txt'),'程序間真實修改');assert.equal((await pending).value.kind,'change');controller.abort();await iterator.return();assert.ok(calls.every(method=>method==='codex.conversation.list'));
  }finally{remote.dispose();await host.dispose();}
});
