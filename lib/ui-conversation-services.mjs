/** Read-only browser presentation of Codex conversations. Local cuts are never DSH replay positions. */
const states=new WeakMap();
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const supported=new Set(['list','page','projections']);
const unsupported=new Set(['create','fork','prompt','cancel','rename','selectModel','updateQueue','attachment','initializeDefaultModel','modelCatalog','search']);
const known=new Set(['session/title','turn/start','turn/end','user/message','assistant/message','tool/call','tool/result']);
const surface=new Set(['user/message','assistant/message','tool/result']);
const methodArgs={list:['_request'],page:['request'],projections:['request'],describe:[],read:['sessionId']};
const inputOf=(method,args)=>Array.isArray(args)?Object.fromEntries((methodArgs[method]??['request']).map((key,index)=>[key,args[index]])):args??{};
function stateFor(query){let state=states.get(query);if(!state){state={cuts:new Map()};states.set(query,state);}return state;}
function queryFor(ctx,sessionQuery){const query=sessionQuery??ctx?.get?.('sessionQuery');if(!query||typeof query.readSession!=='function'||typeof query.listSessions!=='function')throw fail('gateway/unavailable','Codex 對話讀取服務尚未啟用。');return query;}
function idOf(address){if(!record(address)||address.kind!=='session'||typeof address.sessionId!=='string'||!address.sessionId)throw fail('gateway/unsupported','這個頁面只讀取 Codex 對話識別碼；尚未映射 DSH 子代理位址。');return address.sessionId;}
function project(snapshot){
  if(!record(snapshot?.session)||typeof snapshot.session.id!=='string'||!Array.isArray(snapshot.events))throw fail('gateway/internal','Codex 對話沒有可用的顯示紀錄。');
  const events=snapshot.events.map((event,seq)=>{
    if(!record(event)||typeof event.type!=='string'||!record(event.data)||!Number.isFinite(event.time))throw fail('gateway/internal','Codex 顯示事件格式不完整。');
    const row={...structuredClone(event),seq};
    // A Codex presentation event has its own sequence space. Unknown facts stay
    // ignorable and cannot claim to participate in the DSH model surface.
    if(!known.has(row.type)){row.ignorable=true;delete row.surfaceOp;}
    else if(surface.has(row.type))row.surfaceOp='append';
    else delete row.surfaceOp;
    return row;
  });
  return {header:structuredClone(snapshot.session),events,cursor:events.length-1,projection:{...structuredClone(snapshot.projection??{}),source:snapshot.projection?.source??'codex-presentation',replayValidated:false,sequenceSpace:'codex-browser-presentation',notes:[...(snapshot.projection?.notes??[]),'此處 seq 僅是本機顯示順序，不是 DSH 原始事件、重播或分叉位置。']}};
}
function capture(query,id,cut){const state=stateFor(query),cuts=state.cuts.get(id)??new Map();cuts.set(cut.cursor,cut);while(cuts.size>8)cuts.delete(cuts.keys().next().value);state.cuts.delete(id);state.cuts.set(id,cuts);while(state.cuts.size>32)state.cuts.delete(state.cuts.keys().next().value);}
const baseline=cut=>({asOfSeq:cut.cursor,values:{codexPresentation:cut.projection}});
const entries=events=>events.map(event=>({type:'event',event:structuredClone(event)}));
function historyWindow(cut,request={}){
  const maximum=request.maxMessages??100,window=request.turnWindow;
  if(!Number.isSafeInteger(maximum)||maximum<1||maximum>500)throw fail('gateway/bad-request','每頁訊息數量須介於 1 到 500。');
  if(window&&(!Number.isSafeInteger(window.minMessages)||window.minMessages<0||window.minMessages>maximum||!Number.isSafeInteger(window.minTurns)||window.minTurns<0))throw fail('gateway/bad-request','對話頁面的回合視窗無效。');
  const events=cut.events.filter(event=>event.seq<(request.beforeSeq??cut.cursor+1));let start=events.length,messages=0,turns=0;
  while(start>0){const event=events[--start];if(event.type==='user/message'||event.type==='assistant/message')messages++;if(event.type==='turn/start')turns++;if(messages>=maximum||window&&event.type==='turn/start'&&messages>=window.minMessages&&turns>=window.minTurns)break;}
  return {records:entries(events.slice(start)),hasMore:start>0};
}
async function summaries(query,signal){
  signal?.throwIfAborted();const rows=await query.listSessions(signal);signal?.throwIfAborted();
  if(!Array.isArray(rows))throw fail('gateway/internal','Codex 對話清單格式不完整。');
  return rows.map(row=>{
    const header=row.header??row.session??{},thread=row.codex?.thread??row.thread??{};
    const id=header.id??thread.id??row.sessionId;
    if(typeof id!=='string'||!id)throw fail('gateway/internal','Codex 對話清單缺少識別碼。');
    const running=typeof row.running==='boolean'?row.running:thread.status?.type?thread.status.type==='active':undefined;
    const updatedAt=row.updatedAt??(Number.isFinite(thread.updatedAt)?Math.round(thread.updatedAt*1000):header.createdAt);
    const blank=typeof row.blank==='boolean'?row.blank:typeof thread.preview==='string'?thread.preview.length===0:undefined;
    return {sessionId:id,agentAvailable:false,...(typeof updatedAt==='number'?{updatedAt}:{}),...(running===undefined?{}:{running}),...(blank===undefined?{}:{blank}),...(typeof header.cwd==='string'?{cwd:header.cwd}:{}),...(typeof thread.name==='string'?{title:thread.name}:typeof row.title==='string'?{title:row.title}:{}),projection:{source:'codex',replayValidated:false,agentOperations:false,unknownFields:[...(running===undefined?['running']:[]),...(blank===undefined?['blank']:[]),...(typeof updatedAt==='number'?[]:['updatedAt'])]}};
  });
}
/** Return undefined for another namespace. Errors use the official Remote result envelope. */
export async function dispatchConversationUiCall({ctx,sessionQuery,namespace,method,args={},signal}={}){
  if(namespace!=='session'&&namespace!=='codexConversation')return undefined;
  if(namespace==='session'&&!supported.has(method)&&!unsupported.has(method))return undefined;
  if(namespace==='codexConversation'&&!['describe','list','read'].includes(method))return undefined;
  try{
    signal?.throwIfAborted();
    if(namespace==='session'&&unsupported.has(method))throw fail('gateway/unsupported',`「session.${method}」尚未對應 Codex；這個對話介面提供唯讀顯示，不建立或執行 DSH 對話。`);
    const query=queryFor(ctx,sessionQuery),input=inputOf(method,args);let value;
    if(method==='describe')value={...query.capabilities,replayValidated:false,sequenceSpace:'codex-browser-presentation',agentOperations:false};
    else if(method==='list'){
      if(input._request?.cursor!==undefined)throw fail('gateway/bad-request','這個對話清單已一次傳回目前可讀取的項目，沒有下一頁游標。');
      value={items:await summaries(query,signal)};
    }else if(method==='read'){
      if(typeof input.sessionId!=='string'||!input.sessionId)throw fail('gateway/bad-request','請指定要讀取的 Codex 對話識別碼。');
      value=await query.readSession(input.sessionId);
    }else if(method==='projections'){
      const id=input.request?.sessionId;if(typeof id!=='string'||!id)throw fail('gateway/bad-request','請指定對話識別碼。');
      const cut=project(await query.readSession(id));value={kind:'sequenced',...baseline(cut)};
    }else{
      const request=input.request??{},id=idOf(request.address),cut=stateFor(query).cuts.get(id)?.get(request.throughSeq);
      if(!cut)throw fail('session/presentation-cut-expired','顯示紀錄的截點不存在或已過期，請重新開啟此對話。');
      if(!Number.isSafeInteger(request.throughSeq)||request.throughSeq< -1||request.beforeSeq!==undefined&&(!Number.isSafeInteger(request.beforeSeq)||request.beforeSeq<0||request.beforeSeq>cut.cursor+1))throw fail('gateway/bad-request','對話頁面的顯示位置無效。');
      value={...historyWindow(cut,request),projection:cut.projection};
    }
    signal?.throwIfAborted();return {ok:true,value};
  }catch(error){return {ok:false,error:{code:signal?.aborted?'gateway/cancelled':error.code??'gateway/internal',message:error.message??String(error),details:{}}};}
}
function pause(ms,signal){return new Promise((resolve,reject)=>{signal?.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason??fail('gateway/cancelled','已停止讀取對話。'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});}
/** Official stream entry; no match returns undefined synchronously. */
export function dispatchOfficialUiStream({ctx,sessionQuery,namespace,method,args={},signal,pollIntervalMs=1000}={}){
  if(namespace!=='session'||!['follow','control'].includes(method))return undefined;
  if(method==='control')return (async function*(){throw fail('gateway/unsupported','尚未映射 DSH 執行控制投影；唯讀對話顯示請使用 session.follow。');})();
  return (async function*(){
    const query=queryFor(ctx,sessionQuery),input=Array.isArray(args)?args[0]:args.request??args,id=idOf(input?.address);
    let cut=project(await query.readSession(id));signal?.throwIfAborted();capture(query,id,cut);
    yield {type:'snapshot',header:cut.header,cursor:cut.cursor,...historyWindow(cut,input),projections:baseline(cut),projection:cut.projection};
    while(!signal?.aborted){
      await pause(pollIntervalMs,signal);const next=project(await query.readSession(id));signal?.throwIfAborted();
      if(next.events.length<cut.events.length||cut.events.some((event,index)=>JSON.stringify(event)!==JSON.stringify(next.events[index])))throw fail('session/presentation-rewritten','Codex 已修改先前的對話內容，顯示紀錄需要重新開啟；沒有把改寫當成追加成功。');
      const added=next.events.slice(cut.events.length);cut=next;capture(query,id,cut);for(const event of added)yield {type:'event',event};
    }
  })();
}
