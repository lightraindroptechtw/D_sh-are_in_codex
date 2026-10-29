import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCodexSessionQuery,projectCodexSession} from '../lib/codex-sessions.mjs';

const thread={id:'thread-approved',name:'測試對話',createdAt:1720000000,cwd:'C:/test workspace',modelProvider:'test-provider',status:{type:'notLoaded'},ephemeral:false};
const basicTurn={id:'turn-one',status:'completed',startedAt:1720000001,completedAt:1720000002,itemsView:'full',items:[{id:'user-one',type:'userMessage',content:[{type:'text',text:'Human\r\n  original  '}]},{id:'answer-one',type:'agentMessage',phase:'final_answer',text:'Assistant\r\n  original  '}]};
function fake(extra={}){
  const calls=[];
  const request=async(method,params)=>{
    calls.push({method,params});
    if(extra[method])return extra[method](params);
    if(method==='thread/read')return {thread:structuredClone(thread)};
    if(method==='thread/turns/list')return {data:[structuredClone(basicTurn)],nextCursor:null};
    throw new Error('Unexpected read method: '+method);
  };
  return {calls,request};
}

test('default reader creates an empty isolated home and denies undeclared thread ids',async t=>{
  const q=await createCodexSessionQuery();t.after(()=>q.close());
  assert.notEqual(q.codexHome,process.env.CODEX_HOME);assert.match(path.basename(q.codexHome),/^dsh-codex-readonly-/);
  assert.deepEqual(await q.listSessions(),[]);
  await assert.rejects(q.readSession('anything'),error=>error.code==='CODEX_SESSION_SCOPE');
  await assert.rejects(access(path.join(q.codexHome,'config.toml')));
  const home=q.codexHome;await q.close();await assert.rejects(access(home));
});

test('listSessions and exact reads never enumerate chats or start model turns',async t=>{
  const f=fake(),q=await createCodexSessionQuery({request:f.request,allowedThreadIds:[thread.id]});t.after(()=>q.close());
  const listed=await q.listSessions();assert.equal(listed.length,1);assert.equal(listed[0].header.id,thread.id);
  const snapshot=await q.readSession(thread.id);
  assert.equal(snapshot.session.id,thread.id);assert.equal(snapshot.session.createdAt,1720000000000);
  assert.equal(snapshot.events.find(e=>e.type==='user/message').data.content[0].text,'Human\r\n  original  ');
  assert.ok(f.calls.every(c=>['thread/read','thread/turns/list'].includes(c.method)));
  const count=f.calls.length;await assert.rejects(q.readSession('other-thread'),/scope/);assert.equal(f.calls.length,count);
});

test('tool text is retained exactly for function, shell, MCP, and dynamic output',()=>{
  const text='  文字\r\n\n{"x":1}\t  ';
  const tools=[{id:'f',type:'functionCallOutput',name:'fn',output:text},{id:'c',type:'commandExecution',aggregatedOutput:text,status:'completed',exitCode:0},{id:'m',type:'mcpToolCall',server:'remote',tool:'read',status:'completed',result:{content:[{type:'text',text},{type:'image',data:'opaque'}],structuredContent:{ok:true}}},{id:'d',type:'dynamicToolCall',tool:'custom',status:'completed',success:true,contentItems:[{type:'inputText',text}]}];
  const snapshot=projectCodexSession(thread,[{...basicTurn,items:tools}]);
  const results=snapshot.events.filter(e=>e.type==='tool/result');
  assert.equal(results.length,4);for(const result of results)assert.equal(result.data.message.content[0].text,text);
  assert.deepEqual(snapshot.codex.turns[0].items,tools);assert.equal(results[2].data.meta.codexItem.result.structuredContent.ok,true);
  assert.equal(snapshot.events.some(e=>e.type==='assistant/message'),false);
});

