// Trusted MCP endpoint: source code runs only in a separate native Codex command.
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {McpClient,serveMcp} from './protocol.mjs';
import {resolveExecutionPolicy,executionPolicyKey} from './execution-policy.mjs';
import {createPluginSecurity} from './plugin-security.mjs';

const inside=(root,value)=>{const resolved=path.resolve(root,value),relative=path.relative(root,resolved);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('插件入口超出已審查產物');return resolved;};
export function normalizeBrokerTarget(root,target){
  if(!target||!['node','python',undefined].includes(target.type)||typeof target.entry!=='string')throw Error('無效的插件執行入口');
  if(target.args!==undefined&&(!Array.isArray(target.args)||target.args.some(v=>typeof v!=='string')))throw Error('無效的插件執行參數');
  const result={...target,type:target.type??'node',entry:inside(root,target.entry),cwd:target.cwd?inside(root,target.cwd):undefined,args:target.args??[]};
  if(result.type==='python'&&(typeof result.command!=='string'||!path.isAbsolute(result.command)))throw Error('Python 解譯器必須是已審查的絕對路徑');
  result.pythonPaths=(target.pythonPaths??[]).map(value=>inside(root,value));
  if(target.allowTools!==undefined&&(!Array.isArray(target.allowTools)||target.allowTools.some(value=>typeof value!=='string')))throw Error('無效的工具允許清單');
  return result;
}
async function stopTree(child){
  if(!child||child.exitCode!==null||!child.pid)return;
  if(process.platform==='win32')await new Promise(resolve=>execFile('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,timeout:10000},()=>resolve()));
  else child.kill();
}
/** A policy switch always destroys the previous source process before creating
 * another. The host sends updated policy on calls, not on arbitrary UI changes. */
export async function createPermissionBroker({root,target,policy,runGuarded,clientFactory,stopProcess=stopTree,taskBrokerFactory,resolveTaskTools,taskTools=[],security:providedSecurity,enableTaskBroker=policy.sourceProcess==='worker'}){
  target=normalizeBrokerTarget(root,target);
  const pluginId=policy.pluginId??path.basename(root);
  const securityDataRoot=path.join(policy.securityDataRoot??path.join(os.homedir(),'.codex','dsh-converter','plugin-security'),pluginId);
  const security=providedSecurity??createPluginSecurity({pluginId:policy.pluginId??path.basename(root),pluginName:policy.pluginName??path.basename(root),dataRoot:securityDataRoot,pluginDir:root,declaredSecrets:policy.declaredSecrets??[],postingTools:policy.postingTools??[]});
  let settings=(await security.load()).settings;
  const resolvePolicy=requestMeta=>resolveExecutionPolicy({requestMeta,workspace:policy.workspace??process.cwd(),fallbackMode:settings.missingHostMetadataMode??'workspace'});
  const reported=new Set();
  let active=null,serial=Promise.resolve(),closed=false;
  const sourceFor=executionPolicy=>{
    const operation=serial.then(async()=>{
      if(closed)throw Error('插件已停止');
      settings=(await security.load()).settings;
      const key=executionPolicyKey(executionPolicy)+JSON.stringify(settings);
      if(!executionPolicy.liveSynchronized&&!reported.has('metadata')){reported.add('metadata');await security.notify({kind:'missing-host-metadata',what:'本次 Codex 未提供當前權限資料',why:'依你選擇的備援模式繼續',setting:'missingHostMetadataMode',impact:'Node 來源仍使用資料夾限制；無法宣稱同步當前 Codex 權限、模型或核准政策。'});}
      if(target.type==='python'&&!reported.has('python')){reported.add('python');await security.notify({kind:'native-policy-limit',what:'Python 來源無法使用 Node 權限限制',why:'Python 不受 Node 執行階段管制',setting:'restrictionsEnabled',impact:executionPolicy.liveSynchronized?'沿用 Codex 當次原生程序權限。':'此備援僅隔離環境變數；可改用提供原生權限資料的 Codex 或外部作業系統沙箱。'});}
      if(active?.key===key)return active.client;
      if(active){await stopProcess(active.client.child);await active.client.close();await active.taskBroker?.close();active=null;}
      let taskBroker,taskEndpoint;
      if(enableTaskBroker){
        const factory=taskBrokerFactory??(await import('./dsh-codex-task.mjs')).createCodexTaskBroker;
        const taskResolver=resolveTaskTools;
        taskBroker=await factory({codexHome:policy.codexHome,workspace:executionPolicy.cwd??root,executionPolicy:{...executionPolicy,allowModelCalls:settings.allowModelCalls,allowAgents:settings.allowAgents,...(executionPolicy.fullAccess?{sandbox:'danger-full-access',approvalPolicy:'never'}:{})},options:{security,pluginName:policy.pluginName,nativePolicy:executionPolicy,stateDir:policy.stateDir},tools:taskTools,resolveTaskTools:taskResolver});
        try{taskEndpoint=(await taskBroker.startServer({stateRoots:[root,policy.stateDir],workspace:executionPolicy.cwd??root})).endpoint;}catch(cause){await taskBroker.close();throw cause;}
      }
      const guard=path.join(root,'runtime/sandbox-entry.mjs');
      const workspace=executionPolicy.cwd??policy.workspace??root;
      const readRoots=[root,policy.stateDir,workspace,...(settings.extraReadFolders??[]),...(settings.extraWriteFolders??[])];
      const writeRoots=[policy.stateDir,...(settings.missingHostMetadataMode==='state-only'&&!executionPolicy.liveSynchronized?[]:[workspace]),...(settings.extraWriteFolders??[])];
      const nodePermissions=settings.restrictionsEnabled!==false&&!(settings.missingHostMetadataMode==='unrestricted'&&!executionPolicy.liveSynchronized)&&policy.sourceProcess==='inline'&&target.type==='node'?['--permission',...readRoots.map(root=>`--allow-fs-read=${root}`),...writeRoots.map(root=>`--allow-fs-write=${root}`),...(settings.allowDirectSpawn?['--allow-child-process']:[])]:[];
      const sourcePolicy={...executionPolicy,trustedRuntimeHashes:policy.trustedRuntimeHashes??{},sourcePermissions:{restrictionsEnabled:settings.restrictionsEnabled!==false&&!(settings.missingHostMetadataMode==='unrestricted'&&!executionPolicy.liveSynchronized),allowDirectSpawn:settings.allowDirectSpawn===true,readRoots,writeRoots},securitySettings:settings,pluginSecurity:{pluginId,pluginName:policy.pluginName??pluginId,dataRoot:securityDataRoot,pluginDir:root,declaredSecrets:policy.declaredSecrets??[],postingTools:policy.postingTools??[]}};
      const options={config:{command:process.execPath},launchProcess:()=>runGuarded({stateDir:policy.stateDir,sourceNode:target.type==='node',command:process.execPath,args:[...nodePermissions,guard,JSON.stringify(target),policy.stateDir,JSON.stringify(sourcePolicy),taskEndpoint??''],denyRead:policy.denyRead,readRoots:policy.readRoots??[root],stdio:['pipe','pipe','pipe'],executionPolicy,cwd:target.cwd??executionPolicy.cwd??policy.stateDir})};
      let client;
      try{client=clientFactory?await clientFactory({executionPolicy,target,...options}):new McpClient(options.config,{timeout:120000,redact:value=>security.redact(value),launchProcess:options.launchProcess});await client.start();active={key,client,taskBroker};return client;}catch(cause){await stopProcess(client?.child);await client?.close();await taskBroker?.close();const clean=security.redact?.(cause)??cause;await security.notify({kind:'startup-failed',what:'插件來源程序無法啟動',why:clean.message,setting:'插件安全設定與來源入口設定',impact:'這次工具無法執行；來源入口、路徑或依賴修正後可重新啟動。',details:{entry:target.entry,cwd:target.cwd??executionPolicy.cwd,operation:'source-start',code:clean.code}});throw clean;}
    });
    serial=operation.catch(()=>{});return operation;
  };
  const allowed=target.allowTools?new Set(target.allowTools):null;
  const filterTools=async tools=>{
    if(!Array.isArray(tools))throw Error('來源未提供工具清單');
    const valid=tools.filter(tool=>typeof tool?.name==='string'&&tool.inputSchema&&typeof tool.inputSchema==='object');
    const missing=allowed?[...allowed].filter(name=>!valid.some(tool=>tool.name===name)):[];
    if(missing.length||valid.length!==tools.length)await security.notify({kind:'tool-unavailable',what:`略過未提供或參數格式不完整的工具：${missing.join('、')||'請看來源工具清單'}`,why:'來源執行時提供的工具與轉換資訊不同',setting:'插件設定與轉換報告中的工具清單',impact:'其他可用工具仍可使用；沒有把缺少的工具當成已完成。'});
    return valid.filter(tool=>!allowed||allowed.has(tool.name));
  };
  const listeners=new Set();let tools=[],startupError=null,retrying;
  const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
  const diagnostic=async()=>{const ui=await security.ensureUi?.();return {sourceReady:false,error:security.redact?.(startupError?.message)??startupError?.message,securitySettingsUrl:ui?.url,...(security.snapshot?.()??{})};};
  const refresh=async(execution={})=>{
    try{
      const inventory=await filterTools(await (await sourceFor(resolvePolicy(execution.requestMeta))).listTools());
      tools=inventory.map(tool=>security.wrapTool({...tool,execute:async(args,execution={})=>{
      // Only MCP request metadata can select authority. Source-defined tool
      // arguments such as fullAccess or nested _meta have no effect here.
      const executionPolicy=resolvePolicy(execution.requestMeta);
      const client=await sourceFor(executionPolicy);
      return client.request('tools/call',{name:tool.name,arguments:args,...(execution.requestMeta?{_meta:execution.requestMeta}:{})},execution);
      }}));
      startupError=null;await security.resolveRestrictedFeatures?.({kind:'startup-failed'});
      if(!tools.length)throw Error('來源沒有提供所選工具，請查看目前受限功能');
    }catch(cause){
      if(/^SECURITY_INTEGRITY/.test(cause.code??''))throw cause;
      startupError=cause;
      tools=[
        {name:'dsh_plugin_status',description:'來源未就緒：查看真實原因與受限功能，不代表原插件工具成功。',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:async()=>result(await diagnostic())},
        {name:'dsh_plugin_settings',description:'來源啟動失敗時仍可開啟敏感欄位與權限設定。',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:async()=>result(await diagnostic())},
        {name:'dsh_plugin_retry',description:'設定完成後重新啟動來源並更新工具清單；不重試發文。',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:async(_args,execution={})=>{
          retrying??=(async()=>{await serial;if(active){await stopProcess(active.client.child);await active.client.close();await active.taskBroker?.close();active=null;}await refresh(execution);for(const listener of listeners)listener();return result(startupError?await diagnostic():{sourceReady:true,tools:tools.map(tool=>tool.name)});})();try{return await retrying;}finally{retrying=null;}
        }},
      ];
    }
  };
  try{await refresh();}catch(cause){await security.close();await serial;if(active){await stopProcess(active.client.child);await active.client.close();await active.taskBroker?.close();active=null;}throw cause;}
  return {get tools(){return tools;},getTools:()=>tools,onToolsChanged(listener){listeners.add(listener);return()=>listeners.delete(listener);},async close(){closed=true;listeners.clear();await serial;if(active){await stopProcess(active.client.child);await active.client.close();await active.taskBroker?.close();active=null;}await security.close();}};
}
export async function servePermissionBroker(options){
  const broker=await createPermissionBroker(options);
  await serveMcp({name:'dsh-codex-permission-broker',getTools:broker.getTools,onToolsChanged:broker.onToolsChanged,dispose:()=>broker.close()});
}
