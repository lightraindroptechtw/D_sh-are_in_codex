import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCodexConversationHost,recordCodexHook,readCodexEvents} from '../lib/codex-events.mjs';
import {startHookBroker,runNativeHook,queryBroker} from '../lib/hook-broker.mjs';
import {createDshHostRuntime} from '../lib/host-server.mjs';

const hook=(event,extra={})=>({hook_event_name:event,session_id:'main',turn_id:'turn-main',model:'actual-model',...extra});
function fixture(options={}){
  let current={};const events=[],notices=[];
  const host=createCodexConversationHost({startedAt:123,settings:async()=>current,notify:async notice=>notices.push(notice),...(options.redact?{redact:options.redact}:{}),request:async(method,event)=>{assert.equal(method,'conversation.event');events.push(event);await options.receive?.(event,host);return {listeners:options.listenersRecord??{sessionEvent:options.listeners??1}};}});
  return {host,events,notices,set:value=>{current=value;}};
}

test('live main hooks share contents by default, model first, and refuse foreign/subagent turn scopes',async()=>{
  const f=fixture();
  await f.host.processHook(hook('SubagentStart',{agent_id:'child'}));
  await f.host.processHook(hook('PreToolUse',{tool_name:'Bash',tool_use_id:'no-main'}));
  assert.equal(f.events.length,0);
  await f.host.processHook(hook('UserPromptSubmit',{prompt:'current user'}));
  assert.deepEqual(f.events.map(event=>event.kind),['model','user']);assert.equal(f.events[0].model,'actual-model');
  await f.host.processHook(hook('UserPromptSubmit',{session_id:'other',prompt:'foreign'}));
  await f.host.processHook(hook('PreToolUse',{turn_id:'child-turn',tool_name:'Bash',tool_use_id:'child',tool_input:{secret:'foreign child'}}));
  await f.host.processHook(hook('PreToolUse',{agent_id:'child',tool_name:'Bash',tool_use_id:'child'}));
  assert.equal(f.events.length,2);
  await f.host.processHook(hook('PreToolUse',{tool_name:'Bash',tool_use_id:'call',tool_input:{command:'synthetic'}}));
  await f.host.processHook(hook('PostToolUse',{tool_name:'Bash',tool_use_id:'call',tool_response:{output:'synthetic result'}}));
  await f.host.processHook(hook('Stop',{last_assistant_message:'current answer'}));
  assert.deepEqual(f.events.filter(event=>event.kind!=='model').map(event=>event.kind),['user','tool-call','tool-result','turn-end']);
  assert.equal(f.events.at(-1).answer,'current answer');assert.equal(f.notices.length,1);assert.equal(f.host.describe().rawTranscriptRead,false);
});

test('sharing changes apply before worker data transfer while model metadata still updates',async()=>{
  const f=fixture();f.set({shareConversation:false});
  await f.host.processHook(hook('UserPromptSubmit',{prompt:'PRIVATE'}));
  await f.host.processHook(hook('PostToolUse',{tool_name:'Bash',tool_use_id:'call',tool_response:'PRIVATE'}));
  await f.host.processHook(hook('Stop',{last_assistant_message:'PRIVATE'}));
  assert.ok(f.events.every(event=>event.kind==='model'&&event.shareConversation===false));assert.doesNotMatch(JSON.stringify(f.events),/PRIVATE/);assert.equal(f.notices.length,0);
  f.set({shareConversation:true});await f.host.processHook(hook('UserPromptSubmit',{prompt:'new public text',model:'changed-model'}));
  assert.equal(f.events.at(-2).model,'changed-model');assert.equal(f.events.at(-1).text,'new public text');
});

test('idle followup queues and native Stop continuation stays in the same chat with recursion guard',async()=>{
  const f=fixture({receive:async(event,host)=>{if(event.kind==='turn-end')await host.followup({sessionId:event.sessionId,text:'continue from source'});}});
  await f.host.processHook(hook('SessionStart'));await assert.rejects(f.host.followup({sessionId:'main',text:'disabled'}),{code:'CODEX_FOLLOWUP_DISABLED'});
  f.set({allowFollowups:true});await assert.rejects(f.host.followup({sessionId:'foreign',text:'no'}),{code:'CODEX_CONVERSATION_SCOPE'});
  const queued=await f.host.followup({sessionId:'main',text:'idle queued'});assert.equal(queued.queued,true);assert.equal(queued.delivery,'next-hook');assert.equal(f.host.describe().idleWake,false);
  const continued=await f.host.processHook(hook('Stop',{last_assistant_message:'answer'}));assert.deepEqual(continued,{decision:'block',reason:'idle queued\n\ncontinue from source'});
  assert.deepEqual(await f.host.processHook(hook('Stop',{stop_hook_active:true})),{});assert.equal(f.host.describe().queuedFollowups,1);
  const nextUser=await f.host.processHook(hook('UserPromptSubmit',{prompt:'next user'}));assert.equal(nextUser.hookSpecificOutput.additionalContext,'continue from source');assert.equal(f.host.describe().queuedFollowups,0);
  assert.equal(f.notices.filter(notice=>notice.kind==='conversation-followup-queued').length,1);
});