test('commentary is not promoted into a final answer and live tails remain incomplete',()=>{
  const snapshot=projectCodexSession(thread,[{...basicTurn,status:'inProgress',items:[basicTurn.items[0],{id:'progress',type:'agentMessage',phase:'commentary',text:'Still working'}]}]);
  assert.equal(snapshot.events.some(e=>e.type==='assistant/message'),false);assert.equal(snapshot.events.some(e=>e.type==='turn/end'),false);assert.equal(snapshot.events.find(e=>e.type==='codex/commentary').data.text,'Still working');assert.equal(snapshot.projection.replayValidated,false);assert.equal(snapshot.projection.atomic,false);
});

test('pages turns in ascending order and hydrates summary-only item pages',async t=>{
  const f=fake({'thread/turns/list':params=>params.cursor?{data:[],nextCursor:null}:{data:[{...basicTurn,items:[],itemsView:'summary'}],nextCursor:'turn-next'},'thread/items/list':params=>params.cursor?{data:[{turnId:basicTurn.id,item:basicTurn.items[1]}],nextCursor:null}:{data:[{turnId:basicTurn.id,item:basicTurn.items[0]}],nextCursor:'item-next'}});
  const q=await createCodexSessionQuery({request:f.request,allowedThreadIds:[thread.id],pageSize:1});t.after(()=>q.close());
  const snapshot=await q.readSession(thread.id);assert.equal(snapshot.codex.turns[0].items.length,2);
  for(const call of f.calls.filter(c=>c.method.endsWith('/list')))assert.equal(call.params.sortDirection,'asc');
});

test('repeated cursors and data limits fail loudly instead of exporting partial histories',async t=>{
  const f=fake({'thread/turns/list':()=>({data:[],nextCursor:'same'})}),q=await createCodexSessionQuery({request:f.request,allowedThreadIds:[thread.id]});t.after(()=>q.close());
  await assert.rejects(q.readSession(thread.id),e=>e.code==='CODEX_SESSION_CURSOR');
  const bounded=await createCodexSessionQuery({request:fake().request,allowedThreadIds:[thread.id],maxItems:1});t.after(()=>bounded.close());
  await assert.rejects(bounded.readSession(thread.id),e=>e.code==='CODEX_SESSION_LIMIT');
});

test('legacy full-history fallback is limited to a genuinely unavailable read method',async t=>{
  const f=fake({'thread/turns/list':()=>{throw Object.assign(new Error('Method not found'),{code:-32601});},'thread/read':params=>({thread:{...thread,turns:params.includeTurns?[basicTurn]:[]}})});
  const q=await createCodexSessionQuery({request:f.request,allowedThreadIds:[thread.id]});t.after(()=>q.close());
  assert.equal((await q.readSession(thread.id)).codex.turns.length,1);assert.ok(f.calls.some(c=>c.method==='thread/read'&&c.params.includeTurns));
  const bad=fake({'thread/turns/list':()=>{throw Object.assign(new Error('Forbidden'),{code:403});}}),denied=await createCodexSessionQuery({request:bad.request,allowedThreadIds:[thread.id]});t.after(()=>denied.close());
  await assert.rejects(denied.readSession(thread.id),/Forbidden/);assert.equal(bad.calls.length,2);
});

test('cross-thread and cross-turn response mismatches are rejected',async t=>{
  const f=fake({'thread/read':()=>({thread:{...thread,id:'other'}})}),q=await createCodexSessionQuery({request:f.request,allowedThreadIds:[thread.id]});t.after(()=>q.close());await assert.rejects(q.readSession(thread.id),/different thread/);
  const g=fake({'thread/turns/list':()=>({data:[{...basicTurn,itemsView:'notLoaded',items:[]}]}),'thread/items/list':()=>({data:[{turnId:'foreign',item:basicTurn.items[0]}]})}),r=await createCodexSessionQuery({request:g.request,allowedThreadIds:[thread.id]});t.after(()=>r.close());await assert.rejects(r.readSession(thread.id),/different turn/);
});

