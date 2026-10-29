import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {loadDshHost} from './dsh-host.mjs';
import {hostControlTools} from './host-tools.mjs';
import {serveMcp} from './protocol.mjs';
import {readCodexEvents,createCodexConversationHost} from './codex-events.mjs';
import {resolvePluginState} from './state-paths.mjs';
import {probeCodexCapabilities} from './codex-capabilities.mjs';
import {startHookBroker} from './hook-broker.mjs';
import {createPluginSecurity} from './plugin-security.mjs';
import {diagnoseStartup} from './startup-diagnostics.mjs';
import {createPluginUiController} from './ui-host.mjs';
import {createCredentialStore,credentialStoreRoot} from './credential-store.mjs';
import {createConversationHistoryHost} from './conversation-history.mjs';

// This environment is rebuilt by the trusted native-policy entry before any
// source code is imported. A source tool argument cannot supply either value.
const nativeExecution=process.env.DSH_CODEX_EXECUTION_POLICY?JSON.parse(process.env.DSH_CODEX_EXECUTION_POLICY):null;
const taskEndpoint=process.env.DSH_CODEX_TASK_ENDPOINT;
export function hostExecutionOptions({root=process.cwd(),stateDir=process.cwd(),options,executionPolicy=nativeExecution,endpoint=taskEndpoint}){
  const result={...options};
  const source=executionPolicy?.sourcePermissions;
  result.trustedRuntimeHashes=executionPolicy?.trustedRuntimeHashes??{};
  result.sourceSecretNames=(executionPolicy?.pluginSecurity?.declaredSecrets??[]).filter(field=>typeof field==='object'&&field.provided===true).map(field=>field.envName??field.name);
  result.workspace=executionPolicy?.cwd??options.workspace??process.cwd();
  if(source?.restrictionsEnabled===false)delete result.workerPermissions;
  else if(source||options.workerPermissions)result.workerPermissions={readRoots:source?.readRoots??[path.resolve(root),stateDir,result.workspace],writeRoots:source?.writeRoots??[stateDir,result.workspace],allowDirectSpawn:source?.allowDirectSpawn===true};
  else delete result.workerPermissions;
  const permitsWorkspaceWrite=(source?.writeRoots??result.workerPermissions?.writeRoots??[]).some(directory=>path.resolve(directory)===path.resolve(result.workspace));
  result.filePolicy={mode:source?.restrictionsEnabled===false&&!executionPolicy?.sandboxState||!source&&!result.workerPermissions&&!executionPolicy?.sandboxState?'danger-full-access':executionPolicy?.fullAccess&&!result.workerPermissions?'danger-full-access':permitsWorkspaceWrite?'workspace-write':'read-only'};
  const settings=executionPolicy?.securitySettings??{};
  const config=options.moduleConfig??options.moduleOptions??{};
  const credentialMapping=Object.fromEntries((executionPolicy?.pluginSecurity?.declaredSecrets??[]).map(field=>typeof field==='string'?[field,field]:[field.name,field.envName??field.name]).filter(([ref,name])=>typeof ref==='string'&&typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)));
  result.moduleConfig={...config,credentials:{...config.credentials,envMapping:{...credentialMapping,...config.credentials?.envMapping}},shell:{...config.shell},agents:{backend:'codex-broker',...config.agents,allowModelCalls:settings.allowModelCalls!==false,allowAgents:settings.allowAgents!==false},llm:{backend:'codex-broker',...config.llm,allowModelCalls:settings.allowModelCalls!==false}};
  result.nativeToolHooks=settings.nativeToolHooks===true||!executionPolicy?.securitySettings&&options.nativeToolHooks===true;
  result.config={...(options.config??{})};
  if(endpoint){
    const url=new URL(endpoint);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash)throw new Error('Invalid trusted task endpoint');
    result.env={...(result.env??{}),DSH_CODEX_TASK_ENDPOINT:endpoint};
    result.bridgeRequest=async(method,params,{signal}={})=>{
      if(!/^codex\.(?:agent\.(?:create|send|wait|cancel|dispose|registerTools|unregisterTools)|process\.(?:resolve|spawn|poll|write|stop|release)|models|task|shell|callback\.(?:poll|result))$/.test(method))throw new Error('Unsupported trusted task request');
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,params}),signal,redirect:'error'});
      const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.message??value.error??'Codex task request failed'),{code:value.error});return value;
    };
  }
  return result;
}