test('followups ignore disabled restriction mode and are rechecked before actual delivery',async()=>{
  const f=fixture();f.set({restrictionsEnabled:false,allowFollowups:false});await f.host.processHook(hook('SessionStart'));
  await assert.rejects(f.host.followup({sessionId:'main',text:'disabled'}),{code:'CODEX_FOLLOWUP_DISABLED'});
  f.set({allowFollowups:true});await f.host.followup({sessionId:'main',text:'must not deliver'});f.set({allowFollowups:false});
  assert.deepEqual(await f.host.processHook(hook('Stop')),{});assert.equal(f.host.describe().queuedFollowups,0);
  f.set({allowFollowups:true});await f.host.processHook(hook('SessionEnd'));await assert.rejects(f.host.followup({sessionId:'main',text:'ended'}),{code:'CODEX_CONVERSATION_SCOPE'});
});

test('no-listener hooks do not claim a plugin is collecting content; content never enters lifecycle journal',async t=>{
  const f=fixture({listeners:0});await f.host.processHook(hook('UserPromptSubmit',{prompt:'PRIVATE'}));assert.equal(f.notices.length,0);assert.ok(f.events.every(event=>event.kind==='model'));assert.doesNotMatch(JSON.stringify(f.events),/PRIVATE/);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'conversation-journal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await recordCodexHook({dataDir:root,input:hook('UserPromptSubmit',{prompt:'PRIVATE',tool_input:'PRIVATE',transcript_path:'PRIVATE'})});
  const events=await readCodexEvents(root);assert.equal(events[0].model,'actual-model');assert.doesNotMatch(JSON.stringify(events),/PRIVATE/);
});

test('query-only and main-agent listeners receive disclosure; known secrets are redacted on both directions',async()=>{
  for(const listenersRecord of [{sessionQuery:true},{agentCreated:1}]){
    const f=fixture({listenersRecord,redact:value=>JSON.parse(JSON.stringify(value).replaceAll('KNOWN_SECRET','[redacted]'))});
    f.set({allowFollowups:true});await f.host.processHook(hook('UserPromptSubmit',{prompt:'KNOWN_SECRET'}));
    assert.equal(f.events.at(-1).text,'[redacted]');assert.equal(f.notices[0].kind,'conversation-sharing-active');
    await f.host.followup({sessionId:'main',text:'KNOWN_SECRET'});
    const output=await f.host.processHook(hook('Stop',{last_assistant_message:'KNOWN_SECRET'}));
    assert.equal(output.reason,'[redacted]');assert.equal(f.events.at(-1).answer,'[redacted]');
  }
});

test('authenticated broker passes Stop continuation and tool observations even with native interception off',async t=>{
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'conversation-broker-'));t.after(()=>fs.rm(stateDir,{recursive:true,force:true}));
  const f=fixture();f.set({allowFollowups:true});const broker=await startHookBroker({stateDir,evaluate:input=>f.host.processHook(input),status:async()=>({conversation:f.host.describe()})});t.after(()=>broker.close());
  await runNativeHook({stateDir,input:hook('UserPromptSubmit',{prompt:'live'})});
  await runNativeHook({stateDir,input:hook('PreToolUse',{tool_name:'Bash',tool_use_id:'tool',tool_input:{command:'synthetic only'}}),enabled:false});
  assert.ok(f.events.some(event=>event.kind==='tool-call'));
  await f.host.followup({sessionId:'main',text:'native continuation'});
  assert.deepEqual(await runNativeHook({stateDir,input:hook('Stop'),enabled:false}),{decision:'block',reason:'native continuation'});
  assert.equal((await queryBroker(stateDir,'status',{})).conversation.sessionId,'main');
});

