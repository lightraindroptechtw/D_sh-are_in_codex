import {randomUUID} from 'node:crypto';
import {includeConversationAgent} from '../conversation-bridge.mjs';
import Ajv from 'ajv';
import {DEFAULT_PLUGIN_MODEL,DEFAULT_PLUGIN_EFFORT,isClaudeModelAlias} from '../model-routing.mjs';
import {createCodexControl, guardService, moduleError, moduleUnavailable, unsupportedService} from '../codex-control.mjs';

export const descriptor={
  id:'agents',displayName:'代理與對話模組',services:['agents'],
  requires:{minimumCodexVersion:'0.160.0',capabilities:['appServer']},
  methods:{
    create:{support:'partial',reason:'Owned Codex thread; existing ChatGPT login through a trusted control, configured/default Codex model and explicitly registered dynamic tools.'},
    resume:{support:'partial',reason:'Explicitly allowed Codex thread ids only; DSH replay and cross-restart alias reconstruction are unsupported.'},
    list:{support:'partial',reason:'Live agents created or resumed by this module only; never enumerates the desktop chat library.'},
    get:{support:'partial',reason:'Live owned agents only.'},
    'agent.send':{support:'partial',reason:'Text input, immediate turn/start or active turn/steer; queued/nonwaking inbox semantics unsupported.'},
    'agent.whenIdle':{support:'partial',reason:'Waits for the owned Codex turn; rejects on failed or interrupted completion.'},
    'agent.cancel':{support:'partial',reason:'Interrupts the active owned turn; no DSH inbox replay.'},
    'handle.dispose':{support:'partial',reason:'Interrupts/drains active work and removes this module handle; does not delete Codex history.'},
    setup:{support:'partial',reason:'Static noninterpolated systemPrompt.section text becomes developer instructions; tools, presets and scope mutations explicitly fail.'},
    'session.append':{support:'partial',reason:'Only approval/policy with never or on-request is translated on later turns; other mutations fail.'},
    'agent/pre-step':{support:'unsupported',reason:'Codex does not expose DSH loop step admission.'},
    register:{support:'unsupported',reason:'External DSH agent implementations cannot replace Codex execution.'},
    setFactory:{support:'unsupported',reason:'DSH loop replacement is unsupported.'},
  },
  requirements:['allowModelCalls=true before any thread creation/resume or turn submission','Explicit Codex model identity available from model/list','Background execution is not started by this module'],
};

function textInput(message) {
  if(typeof message==='string')return [{type:'text',text:message}];
  if(!Array.isArray(message?.content)||message.content.length===0||message.content.some(x=>x.type!=='text'||typeof x.text!=='string'))throw moduleError('agents','agent.send','Only nonempty text content is supported');
  return message.content.map(x=>({type:'text',text:x.text}));
}

