import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {dispatchConversationUiCall,dispatchOfficialUiStream} from '../lib/ui-conversation-services.mjs';
import {dispatchOfficialUiCall} from '../lib/ui-official-services.mjs';
import {createConversationServices} from '../ui/conversation.mjs';
import {createRemoteServices} from '../ui/remote.mjs';
import {createRemoteStreamRegistry} from '../lib/ui-remote-streams.mjs';
import {createRuntime} from '../ui/runtime.mjs';
import {loadDshHost} from '../lib/dsh-host.mjs';
import {projectCodexSession} from '../lib/codex-sessions.mjs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const event=(seq,type='user/message',text='原始文字')=>({seq,type,time:100+seq,data:{id:'item-'+seq,role:'user',source:{kind:'user'},content:[{type:'text',text}]}});
function fixture(){let snapshot={session:{version:4,id:'readable',createdAt:100,cwd:'C:/project',isSeeded:false},events:[event(0),{seq:1,type:'codex/opaque-fact',time:101,data:{original:true}}],projection:{source:'codex-app-server',replayValidated:false},codex:{thread:{id:'readable',name:'真實標題'},turns:[]}};const calls=[];const query={capabilities:{listSessions:'codex-host-visible',modelCalls:0},async listSessions(){calls.push('list');return [{header:snapshot.session,thread:{id:'readable',name:'真實標題',preview:'非空',updatedAt:1,status:{type:'active'}}}];},async readSession(id){calls.push(['read',id]);if(id!=='readable')throw Object.assign(Error('Codex 拒絕讀取'),{code:'CODEX_READ_DENIED'});return structuredClone(snapshot);}};return {query,calls,ctx:{get:name=>name==='sessionQuery'?query:undefined},get snapshot(){return snapshot;},set snapshot(value){snapshot=value;}};}

test('official session catalog preserves host metadata and propagates denied reads without local id restrictions',async()=>{
  const f=fixture();const listed=await dispatchOfficialUiCall({ctx:f.ctx,namespace:'session',method:'list',args:{_request:{}}});
  assert.equal(listed.ok,true);assert.deepEqual(listed.value.items[0],{sessionId:'readable',agentAvailable:false,updatedAt:1000,running:true,blank:false,cwd:'C:/project',title:'真實標題',projection:{source:'codex',replayValidated:false,agentOperations:false,unknownFields:[]}});
  const denied=await dispatchConversationUiCall({ctx:f.ctx,namespace:'codexConversation',method:'read',args:['host-denied']});assert.equal(denied.error.code,'CODEX_READ_DENIED');assert.ok(f.calls.some(row=>Array.isArray(row)&&row[1]==='host-denied'));
  const unsupported=await dispatchOfficialUiCall({ctx:f.ctx,namespace:'session',method:'prompt',args:{request:{}}});assert.equal(unsupported.error.code,'gateway/unsupported');assert.equal(f.calls.some(row=>Array.isArray(row)&&row[0]==='turn/start'),false);
});

test('follow yields an explicit local projection, supports captured page cuts and accepts only appended facts',async()=>{
  const f=fixture(),controller=new AbortController(),iterator=dispatchOfficialUiStream({ctx:f.ctx,namespace:'session',method:'follow',args:{request:{address:{kind:'session',sessionId:'readable'}}},signal:controller.signal,pollIntervalMs:1})[Symbol.asyncIterator]();
  const first=(await iterator.next()).value;assert.equal(first.type,'snapshot');assert.equal(first.projections.values.codexPresentation.replayValidated,false);assert.equal(first.records[0].event.surfaceOp,'append');assert.equal(first.records[1].event.ignorable,true);assert.equal(first.cursor,1);
  const page=await dispatchConversationUiCall({ctx:f.ctx,namespace:'session',method:'page',args:{request:{address:{kind:'session',sessionId:'readable'},throughSeq:1,beforeSeq:1}}});assert.equal(page.ok,true);assert.equal(page.value.records.length,1);
  f.snapshot.events.push(event(2));assert.equal((await iterator.next()).value.event.seq,2);
  const captured=await dispatchConversationUiCall({ctx:f.ctx,namespace:'session',method:'page',args:{request:{address:{kind:'session',sessionId:'readable'},throughSeq:1}}});assert.equal(captured.value.records.length,2);
  const missing=await dispatchConversationUiCall({ctx:f.ctx,namespace:'session',method:'page',args:{request:{address:{kind:'session',sessionId:'readable'},throughSeq:99}}});assert.equal(missing.error.code,'session/presentation-cut-expired');
  f.snapshot.events[0].data.content[0].text='已改寫';await assert.rejects(iterator.next(),{code:'session/presentation-rewritten'});controller.abort();
});

