/** Browser-side conversation catalog and explicit local selection; every read uses the real host. */
const fail=(message,code='UI_CONVERSATION_UNSUPPORTED')=>Object.assign(new Error(message),{code});
function source(initial){let value=initial;const listeners=new Set();return {getSnapshot:()=>value,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},set(next){value=next;for(const fn of [...listeners])fn();}};}
const unsupported=method=>{throw fail(`「sessions.${method}」尚未對應 Codex。此頁面提供對話選擇與唯讀顯示。`);};
const idOf=target=>{if(typeof target!=='string'||!target)throw fail('請指定 Codex 對話識別碼。','UI_CONVERSATION_ID');return target;};
const unwrap=result=>{if(result?.ok===false)throw fail(result.error.message,result.error.code);return result?.ok===true?result.value:result;};
export function createConversationServices({rpc,context,report=()=>{},emit=()=>{},initialSessionId,pollIntervalMs=1000}={}){
  if(typeof rpc!=='function')throw new TypeError('Conversation services require rpc');
  const list=source({ids:[],byId:{},phase:'loading',projectionsBySession:{},current:undefined}),current=source(undefined),bindings=new Map(),retainSources=new Map();
  let disposed=false,refreshing,timer,controller=new AbortController(),generation=0;
  const call=async(method,params={},signal)=>{if(disposed)throw fail('對話介面已關閉。','UI_CONVERSATION_DISPOSED');signal?.throwIfAborted();const result=await rpc('ui.conversation.'+method,params,{signal:signal??controller.signal});signal?.throwIfAborted();if(disposed)throw fail('對話介面已關閉。','UI_CONVERSATION_DISPOSED');return unwrap(result);};
  const notifySelection=id=>{const previous=list.getSnapshot().current;if(previous===id)return;if(previous)updateCounts(previous,'mainView',-1);if(id)updateCounts(id,'mainView',1);list.set({...list.getSnapshot(),current:id});current.set(id?bindings.get(id)?.session.getSnapshot():undefined);emit('session/selected',id);};
  const retention=id=>{let store=retainSources.get(id);if(!store){store=source({referenceCount:0,retainedBy:{}});retainSources.set(id,store);}return store;};
  function updateCounts(id,kind,delta){const store=retention(id),old=store.getSnapshot(),retainedBy={...old.retainedBy};retainedBy[kind]=(retainedBy[kind]??0)+delta;if(!retainedBy[kind])delete retainedBy[kind];store.set({referenceCount:old.referenceCount+delta,retainedBy});const state=list.getSnapshot();if(state.byId[id])list.set({...state,byId:{...state.byId,[id]:{...state.byId[id],retainedBy}}});}
  async function refresh(){
    if(disposed)throw fail('對話介面已關閉。','UI_CONVERSATION_DISPOSED');
    return refreshing??=(async()=>{try{const value=await call('list'),rows=Array.isArray(value)?value:value.items??[],previous=list.getSnapshot(),ids=[],byId={};for(const row of rows){const header=row.header??{},thread=row.codex?.thread??row.thread??{},id=row.sessionId??header.id??thread.id;if(typeof id!=='string'||!id)throw fail('Codex 對話清單缺少識別碼。','UI_CONVERSATION_SHAPE');ids.push(id);const title=row.title??thread.name,cwd=row.cwd??header.cwd??thread.cwd;byId[id]={...row,id,...(title?{title}:{}),displayTitle:title||cwd?.split(/[\\/]/).filter(Boolean).at(-1)||id,...(cwd?{cwd}:{}),retainedBy:retention(id).getSnapshot().retainedBy};}list.set({ids,byId,phase:'ready',projectionsBySession:{},current:previous.current});}catch(error){if(!disposed){list.set({...list.getSnapshot(),phase:'error'});report(error);}throw error;}finally{refreshing=undefined;}})();
  }
  async function read(id,signal){return call('read',{sessionId:idOf(id)},signal);}
  function materialize(id){
    let binding=bindings.get(id);if(binding)return binding;
    const session=source({sessionId:id,openState:'cold',openError:null,removed:false,hasMore:false,loadingOlder:false,presentationOnly:true}),events=source({entries:[],hasMore:false,revision:0,change:{kind:'replace',entries:[]}}),projections=new Map();
    Object.assign(session,{sessionId:id,projections:{faceOf(key){if(!projections.has(key))projections.set(key,source(undefined));return projections.get(key);}},async loadOlder(){return binding.ready;},async loadThrough(){return binding.ready;},...Object.fromEntries(['prompt','cancel','rename','command','readAttachment','updateQueue','beginSubmission'].map(method=>[method,()=>unsupported(method)]))});
    const scoped=typeof context==='function'?context(id):{identities:{agent:id,session:id}};
    binding={sessionId:id,session,eventSource:events,ctx:scoped,presentationOnly:true,async refresh(signal){session.set({...session.getSnapshot(),openState:'loading',openError:null});try{const value=await read(id,signal),records=(value.events??[]).map(event=>({type:'event',event})),old=events.getSnapshot();events.set({entries:records,hasMore:false,revision:old.revision+1,change:{kind:'replace',entries:records}});const thread=value.codex?.thread;session.set({...session.getSnapshot(),openState:'open',...(value.session?.cwd?{cwd:value.session.cwd}:{}),...(thread?.status?{running:thread.status.type==='active'}:{}),projection:value.projection,codex:value.codex,events:value.events});session.projections.faceOf('codexPresentation').set(value.projection);if(list.getSnapshot().current===id)current.set(session.getSnapshot());return value;}catch(error){if(!disposed)session.set({...session.getSnapshot(),openState:'error',openError:{code:error.code??'gateway/internal',message:error.message,details:{}}});throw error;}}};
    bindings.set(id,binding);return binding;
  }
  function retain(target,options={}){
    const id=idOf(target),kind=typeof options.source==='string'?options.source:'plugin';options.signal?.throwIfAborted();
    if(disposed)throw fail('對話介面已關閉。','UI_CONVERSATION_DISPOSED');
    const binding=materialize(id);updateCounts(id,kind,1);let released=false;
    const release=()=>{if(released)return;released=true;options.signal?.removeEventListener('abort',release);updateCounts(id,kind,-1);};
    const ready=(binding.ready??=binding.refresh().then(()=>binding).catch(error=>{binding.ready=undefined;throw error;})).then(value=>{options.signal?.throwIfAborted();if(released)throw fail('對話參照已釋放。','UI_CONVERSATION_RELEASED');return value;});
    ready.catch(()=>{});options.signal?.addEventListener('abort',release,{once:true});
    return {sessionId:id,get binding(){if(released||disposed)throw fail('對話參照已釋放。','UI_CONVERSATION_RELEASED');return binding;},ready,release,[Symbol.dispose]:release};
  }
  const sessions={list,state:list,getSnapshot:list.getSnapshot,subscribe:list.subscribe,refresh,read,retain,retainInfo:retention,binding:id=>bindings.get(id),scope:id=>bindings.get(id)?.ctx,scopeOf:ctx=>ctx?.identities?.session,sessionOf:ctx=>bindings.get(ctx?.identities?.session)?.session,
    async using(target,options,operation){const reference=retain(target,options);try{await reference.ready;return await operation(reference);}finally{reference.release();}},
    async open(target){const id=idOf(target),ticket=++generation,binding=materialize(id);await binding.refresh();if(ticket===generation)notifySelection(id);return binding;},
    select(target){return this.open(target);},...Object.fromEntries(['create','fork','search','refreshProjections'].map(method=>[method,()=>unsupported(method)]))};
  const currentConversation={getSnapshot:current.getSnapshot,subscribe:current.subscribe,get sessionId(){return list.getSnapshot().current;},read:()=>{const id=list.getSnapshot().current;if(!id)throw fail('尚未選擇對話。','UI_CONVERSATION_UNSELECTED');return read(id);}};
  const schedule=()=>{if(disposed||pollIntervalMs<=0)return;timer=setTimeout(()=>{timer=undefined;void refresh().then(()=>{const id=list.getSnapshot().current;return id?bindings.get(id)?.refresh():undefined;}).catch(error=>report(error)).finally(schedule);},pollIntervalMs);};
  const ready=refresh().then(async()=>{if(initialSessionId)await sessions.open(initialSessionId);}).catch(error=>report(error));ready.finally(schedule);
  return {sessions,currentConversation,ready,async dispose(){if(disposed)return;disposed=true;++generation;controller.abort();clearTimeout(timer);bindings.clear();retainSources.clear();}};
}
