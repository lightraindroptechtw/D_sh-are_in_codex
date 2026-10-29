import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {guardService,moduleError,moduleUnavailable,unsupportedService} from '../codex-control.mjs';
import {codexModelRoute,DEFAULT_PLUGIN_MODEL,DEFAULT_PLUGIN_EFFORT} from '../model-routing.mjs';

export const CODEX_LLM_REASON='The verified app-server ThreadStartParams/TurnStartParams schema has no general tool_choice=none or complete tools-disable contract. Read-only sandbox is not a no-tools guarantee. Codex one-shot LLM mapping is unsupported; actual model output, latency and account cost were not tested.';
export const descriptor={id:'llm',displayName:'模型呼叫模組',services:['llm'],requires:{minimumCodexVersion:'0.160.0',capabilities:[]},methods:{
  complete:{support:'partial',reason:'使用現有 Codex 登入取得完整文字回答，與串流共用模型路由。'},
  stream:{support:'partial',reason:'預設由現有 Codex 登入投影文字模型任務；另外的 API-key 後端需明確選擇並提供金鑰。'},
  prepareCall:{support:'partial',reason:'Same exact opt-in route and credential checks before official runtime preparation and dispatch.'},
  registerAdapter:{support:'partial',reason:'Only explicitly allowed API provider routes may register; no provider is silently redirected to Codex.'},
  listProviders:{support:'partial',reason:'Official runtime registered API providers only.'},listModels:{support:'partial',reason:'Only explicitly configured API routes, without silently changing models.'},
  resolveModelInfo:{support:'partial',reason:'Exact explicitly enabled provider/model route only.'},resolveCallConfig:{support:'partial',reason:'Exact explicitly enabled provider/model route only.'},
  registerConfigurableProviders:{support:'unsupported',reason:'Replacing the DSH provider configuration directory is unsupported.'},
  'codex.stream':{support:'unsupported',reason:CODEX_LLM_REASON},
  registerModelDiscovery:{support:'unsupported',reason:'Unbounded provider discovery may perform network operations outside explicit routes.'},
  discoverModels:{support:'unsupported',reason:'Provider discovery is not enabled by this module.'},
},requirements:['預設使用 Codex 模型通道；backend=api-key 是另外計費且需明確選擇的後端','allowModelCalls=true','allowedApiRoutes entries {provider,model,credentialEnv}; names only, no secret values','A compatible provider adapter must be mounted explicitly; this module does not log in or install one automatically']};

