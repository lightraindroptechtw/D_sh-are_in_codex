/** Trusted-side agent/task carrier. Never import this runner into untrusted source to expose authentication. */
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
import {parseDocument} from 'yaml';
import {createAgentService} from './modules/agents.mjs';
import {createCodexControl,guardService,moduleError} from './codex-control.mjs';
import {createProcessBroker,PROCESS_METHODS} from './process-broker.mjs';

const error=(reason,code='DSH_TASK_UNSUPPORTED')=>moduleError('codex-task','run',reason,code);
const within=(root,file)=>{const rel=path.relative(root,file);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const textOf=agent=>agent.session.snapshotEvents().filter(e=>e.type==='assistant/message').flatMap(e=>e.data.message.content).filter(b=>b.type==='text').map(b=>b.text).join('\n');

export function parseDshTaskArguments(argv){
  const result={profile:'headless',patches:[],prompt:''};let profileSeen=false;
  for(let i=0;i<argv.length;i++){
    const value=argv[i];
    if(value==='--profile'||value==='--patch'){
      const next=argv[++i];if(typeof next!=='string'||!next||next.startsWith('-'))throw error(`Missing value for ${value}`);
      if(value==='--profile'){if(profileSeen)throw error('Repeated profiles are unsupported');result.profile=next;profileSeen=true;}else result.patches.push(next);
    }else if(value==='--'){if(result.prompt||i!==argv.length-2)throw error('Exactly one task prompt is required');result.prompt=argv[++i];}
    else if(value.startsWith('-')||result.prompt)throw error('Only --profile, --patch and one task prompt are supported');
    else result.prompt=value;
  }
  if(!result.prompt.trim()||result.prompt.length>1024*1024)throw error('Task prompt must be nonempty and at most 1 MiB');
  if(result.patches.length>8)throw error('At most eight overlays are supported');
  return result;
}

/** Reads data-only overlays. Unknown runtime services fail instead of executing source code. */
export async function readDshTaskOverlays(invocation,{stateRoots=[],allowedProfiles=['headless'],cwd=process.cwd()}={}){
  if(!allowedProfiles.includes(invocation.profile))throw error('Profile is outside the configured task profiles');
  const roots=await Promise.all(stateRoots.map(p=>fs.realpath(path.resolve(p))));
  const result={modelSelection:null,mcpServers:[],ignoredServices:[]};
  for(const filename of invocation.patches){
    const file=await fs.realpath(path.resolve(cwd,filename));
    if(!roots.some(root=>within(root,file)))throw error('Overlay is outside the dedicated source state roots');
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>256*1024)throw error('Overlay must be a regular file of at most 256 KiB');
    const document=parseDocument(await fs.readFile(file,'utf8'),{uniqueKeys:true});
    if(document.errors.length)throw error('Invalid overlay YAML');
    let rows;try{rows=document.toJS({maxAliasCount:0});}catch{throw error('Overlay aliases are unsupported');}
    if(!Array.isArray(rows))throw error('Overlay root must be an array');
    for(const row of rows){
      if(!row||typeof row!=='object')throw error('Invalid overlay row');
      if(['credentials','authorization','deepseek-account'].includes(row.id)&&Object.keys(row).every(k=>['id','disabled'].includes(k))){result.ignoredServices.push(row.id);continue;}
      if(row.id==='agent-default-model'&&Object.keys(row).every(k=>['id','config'].includes(k))){
        if(!row.config||typeof row.config.provider!=='string'||typeof row.config.model!=='string'||Object.keys(row.config).some(k=>!['provider','model','reasoningEffort'].includes(k)))throw error('Invalid model selection overlay');
        result.modelSelection={...row.config};continue;
      }
      if(!Array.isArray(row.insert)||Object.keys(row).some(k=>k!=='insert'))throw error('Unsupported overlay runtime mutation');
      for(const entry of row.insert){
        if(entry?.name!=='@deepseek-ai/dsh-mcp-client'||entry.config?.transport!=='stdio'||Object.keys(entry).some(k=>!['id','name','config'].includes(k)))throw error('Only configured stdio MCP declarations can be projected');
        const cfg=entry.config;
        if(typeof cfg.serverName!=='string'||!cfg.serverName||typeof cfg.command!=='string'||!cfg.command||!Array.isArray(cfg.args)||cfg.args.some(x=>typeof x!=='string')||Object.keys(cfg).some(k=>!['serverName','transport','command','args','env'].includes(k))||Object.values(cfg.env??{}).some(x=>typeof x!=='string'))throw error('Invalid MCP declaration');
        if(result.mcpServers.some(s=>s.serverName===cfg.serverName))throw error('Duplicate MCP server name');
        result.mcpServers.push(structuredClone(cfg));
      }
    }
  }
  return result;
}