/** Public for injected-transport tests; no model request is issued at construction. */
export function createAgentService({control,options={},emit=()=>{},diagnostics=[]}={}) {
  const live=new Map(), ownedIds=new Set(), aliases=new Map();
  const allowed=new Set(options.allowedThreadIds??[]);
  let closed=false,catalog;
  const warn=(code,reason)=>{if(!diagnostics.some(x=>x.code===code))diagnostics.push({module:'agents',level:'warning',code,reason});};
  warn('PROJECTION_ONLY','Codex turn and message notifications are a presentation projection. Full DSH session replay, tool execution inside the DSH loop and step events are unsupported; actual model output has not been tested.');
  const publish=(event,...args)=>{try{const result=emit(event,...args);if(result?.catch)result.catch(()=>{});}catch{}};
  const requireOptIn=method=>{if(closed)throw moduleError('agents',method,'Module is disposed');if(options.allowModelCalls===false||options.allowAgents===false&&!options.internalModelTask)throw moduleError('agents',method,'allowModelCalls must be explicitly true','DSH_MODEL_CALLS_DISABLED');};
  const selectModel=async input=>{
    const settings=input.agentOptions??{},provider=settings.provider??options.provider??'codex';
    const source=settings.model??options.model;
    catalog??=control.request('model/list',{});
    const models=await catalog;
    const defaultModel=options.defaultModel??DEFAULT_PLUGIN_MODEL;
    const mapped=options.modelMap?.[`${provider}/${source}`] ?? (isClaudeModelAlias(provider,source)?defaultModel:source&&['codex','openai'].includes(provider)?source:!source||options.mapUnrecognizedModelsToDefault!==false?defaultModel:null);
    if(typeof mapped!=='string')throw moduleError('agents','create',`Provider/model has no explicit Codex mapping or available default: ${provider}/${source??'(default)'}`);
    if(!Array.isArray(models?.data)||!models.data.some(row=>row.model===mapped))throw moduleError('agents','create',`Requested model is not in Codex model/list: ${mapped}`);
    if(source!==mapped||provider!=='codex')warn('MODEL_ROUTE_MAPPING',`Requested ${provider}/${source??'(default)'} maps to ChatGPT Codex ${mapped}; no API-key provider is used.`);
    if(settings.maxTokens!==undefined)warn('MODEL_OPTION_NOT_MAPPED','來源設定 maxTokens，但 Codex 沒有對應的輸出長度欄位；會使用 Codex 自己的限制，仍可執行。');
    return {model:mapped,provider,source:source??mapped,effort:settings.reasoningEffort??options.reasoningEffort??DEFAULT_PLUGIN_EFFORT};
  };
  const create=async(input={},resume=false)=>{
    const method=resume?'resume':'create';requireOptIn(method);
    if(!options.internalModelTask)await options.security?.notify({kind:'agent-create',what:'插件準備建立 Codex 子代理',why:options.pluginName??'插件要求',setting:'allowAgents',impact:'沿用現有 Codex 登入及共用帳戶額度；模型與未提供的核准設定使用 Codex 設定預設值。'});
    if(options.security){const current=(await options.security.load()).settings;if(!current.allowModelCalls||!current.allowAgents&&!options.internalModelTask)throw moduleError('agents',method,'插件安全設定已關閉模型或子代理','DSH_MODEL_CALLS_DISABLED');}
    if(input.signal?.aborted)throw moduleError('agents',method,'Creation was cancelled','ABORT_ERR');
    if(input.seed!==undefined||input.inheritedEventCount!==undefined||input.parentAgent!==undefined||input.meta?.parentSession!==undefined||input.meta?.isSeeded)throw moduleError('agents',method,'DSH seed, fork lineage and parent ownership are not mapped');
    if(input.meta?.agentPreset!==undefined)throw moduleError('agents',method,'Agent preset mounting is unsupported');
    const id=resume?input.resumeSessionId:input.sessionId??randomUUID();
    if(typeof id!=='string'||!id||live.has(id))throw moduleError('agents',method,'Session id must be nonempty and not already live');
    const existing=aliases.get(id)??id;
    if(resume&&!ownedIds.has(existing)&&!allowed.has(existing))throw moduleError('agents','resume','Thread is outside owned or explicitly allowed ids','CODEX_CONTROL_SCOPE');
    const selected=await selectModel(input),sections=[],toolDefinitions=new Map();let setupOpen=true,violations=[];
    for(const tool of input.tools??[]){
      if(typeof tool.name!=='string'||!tool.name||toolDefinitions.has(tool.name)||typeof tool.execute!=='function'||!tool.inputSchema)throw moduleError('agents','create','Dynamic tools require unique names, inputSchema and an execute handler');
      toolDefinitions.set(tool.name,{...tool,validate:new Ajv({strict:false}).compile(tool.inputSchema)});
    }
    const setupReject=name=>{violations.push(name);throw moduleError('agents','setup',`Unsupported setup operation: ${name}`);};
    const prompt=new Proxy({section(section){
      if(!setupOpen)return setupReject('late prompt mutation');
      if(typeof section?.text!=='string'||!Number.isFinite(section.order)||section.complete||section.interpolate!==false&&section.text.includes('{{'))return setupReject('dynamic, complete or interpolated prompt section');
      sections.push({...section});return ()=>{const index=sections.findIndex(x=>x.name===section.name);if(index>=0)sections.splice(index,1);};
    }},{get(target,key){if(key==='then'||typeof key==='symbol')return undefined;return key in target?target[key]:(...args)=>setupReject(`systemPrompt.${String(key)}`);}});
    const setupContext=new Proxy({systemPrompt:prompt,get(name){if(name==='systemPrompt')return prompt;return setupReject(`get(${name})`);}},{get(target,key){if(key==='then'||typeof key==='symbol')return undefined;return key in target?target[key]:setupReject(String(key));},set(){return setupReject('context mutation');}});
    if(input.setup){
      const result=await input.setup(setupContext,Object.freeze({id,options:Object.freeze({...input.agentOptions})}));
      if(result!==undefined)setupReject('setup commit callbacks');
      if(violations.length)throw moduleError('agents','setup',`Unsupported setup operations were attempted: ${[...new Set(violations)].join(', ')}`);
    }
    setupOpen=false;
    if(sections.length)warn('SETUP_PROMPT_PROJECTION','Static setup prompt sections become opening developer instructions, not a DSH agent scope; their timing and precedence differ.');
    if(input.signal?.aborted)throw moduleError('agents',method,'Creation was cancelled','ABORT_ERR');
    let approvalPolicy=options.approvalPolicy;
    if(approvalPolicy!==undefined&&!['never','on-request','untrusted'].includes(approvalPolicy))throw moduleError('agents',method,'Only on-request and never approval policies are mapped');
    if(approvalPolicy==='never')warn('APPROVAL_NEVER','approvalPolicy=never disables interactive approval requests for this owned Codex thread; server approval requests are refused by this carrier.');
    const params={model:selected.model,modelProvider:'openai',cwd:options.workspace??input.meta?.cwd??process.cwd(),...(approvalPolicy?{approvalPolicy}:{}),...(options.permissions?{permissions:options.permissions}:options.sandbox?{sandbox:options.sandbox}:{}),...(toolDefinitions.size?{dynamicTools:[...toolDefinitions.values()].map(t=>({type:'function',name:t.name,description:t.description??'',inputSchema:t.inputSchema}))}:{}),...(sections.length?{developerInstructions:sections.sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name)).map(s=>s.text).join('\n\n')}:{})};
    const response=await control.request(resume?'thread/resume':'thread/start',resume?{...params,threadId:existing}:{...params,allowProviderModelFallback:false});
    const threadId=response?.thread?.id;
    if(typeof threadId!=='string'||resume&&threadId!==existing)throw moduleError('agents',method,'App-server returned an invalid or different thread');
    if(response.model!==selected.model||response.modelProvider!=='openai')throw moduleError('agents',method,'App-server returned a different model/provider; no turn was submitted');
    if(input.signal?.aborted)throw moduleError('agents',method,'Creation was cancelled after thread creation; no turn was submitted','ABORT_ERR');
    ownedIds.add(threadId);aliases.set(id,threadId);
    let disposed=false,active=null,lastTask=Promise.resolve(),turnNumber=0;
    const events=[],header=Object.freeze({version:4,id,createdAt:Date.now(),cwd:params.cwd,isSeeded:false});
    const session=guardService({id,header,projection:Object.freeze({source:'codex-app-server',replayValidated:false}),get seq(){return events.length;},snapshotEvents(from=0,to=events.length){return structuredClone(events.slice(from,to));},eventAt(seq){return structuredClone(events[seq]);},ownEvents(){return structuredClone(events);},append(type,data){
      if(type!=='approval/policy'||!['never','on-request'].includes(data?.policy))throw moduleError('agents','session.append','Only approval/policy never or on-request is mapped; arbitrary DSH log mutation is unsupported');
      if(disposed||active)throw moduleError('agents','session.append','Approval changes require a live idle agent');
      approvalPolicy=data.policy;if(approvalPolicy==='never')warn('APPROVAL_NEVER','approval/policy never is mapped to Codex approvalPolicy=never for subsequent turns.');
      return append(type,{policy:approvalPolicy});
    }},'sessions');
    const append=(type,data)=>{const event={seq:events.length,time:Date.now(),type,data};events.push(event);publish('session/event',session,event);return event;};
    const settle=(error)=>{
      if(!active)return;const run=active;active=null;clearTimeout(run.timer);
      append('turn/end',{turn:run.number,reason:error?{kind:'error',error:{code:error.code??'CODEX_TURN_FAILED',message:error.message}}:{kind:'completed'}});
      publish('agent/status',{agent,status:'idle'});error?run.reject(error):run.resolve();
    };
    const receive=message=>{
      const p=message.params??{};
      if(!active||p.threadId!==threadId)return;
      if(!active.turnId){active.buffer.push(message);return;}
      const tid=p.turnId??p.turn?.id;
      if(tid!==active.turnId)return;
      if(message.method==='item/completed'&&p.item?.type==='agentMessage'&&p.item.phase==='final_answer'){
        append('assistant/message',{turn:active.number,step:0,message:{id:p.item.id,role:'assistant',source:{kind:'model',provider:'codex',model:selected.model},content:[{type:'text',text:p.item.text}]},stream:[]});
      }
      publish('codex/agent-event',{agent,notification:message});
      if(message.method==='turn/completed'){
        const status=p.turn.status;
        settle(status==='completed'?null:moduleError('agents','agent.send',`Codex turn ended with status ${status}`,status==='interrupted'?'ABORT_ERR':'CODEX_TURN_FAILED'));
      }
    };
    const detach=control.onNotification(receive);
    const detachRequests=control.onRequest?.(async message=>{
      const p=message.params??{};
      if(message.method!=='item/tool/call'||p.threadId!==threadId)return undefined;
      if(active&&!active.turnId)await active.startPromise;
      const tool=toolDefinitions.get(p.tool);
      if(disposed||!active||p.turnId!==active.turnId||!tool||p.namespace)return {success:false,contentItems:[{type:'inputText',text:'Tool is outside this active agent contract'}]};
      if(!tool.validate(p.arguments))return {success:false,contentItems:[{type:'inputText',text:'Tool arguments do not match the registered schema'}]};
      try{
        const result=await tool.execute(p.arguments,{threadId,turnId:p.turnId,callId:p.callId});
        return {success:true,contentItems:[{type:'inputText',text:typeof result==='string'?result:JSON.stringify(result??null)}]};
      }catch(error){return {success:false,contentItems:[{type:'inputText',text:typeof error?.code==='string'?error.code:'TOOL_EXECUTION_FAILED'}]};}
    });
    const detachClose=control.onClose?.(()=>settle(moduleError('agents','agent.send','App-server closed','CODEX_CONTROL_CLOSED')));
    const send=(message,target='next-turn',wakeup=true)=>{
      requireOptIn('agent.send');if(disposed)throw moduleError('agents','agent.send','Agent is disposed');
      if(!wakeup||!['next-turn','next-step'].includes(target))throw moduleError('agents','agent.send','Nonwaking injection and unknown inbox targets are unsupported');
      const input=textInput(message);
      const notice=options.internalModelTask?undefined:options.security?.notify({kind:'agent-send',what:'插件子代理準備呼叫 Codex 模型',why:options.pluginName??'插件要求',setting:'allowModelCalls',impact:'使用現有 Codex 登入及帳戶額度。'});
      if(active){
        if(target!=='next-step'||!active.turnId)throw moduleError('agents','agent.send','Queued next-turn delivery and steering before turn acceptance are unsupported');
        const steering=control.request('turn/steer',{threadId,expectedTurnId:active.turnId,input});
        steering.catch(error=>settle(error));return;
      }
      const run={turnId:null,number:++turnNumber,buffer:[]};
      lastTask=new Promise((resolve,reject)=>Object.assign(run,{resolve,reject}));lastTask.catch(()=>{});active=run;
      run.timer=setTimeout(()=>{void interrupt().finally(()=>settle(moduleError('agents','agent.send','Owned turn exceeded configured timeout','CODEX_TURN_TIMEOUT'))).catch(()=>{});},options.turnTimeoutMs??300000);
      append('turn/start',{turn:run.number});publish('agent/status',{agent,status:'running'});
      run.startPromise=Promise.resolve(notice).then(async()=>{if(options.security){const current=(await options.security.load()).settings;if(!current.allowModelCalls||!current.allowAgents&&!options.internalModelTask)throw moduleError('agents','agent.send','插件安全設定已關閉模型或子代理','DSH_MODEL_CALLS_DISABLED');}return control.request('turn/start',{threadId,input,model:selected.model,approvalPolicy,...(selected.effort?{effort:selected.effort}:{})});}).then(result=>{
        if(active!==run)return;if(typeof result?.turn?.id!=='string'){settle(moduleError('agents','agent.send','No turn id returned'));return;}
        run.turnId=result.turn.id;for(const notification of run.buffer.splice(0))receive(notification);
        if(active===run&&run.cancelRequested)void interrupt().catch(error=>settle(error));
      },settle);
    };
    const interrupt=async()=>{if(!active)return;const run=active;run.cancelRequested=true;if(!run.turnId)await run.startPromise;if(active===run&&run.turnId)await control.request('turn/interrupt',{threadId,turnId:run.turnId});};
    const agent=guardService({id,codexThreadId:threadId,codexModel:selected.model,session,options:Object.freeze({...input.agentOptions,model:selected.source,provider:selected.provider}),ctx:setupContext,get status(){return active?'running':'idle';},send,followup:message=>send(message,'next-turn',true),steer:message=>send(message,'next-step',true),inject(){throw moduleError('agents','agent.inject','Nonwaking DSH inbox mutation is unsupported');},cancel(){void interrupt().catch(error=>settle(error));},interrupt,whenIdle:()=>lastTask},'agents.agent');
    const handle={agent,async dispose(){if(disposed)return;disposed=true;try{
      await interrupt();
      if(active)await new Promise(resolve=>{const timer=setTimeout(resolve,options.disposeTimeoutMs??5000);lastTask.catch(()=>{}).finally(()=>{clearTimeout(timer);resolve();});});
    }finally{settle(moduleError('agents','handle.dispose','Agent was disposed','ABORT_ERR'));detach();detachRequests?.();detachClose?.();live.delete(id);publish('agent/disposed',{agent});publish('session/disposed',session);}}};
    live.set(id,handle);publish('session/created',session);publish('agent/created',{agent,source:resume?'resume':'startup'});
    return handle;
  };
  return {service:guardService({create:input=>create(input),resume:input=>create(input,true),get:id=>live.get(id)?.agent,list:()=>[...live.values()].map(h=>h.agent),roots:()=>[...live.values()].map(h=>h.agent)},'agents'),async dispose(){closed=true;await Promise.all([...live.values()].map(handle=>handle.dispose()));}};
}

export async function install({options={},capabilities={},emit,requestHost,conversation}={}) {
  const diagnostics=[];const unavailable=moduleUnavailable(descriptor,capabilities);
  if(unavailable)return {services:{agents:unsupportedService('agents',['create','resume','list','get'],unavailable)},dispose:async()=>{},diagnostics:[{module:'agents',level:'warning',status:'disabled',reason:unavailable}]};
  if(options.backend==='codex-broker'){
    const {createRemoteAgentService}=await import('../dsh-codex-task.mjs');
    const runtime=createRemoteAgentService({requestHost,options,emit});
    return {services:{agents:includeConversationAgent(runtime.service,conversation)},diagnostics:[{module:'agents',reason:'Agent execution is delegated to the trusted ChatGPT Codex broker; credentials stay outside the source worker.'}],dispose:runtime.dispose};
  }
  const control=options.control??await createCodexControl(options);
  const runtime=createAgentService({control,options,emit,diagnostics});
  return {services:{agents:includeConversationAgent(runtime.service,conversation)},diagnostics,async dispose(){try{await runtime.dispose();}finally{if(!options.control)await control.close();}}};
}