test('real host, authenticated broker and DSH worker deliver native hook events and queue same-chat followup without any model call',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'conversation-real-host-')),source=path.join(root,'source'),runtimeDir=path.join(root,'runtime');
  let runtime;t.after(async()=>{await runtime?.dispose();await fs.rm(root,{recursive:true,force:true});});
  await fs.mkdir(source);await fs.mkdir(runtimeDir);
  const packageRoot=fileURLToPath(new URL('../',import.meta.url));
  await fs.symlink(packageRoot,path.join(runtimeDir,'host-env'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(runtimeDir,'dsh-host-worker.mjs'),`import ${JSON.stringify(pathToFileURL(path.join(packageRoot,'lib/dsh-host-worker.mjs')).href)};`);
  await fs.writeFile(path.join(source,'package.json'),'{"type":"module"}');
  await fs.writeFile(path.join(source,'index.js'),`import {defineTool} from '@deepseek-ai/dsh-tools';
    export const name='live-main-hook-probe';export const inject=['tools','sessionQuery','agentDefaultModel'];
    export function apply(ctx){const seen=[],agents=[];
      ctx.on('agent/created',({agent})=>agents.push(agent));
      ctx.on('session/event',(_,event)=>{seen.push(event);if(event.type==='turn/end')agents[0].followup('synthetic continuation from same main chat');});
      ctx.tools.register(defineTool({name:'state',description:'state',parameters:{},output:{schema:{type:'json'},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async()=>({seen,model:ctx.agentDefaultModel.currentSelection(),history:await ctx.sessionQuery.readSession(agents[0].session.id)})}));
    }`);
  const securitySettings={shareConversation:true,allowFollowups:true};
  runtime=await createDshHostRuntime({root,options:{stateMode:'package',entry:'index.js',services:[],codexCommand:'dsh-test-no-codex-executable',conversationHistory:false,securitySettings,plan:{host:{services:['sessionQuery','agentDefaultModel']}}}});
  const sharingMessage='發生什麼：此插件正在接收這次啟動後綁定主對話的使用者訊息、工具事件與回合結束內容。\n原因：插件已要求主對話資料，且對話內容分享已開啟。\n在哪裡設定：插件安全設定 → 讓插件知道目前對話裡發生的事\n影響：關閉後停止轉交後續事件與對話紀錄讀取；插件若要求讀取 Codex 儲存的歷史對話，會另外顯示通知。';
  const firstHook=await runNativeHook({stateDir:runtime.stateDir,input:hook('UserPromptSubmit',{prompt:'synthetic user text'})});
  assert.deepEqual(firstHook,{systemMessage:sharingMessage});
  await runNativeHook({stateDir:runtime.stateDir,input:hook('PreToolUse',{tool_name:'synthetic-tool',tool_use_id:'synthetic-call',tool_input:{key:'value'}})});
  await runNativeHook({stateDir:runtime.stateDir,input:hook('PostToolUse',{tool_name:'synthetic-tool',tool_use_id:'synthetic-call',tool_response:{output:'synthetic output'}})});
  const output=await runNativeHook({stateDir:runtime.stateDir,input:hook('Stop',{last_assistant_message:'synthetic answer'})});
  const queuedMessage='發生什麼：閒置時不會自動喚醒；跟進訊息會在這個主對話下一次提交訊息或完成回合的掛鉤送入。\n原因：目前使用 Codex 官方掛鉤通道。\n在哪裡設定：插件安全設定 → 允許插件主動送出訊息\n影響：Stop 掛鉤可延續主對話；閒置期間需等待下一個主對話掛鉤。';
  assert.deepEqual(output,{decision:'block',reason:'插件「DSH 插件」主動送出的訊息：\nsynthetic continuation from same main chat',systemMessage:queuedMessage});
  const state=JSON.parse((await runtime.loaded.tools[0].execute({})).content[0].text);
  assert.deepEqual(state.seen.map(event=>event.type),['turn/start','user/message','tool/call','tool/result','assistant/message','turn/end']);
  assert.equal(state.model.model,'actual-model');assert.equal(state.history.session.id,'main');
  assert.equal(state.history.events.find(event=>event.type==='tool/result').data.message.content[0].text,'{"output":"synthetic output"}');
  securitySettings.allowFollowups=false;
  await runNativeHook({stateDir:runtime.stateDir,input:hook('UserPromptSubmit',{prompt:'synthetic followup disabled test'})});
  const disabled=await runNativeHook({stateDir:runtime.stateDir,input:hook('Stop',{last_assistant_message:'synthetic answer'})});
  assert.deepEqual(disabled,{systemMessage:'發生什麼：已拒絕插件要求的主對話跟進訊息。\n原因：「允許插件主動送出訊息」目前關閉。\n在哪裡設定：插件安全設定 → 允許插件主動送出訊息\n影響：這次訊息不會排隊或送入主對話；開啟後插件才能再次要求跟進。'});
  securitySettings.shareConversation=false;
  await runNativeHook({stateDir:runtime.stateDir,input:hook('UserPromptSubmit',{prompt:'not shared'})});
  assert.equal((await runtime.rpc('describe',{})).codexAdapters.conversation.shared,false);
  assert.equal((await runtime.rpc('describe',{})).conversationHost.idleWake,false);
});