/** Deterministic Codex execpolicy evaluation. Metadata does not expose in-memory
 * turn rules, so this covers only visible home/workspace .rules files. */
export async function checkLocalShellRules(command,{codexCommand='codex',codexHome=process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),workspace=process.cwd(),cwd=workspace}={}){
  const directories=[path.join(codexHome,'rules'),path.join(workspace,'.codex','rules'),path.join(cwd,'.codex','rules')],files=[];
  for(const dir of new Set(directories)){
    let rows;try{rows=await fs.readdir(dir,{withFileTypes:true});}catch(cause){if(cause.code==='ENOENT')continue;throw cause;}
    for(const row of rows)if(row.isFile()&&row.name.endsWith('.rules'))files.push(path.join(dir,row.name));
  }
  if(!files.length)return {decision:'prompt',files,scope:'visible-home-and-workspace-files'};
  const {stdout}=await execFileAsync(codexCommand,['execpolicy','check',...files.flatMap(file=>['--rules',file]),'--resolve-host-executables','--',...command],{cwd,windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  const result=JSON.parse(stdout);return {...result,decision:result.decision??'prompt',files,scope:'visible-home-and-workspace-files'};
}

/** Each broker instance belongs to one source installation. Caller owns policy and tool authorization. */
export async function createCodexTaskBroker({control,options={},codexHome,workspace,executionPolicy={},model,tools=[],resolveTaskTools}={}){
  options={...executionPolicy,...options,...(codexHome?{codexHome}:{}),...(workspace?{workspace}:{}),...(model?{model}:{})};
  const onApprovalRequest=options.onApprovalRequest??(async message=>{
    if(!['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(message.method))return undefined;
    const approved=options.nativePolicy?.fullAccess===true||await options.security?.requestApproval({kind:'codex-agent-approval',command:message.params?.command,cwd:message.params?.cwd??options.workspace,reason:message.params?.reason??'Codex 子代理要求核准此操作',nativeRequest:message.params});
    return {decision:approved?'accept':'decline'};
  });
  const carrier=control??await createCodexControl({...options,onApprovalRequest,authentication:'chatgpt'});
  const runtime=createAgentService({control:carrier,options}),handles=new Map();let closed=false;
  let sourceToolDispatcher;
  const catalog=new Map(tools.map(tool=>[tool.name,tool]));
  async function create(input={}){
    if(closed)throw error('Broker is closed');
    const settings=(await options.security?.load())?.settings;
    if(settings?.allowAgents===false||settings?.allowModelCalls===false)throw error('子代理已在插件安全設定關閉','DSH_MODEL_CALLS_DISABLED');
    const names=input.toolNames??[];
    if(!Array.isArray(names)||names.some(name=>!catalog.has(name)))throw error('Requested tools are outside the trusted installation catalog');
    const id=input.sessionId??randomUUID();
    const callbackTools=(input.toolDefinitions??[]).map(tool=>{
      if(typeof sourceToolDispatcher!=='function'||typeof tool.callbackId!=='string')throw error('A trusted source callback channel is required');
      return {...tool,execute:(args,execution)=>sourceToolDispatcher({agentId:id,callbackId:tool.callbackId,name:tool.name,args,execution})};
    });
    const handle=await runtime.service.create({sessionId:id,agentOptions:input.agentOptions,meta:{cwd:options.workspace},tools:[...names.map(name=>catalog.get(name)),...callbackTools],...(input.instructions?{setup(ctx){ctx.systemPrompt.section({name:'source-task',order:0,text:input.instructions,interpolate:false});}}:{})});
    handles.set(id,handle);return {id,codexThreadId:handle.agent.codexThreadId,model:handle.agent.codexModel};
  }
  const get=id=>{const handle=handles.get(id);if(!handle)throw error('Unknown agent id','CODEX_CONTROL_SCOPE');return handle;};
  async function run(input={},internalModelTask=false){
    const settings=(await options.security?.load())?.settings;
    if(settings?.allowModelCalls===false)throw error('模型呼叫已在插件安全設定關閉','DSH_MODEL_CALLS_DISABLED');
    await options.security?.notify({kind:'model-call',what:'插件準備呼叫 Codex 模型',why:options.pluginName??'插件要求',setting:'allowModelCalls',impact:'使用現有 Codex 登入及共用帳戶額度；不是獨立 API 計費。'});
    if(typeof input.prompt!=='string'||!input.prompt.trim())throw error('A nonempty task prompt is required');
    let taskTools=[];const warnings=[];
    if(input.overlay?.mcpServers?.length){
      if(typeof resolveTaskTools!=='function'){
        const names=input.overlay.mcpServers.map(server=>String(server.serverName??'未命名服務').slice(0,100));
        const notice={code:'DSH_TASK_MCP_NOT_ATTACHED',kind:'unsupported-feature',what:`這次子代理沒有掛上臨時 MCP 服務：${names.join('、')}`,why:'目前沒有這些臨時服務的通用接入流程；不會推測 Python 路徑或啟動方式。',setting:'可改用插件正式宣告的 MCP 連線，或依原始碼補寫這部分。',impact:'任務仍會使用目前可用工具執行；只有這些服務提供的工具無法使用。'};
        warnings.push(notice);await options.security?.notify(notice);
      }else{
        taskTools=await resolveTaskTools(input.overlay.mcpServers);
        if(!Array.isArray(taskTools))throw error('Task resolver did not return tool definitions');
      }
    }
    const taskRuntime=internalModelTask||taskTools.length?createAgentService({control:carrier,options:internalModelTask?{...options,internalModelTask:true,allowAgents:true}:options}):runtime;
    let handle;
    try{
      const requestedTools=input.toolNames===undefined?tools:input.toolNames.map(name=>{if(!catalog.has(name))throw error('Task tool name is outside the trusted catalog');return catalog.get(name);});
      const instructions=[input.instructions,...warnings.map(notice=>`${notice.what}。${notice.impact} 若任務需要缺少的工具，請說明無法完成的部分，不要聲稱已執行。`)].filter(Boolean).join('\n\n');
      handle=await taskRuntime.service.create({sessionId:randomUUID(),agentOptions:input.agentOptions??input.overlay?.modelSelection,meta:{cwd:options.workspace},tools:taskTools.length?taskTools:requestedTools,...(instructions?{setup(ctx){ctx.systemPrompt.section({name:'source-task',order:0,text:instructions,interpolate:false});}}:{})});
      handle.agent.send(input.prompt);await handle.agent.whenIdle();
      return {id:handle.agent.id,codexThreadId:handle.agent.codexThreadId,model:handle.agent.codexModel,text:textOf(handle.agent),events:handle.agent.session.snapshotEvents(),ignoredServices:input.overlay?.ignoredServices??[],warnings};
    }finally{await handle?.dispose();if(taskRuntime!==runtime)await taskRuntime.dispose();}
  }
  async function authorizeCommand(input={}){
    if(!Array.isArray(input.command)||!input.command.length||input.command.some(arg=>typeof arg!=='string'))throw error('shell.command 必須是完整指令與參數陣列');
    const cwd=path.resolve(input.cwd??options.workspace??process.cwd());
    let ruleCheck;try{ruleCheck=await checkLocalShellRules(input.command,{codexCommand:options.command??'codex',codexHome:options.codexHome,workspace:options.workspace,cwd});}catch(cause){await options.security?.notify({kind:'native-rules-unavailable',what:'無法讀取或評估可見的 Codex 指令規則',why:cause.message,setting:'Codex rules（規則）檔案',impact:'改由本機介面取得這次完整指令的核准，無法宣稱同步記憶體中的當次規則。'});}
    if(ruleCheck?.decision==='forbidden')throw error('可見的 Codex 指令規則禁止執行這條指令','DSH_SHELL_FORBIDDEN');
    const display={kind:'shell',command:input.command,cwd,reason:ruleCheck?.decision==='allow'?'可見 Codex 規則已明確允許這條完整指令。':options.nativePolicy?.fullAccess?'目前為完整存取權限，依本次權限執行。':'來源插件要求執行這條指令。Codex command/exec 沒有外部呼叫的原生核准介面，因此由本機介面取得單次核准。'};
    await options.security?.notify({kind:'shell',what:'插件準備執行本機指令',why:display.reason,setting:'Codex 權限與插件安全設定',impact:'完整存取或可見規則明確允許時直接執行；其餘指令核准後回到原函式繼續執行。',details:display});
    if(!options.nativePolicy?.fullAccess&&ruleCheck?.decision!=='allow'){
      if(!options.security||!await options.security.requestApproval(display))throw error('你取消或未核准這條指令','DSH_SHELL_REJECTED');
    }
    return {cwd,env:options.security?.commandEnvironment(input.env??{},{providedSecrets:input.providedSecrets??[]})??{}};
  }
  async function shell(input={}){
    const {cwd,env}=await authorizeCommand(input);
    // The native sandbox command is deterministic execution, never a model prompt.
    const {runGuarded}=await import('./sandbox-launch.mjs');
    const child=await runGuarded({stateDir:options.stateDir??cwd,command:input.command[0],args:input.command.slice(1),cwd,executionPolicy:options.nativePolicy,codexCommand:options.command,stdio:['ignore','pipe','pipe'],environment:env});
    let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
    const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    return options.security?.redact({stdout,stderr,exitCode})??{stdout,stderr,exitCode};
  }
  const processes=createProcessBroker({options,authorizeCommand});
  const servers=new Set();
  const broker={
    run,
    setSourceToolDispatcher(handler){if(sourceToolDispatcher)throw error('A callback channel is already attached');sourceToolDispatcher=handler;},
    async startServer(config={}){const server=await createDshCodexTaskServer({broker,workspace:options.workspace,stateRoots:options.stateRoots,...config});servers.add(server);return server;},
    async dispatch(method,params={}){
      if(method==='codex.task'){if(params.overlay?.mcpServers?.length||params.toolNames?.length||params.toolDefinitions?.length)throw error('模型通道只接受文字，不接受來源工具；請使用 agents 介面');return run({...params,toolNames:[]},true);}
      if(method==='codex.shell')return shell(params);
      if(PROCESS_METHODS.includes(method))return processes.dispatch(method,params);
      if(method==='codex.models')return carrier.request('model/list',{});
      if(method==='codex.agent.create')return create(params);
      const handle=get(params.id),agent=handle.agent;
      if(method==='codex.agent.send'){agent.send(params.message,params.target??'next-turn',params.wakeup??true);return {accepted:true};}
      if(method==='codex.agent.wait'){await agent.whenIdle();return {status:agent.status,text:textOf(agent),events:agent.session.snapshotEvents()};}
      if(method==='codex.agent.cancel'){await agent.interrupt();return {interrupted:true};}
      if(method==='codex.agent.dispose'){await handle.dispose();handles.delete(params.id);return {disposed:true};}
      throw error('Unknown broker method');
    },
    async close(){if(closed)return;closed=true;await processes.close();await Promise.allSettled([...servers].map(server=>server.close()));await runtime.dispose();handles.clear();await resolveTaskTools?.close?.();if(!control)await carrier.close();},
  };
  return broker;
}

/** Source-side proxy. Only plain data crosses requestHost; no login paths or tokens are returned. */
export function createRemoteAgentService({requestHost,options={},emit=()=>{}}={}){
  if(typeof requestHost!=='function')throw error('A trusted host request transport is required');
  const live=new Map(),callbacks=new Map();let closed=false,pump;
  const pollCallbacks=()=>pump??=(async()=>{
    while(!closed&&callbacks.size){
      let call;try{call=await requestHost('codex.callback.poll',{waitMs:25000});}catch{if(closed)break;await new Promise(resolve=>setTimeout(resolve,1000));continue;}
      if(!call)continue;const callback=callbacks.get(call.callbackId),owner=live.get(call.agentId)?.agent;
      try{
        if(!callback||!owner)throw error('Callback is outside the live source agent');
        const result=await callback(call.args,{...call.execution,agent:owner,sessionId:call.agentId,cwd:options.workspace,signal:new AbortController().signal});
        await requestHost('codex.callback.result',{callId:call.callId,success:true,result});
      }catch(cause){await requestHost('codex.callback.result',{callId:call.callId,success:false,error:cause.code??'SOURCE_TOOL_FAILED'}).catch(()=>{});}
    }
  })().finally(()=>{pump=undefined;});
  const create=async(input={})=>{
    if(closed||options.allowModelCalls===false)throw error('Model calls are disabled','DSH_MODEL_CALLS_DISABLED');
    if(input.seed||input.parentAgent)throw error('Seed and parent lineage semantics are not mapped');
    const definitions=new Map(),sections=[];let setupOpen=true;
    const register=tool=>{
      if(!setupOpen||typeof tool?.name!=='string'||definitions.has(tool.name)||typeof tool.execute!=='function'||!(tool.inputSchema??tool.parameters))throw error('Static tools require unique names, schemas and execute callbacks');
      const callbackId=randomUUID();definitions.set(tool.name,{name:tool.name,description:tool.description??'',inputSchema:tool.inputSchema??tool.parameters,callbackId});callbacks.set(callbackId,tool.execute.bind(tool));
      return ()=>{definitions.delete(tool.name);callbacks.delete(callbackId);};
    };
    const tools=guardService({register},'agents.setup.tools');
    const systemPrompt=guardService({section(section){if(!setupOpen||typeof section?.text!=='string'||section.interpolate!==false&&section.text.includes('{{')||section.complete)throw error('Only static prompt sections are mapped');sections.push({...section});return ()=>{const i=sections.indexOf(section);if(i>=0)sections.splice(i,1);};}},'agents.setup.systemPrompt');
    const setupContext=guardService({tools,systemPrompt,get(name){if(name==='tools')return tools;if(name==='systemPrompt')return systemPrompt;throw error('Unknown remote setup service');}},'agents.setup');
    let created;
    try{
      for(const tool of input.tools??[])register(tool);
      if(input.setup){const result=await input.setup(setupContext,{id:input.sessionId,options:input.agentOptions??{}});if(result!==undefined)throw error('Setup disposal callbacks are not mapped');}
      setupOpen=false;
      const instructions=[input.instructions,...sections.sort((a,b)=>(a.order??0)-(b.order??0)).map(s=>s.text)].filter(Boolean).join('\n\n');
      created=await requestHost('codex.agent.create',{sessionId:input.sessionId,agentOptions:input.agentOptions,toolNames:input.toolNames,toolDefinitions:[...definitions.values()],instructions});
    }catch(cause){for(const tool of definitions.values())callbacks.delete(tool.callbackId);throw cause;}
    let status='idle',events=[],lastTask=Promise.resolve();
    const agent=guardService({id:created.id,codexThreadId:created.codexThreadId,options:{...input.agentOptions,model:created.model},get status(){return status;},session:{id:created.id,snapshotEvents:()=>structuredClone(events)},send(message,target='next-turn',wakeup=true){
      status='running';lastTask=requestHost('codex.agent.send',{id:created.id,message,target,wakeup}).then(()=>requestHost('codex.agent.wait',{id:created.id})).then(result=>{status='idle';events=result.events;return result;},cause=>{status='idle';throw cause;});lastTask.catch(()=>{});
    },whenIdle:()=>lastTask,cancel(){void requestHost('codex.agent.cancel',{id:created.id});}},'agents.agent');
    const handle={agent,async dispose(){try{await requestHost('codex.agent.dispose',{id:created.id});}finally{live.delete(created.id);for(const tool of definitions.values())callbacks.delete(tool.callbackId);}}};
    live.set(created.id,handle);if(definitions.size)void pollCallbacks();emit('agent/created',{agent,source:'startup'});return handle;
  };
  return {service:guardService({create,get:id=>live.get(id)?.agent,list:()=>[...live.values()].map(h=>h.agent),roots:()=>[...live.values()].map(h=>h.agent)},'agents'),async dispose(){closed=true;await Promise.allSettled([...live.values()].map(h=>h.dispose()));}};
}

export async function requestCodexTaskEndpoint(endpoint,method,params={},execution={}){
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash)throw error('A trusted loopback task endpoint is required');
  if(![...PROCESS_METHODS,'codex.models','codex.shell','codex.task','codex.agent.create','codex.agent.send','codex.agent.wait','codex.agent.cancel','codex.agent.dispose','codex.callback.poll','codex.callback.result'].includes(method))throw error('Unknown task endpoint RPC method');
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,params}),signal:execution.signal,redirect:'error'});
  const result=await response.json();
  if(!response.ok)throw error(result.message??'Trusted task request failed',result.error??'DSH_TASK_FAILED');
  return result;
}

