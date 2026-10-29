import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const READ_METHODS=new Set(['thread/list','thread/read','thread/turns/list','thread/items/list']);
const clone=value=>structuredClone(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const failure=(message,code='CODEX_SESSION_READ')=>Object.assign(new Error(message),{code});
const milliseconds=value=>Number.isFinite(value)?Math.round(value*1000):0;
const isUnavailable=error=>error?.code===-32601;

/** A deliberately small JSON-RPC transport: no thread/turn mutation methods. */
function appServerTransport({codexHome,command='codex',timeoutMs=15000,maxResponseBytes=32*1024*1024}) {
  let child,lines,started,closed=false,nextId=0;
  const pending=new Map();
  const rejectAll=error=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
  const rawRequest=(method,params)=>new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{pending.delete(id);reject(failure(`Codex read request timed out: ${method}`,'CODEX_SESSION_TIMEOUT'));},timeoutMs);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
  });
  const start=()=>started??=(async()=>{
    if(closed)throw failure('Session reader is closed');
    // Preserve only process-launch essentials. Do not inherit API-key env vars,
    // desktop routing hints, or the user's default HOME/CODEX_HOME.
    const env={};
    for(const [key,value]of Object.entries(process.env))if(/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LANG|LC_ALL)$/i.test(key))env[key]=value;
    Object.assign(env,{CODEX_HOME:codexHome,HOME:codexHome,USERPROFILE:codexHome});
    child=spawn(command,['app-server','--stdio','--disable','plugins'],{cwd:codexHome,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.stderr.on('data',()=>{});
    child.on('error',error=>rejectAll(error));
    child.on('close',code=>rejectAll(failure(`Codex read process exited (${code})`,'CODEX_SESSION_CLOSED')));
    child.stdin.on('error',()=>{});
    lines=createInterface({input:child.stdout});
    lines.on('line',line=>{
      if(Buffer.byteLength(line)>maxResponseBytes){rejectAll(failure('Codex response exceeds the configured size limit; no partial transcript returned','CODEX_SESSION_LIMIT'));child.kill();return;}
      let message;try{message=JSON.parse(line);}catch{return;}
      if(message.method&&message.id!==undefined){child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Read-only session client does not accept server requests'}})+'\n');return;}
      const wait=pending.get(message.id);if(!wait)return;
      pending.delete(message.id);clearTimeout(wait.timer);
      message.error?wait.reject(Object.assign(new Error(message.error.message),{code:message.error.code})):wait.resolve(message.result);
    });
    await rawRequest('initialize',{clientInfo:{name:'dsh-codex-session-reader',version:'0.1.0'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  })();
  return {
    async request(method,params){if(!READ_METHODS.has(method))throw failure(`Method is outside the read-only contract: ${method}`,'CODEX_SESSION_METHOD');await start();return rawRequest(method,params);},
    async close(){closed=true;rejectAll(failure('Session reader closed','CODEX_SESSION_CLOSED'));lines?.close();if(child&&!child.killed){const done=new Promise(resolve=>child.once('close',resolve));child.kill();await Promise.race([done,new Promise(resolve=>{const timer=setTimeout(resolve,1000);timer.unref();})]);}},
  };
}

function userContent(items) {
  return (items??[]).map(item=>item.type==='text'&&typeof item.text==='string'?{type:'text',text:item.text}:item.type==='image'||item.type==='localImage'?{type:'image',codex:clone(item)}:{type:'codex-opaque',codex:clone(item)});
}
function outputContent(value) {
  if(typeof value==='string')return [{type:'text',text:value}];
  if(!Array.isArray(value))return [];
  return value.map(item=>record(item)&&['text','input_text','inputText'].includes(item.type)&&typeof item.text==='string'?{type:'text',text:item.text}:{type:'codex-opaque',codex:clone(item)});
}
function toolFacts(item) {
  if(item.type==='functionCallOutput')return {name:item.namespace?`${item.namespace}.${item.name}`:item.name,content:outputContent(item.output),isError:false};
  if(item.type==='commandExecution'&&typeof item.aggregatedOutput==='string')return {name:'commandExecution',content:outputContent(item.aggregatedOutput),isError:item.status==='failed'||Number.isInteger(item.exitCode)&&item.exitCode!==0};
  if(item.type==='mcpToolCall'&&(item.result||item.error))return {name:`${item.server}.${item.tool}`,content:outputContent(item.result?.content??item.error?.message),isError:item.status==='failed'||Boolean(item.error)||item.result?.isError===true};
  if(item.type==='dynamicToolCall'&&Array.isArray(item.contentItems))return {name:item.namespace?`${item.namespace}.${item.tool}`:item.tool,content:outputContent(item.contentItems),isError:item.status==='failed'||item.success===false};
  return null;
}

/**
 * Presentation projection for sessionQuery.readSession consumers. This is NOT
 * a DSH replay log: Codex does not expose DSH step ids, append/replacement
 * origin, original raw argument strings, or exact inherited-event counts.
 * Every input item remains in codex.turns; tool text is copied verbatim.
 */
export function projectCodexSession(thread,turns) {
  if(!record(thread)||typeof thread.id!=='string'||!Array.isArray(turns))throw failure('Invalid Codex thread projection input');
  const events=[],notes=new Set(['Presentation projection only; DSH replay validation was not performed.','History pagination is not an atomic snapshot of a running conversation.','Only app-server-visible items are preserved; legacy JSONL history may omit generic tool outputs. No raw rollout files were read.']);
  const add=(type,data,{surface=false,time=0,item}={})=>events.push({seq:events.length,type,time,data,...(surface?{surfaceOp:'append'}:{}),...(item?{codexItemId:item.id}:{})});
  const createdAt=milliseconds(thread.createdAt);
  if(typeof thread.name==='string'&&thread.name.trim())add('session/title',{title:thread.name},{time:createdAt});
  const seenTurns=new Set();
  for(let index=0;index<turns.length;index++){
    const turn=turns[index],number=index+1;
    if(!record(turn)||typeof turn.id!=='string'||!Array.isArray(turn.items)||seenTurns.has(turn.id))throw failure('Malformed or duplicate Codex turn; no partial transcript returned','CODEX_SESSION_SHAPE');
    seenTurns.add(turn.id);
    const time=milliseconds(turn.startedAt)||createdAt;
    add('turn/start',{turn:number},{time});
    for(const item of turn.items){
      if(!record(item)||typeof item.type!=='string'||typeof item.id!=='string')throw failure('Malformed Codex history item','CODEX_SESSION_SHAPE');
      if(item.type==='userMessage'){
        if(!Array.isArray(item.content))throw failure('User message has no content array','CODEX_SESSION_SHAPE');
        add('user/message',{id:item.id,role:'user',source:{kind:'user'},content:userContent(item.content)},{surface:true,time,item});
      }else if(item.type==='agentMessage'){
        if(typeof item.text!=='string')throw failure('Agent message has no text','CODEX_SESSION_SHAPE');
        if(item.phase==='commentary')add('codex/commentary',{text:item.text},{time,item});
        else {
          if(item.phase==null)notes.add('Legacy assistant phase is unknown; retained as assistant text, not certified as a final answer.');
          add('assistant/message',{turn:number,step:0,message:{id:item.id,role:'assistant',source:{kind:'model',provider:thread.modelProvider??'codex',model:'unknown'},content:[{type:'text',text:item.text}]},stream:[]},{surface:true,time,item});
        }
      }else {
        const facts=toolFacts(item);
        if(facts)add('tool/result',{turn:number,step:0,message:{id:item.id,role:'tool',toolCallId:item.id,source:{kind:'tool',callId:item.id},content:facts.content,isError:facts.isError},meta:{codexItem:clone(item),toolName:facts.name}},{surface:true,time,item});
        else add('codex/item',{item:clone(item)},{time,item});
      }
    }
    if(turn.status!=='inProgress'){
      const reason=turn.status==='completed'?{kind:'completed'}:turn.status==='interrupted'?{kind:'interrupted'}:{kind:'error',error:{code:'CODEX_TURN_FAILED',message:turn.error?.message??`Codex turn status: ${turn.status}`}};
      add('turn/end',{turn:number,reason},{time:milliseconds(turn.completedAt)||time});
    }else if(index!==turns.length-1)throw failure('An unfinished turn precedes later history','CODEX_SESSION_SHAPE');
  }
  return {
    session:{version:4,id:thread.id,createdAt,...(typeof thread.cwd==='string'?{cwd:thread.cwd}:{}),isSeeded:false},
    inheritedEventCount:0,events,
    projection:{source:'codex-app-server',schemaVersion:1,replayValidated:false,atomic:false,toolOutputCoverage:'app-server-visible-items-only',rawRolloutRead:false,notes:[...notes]},
    codex:{thread:clone(thread),turns:clone(turns)},
  };
}

/**
 * Create a narrow read-only sessionQuery adapter. Default home is temporary and
 * empty. Legacy callers keep an explicit id scope. The trusted parent can opt
 * into allowDiscovery to list/read its Codex store under the sharing setting.
 * An injected request callback is intended for a trusted host or test double.
 */
export async function createCodexSessionQuery({codexHome,allowedThreadIds=[],allowDiscovery=false,request,command='codex',pageSize=100,maxPages=1000,maxItems=100000,maxBytes=64*1024*1024,timeoutMs=15000}={}) {
  if(!Array.isArray(allowedThreadIds)||allowedThreadIds.some(id=>typeof id!=='string'||!id||id.length>200||/[\x00-\x1f\/\\]/.test(id)))throw failure('allowedThreadIds must be an explicit array of thread ids','CODEX_SESSION_SCOPE');
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1000||!Number.isSafeInteger(maxPages)||maxPages<1||!Number.isSafeInteger(maxItems)||maxItems<1||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw failure('Invalid session pagination or size bounds');
  const allowed=new Set(allowedThreadIds);
  let ownedHome=false,home=codexHome?path.resolve(codexHome):null,transport,closed=false;
  if(!request){
    if(home){if(!(await stat(home)).isDirectory())throw failure('codexHome must be an explicit directory');}
    else{home=await mkdtemp(path.join(tmpdir(),'dsh-codex-readonly-'));ownedHome=true;}
    transport=appServerTransport({codexHome:home,command,timeoutMs,maxResponseBytes:maxBytes});
    request=(method,params)=>transport.request(method,params);
  }
  const send=async(method,params)=>{
    if(closed)throw failure('Session reader is closed','CODEX_SESSION_CLOSED');
    if(!READ_METHODS.has(method))throw failure('Method is outside the read-only contract','CODEX_SESSION_METHOD');
    return request(method,params);
  };
  const authorize=id=>{if(typeof id!=='string'||!id||id.length>200||/[\x00-\x1f\/\\]/.test(id)||!allowDiscovery&&!allowed.has(id))throw failure('Thread is outside the explicitly allowed session scope','CODEX_SESSION_SCOPE');};
  const metadata=async id=>{authorize(id);const result=await send('thread/read',{threadId:id,includeTurns:false});if(!record(result?.thread)||result.thread.id!==id)throw failure('Codex returned a different thread','CODEX_SESSION_SHAPE');return result.thread;};
  const pages=async(method,params)=>{
    const data=[],seen=new Set();let cursor=null;
    for(let page=0;page<maxPages;page++){
      const result=await send(method,{...params,cursor,limit:pageSize,sortDirection:method==='thread/list'?'desc':'asc'});
      if(!Array.isArray(result?.data))throw failure(`${method} returned no data array`,'CODEX_SESSION_SHAPE');
      data.push(...result.data);
      if(data.length>maxItems||Buffer.byteLength(JSON.stringify(data))>maxBytes)throw failure('History exceeds configured bounds; no partial transcript returned','CODEX_SESSION_LIMIT');
      const next=result.nextCursor;
      if(next==null)return data;
      if(typeof next!=='string'||!next||seen.has(next))throw failure('Invalid or repeating Codex history cursor','CODEX_SESSION_CURSOR');
      seen.add(next);cursor=next;
    }
    throw failure('History page limit reached; no partial transcript returned','CODEX_SESSION_LIMIT');
  };
  return {
    codexHome:home,
    capabilities:{readSession:true,listSessions:allowDiscovery?'codex-accessible-history':'explicit-ids-only',searchSessions:false,replayValidated:false,modelCalls:0},
    async listSessions(){
      const records=[];
      const threads=allowDiscovery?await pages('thread/list',{sortKey:'updated_at',modelProviders:[],sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown']}):await Promise.all([...allowed].map(metadata));
      for(const thread of threads){if(!record(thread)||typeof thread.id!=='string')throw failure('Codex returned an invalid conversation list','CODEX_SESSION_SHAPE');records.push({header:{version:4,id:thread.id,createdAt:milliseconds(thread.createdAt),...(typeof thread.cwd==='string'?{cwd:thread.cwd}:{}),isSeeded:false},thread:clone(thread),...(typeof thread.name==='string'?{title:thread.name}:{}),...(typeof thread.preview==='string'?{preview:thread.preview}:{}),live:thread.status?.type==='active',persisted:thread.ephemeral!==true});}
      return records;
    },
    async readSession(id){
      const thread=await metadata(id);let turns;
      try{turns=await pages('thread/turns/list',{threadId:id,itemsView:'full'});}
      catch(error){if(!isUnavailable(error))throw error;const result=await send('thread/read',{threadId:id,includeTurns:true});if(result.thread?.id!==id||!Array.isArray(result.thread.turns))throw failure('Legacy Codex history hydration returned no complete turns','CODEX_SESSION_SHAPE');turns=result.thread.turns;}
      let totalItems=0;
      for(const turn of turns){
        if(turn.itemsView==='notLoaded'||turn.itemsView==='summary'){
          const entries=await pages('thread/items/list',{threadId:id,turnId:turn.id});
          if(entries.some(entry=>entry.turnId!==turn.id||!record(entry.item)))throw failure('Codex returned items belonging to a different turn','CODEX_SESSION_SHAPE');
          turn.items=entries.map(entry=>entry.item);turn.itemsView='full';
        }
        if(!Array.isArray(turn.items))throw failure('Codex turn has no complete item list','CODEX_SESSION_SHAPE');
        totalItems+=turn.items.length;
        if(totalItems>maxItems)throw failure('History item limit reached; no partial transcript returned','CODEX_SESSION_LIMIT');
      }
      if(Buffer.byteLength(JSON.stringify(turns))>maxBytes)throw failure('History exceeds the configured byte limit; no partial transcript returned','CODEX_SESSION_LIMIT');
      return projectCodexSession(thread,turns);
    },
    async close(){if(closed)return;closed=true;await transport?.close();if(ownedHome)await rm(home,{recursive:true,force:true});},
  };
}