export async function install({root,options={},capabilities={},requestHost}={}){
  options={backend:'codex-broker',...options};
  const unavailable=moduleUnavailable(descriptor,capabilities);
  if(!unavailable&&options.backend==='codex-broker'&&options.allowModelCalls!==false){
    if(typeof requestHost!=='function')return {services:{llm:unsupportedService('llm',Object.keys(descriptor.methods),'缺少可信模型通道；請從已轉換插件的 Codex 入口啟動')},dispose:async()=>{},diagnostics:[{module:'llm',status:'disabled',reason:'缺少可信模型通道；模型預設開啟，但此獨立測試環境沒有登入傳輸。'}]};
    const diagnostics=[{module:'llm',code:'CODEX_TASK_PROJECTION',reason:'使用 Codex 登入完成文字模型任務，再回傳文字或串流區塊；不另外使用付費 API。'}];
    const normalize=config=>({...config,messages:(config.messages??[]).map(message=>({...message,content:typeof message.content==='string'?[{type:'text',text:message.content}]:message.content}))});
    const check=config=>{
      if(config.signal?.aborted)throw moduleError('llm','stream','Call was cancelled','ABORT_ERR');
      if(config.tools?.length||config.toolHistory)throw moduleError('llm','stream','模型工具呼叫請使用 agents interface（代理介面），文字補全不接受工具清單');
      if(!Array.isArray(config.messages)||!config.messages.length||config.messages.some(m=>!['user','assistant','system','developer'].includes(m.role)||!Array.isArray(m.content)||m.content.some(b=>b.type!=='text'||typeof b.text!=='string')))throw moduleError('llm','stream','Only nonempty text message histories are mapped');
      for(const field of ['temperature','maxTokens','stop'])if(config[field]!==undefined&&!diagnostics.some(row=>row.field===field))diagnostics.push({module:'llm',code:'MODEL_OPTION_NOT_MAPPED',field,reason:`來源設定 ${field}，Codex 沒有對應欄位，會使用 Codex 自己的設定；此呼叫仍可執行。`});
    };
    const complete=async(config={})=>{
      config=normalize(config);check(config);
      const route=codexModelRoute({provider:config.provider,model:config.model??options.model,modelMap:options.modelMap,defaultModel:options.defaultModel??DEFAULT_PLUGIN_MODEL});
      const result=await requestHost('codex.task',{prompt:config.messages.map(m=>`[${m.role}]\n${m.content.map(b=>b.text).join('\n')}`).join('\n\n'),instructions:config.system,agentOptions:{provider:route.provider,model:route.model,reasoningEffort:config.reasoningEffort??options.reasoningEffort??DEFAULT_PLUGIN_EFFORT},toolNames:[]},{signal:config.signal});
      check(config);if(typeof result?.text!=='string')throw moduleError('llm','complete','Codex 回覆沒有文字，請查看模型呼叫錯誤。');
      return {text:result.text,provider:'codex',model:result.model??route.model,ignoredParameters:diagnostics.filter(row=>row.field).map(row=>row.field)};
    };
    const stream=(config={})=>{
      config=normalize(config);
      check(config);
      return (async function*(){
        const result=await complete(config);
        check(config);const block={type:'text',text:result.text};
        yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:result.text};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'stop'}};
      })();
    };
    const listModels=async()=>{const result=await requestHost('codex.models',{});return (result?.data??result?.models??[]).map(row=>({...row,id:row.model??row.id,provider:'codex',name:row.displayName??row.model??row.id}));};
    return {services:{llm:guardService({complete,stream,listProviders:()=>['codex'],listModels,async resolveModelInfo(provider,model){const route=codexModelRoute({provider,model,modelMap:options.modelMap}),models=await listModels();const found=models.find(row=>row.id===route.model);if(!found)throw moduleError('llm','resolveModelInfo',`Codex 模型清單沒有 ${route.model}`);return found;},resolveCallConfig(config){return {...config,...codexModelRoute({provider:config.provider,model:config.model,modelMap:options.modelMap}),reasoningEffort:config.reasoningEffort??options.reasoningEffort??DEFAULT_PLUGIN_EFFORT};},async prepareCall(config,signal){return {config:{...config},adapterDefaults:{},stream:request=>stream({...config,...request,signal})};}},'llm')},dispose:async()=>{},diagnostics};
  }
  const reason=unavailable??(options.backend!=='api-key'?(options.backend==='codex'?CODEX_LLM_REASON:'Model calls are disabled until backend=api-key and allowModelCalls=true are explicitly configured'):options.allowModelCalls!==true?'allowModelCalls must be explicitly true':null);
  if(reason)return {services:{llm:unsupportedService('llm',Object.keys(descriptor.methods),reason)},dispose:async()=>{},diagnostics:[{module:'llm',level:'warning',status:'disabled',reason}]};
  const routes=options.allowedApiRoutes;
  if(!Array.isArray(routes)||routes.length===0||routes.some(route=>!route||typeof route.provider!=='string'||!route.provider||typeof route.model!=='string'||!route.model||typeof route.credentialEnv!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(route.credentialEnv)))throw moduleError('llm','install','allowedApiRoutes must explicitly contain provider, model and credentialEnv names');
  const env=options.environment??process.env;
  const checkProviders=(providers,method)=>{if(!Array.isArray(providers)||providers.some(provider=>!routes.some(route=>route.provider===provider)))throw moduleError('llm',method,'Provider route was not explicitly enabled for the API-key backend');};
  const check=(config,method)=>{
    if(options.allowModelCalls!==true)throw moduleError('llm',method,'allowModelCalls must be explicitly true','DSH_MODEL_CALLS_DISABLED');
    const route=routes.find(route=>route.provider===config?.provider&&route.model===config?.model);
    if(!route)throw moduleError('llm',method,'Provider/model is outside explicitly allowed API routes; no model substitution is performed');
    if(typeof env[route.credentialEnv]!=='string'||!env[route.credentialEnv])throw moduleError('llm',method,'The configured credential environment variable is empty');
    if(config.signal?.aborted)throw moduleError('llm',method,'Call was cancelled','ABORT_ERR');
  };
  const hostRequire=createRequire(path.join(options.runtimeRoot??fileURLToPath(new URL('../../',import.meta.url)),'package.json'));
  const {default:OfficialLlm}=await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-llm')).href);
  class ExplicitApiLlm extends OfficialLlm{
    registerAdapter(providers,adapter){
      checkProviders(providers,'registerAdapter');
      const handle=super.registerAdapter(providers,adapter),replace=handle.replace;
      handle.replace=next=>{checkProviders(next,'registerAdapter.replace');return replace(next);};
      return handle;
    }
    stream(config){check(config,'stream');return super.stream({...config});}
    async prepareCall(config,signal,configure){
      check({...config,signal},'prepareCall');const prepared=await super.prepareCall(config,signal,configure);
      check({...prepared.config,signal},'prepareCall');
      return {...prepared,stream:(request)=>{check(request,'stream');return prepared.stream(request);}};
    }
    listModels(provider){if(!routes.some(route=>route.provider===provider))throw moduleError('llm','listModels','Provider is outside explicit API routes');return super.listModels(provider).then(models=>models.filter(model=>routes.some(route=>route.provider===provider&&route.model===model.id)));}
    resolveModelInfo(provider,model,signal){check({provider,model,signal},'resolveModelInfo');return super.resolveModelInfo(provider,model,signal);}
    resolveCallConfig(config,signal){check({...config,signal},'resolveCallConfig');return super.resolveCallConfig(config,signal);}
    registerModelDiscovery(){throw moduleError('llm','registerModelDiscovery','Provider network discovery is disabled');}
    discoverModels(){throw moduleError('llm','discoverModels','Provider network discovery is disabled');}
  }
  // Keep the official Service's automatic registration in a private Cordis
  // scope, while the registry provides the guarded public instance at root.
  const service=new ExplicitApiLlm(root.isolate('llm'));
  const supported=new Set(['registerAdapter','stream','prepareCall','listModels','listProviders','resolveModelInfo','resolveCallConfig']);
  const publicService=new Proxy(service,{get(target,key){
    if(typeof key==='symbol'||['then','ctx','name','constructor'].includes(key))return Reflect.get(target,key);
    if(supported.has(key))return target[key].bind(target);
    return ()=>{throw moduleError('llm',String(key),'This official runtime method is outside the explicitly configured API-key mapping');};
  }});
  return {services:{llm:publicService},dispose:async()=>{},diagnostics:[{module:'llm',level:'warning',reason:'Explicit API-key backend uses official DSH LlmRuntime; a provider adapter must be mounted separately. No real model call or account cost was tested.'},{module:'llm',level:'warning',reason:CODEX_LLM_REASON}]};
}