test('follow cancellation aborts its wait and unsupported execution-control stream gives a clear failure',async()=>{
  const f=fixture(),controller=new AbortController(),iterator=dispatchOfficialUiStream({ctx:f.ctx,namespace:'session',method:'follow',args:[{address:{kind:'session',sessionId:'readable'}}],signal:controller.signal})[Symbol.asyncIterator]();
  await iterator.next();const next=iterator.next();controller.abort();await assert.rejects(next,{name:'AbortError'});
  const unsupported=dispatchOfficialUiStream({ctx:f.ctx,namespace:'session',method:'control'})[Symbol.asyncIterator]();await assert.rejects(unsupported.next(),{code:'gateway/unsupported'});
});

test('browser selection publishes real read state, keeps main-view ownership and refuses mutation',async()=>{
  const f=fixture(),calls=[],published=[];
  const ui=createConversationServices({pollIntervalMs:0,emit:(...args)=>published.push(args),rpc:async(method,args)=>{calls.push(method);if(method==='ui.conversation.list')return f.query.listSessions();if(method==='ui.conversation.read')return f.query.readSession(args.sessionId);throw Error('unexpected');}});
  await ui.ready;assert.equal(ui.sessions.list.getSnapshot().current,undefined);await ui.sessions.open('readable');
  assert.equal(ui.sessions.list.getSnapshot().byId.readable.retainedBy.mainView,1);assert.equal(ui.currentConversation.sessionId,'readable');assert.equal(ui.currentConversation.getSnapshot().cwd,'C:/project');assert.deepEqual(published,[['session/selected','readable']]);
  const reference=ui.sessions.retain('readable',{source:'test'});await reference.ready;assert.equal(ui.sessions.retainInfo('readable').getSnapshot().referenceCount,2);reference.release();assert.throws(()=>reference.binding,{code:'UI_CONVERSATION_RELEASED'});
  assert.throws(()=>ui.sessions.binding('readable').session.prompt('cannot execute'),{code:'UI_CONVERSATION_UNSUPPORTED'});
  await assert.rejects(ui.sessions.open('host-denied'),{code:'CODEX_READ_DENIED'});assert.equal(ui.currentConversation.sessionId,'readable');assert.ok(calls.includes('ui.conversation.read'));await ui.dispose();await assert.rejects(ui.sessions.read('readable'),{code:'UI_CONVERSATION_DISPOSED'});
});

test('standard generated Remote session.list/page/follow signatures use the same real host adapter',async t=>{
  const f=fixture();const registry=createRemoteStreamRegistry({open:(params,signal)=>{const [namespace,method]=params.endpoint.split('/');return dispatchOfficialUiStream({ctx:f.ctx,namespace,method,args:params.payload.args,signal,pollIntervalMs:1});},readWaitMs:5});t.after(()=>registry.dispose());
  const ui=createRemoteServices({rpc:(method,params,options)=>{if(method.startsWith('ui.stream.'))return registry.request(method,params,options?.signal);const [namespace,operation]=params.endpoint.split('/');return dispatchOfficialUiCall({ctx:f.ctx,namespace,method:operation,args:params.payload.args,signal:options?.signal});}});t.after(()=>ui.dispose());
  assert.equal((await ui.remote.session.list({})).value.items[0].sessionId,'readable');const handle=ui.remote.session.follow({address:{kind:'session',sessionId:'readable'}}),iterator=handle[Symbol.asyncIterator]();assert.equal((await iterator.next()).value.type,'snapshot');await iterator.return();assert.equal(registry.size,0);
});

