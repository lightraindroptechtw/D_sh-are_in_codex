import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const CODEX_HOOK_EVENTS=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','SubagentStart','SubagentStop','Stop','Notification','PreCompact','Interrupt','SessionEnd'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const string=(value,max=2048)=>typeof value==='string'&&value.length<=max?value:undefined;

/** Persist only lifecycle metadata, never prompt, transcript, or tool arguments. */
export async function recordCodexHook({dataDir,input,now=Date.now()}){
  if(!object(input)||!CODEX_HOOK_EVENTS.includes(input.hook_event_name)||!string(input.session_id,256))throw new Error('Unsupported or invalid Codex lifecycle event');
  const event={id:randomUUID(),time:now,event:input.hook_event_name,sessionId:input.session_id,...(string(input.turn_id,256)?{turnId:input.turn_id}:{}),...(string(input.agent_id,256)?{agentId:input.agent_id}:{}),...(string(input.model,256)?{model:input.model}:{}),...(string(input.cwd)?{cwd:input.cwd}:{})};
  if(['SubagentStart','SubagentStop'].includes(event.event)&&!event.agentId)throw new Error('Subagent lifecycle event requires agent_id');
  const dir=path.join(path.resolve(dataDir),'codex-events');await fs.mkdir(dir,{recursive:true});
  // Separate atomic files avoid interleaved append writes from simultaneous hooks.
  const file=path.join(dir,`${String(now).padStart(16,'0')}-${event.id}.json`),temp=file+'.tmp';
  await fs.writeFile(temp,JSON.stringify(event)+'\n',{flag:'wx'});await fs.rename(temp,file);
  let context='';
  if(['SessionStart','UserPromptSubmit','SubagentStart'].includes(event.event))try{
    const raw=JSON.parse(await fs.readFile(path.join(dataDir,'runtime-context.json'),'utf8'));
    if(typeof raw.text==='string')context=raw.text;
  }catch(e){if(e.code!=='ENOENT')throw e;}
  return {event,output:context?{hookSpecificOutput:{hookEventName:event.event,additionalContext:context}}:{}};
}

/** Real Codex lifecycle observations projected into a read-only DSH agents service. */
export function createCodexActivity(){
  const agents=new Map(),seen=new Set(),ended=new Map();let observed=false;
  const apply=event=>{
    if(!object(event)||!CODEX_HOOK_EVENTS.includes(event.event)||typeof event.sessionId!=='string')throw new Error('Invalid lifecycle record');
    if(seen.has(event.id))return false;seen.add(event.id);observed=true;
    const main=event.sessionId,id=event.agentId??main;
    if(!Number.isFinite(event.time))throw new Error('Lifecycle record requires a finite time');
    if((ended.get(main)??-Infinity)>=event.time)return false;
    const previous=agents.get(id);if(previous&&previous.updatedAt>event.time)return false;
    if(event.event==='SessionEnd'){ended.set(main,event.time);for(const [key,value]of agents)if(value.sessionId===main)agents.delete(key);return true;}
    const status=['UserPromptSubmit','SubagentStart'].includes(event.event)?'running':'idle';
    agents.set(id,{id,sessionId:main,status,cwd:event.cwd??previous?.cwd,updatedAt:event.time,source:'codex-hook'});return true;
  };
  return {apply,list:()=>[...agents.values()].map(value=>({...value})),describe:()=>({source:'codex-hooks',observed,agents:[...agents.values()],backgroundJobsObserved:false})};
}

export async function readCodexEvents(dataDir,{limit=10000}={}){
  const dir=path.join(path.resolve(dataDir),'codex-events');let names;try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  names=names.filter(name=>/^\d{16}-[a-f0-9-]+\.json$/.test(name)).sort();
  if(names.length>limit)throw new Error('Codex lifecycle journal exceeds its configured limit');
  const events=[];for(const name of names){const value=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));events.push(value);}return events;
}

export const GENERATED_HOOK_EVENTS=CODEX_HOOK_EVENTS.filter(event=>event!=='Notification');
export function hookManifest(command){return {hooks:Object.fromEntries(GENERATED_HOOK_EVENTS.map(event=>[event,[{hooks:[{type:'command',command,timeout:['Interrupt','SessionEnd'].includes(event)?3:30}]}]]))};}

const conversationError=(message,code)=>Object.assign(new Error(message),{code});
const mainHooks=new Set(['SessionStart','UserPromptSubmit','Stop','Interrupt','SessionEnd']);

/**
 * Live hook inputs only. No transcript paths, replay, journal text, global
 * session search, app-server resume, or independent model process is used.
 * Stop continuation is the documented native channel back to the SAME chat.
 */