/** Only routes registered in this isolated host can be addressed; never an arbitrary URL proxy. */
export async function requestHostRoute(host,args){
  const registered=await host.request('routes');
  if(!registered?.origin||!Array.isArray(registered.routes))throw new Error('The source plugin has no registered local HTTP service');
  if(typeof args.path!=='string'||!args.path.startsWith('/')||args.path.startsWith('//'))throw new Error('A plugin-relative HTTP path is required');
  const origin=new URL(registered.origin),url=new URL(args.path,origin);
  if(!['127.0.0.1','[::1]','localhost'].includes(origin.hostname)||url.origin!==origin.origin)throw new Error('The host route must remain on the isolated loopback service');
  if(!registered.routes.some(route=>typeof route.path==='string'&&(route.kind==='exact'?url.pathname===route.path:route.kind==='prefix'&&(url.pathname===route.path||url.pathname.startsWith(route.path.replace(/\/$/,'')+'/')))))throw new Error('The path is not registered by this plugin host');
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(args.method))throw new Error('Unsupported HTTP method');
  const headers=new Headers(args.headers??{});for(const name of ['host','connection','content-length','transfer-encoding'])if(headers.has(name))throw new Error('Transport headers cannot be overridden');
  const body=args.body===undefined?undefined:JSON.stringify(args.body);if(body!==undefined)headers.set('content-type','application/json');
  if(args.method==='GET'&&body!==undefined)throw new Error('GET requests cannot contain a body');
  const response=await fetch(url,{method:args.method,headers,body,redirect:'error',signal:AbortSignal.timeout(30000)});
  const chunks=[];let bytes=0;
  for await(const chunk of response.body??[]){bytes+=chunk.length;if(bytes>8*1024*1024)throw new Error('Plugin HTTP response exceeds 8 MiB');chunks.push(chunk);}
  const text=Buffer.concat(chunks).toString('utf8');let data=text;if((response.headers.get('content-type')??'').includes('application/json'))try{data=JSON.parse(text);}catch{throw new Error('Plugin returned malformed JSON');}
  return {status:response.status,ok:response.ok,contentType:response.headers.get('content-type'),body:data};
}