test('the original exporter consumes the projection without importing tools into assistant text',async t=>{
  const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  const file=path.join(workspace,'work/dsh-converter-corpus/dsh-conversation-exporter/src/lib/production.js');
  try{await access(file);}catch{t.skip('Original corpus source is not present');return;}
  const {exportSessionSnapshot}=await import(pathToFileURL(file));
  const snapshot=projectCodexSession(thread,[{...basicTurn,items:[basicTurn.items[0],{id:'secret-tool',type:'functionCallOutput',name:'read',output:'TOOL-ONLY-TEXT'},basicTurn.items[1]]}]);
  const result=exportSessionSnapshot(thread.id,snapshot);
  assert.match(result.markdown,/Human\r\n  original  /);assert.match(result.markdown,/Assistant\r\n  original  /);assert.doesNotMatch(result.markdown,/TOOL-ONLY-TEXT/);assert.equal(result.stats.toolResults,1);
});

test('real Codex reads a synthetic official-shape rollout in an isolated home without a model turn',{skip:process.env.CODEX_INTEGRATION!=='1',timeout:30000},async t=>{
  const home=await mkdtemp(path.join(tmpdir(),'codex-session-fixture '));let q,discovery;t.after(async()=>{await q?.close();await discovery?.close();await rm(home,{recursive:true,force:true});});
  const id='c934a5b7-3f2a-4784-af2b-a65f3ac52000',stamp='2026-10-22T00:00:00Z';
  const directory=path.join(home,'sessions','2026','10','22');await mkdir(directory,{recursive:true});
  // Based on OpenAI codex rust-v0.160.0 app-server/tests/common/rollout.rs.
  const exactToolText='  Synthetic tool\r\n  exact bytes as text  ';
  const rows=[{type:'session_meta',payload:{id,session_id:id,timestamp:stamp,cwd:home,originator:'codex',cli_version:'0.160.0',source:'cli',model_provider:'test-fixture',selected_capability_roots:[]}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic human only.'}]}},{type:'event_msg',payload:{type:'user_message',message:'Synthetic human only.',text_elements:[],local_images:[]}},{type:'response_item',payload:{type:'function_call',call_id:'fixture-call',name:'fixture_read',arguments:'{}'}},{type:'response_item',payload:{type:'function_call_output',call_id:'fixture-call',output:exactToolText}},{type:'event_msg',payload:{type:'agent_message',message:'Synthetic answer only.',phase:'final_answer',memory_citation:null}}];
  await writeFile(path.join(directory,`rollout-2026-10-22T00-00-00-${id}.jsonl`),rows.map(row=>JSON.stringify({timestamp:stamp,...row})).join('\n')+'\n');
  q=await createCodexSessionQuery({codexHome:home,allowedThreadIds:[id],command:process.env.CODEX_BIN||'codex'});
  const snapshot=await q.readSession(id);
  assert.equal(snapshot.session.id,id);assert.ok(snapshot.events.some(e=>e.type==='user/message'&&e.data.content.some(c=>c.text==='Synthetic human only.')));assert.ok(snapshot.events.some(e=>e.type==='assistant/message'&&e.data.message.content[0].text==='Synthetic answer only.'));
  const toolResult=snapshot.events.find(e=>e.type==='tool/result');
  if(toolResult)assert.ok(toolResult.data.message.content.some(c=>c.text===exactToolText));
  else t.diagnostic('This Codex legacy-history projection omitted the generic function_call_output; coverage is explicitly limited to app-server-visible items.');
  assert.equal(snapshot.projection.toolOutputCoverage,'app-server-visible-items-only');assert.equal(snapshot.projection.rawRolloutRead,false);
  discovery=await createCodexSessionQuery({codexHome:home,allowDiscovery:true,command:process.env.CODEX_BIN||'codex'});
  const listed=await discovery.listSessions();assert.ok(listed.some(row=>row.header.id===id));
  assert.equal((await discovery.readSession(id)).session.id,id);
});
