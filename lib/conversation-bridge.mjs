import {randomUUID} from 'node:crypto';
import {guardService,moduleError} from './codex-control.mjs';

// The main chat is a DSH agent, distinct from threads created by the agents module.
// Keep the same text/history bounds as the Claude Code bridge.
export function createConversationBridge({emit=()=>{},requestHost,workspace}={}){
  let sessionId=null,model=null,seq=0,turn=0,open=false,announced=false,lastReply,dropped=0,shared=true,allowFollowups=false,disposed=false;
  const createdAt=Date.now(),log=[],idle=[],pending=new Set(),failures=[];
  const clip=value=>String(value??'').slice(0,20000);
  const publish=async(name,...args)=>{await emit(name,...args);};
  const row=async(type,data)=>{const event={seq:seq++,time:Date.now(),type,data};log.push(event);if(log.length>2000){log.shift();dropped++;}await publish('session/event',session,event);};
  const header={get id(){return sessionId;},...(workspace?{cwd:workspace}:{})};
  const session=guardService({get id(){return sessionId;},header,get seq(){return seq;},projection:{source:'codex-main-conversation',replayValidated:false}},'sessions','主對話僅提供即時事件與唯讀紀錄');
  const followup=message=>{
    // The trusted host re-reads allowFollowups on every request and reports a
    // blocked request to the user. Do not use a stale worker-side setting here.
    if(disposed||!sessionId)throw moduleError('conversation','agent.followup','主對話尚未連接，請先在已信任插件掛鉤的對話中送出訊息。','CODEX_CONVERSATION_UNBOUND');
    const content=typeof message==='string'?message:message?.content;
    const text=typeof content==='string'?content:Array.isArray(content)?content.filter(x=>x?.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n'):'';
    if(!text.trim())throw moduleError('conversation','agent.followup','請提供文字訊息。');
    const task=Promise.resolve().then(()=>requestHost('codex.conversation.followup',{sessionId,text:clip(text),...(message?.source&&typeof message.source==='object'?{source:message.source}:{})}));
    pending.add(task);
    task.catch(cause=>{failures.push({code:cause.code??'CODEX_FOLLOWUP_FAILED',message:cause.message});}).finally(()=>pending.delete(task));
    // DSH followup is fire-and-forget. The host reports blocked/queued delivery;
    // flush() lets the Stop hook finish these reverse requests before returning.
  };
  const agent=guardService({id:'codex-main-conversation',session,options:Object.freeze({}),get status(){return open?'running':'idle';},get lastReply(){return lastReply;},followup,send:followup,whenIdle:()=>open?new Promise(resolve=>idle.push(resolve)):Promise.resolve(),cancel(){throw moduleError('conversation','agent.cancel','插件不能透過這個介面中斷主對話。');}},'agents','主對話提供 followup、send、whenIdle 與目前狀態');
  const status=async value=>{await publish('agent/status',{agent,status:value});if(value==='idle')for(const resolve of idle.splice(0))resolve();};
  const start=async()=>{if(open)return;open=true;turn++;await row('turn/start',{turn});await status('running');};
  const bind=async id=>{
    if(typeof id!=='string'||!id)throw moduleError('conversation','event','缺少目前對話識別碼。','CODEX_CONVERSATION_UNBOUND');
    if(sessionId&&sessionId!==id)throw moduleError('conversation','event','這個插件程序只接收它所屬的主對話。','CODEX_CONVERSATION_SCOPE');
    sessionId=id;
    if(!announced){announced=true;await publish('agent/created',{agent,source:'startup'});}
  };
  async function event(params={}){
    if(disposed)throw moduleError('conversation','event','對話連接已結束。');
    if(sessionId&&params.sessionId!==sessionId)throw moduleError('conversation','event','這個插件程序只接收它所屬的主對話。','CODEX_CONVERSATION_SCOPE');
    // Settings arrive through the trusted host RPC, never through source tools.
    if(typeof params.shareConversation==='boolean')shared=params.shareConversation;
    if(typeof params.allowFollowups==='boolean')allowFollowups=params.allowFollowups;
    // Model metadata is independent of conversation sharing.
    if(typeof params.model==='string'&&params.model)model=params.model;
    await bind(params.sessionId);
    if(!shared){open=false;for(const resolve of idle.splice(0))resolve();await flush();return describe();}
    if(params.kind==='model'){await flush();return describe();}
    const text=value=>[{type:'text',text:clip(value)}];
    switch(params.kind){
      case 'user':await start();await row('user/message',{id:randomUUID(),role:'user',content:text(params.text),source:params.source??{kind:'user'}});break;
      case 'tool-call':await start();await row('tool/call',{turn,step:0,callId:String(params.callId??randomUUID()),name:String(params.name??''),arguments:clip(JSON.stringify(params.input??{}))});break;
      case 'tool-result':await start();await row('tool/result',{turn,step:0,message:{id:randomUUID(),role:'tool',source:{kind:'tool',name:String(params.name??'')},toolCallId:String(params.callId??''),content:text(params.text),...(params.isError?{isError:true}:{})}});break;
      case 'turn-end':{
        await start();
        if(params.answer){lastReply=clip(params.answer);await row('assistant/message',{turn,step:0,message:{id:randomUUID(),role:'assistant',source:{kind:'model',provider:'codex',model},content:text(params.answer)},stream:[]});}
        open=false;const kind=({answer:'completed',aborted:'aborted',refusal:'blocked',error:'error'})[params.reason]??'completed';
        await row('turn/end',{turn,reason:{kind}});await status('idle');break;
      }
      default:throw moduleError('conversation','event',`不認得的對話事件：${params.kind}`);
    }
    await flush();return describe();
  }
  async function flush(){while(pending.size)await Promise.allSettled([...pending]);}
  const sessionHeader=()=>({version:4,id:sessionId,createdAt,isSeeded:false,...(workspace?{cwd:workspace}:{})});
  const query={capabilities:{readSession:true,listSessions:'current-conversation-since-start',searchSessions:false,replayValidated:false,modelCalls:0},async listSessions(){return sessionId&&shared?[{header:sessionHeader(),live:true,persisted:false,running:open,blank:!log.some(event=>event.type==='user/message'||event.type==='assistant/message'),updatedAt:log.at(-1)?.time??createdAt}]:[];},async readSession(id){if(id!==sessionId)throw moduleError('sessionQuery','readSession','只能讀目前這個主對話。','CODEX_SESSION_SCOPE');if(!shared)throw moduleError('sessionQuery','readSession','shareConversation 已關閉。請在插件設定開啟；關閉時無法讀取對話。','DSH_CONVERSATION_SHARING_DISABLED');return {session:sessionHeader(),inheritedEventCount:0,events:structuredClone(log),projection:{source:'codex-main-conversation',schemaVersion:1,replayValidated:false,atomic:false,notes:['只有插件啟動後轉來的對話事件。',...(dropped?[`較早的 ${dropped} 筆事件已捨棄，最多保留 2000 筆。`]:[])]}};},async close(){}};
  function describe(){return {sessionId,turn,shared,allowFollowups,model,events:log.length,dropped,failures:structuredClone(failures)};}
  return {event,flush,agent,session,query,selection:()=>({provider:'codex',model}),describe,get bound(){return sessionId!==null;},async dispose(){disposed=true;if(announced)await publish('agent/disposed',{agent});for(const resolve of idle.splice(0))resolve();}};
}

export function includeConversationAgent(service,conversation){
  if(!conversation)return service;
  return new Proxy(service,{get(target,key,receiver){
    if(key==='list'||key==='roots')return (...args)=>{
      const own=target[key](...args),merge=rows=>conversation.bound?[conversation.agent,...rows.filter(row=>row.id!==conversation.agent.id)]:rows;
      return own?.then?own.then(merge):merge(own);
    };
    if(key==='get')return id=>conversation.bound&&id===conversation.agent.id?conversation.agent:target.get(id);
    return Reflect.get(target,key,receiver);
  }});
}