test('runtime lazily mounts the conversation services and publishes scoped real history',async()=>{
  const f=fixture(),calls=[],runtime=createRuntime({rpc:async(method,args)=>{calls.push(method);if(method==='ui.conversation.list')return f.query.listSessions();if(method==='ui.conversation.read')return f.query.readSession(args.sessionId);throw Error('unexpected '+method);}});
  assert.equal(calls.length,0);const sessions=runtime.services.sessions;await sessions.refresh();assert.equal(calls[0],'ui.conversation.list');await sessions.open('readable');
  assert.equal(runtime.services.currentconversation,runtime.services.currentConversation);assert.equal(sessions.binding('readable').ctx.identities.session,'readable');assert.equal(sessions.scopeOf(sessions.binding('readable').ctx),'readable');runtime.dispose();await assert.rejects(sessions.read('readable'),{code:'UI_CONVERSATION_DISPOSED'});
});

test('real dsh-md-render corpus functions resolve the selected binding and unchanged event text',{skip:process.env.DSH_CORPUS_VALIDATION!=='1'},async()=>{
  const source=await fs.readFile(new URL('../../../work/dsh-corpus-100/sources/dsh-md-render_0.7.0/lib/client.js',import.meta.url),'utf8');
  const start=source.indexOf('function propOf(value, key)'),end=source.indexOf('\n}',source.indexOf('function fenceEventWindow(ctx)',start))+2;
  assert.ok(start>=0&&end>start);const functions=source.slice(start,end),f=fixture(),ui=createConversationServices({pollIntervalMs:0,rpc:(method,args)=>method==='ui.conversation.list'?f.query.listSessions():f.query.readSession(args.sessionId)});
  try{await ui.ready;await ui.sessions.open('readable');const sandbox=vm.createContext({ctx:{get:name=>name==='sessions'?ui.sessions:undefined}});vm.runInContext(functions+'\nresult=fenceEventWindow(ctx);',sandbox);assert.equal(sandbox.result.sessionId,'readable');assert.equal(sandbox.result.entries[0].event.data.content[0].text,'原始文字');assert.equal(sandbox.result.entries.length,2);}finally{await ui.dispose();}
});

test('unmodified conversation-exporter backend reads the parent query through its actual registered routes',{skip:process.env.DSH_CORPUS_VALIDATION!=='1',timeout:30000},async t=>{
  const sourceRoot=fileURLToPath(new URL('../../../work/dsh-converter-corpus/dsh-conversation-exporter/',import.meta.url)),runtimeRoot=fileURLToPath(new URL('../',import.meta.url)),stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-conversation-export-'));
  const calls=[],snapshot=projectCodexSession({id:'readable',name:'原始標題',cwd:'C:/project',createdAt:1},[{id:'turn',startedAt:1,completedAt:2,status:'completed',items:[{id:'u',type:'userMessage',content:[{type:'text',text:'讀取原對話的問題'}]},{id:'a',type:'agentMessage',phase:'final_answer',text:'回答保留原文。'}]}]);
  let host;t.after(async()=>{await host?.dispose();await fs.rm(stateDir,{recursive:true,force:true});});
  host=await loadDshHost({sourceRoot,entry:path.join(sourceRoot,'src/index.js'),runtimeRoot,stateDir,services:['webServer'],conversationHistory:true,bridgeRequest:async(method,params)=>{calls.push({method,params});if(method==='codex.conversation.read'){assert.equal(params.id,'readable');return snapshot;}if(method==='codex.conversation.list')return [];throw Error('unexpected '+method);}});
  const registry=await host.request('routes');assert.ok(registry.routes.some(row=>row.path==='/api/conversation.export'));
  const turns=await fetch(registry.origin+'/api/conversation.turns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'readable'})});assert.equal(turns.status,200);const preview=await turns.json();assert.match(JSON.stringify(preview),/讀取原對話的問題/);
  const exported=await fetch(registry.origin+'/api/conversation.export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'readable'})});assert.equal(exported.status,200);const markdown=await exported.text();assert.match(markdown,/讀取原對話的問題/);assert.match(markdown,/回答保留原文/);assert.equal(calls.filter(row=>row.method==='codex.conversation.read').length,2);assert.equal(calls.some(row=>row.method==='turn/start'),false);
});