/** A source CLI can submit bounded tasks, while Codex authentication remains in this trusted process. */
export async function createDshCodexTaskServer({broker,stateRoots,workspace,allowedProfiles=['headless'],maxBodyBytes=2*1024*1024}={}){
  if(!broker?.run||!workspace||!stateRoots?.length)throw error('Broker, workspace and dedicated stateRoots are required');
  const root=await fs.realpath(workspace),token=randomUUID()+randomUUID();let active=false;
  const callbackCalls=new Map(),callbackQueue=[],callbackPolls=[];
  broker.setSourceToolDispatcher?.(call=>new Promise((resolve,reject)=>{
    const callId=randomUUID(),timer=setTimeout(()=>{callbackCalls.delete(callId);reject(error('Source tool callback timed out'));},180000);
    callbackCalls.set(callId,{resolve,reject,timer});const item={...call,callId};
    const poll=callbackPolls.shift();poll?poll(item):callbackQueue.push(item);
  }));
  const server=createServer(async(req,res)=>{
    const provided=Buffer.from(req.url??''),expected=Buffer.from('/'+token);
    if(req.method!=='POST'||provided.length!==expected.length||!timingSafeEqual(provided,expected)){res.writeHead(404);res.end();return;}
    let ownsTaskSlot=false;
    try{
      const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>maxBodyBytes)throw error('Task body is too large');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      let result;
      if(typeof input.method==='string'){
        if(input.method==='codex.callback.poll'){
          result=callbackQueue.shift()??await new Promise(resolve=>{const finish=value=>{clearTimeout(timer);const index=callbackPolls.indexOf(finish);if(index>=0)callbackPolls.splice(index,1);resolve(value);};const timer=setTimeout(()=>finish(null),Math.min(25000,Math.max(1,input.params?.waitMs??25000)));callbackPolls.push(finish);});
        }else if(input.method==='codex.callback.result'){
          const slot=callbackCalls.get(input.params?.callId);if(!slot)throw error('Unknown source tool callback');
          clearTimeout(slot.timer);callbackCalls.delete(input.params.callId);input.params.success?slot.resolve(input.params.result):slot.reject(error(input.params.error??'Source tool failed'));result={accepted:true};
        }else{
          if(![...PROCESS_METHODS,'codex.models','codex.shell','codex.task','codex.agent.create','codex.agent.send','codex.agent.wait','codex.agent.cancel','codex.agent.dispose'].includes(input.method))throw error('Unknown broker RPC method');
          result=await broker.dispatch(input.method,input.params??{});
        }
      }else{
        if(active){res.writeHead(409);res.end(JSON.stringify({error:'A task is already running'}));return;}
        active=true;ownsTaskSlot=true;
        if(await fs.realpath(input.cwd)!==root)throw error('Task cwd differs from the installation workspace');
        const invocation=parseDshTaskArguments(input.argv),overlay=await readDshTaskOverlays(invocation,{stateRoots,allowedProfiles,cwd:root});
        result=await broker.run({prompt:invocation.prompt,overlay});
      }
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
    }catch(cause){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:cause.code??'DSH_TASK_FAILED',message:cause.module?cause.message:'Task failed'}));}
    finally{if(ownsTaskSlot)active=false;}
  });
  server.requestTimeout=30000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {endpoint:`http://127.0.0.1:${server.address().port}/${token}`,close:()=>new Promise((resolve,reject)=>{for(const slot of callbackCalls.values()){clearTimeout(slot.timer);slot.reject(error('Task callback server closed'));}callbackCalls.clear();for(const poll of [...callbackPolls])poll(null);callbackQueue.length=0;server.closeAllConnections();server.close(cause=>cause?reject(cause):resolve());})};
}