export async function createDshHostRuntime({root,options,mode='mcp',onShutdown}){
  const startedAt=Date.now();
  const stateDir=resolvePluginState({root,options});await fs.mkdir(stateDir,{recursive:true});
  const codexCapabilities=await probeCodexCapabilities({command:options.codexCommand??'codex'});
  let loaded,transientLogs='';
  const execution=hostExecutionOptions({root,stateDir,options});

  let pluginSecurity;
  if(nativeExecution?.pluginSecurity?.dataRoot){
    const security=createPluginSecurity(nativeExecution.pluginSecurity);pluginSecurity=security;await security.load();
    execution.env={...security.sourceEnvironment(process.env),...(execution.env??{})};
    execution.config=structuredClone(execution.config??{});
    for(const field of options.runtimeBindings?.sensitiveConfigFields??[]){
      if(!Array.isArray(field.path)||field.path.some(key=>typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))||typeof field.envName!=='string')throw new Error('敏感設定映射無效');
      const value=execution.env[field.envName];if(typeof value!=='string')continue;
      let object=execution.config;for(const key of field.path.slice(0,-1))object=object[key]??=(Object.create(null));object[field.path.at(-1)]=value;
    }
  }
  const credentialValues=new Set();
  const credentialStore=createCredentialStore({directory:credentialStoreRoot({root,stateId:options.stateId}),onSecrets:values=>{for(const value of values)if(typeof value==='string'&&value.length>=6)credentialValues.add(value);pluginSecurity?.rememberSecrets(values);}});
  await credentialStore.load();
  const redactUi=value=>{
    if(pluginSecurity)return pluginSecurity.redact(value);
    const walk=value=>{if(typeof value==='string'){for(const secret of [...credentialValues].sort((a,b)=>b.length-a.length))value=value.split(secret).join('[已隱藏敏感值]');return value;}if(value instanceof Error){const clean=new Error(walk(value.message));clean.code=value.code;return clean;}if(Array.isArray(value))return value.map(walk);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,walk(child)]));return value;};
    return walk(value);
  };
  const conversationNotices=[];
  const conversation=createCodexConversationHost({startedAt,pluginName:options.name??options.plan?.name??'DSH 插件',request:(method,args)=>loaded.request(method,args),settings:async()=>pluginSecurity?(await pluginSecurity.load()).settings:(nativeExecution?.securitySettings??options.securitySettings??{}),notify:async notice=>{conversationNotices.push(notice);await pluginSecurity?.notify(notice);},redact:redactUi});
  const history=createConversationHistoryHost({settings:async()=>pluginSecurity?(await pluginSecurity.load()).settings:(nativeExecution?.securitySettings??options.securitySettings??{}),notify:async notice=>{conversationNotices.push(notice);await pluginSecurity?.notify(notice);},command:options.codexCommand??'codex',queryOptions:options.codexSessionQuery??{}});
  execution.conversationHistory=options.conversationHistory!==false;
  const taskBridge=execution.bridgeRequest;
  execution.bridgeRequest=(method,params,requestOptions)=>method.startsWith('codex.credentials.')?credentialStore.request(method.slice('codex.credentials.'.length),params):method==='codex.conversation.followup'?conversation.followup(params):['codex.conversation.list','codex.conversation.read'].includes(method)?history.request(method.slice('codex.conversation.'.length),params):taskBridge?taskBridge(method,params,requestOptions):Promise.reject(Object.assign(new Error('No client request bridge is available'),{code:'CLIENT_CAPABILITY_UNAVAILABLE'}));
  try{loaded=await loadDshHost({...execution,entry:path.resolve(root,'source',options.entry),sourceRoot:path.resolve(root,'source'),sourceNodePaths:(options.sourceNodePaths??[]).map(dir=>path.resolve(root,dir)),workspace:execution.workspace??path.resolve(root,'source',options.packageDir??'.'),stateDir,runtimeRoot:path.resolve(root,'runtime/host-env'),workerPath:path.resolve(root,'runtime/dsh-host-worker.mjs'),config:execution.config??{},codexCapabilities,services:options.services??['timer','fs','settings','webServer','commands','skills'],...(options.codexSessionQuery?{codexSessionQuery:options.codexSessionQuery}:{}),logger:log=>{transientLogs=redactUi(transientLogs+log.text).slice(-65536);}});}
  catch(error){await history.close();await pluginSecurity?.close();const clean=redactUi(error);const diagnostics=diagnoseStartup(clean,transientLogs);if(diagnostics.code==='HOST_INITIALIZATION_FAILED')diagnostics.summary=`來源初始化失敗：${clean.message}`;throw Object.assign(new Error(diagnostics.summary),{code:diagnostics.code,diagnostics});}
  transientLogs='';
  let disposed=false,pumping=false;
  let timer,broker,pluginUi;
  const writeContext=async()=>{const context=await loaded.context();const text=[context.text,context.contextText].filter(value=>typeof value==='string'&&value.trim()).join('\n\n');const target=path.join(stateDir,'runtime-context.json'),temp=target+'.tmp';await fs.writeFile(temp,JSON.stringify({text,sections:context.sections,updatedAt:new Date().toISOString()})+'\n');await fs.rename(temp,target);return context;};
  const dispose=async()=>{if(disposed)return;disposed=true;clearInterval(timer);await pluginUi?.close();await broker?.close();await loaded.dispose();await history.close();await pluginSecurity?.close();};
  try{
  await writeContext();
  const handled=new Set();
  const pump=async()=>{if(disposed||pumping)return;pumping=true;try{for(const event of await readCodexEvents(stateDir)){if(handled.has(event.id))continue;await loaded.dispatchEvent('codex/'+event.event,[event]);handled.add(event.id);}}catch(e){process.stderr.write('Codex lifecycle bridge: '+e.message+'\n');}finally{pumping=false;}};
  timer=setInterval(pump,500);timer.unref();
  const rpc=async(method,args,execution={})=>{
    if(method==='ui.open')return pluginUi.open();
    if(method==='ui.status')return pluginUi.describe();
    if(method==='getTools')return loaded.tools.filter(tool=>!options.allowTools?.length||options.allowTools.includes(tool.name)).map(({execute,...schema})=>schema);
    if(method==='execute'){
      const tool=loaded.tools.find(item=>item.name===args.name&&(!options.allowTools?.length||options.allowTools.includes(item.name)));
      if(!tool)throw new Error('這個插件沒有啟用工具「'+args.name+'」。請檢查轉換時選取的工具清單。');
      const selected=pluginSecurity?pluginSecurity.wrapTool(tool):tool;
      try{return redactUi(await selected.execute(args.args??{},execution));}catch(error){throw redactUi(error);}
    }
    if(method==='http.request')return requestHostRoute(loaded,args);
    if(method==='settings.update'){const result=await loaded.request(method,{namespace:args.ns,values:args.patch,expectedRevision:args.revision});await writeContext();return result;}
    if(method==='context')return writeContext();
    if(method==='describe')return {...await loaded.describe(),conversationHost:conversation.describe(),toolSelection:{requested:options.allowTools??[],available:loaded.tools.map(tool=>tool.name),missing:(options.allowTools??[]).filter(name=>!loaded.tools.some(tool=>tool.name===name))}};
    return loaded.request(method,{...args,...(method==='commands.run'?{clientCapabilities:execution.clientCapabilities??{}}:{})},execution);
  };
  pluginUi=await createPluginUiController({root,rpc:async(...args)=>{try{return redactUi(await rpc(...args));}catch(error){throw redactUi(error);}},onNotice:notice=>pluginSecurity?.notify({kind:'ui-operation-failed',what:'原插件畫面的一項操作未能完成。',why:notice.message,setting:'請在插件畫面查看「目前未接上的功能」，修正所列設定；缺少服務時需更新轉換器。',impact:'這次操作未完成，其他已接好的頁面與工具仍可使用。',details:{code:notice.code}})});
  const controls=hostControlTools({rpc,prefix:options.controlPrefix??'dsh_host',ui:Boolean(pluginUi)});
  const getTools=()=>{
    const selected=options.allowTools?.length?loaded.tools.filter(t=>options.allowTools.includes(t.name)):loaded.tools;
    const source=selected.map(tool=>({...tool,execute:async(...args)=>{try{return redactUi(await tool.execute(...args));}catch(error){throw redactUi(error);}}}));
    const all=[...source,...controls];if(new Set(all.map(t=>t.name)).size!==all.length)throw new Error('Source tool name collides with a reserved bridge control name');return all;
  };
  let hookQueue=Promise.resolve();
  const evaluateHook=async input=>{
    const followup=await conversation.processHook(input);
    let output=followup;
    if(['SessionStart','UserPromptSubmit','SubagentStart'].includes(input.hook_event_name)){
      const context=await writeContext(),text=[context.text,context.contextText].filter(value=>typeof value==='string'&&value.trim()).join('\n\n');
      const combined=[text,followup.hookSpecificOutput?.additionalContext].filter(Boolean).join('\n\n');
      output=combined?{...followup,hookSpecificOutput:{hookEventName:input.hook_event_name,additionalContext:combined}}:followup;
    }
    else if(['PreToolUse','PostToolUse'].includes(input.hook_event_name))output={...await loaded.request('hook.evaluate',{input}),...followup};
    // Notices are warnings in the actual Codex UI, in addition to the saved
    // security record. Never send a main-chat notice into a child hook.
    if(input.session_id===conversation.describe().sessionId&&!input.agent_id&&['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop','Interrupt'].includes(input.hook_event_name)&&conversationNotices.length){
      const messages=conversationNotices.splice(0).map(notice=>`發生什麼：${notice.what}\n原因：${notice.why}\n在哪裡設定：${notice.setting}\n影響：${notice.impact}`);
      output={...output,systemMessage:[output.systemMessage,...messages].filter(Boolean).join('\n\n')};
    }
    return output;
  };
  broker=await startHookBroker({stateDir,mode,status:async()=>({conversation:conversation.describe(),conversationPolicy:await conversation.policy()}),evaluate:input=>{const pending=hookQueue.then(()=>evaluateHook(input));hookQueue=pending.catch(()=>{});return pending;},shutdown:async()=>{await dispose();await onShutdown?.();}});
  return {loaded,stateDir,getTools,rpc,dispose,onToolsChanged:loaded.onToolsChanged};
  }catch(error){await dispose();throw error;}
}
export async function serveDshHost({root,options}){
  const runtime=await createDshHostRuntime({root,options});
  try{await serveMcp({name:options.name,getTools:runtime.getTools,onToolsChanged:runtime.onToolsChanged,dispose:runtime.dispose});}finally{await runtime.dispose();}
}
export async function runDshDaemon({root,options}){
  let finish;const finished=new Promise(resolve=>{finish=resolve;});
  const runtime=await createDshHostRuntime({root,options,mode:'daemon',onShutdown:finish});
  const stop=()=>void runtime.dispose().finally(finish);
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{await finished;}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await runtime.dispose();}
}