export function createCodexConversationHost({request,settings=async()=>({}),notify=async()=>{},redact=value=>value,pluginName,startedAt=Date.now()}={}){
  if(typeof request!=='function')throw new TypeError('Conversation host requires a worker request function');
  let sessionId=null,turnId=null,ended=false,model=null,queue=[],noticeSent=false,sharingNoticeSent=false,disabledNoticeSent=false;
  const interested=result=>result?.listeners?.sessionEvent>0||result?.listeners?.agentCreated>0||result?.listeners?.sessionQuery===true;
  const policy=async()=>{const current=await settings();return {shareConversation:current.shareConversation!==false,allowFollowups:current.allowFollowups===true};};
  const describe=()=>({source:'live-codex-hooks',sessionId,startedAt,model,queuedFollowups:queue.length,delivery:'next-user-prompt-or-stop-hook',idleWake:false,toolScope:'matching-observed-main-turn-only',rawTranscriptRead:false});
  const followup=async params=>{
    const current=await policy();
    if(!current.allowFollowups){
      if(!disabledNoticeSent){disabledNoticeSent=true;await notify({kind:'conversation-followup-disabled',what:'已拒絕插件要求的主對話跟進訊息。',why:'「允許插件主動送出訊息」目前關閉。',setting:'插件安全設定 → 允許插件主動送出訊息',impact:'這次訊息不會排隊或送入主對話；開啟後插件才能再次要求跟進。'});}
      throw conversationError('插件安全設定未允許主對話跟進訊息。','CODEX_FOLLOWUP_DISABLED');
    }
    if(!sessionId||ended||params?.sessionId!==sessionId)throw conversationError('跟進訊息不屬於這次插件啟動後綁定的主對話。','CODEX_CONVERSATION_SCOPE');
    if(typeof params.text!=='string'||!params.text.trim())throw conversationError('主對話跟進訊息必須是非空文字。','CODEX_FOLLOWUP_INVALID');
    queue.push(redact(pluginName?`插件「${pluginName}」主動送出的訊息：\n${params.text}`:params.text));
    const notice='閒置時不會自動喚醒；跟進訊息會在這個主對話下一次提交訊息或完成回合的掛鉤送入。';
    if(!noticeSent){noticeSent=true;await notify({kind:'conversation-followup-queued',what:notice,why:'目前使用 Codex 官方掛鉤通道。',setting:'插件安全設定 → 允許插件主動送出訊息',impact:'Stop 掛鉤可延續主對話；閒置期間需等待下一個主對話掛鉤。'});}
    return {queued:true,delivery:'next-hook',notice};
  };
  const processHook=async input=>{
    if(!object(input)||typeof input.session_id!=='string'||!input.session_id||!CODEX_HOOK_EVENTS.includes(input.hook_event_name))throw conversationError('無效的主對話掛鉤輸入。','CODEX_CONVERSATION_INPUT');
    const event=input.hook_event_name;
    // A parent id on SubagentStart/Stop does not make the child the main chat.
    if(input.agent_id||event.startsWith('Subagent'))return {};
    if(!mainHooks.has(event)&&!['PreToolUse','PostToolUse'].includes(event))return {};
    if(!sessionId){if(!mainHooks.has(event)||['Interrupt','SessionEnd'].includes(event))return {};sessionId=input.session_id;}
    if(input.session_id!==sessionId||ended)return {};
    const current=await policy();
    const send=async extra=>{
      const result=await request('conversation.event',{sessionId,shareConversation:current.shareConversation,allowFollowups:current.allowFollowups,...redact(extra)});
      if(current.shareConversation&&extra.kind!=='model'&&!sharingNoticeSent&&interested(result)){
        sharingNoticeSent=true;await notify({kind:'conversation-sharing-active',what:'此插件正在接收這次啟動後綁定主對話的使用者訊息、工具事件與回合結束內容。',why:'插件已要求主對話資料，且對話內容分享已開啟。',setting:'插件安全設定 → 讓插件知道目前對話裡發生的事',impact:'關閉後停止轉交後續事件與對話紀錄讀取；插件若要求讀取 Codex 儲存的歷史對話，會另外顯示通知。'});
      }
      return result;
    };
    // Tool hooks only enter an explicitly observed main user turn. A child
    // lifecycle event alone can never authorize a tool or model update.
    const tool=['PreToolUse','PostToolUse'].includes(event);
    if(tool&&(!turnId||input.turn_id!==turnId))return {};
    if(event==='UserPromptSubmit')turnId=typeof input.turn_id==='string'?input.turn_id:null;
    if(typeof input.model==='string'&&input.model)model=input.model;
    const metadata=await send({kind:'model',...(model?{model}:{})});
    if(current.shareConversation&&interested(metadata)){
      if(event==='UserPromptSubmit'&&typeof input.prompt==='string')await send({kind:'user',text:input.prompt});
      if(tool&&typeof input.tool_name==='string'&&typeof input.tool_use_id==='string'){
        const answer=input.tool_response??input.tool_output??null;
        await send(event==='PreToolUse'?{kind:'tool-call',name:input.tool_name,callId:input.tool_use_id,input:input.tool_input??{}}:{kind:'tool-result',name:input.tool_name,callId:input.tool_use_id,text:typeof answer==='string'?answer:JSON.stringify(answer)});
      }
      if(event==='Stop')await send({kind:'turn-end',answer:typeof input.last_assistant_message==='string'?input.last_assistant_message:null,reason:'answer'});
      if(event==='Interrupt')await send({kind:'turn-end',answer:null,reason:'aborted'});
    }
    if(['Stop','Interrupt'].includes(event))turnId=null;
    if(event==='SessionEnd'){ended=true;turnId=null;queue=[];return {};}
    // Re-check immediately before delivery: a handler can change settings.
    const latest=await policy();
    if(!latest.allowFollowups){queue=[];return {};}
    if(!queue.length)return {};
    if(event==='UserPromptSubmit'){const text=queue.join('\n\n');queue=[];return {hookSpecificOutput:{hookEventName:event,additionalContext:text}};}
    if(event==='Stop'&&input.stop_hook_active!==true){const text=queue.join('\n\n');queue=[];turnId=null;return {decision:'block',reason:text};}
    return {};
  };
  return {processHook,followup,describe,policy};
}
