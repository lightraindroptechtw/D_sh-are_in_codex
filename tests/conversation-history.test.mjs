import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationHistoryHost} from '../lib/conversation-history.mjs';
import {createCodexSessionQuery} from '../lib/codex-sessions.mjs';

test('trusted conversation reader discovers all paginated accessible threads and reads a selected one without model calls',async t=>{
  const calls=[];
  const thread=id=>({id,name:'對話 '+id,createdAt:100,cwd:'C:/work',status:{type:'notLoaded'}});
  const q=await createCodexSessionQuery({allowDiscovery:true,pageSize:1,request:async(method,params)=>{
    calls.push({method,params});
    if(method==='thread/list')return params.cursor?{data:[thread('two')],nextCursor:null}:{data:[thread('one')],nextCursor:'second'};
    if(method==='thread/read')return {thread:thread(params.threadId)};
    if(method==='thread/turns/list')return {data:[{id:'turn',status:'completed',items:[{id:'answer',type:'agentMessage',text:'原始對話',phase:'final_answer'}]}],nextCursor:null};
    throw Error('Must never start or resume a model turn');
  }});t.after(()=>q.close());
  const list=await q.listSessions();assert.deepEqual(list.map(row=>row.header.id),['one','two']);assert.equal(list[0].title,'對話 one');
  const read=await q.readSession('two');assert.equal(read.codex.thread.id,'two');assert.equal(read.events.find(e=>e.type==='assistant/message').data.message.content[0].text,'原始對話');
  assert.ok(calls.every(row=>['thread/list','thread/read','thread/turns/list'].includes(row.method)));
  assert.equal(calls[0].params.sortDirection,'desc');
});

test('trusted history follows the existing sharing switch on every read and does not spawn when disabled',async()=>{
  let shared=false,created=0,closed=0;const notices=[];
  const host=createConversationHistoryHost({codexHome:'C:/fixture-home',settings:async()=>({shareConversation:shared}),notify:async notice=>notices.push(notice),createQuery:async options=>{
    created++;assert.equal(options.allowDiscovery,true);assert.equal(options.codexHome,'C:/fixture-home');return {listSessions:async()=>['history'],readSession:async id=>({id}),close:async()=>{closed++;}};
  }});
  await assert.rejects(host.request('list'),{code:'DSH_CONVERSATION_SHARING_DISABLED'});assert.equal(created,0);assert.equal(notices.length,1);
  shared=true;assert.deepEqual(await host.request('list'),['history']);assert.deepEqual(await host.request('read',{id:'selected'}),{id:'selected'});assert.equal(created,1);
  shared=false;await assert.rejects(host.request('read',{id:'selected'}),{code:'DSH_CONVERSATION_SHARING_DISABLED'});
  await host.close();assert.equal(closed,1);await assert.rejects(host.request('list'),{code:'CODEX_SESSION_CLOSED'});
});

test('history errors identify the operation and do not claim an empty successful transcript',async()=>{
  const host=createConversationHistoryHost({createQuery:async()=>({readSession:async()=>{throw Object.assign(Error('原紀錄無法讀取'),{code:'FIXTURE_UNAVAILABLE'});},close:async()=>{}})});
  await assert.rejects(host.request('read',{id:'failed-chat'}),e=>e.code==='FIXTURE_UNAVAILABLE'&&/failed-chat/.test(e.message)&&/未取得/.test(e.message));
  await assert.rejects(host.request('delete',{id:'failed-chat'}),{code:'CODEX_SESSION_METHOD'});await host.close();
});
