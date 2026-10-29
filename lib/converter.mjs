import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {inspectSource} from './inspect.mjs';
import {acquireSource,copySource,inside} from './source.mjs';
import {writeCodexPackage,validateCodexPackage} from './codex-package.mjs';
import {compileDshEntry} from './runtime.mjs';
import {McpClient} from './protocol.mjs';
import {buildOfficialHost} from './host-build.mjs';
import {planSourceDependencies,installSourceDependencies} from './source-deps.mjs';
import {stablePluginId} from './state-paths.mjs';
import {generateCommandSkills} from './modules/commands.mjs';
import {webConfiguration} from './modules/web.mjs';
import {selectModules} from './modules/index.mjs';
import {probeCodexCapabilities} from './codex-capabilities.mjs';
import {preparePluginUi} from './ui-assets.mjs';

function configuredEnvironmentNames(moduleOptions){
  if(!moduleOptions||typeof moduleOptions!=='object'||Array.isArray(moduleOptions))throw new Error('moduleOptions 必須是物件');
  const names=new Set(),valid=value=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
  const walk=value=>{if(!value||typeof value!=='object')return;if(Object.hasOwn(value,'environment'))throw new Error('模組設定不得儲存環境變數值；請使用 envMapping 或 credentialEnv 宣告名稱');for(const [key,item]of Object.entries(value)){if(key==='envMapping'){if(!item||typeof item!=='object'||Array.isArray(item)||Object.values(item).some(name=>!valid(name)))throw new Error('envMapping 必須只包含環境變數名稱');for(const name of Object.values(item))names.add(name);}else if(key==='credentialEnv'){if(!valid(item))throw new Error('credentialEnv 必須是環境變數名稱');names.add(item);}else walk(item);}};
  walk(moduleOptions);return [...names];
}
function reportConfiguration(value){
  if(Array.isArray(value))return value.map(reportConfiguration);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/(?:secret|password|passwd|api.?key|token|authorization|credential)/i.test(key)&&!/(?:Env|env_var|envMapping)$/i.test(key)?'[redacted]':reportConfiguration(item)]));
}
function reportCapabilities(capabilities){
  const copy={...capabilities,mcpServers:{}};
  for(const [name,server]of Object.entries(capabilities.mcpServers??{})){copy.mcpServers[name]={...server};for(const key of ['env','http_headers','headers'])if(server[key])copy.mcpServers[name][key]=reportConfiguration(server[key]);}
  return copy;
}

export const converterRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// 靜態分類沿用 CC 的 MIT 來源：提示段落留作證據，單獨出現時不代表改變模型或工具行為。
export function modelBehaviors(plan) {
  return (plan.host?.behaviors ?? []).filter(item => item.kind !== 'prompt-section');
}

// 供補寫流程判定原生介面是否仍有可保留功能；本函式不初始化來源，也不改變 convert 的預設路徑。
// 計時器、網頁路由及對話事件本身沿用上游規則，不排除純介面分類。
export function isPureNativeUi(plan) {
  const native = Boolean(plan.host?.client) || (plan.issues ?? []).some(item => item.code === 'NATIVE_UI');
  if (!native) return false;
  const capabilities = plan.capabilities ?? {}, commands = capabilities.commands ?? {};
  return !capabilities.toolRuntime && !(capabilities.skills ?? []).length &&
    !(commands.definitions ?? []).length && !(commands.dynamicRegistrations ?? []).length &&
    !Object.keys(capabilities.mcpServers ?? {}).length &&
    !modelBehaviors(plan).length;
}

const jsonWrite=(file,data)=>fs.writeFile(file,JSON.stringify(data,null,2)+'\n','utf8');
function safeName(name){return name.replace(/^@[^/]+\//,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,53)||'converted';}
function guide(plan,servers){return `---\nname: conversion-guide\ndescription: 使用從 DSH 轉換的 ${safeName(plan.name)} 工具或技能。\n---\n\n# ${plan.name}\n\n本包由固定規則轉換，不呼叫其他模型。\n\n- 已產生的 MCP 連線：${Object.keys(servers).join(', ')||'無'}。\n- 先讀插件根目錄 conversion-report.json，確認保留與未支援功能。\n- 原技能保留在 source/ 原本位置，連同相鄰資源與授權檔。技能內的倉庫根目錄、bin/ 等相對操作以本包 source/ 為工作目錄；讀到其他宿主工具或事件名稱時先確認 Codex 有對應能力。\n- 本包沒有移植 DSH 原生設定頁、事件服務或自動排程。宿主提示詞只作參考，不能視為已相容的指令。\n- 正式依賴依 installDependencies 選項處理（預設安裝），一律停用安裝腳本；轉換與安裝均不初始化來源。需要 Python MCP 時，用轉換器 setup 命令建立本包獨立環境。\n- 使用者要求的外部操作才執行；只做研究時使用讀取工具。\n`;}
export async function convert(input,{outputDir,cacheDir,ref,name,config={},allowTools=[],pythonEntry,engine='auto',workspace,codexSessionQuery,hooks=true,sourceEntry,packageDir='.',installDependencies=true,passEnv=[],homeMode='isolated',initializeTimeoutMs=120000,callTimeoutMs=60000,cancelGraceMs=1000,lenientOutput=false,allowUndeclaredOutput=false,moduleOptions={},services,background=false,stateMode='persistent',stateRoot,dependencyRunner}={}) {
  const configuredEnvNames=configuredEnvironmentNames(moduleOptions);
  if(typeof installDependencies!=='boolean'||typeof hooks!=='boolean'||typeof lenientOutput!=='boolean'||typeof allowUndeclaredOutput!=='boolean'||typeof background!=='boolean')throw new Error('安裝依賴、掛鉤、寬鬆輸出與背景選項必須是布林值');
  if(!['isolated','real'].includes(homeMode))throw new Error('homeMode 必須是 isolated 或 real');
  if(!Array.isArray(passEnv)||passEnv.some(name=>typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))throw new Error('passEnv 必須只包含環境變數名稱');
  for(const [key,value]of Object.entries({initializeTimeoutMs,callTimeoutMs,cancelGraceMs}))if(typeof value!=='number'||!Number.isFinite(value)||value<(key==='cancelGraceMs'?0:1))throw new Error(key+' 必須是有效毫秒數');
  if(!['persistent','package'].includes(stateMode))throw new Error('stateMode 必須是 persistent 或 package');
  if(!['auto','portable-tools','official-dsh'].includes(engine))throw new Error('未知執行引擎');
  if(!Array.isArray(allowTools)||allowTools.some(value=>typeof value!=='string'||!value.trim())||new Set(allowTools).size!==allowTools.length)throw new Error('allowTools 必須是不重複的工具名稱陣列');
  if(!outputDir)throw new Error('需要 --out 指定新的輸出資料夾');
  outputDir=path.resolve(outputDir);
  try{await fs.access(outputDir);throw new Error('輸出資料夾已存在；為保留使用者修改，請指定新資料夾');}catch(e){if(e.code!=='ENOENT')throw e;}
  const source=await acquireSource(input,{cacheDir:cacheDir??path.join(path.dirname(outputDir),'.dsh-source-cache'),ref});
  if(inside(source.root,outputDir)||inside(outputDir,source.root))throw new Error('來源與輸出資料夾不可互相包含');
  const plan=await inspectSource(source,{sourceEntry,packageDir});
  // A source reference requests a name; it never authorizes access to its value.
  // Proxy variables may contain credentials and also require explicit forwarding.
  const requestedEnvNames=[...new Set(plan.environment?.requiredNames??[])].sort();
  const forwardedNames=[...new Set([...passEnv,...configuredEnvNames])].sort();
  const declaredTimeouts=(plan.capabilities.toolTimeouts??[]).filter(item=>item.static).map(item=>item.timeoutMs);
  const outerToolTimeoutMs=Math.max(callTimeoutMs,...declaredTimeouts)+cancelGraceMs;
  const stateId=stablePluginId({origin:source.origin,packageDir:plan.packageDir,name:plan.name});
  const hostOptions={passEnv:forwardedNames,homeMode,initializeTimeoutMs,callTimeoutMs,cancelGraceMs,lenientOutput,allowUndeclaredOutput,moduleOptions,services,background,stateId,stateMode,...(stateRoot?{stateRoot}: {})};
  if(pythonEntry&&!plan.capabilities.pythonServers.some(s=>s.path===pythonEntry))throw new Error('指定的 Python 入口不在已辨識候選清單中');
  if(pythonEntry&&!allowTools.length)throw new Error('擷取內附 Python 服務必須用 allowTools 明確指定工具名稱，不能預設開放全部工具');
  await fs.mkdir(outputDir,{recursive:true});
  const report={...plan,root:undefined,defaultConfig:reportConfiguration(plan.defaultConfig),serviceConfig:reportConfiguration(plan.serviceConfig),capabilities:reportCapabilities(plan.capabilities),conversion:{engine:'fixed-rules',modelCalls:0,generatedAt:new Date().toISOString(),status:'unsupported',components:[],omitted:plan.issues,verification:{codexLoaded:false,toolsListed:false,toolsCalled:[]}}};
  const {requiredNames:untrustedEnvironmentRequests,...environmentMetadata}=plan.environment??{};
  report.environment={...environmentMetadata,requestedEnvNames};
  if((plan.capabilities.toolTimeouts??[]).some(item=>!item.static))report.conversion.omitted.push({code:'DYNAMIC_TOOL_TIMEOUT',message:'來源含動態 timeoutMs，靜態轉換無法預先調整已載入的 MCP 上限；若執行時來源上限更長，請提高 callTimeoutMs 並重新生成插件'});
  if(allowTools.length&&plan.capabilities.hostRuntime){
    const known=new Set((plan.capabilities.toolRuntime?.tools??[]).map(tool=>tool.name));
    const unconfirmed=allowTools.filter(name=>!known.has(name));
    report.conversion.toolSelection={requested:allowTools,scope:'native-source-tools',staticallyConfirmed:allowTools.filter(name=>known.has(name)),notStaticallyConfirmed:unconfirmed,runtimeValidated:false};
    if(unconfirmed.length)report.conversion.omitted.push({code:'TOOL_ALLOWLIST_UNCONFIRMED',message:`靜態分析不能確認工具名稱：${unconfirmed.join(', ')}。啟動後須核對實際註冊工具，不會因此開放其他來源工具`});
  }
  if(allowUndeclaredOutput)report.conversion.omitted.push({code:'OUTPUT_EXTRA_FIELDS_PRESERVED',message:'已明確選用保留來源未宣告的輸出欄位；已宣告欄位型別、必填與列舉仍驗證，輸入與核准規則不變。此結果不等於通過來源原始輸出規格。'});
  if(!plan.convertible&&!pythonEntry){await jsonWrite(path.join(outputDir,'conversion-report.json'),report);return report;}
  const copied=await copySource(source.root,path.join(outputDir,'source'));report.conversion.sourceCopy=copied;
  report.conversion.runtimeOptions={passEnv:forwardedNames,homeMode,initializeTimeoutMs,callTimeoutMs,cancelGraceMs,outerToolTimeoutMs,lenientOutput,allowUndeclaredOutput,hooks,stateId,stateMode,background};
  const dependencyPlan=await planSourceDependencies(source,{packageDir:plan.packageDir});
  const sourceDependencies=await installSourceDependencies(dependencyPlan,{destination:outputDir,enabled:installDependencies,...(dependencyRunner?{runner:dependencyRunner}: {}),onPlan:async proposed=>{report.conversion.sourceDependencies=proposed;await jsonWrite(path.join(outputDir,'conversion-report.json'),report);}});
  report.conversion.sourceDependencies=sourceDependencies;
  if(sourceDependencies.status==='failed')report.conversion.omitted.push({code:'SOURCE_DEPENDENCIES_FAILED',message:sourceDependencies.error.message,dependencyError:sourceDependencies.error.code});
  if(sourceDependencies.status==='disabled'&&sourceDependencies.packages.length)report.conversion.omitted.push({code:'SOURCE_DEPENDENCIES_DISABLED',message:'已依選項略過來源正式依賴安裝；尚未確認來源可編譯或啟動'});
  hostOptions.serviceConfig={web:webConfiguration(plan)};
  hostOptions.sourceNodePaths=sourceDependencies.nodePaths.map(item=>'./'+path.relative(outputDir,item).split(path.sep).join('/'));
  const servers=Object.create(null),additionalSkillPaths=[];
  const allocateServer=base=>{let key=base,n=1;while(Object.hasOwn(servers,key))key=`${base}-${++n}`;return key;};
  for(const [key,raw]of Object.entries(plan.capabilities.mcpServers)) {
    const server={...raw};
    if(server._optionalEnvHeaders){
      const stem=`http-${Object.keys(servers).length+1}`;
      const runtimeDir=path.join(outputDir,'runtime');await fs.mkdir(runtimeDir,{recursive:true});
      const temp=path.join(runtimeDir,stem+'.entry.mjs');
      await fs.writeFile(temp,`import path from'node:path';import fs from'node:fs/promises';import{fileURLToPath}from'node:url';import{connectHttpMcp}from ${JSON.stringify(path.join(converterRoot,'lib','http-proxy.mjs'))};import{serveMcp}from ${JSON.stringify(path.join(converterRoot,'lib','protocol.mjs'))};const root=path.dirname(fileURLToPath(import.meta.url));const c=JSON.parse(await fs.readFile(path.join(root,${JSON.stringify(stem+'.json')}),'utf8'));try{const connection=await connectHttpMcp(c);await serveMcp({name:${JSON.stringify(key)},tools:connection.tools,dispose:connection.dispose});}catch(e){console.error(e.message);process.exitCode=1;}`);
      await build({entryPoints:[temp],outfile:path.join(runtimeDir,stem+'.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});await fs.unlink(temp);
      await jsonWrite(path.join(runtimeDir,stem+'.json'),{url:server.url,httpHeaders:server.http_headers??{},optionalEnvHeaders:server._optionalEnvHeaders,timeout:(server.tool_timeout_sec??30)*1000});
      servers[key]={command:'node',args:[`./runtime/${stem}.mjs`],cwd:'.',env_vars:Object.values(server._optionalEnvHeaders),...(server.tool_timeout_sec?{tool_timeout_sec:server.tool_timeout_sec}:{}),startup_timeout_sec:30};
      report.conversion.components.push({kind:'declared-mcp',name:key,status:'configured-not-started',adapter:'optional-env-http-proxy'});continue;
    }
    if(server.command){
      const sourceCwd=server.cwd??'.';
      if(path.isAbsolute(sourceCwd)||path.win32.isAbsolute(sourceCwd)||!inside(source.root,path.resolve(source.root,sourceCwd))){report.conversion.omitted.push({code:'MCP_CWD',message:`${key} 的工作目錄不可攜或超出來源，未產生此連線`});continue;}
      server.cwd='./source/'+path.relative(source.root,path.resolve(source.root,sourceCwd)).split(path.sep).join('/');
    }
    servers[key]=server;report.conversion.components.push({kind:'declared-mcp',name:key,status:'configured-not-started'});
  }
  for(const skill of plan.capabilities.skills) {
    const destination='./source/'+path.dirname(skill.path).split(path.sep).join('/');
    if(report.conversion.components.some(c=>c.kind==='skill'&&c.name===skill.name)){report.conversion.omitted.push({code:'SKILL_COLLISION',message:`技能名稱重複：${skill.name}，後者未啟用`});continue;}
    additionalSkillPaths.push(destination);report.conversion.components.push({kind:'skill',name:skill.name,path:destination,status:'copied-unexecuted'});
  }
  if(additionalSkillPaths.length)report.conversion.omitted.push({code:'SKILL_HOST_CONTEXT',message:'技能及相對資源保留原目錄；倉庫根指令以 source/ 為工作目錄。未自動把原宿主特有指令改寫成 Codex 工具，技能內容尚未逐項執行驗證'});
  let ui=null;
  if(plan.host?.frontend){
    try{
      ui=await preparePluginUi({converterRoot,outputDir,sourceRoot:path.join(outputDir,'source'),packageDir:plan.packageDir});
      if(ui)report.conversion.components.push({kind:'dsh-ui',name:'original-frontend',status:'packaged-not-executed',manifest:'runtime/ui/manifest.json',clients:ui.clients,placement:'independent-browser-page'});
    }catch(error){report.conversion.omitted.push({code:'UI_BUILD',message:'原畫面尚未打包成功，其餘功能繼續轉換：'+error.message});}
  }
  const official=Boolean(plan.capabilities.hostRuntime||ui&&plan.entry)&&engine!=='portable-tools';
  report.conversion.requiredServices=plan.host?.services??[];
  const detectedCapabilities=await probeCodexCapabilities();
  report.conversion.modules=selectModules(plan,{...hostOptions,services:hostOptions.services??plan.host?.services},detectedCapabilities);
  if(engine==='portable-tools'){report.conversion.modules=report.conversion.modules.map(item=>({...item,status:'not-applied-portable',selected:false,reason:'明確選用 portable-tools，未掛載官方服務模組'}));report.conversion.runtimeOptions.ignoredOptions=['homeMode','initializeTimeoutMs','callTimeoutMs','cancelGraceMs','moduleOptions','hooks'];}
  report.conversion.codexCapabilities=detectedCapabilities;
  report.conversion.intrinsicallyUnsupported=[...(plan.host?.client?[{feature:'Codex-chat-appearance',reason:'不改 Codex 聊天外觀；原插件頁面另放在右側瀏覽器，輸入框及訊息內掛載尚未接上。'}]:[]),{feature:'DSH-model-provider-replacement',reason:'無法從來源插件替換 Codex 自身模型供應商'},{feature:'DSH-internal-agent-loop',reason:'無法直接改造 Codex 的內部代理執行流程'}];
  if(engine==='portable-tools')report.conversion.omitted.push({code:'PORTABLE_RUNTIME_LIMITATIONS',message:'明確選用 portable-tools，只提供工具相容層與輸出包裝；homeMode、環境變數隔離、初始化與呼叫逾時、官方核准及其他 DSH 服務模組不適用，未套用這些選項'});
  if(official){
    for(const item of plan.runtimeCompatibility.mismatches)report.conversion.omitted.push({code:'HOST_VERSION_MISMATCH',message:`官方執行套件 ${item.name} 的版本 ${item.installed} 不符合來源 ${item.declaredIn} 宣告的 ${item.requested}；不能據此把原工具失敗歸因於 Codex，需在來源支援的 DSH 版本對照驗證`,...item});
    for(const item of plan.runtimeCompatibility.unresolved)if(!item.optional)report.conversion.omitted.push({code:'HOST_VERSION_UNCONFIRMED',message:`無法確認來源宣告的官方套件 ${item.name}@${item.requested} 與內附執行環境相容；未安裝或替換來源依賴`,...item});
    try{
      const built=await buildOfficialHost({converterRoot,outputDir,plan,config,allowTools,workspace,codexSessionQuery,hooks,options:hostOptions});
      const key=allocateServer('dsh');servers[key]={command:'node',args:['./runtime/server.mjs'],cwd:'.',startup_timeout_sec:initializeTimeoutMs/1000,tool_timeout_sec:outerToolTimeoutMs/1000};
      report.conversion.components.push({kind:'dsh-host',name:key,status:'configured-not-executed',host:'official-dsh-cordis',packages:built.environment.packages,runtimeTemplate:built.runtimeTemplate,hooksGenerated:built.hooksGenerated,hookEvents:built.hookEvents,hooksTrusted:false,sourceExecuted:false});
      report.conversion.omitted.push({code:'HOST_BOUNDARIES',message:'使用真正的 DSH 工具政策、設定、提示內容及本機路由。Codex 對話為明確清單內唯讀投影；不建立 DSH 模型迴圈、不接管 Codex 模型、不改聊天介面。需要原生 Agent/Session 的工具仍須個別驗證。'});
    }catch(e){report.conversion.omitted.push({code:'HOST_BUILD',message:String(e.message).slice(0,2000)});}
  }
  if(!official&&plan.capabilities.toolRuntime&&!plan.host.features.length) {
    const compiled=path.join(outputDir,'runtime','plugin.mjs');await fs.mkdir(path.dirname(compiled),{recursive:true});
    try{
      await compileDshEntry({entry:path.resolve(outputDir,'source',plan.entry),sourceRoot:path.join(outputDir,'source'),portableRoot:path.join(outputDir,'source'),outfile:compiled,nodePaths:sourceDependencies.nodePaths});
      const runtimeEntry=path.join(outputDir,'runtime','server-entry.mjs');
      await fs.writeFile(runtimeEntry,`import path from 'node:path';\nimport {fileURLToPath} from 'node:url';\nimport fs from 'node:fs/promises';\nimport {loadDshTools} from ${JSON.stringify(path.join(converterRoot,'lib','runtime.mjs'))};\nimport {serveMcp} from ${JSON.stringify(path.join(converterRoot,'lib','protocol.mjs'))};\nimport {resolvePluginState} from ${JSON.stringify(path.join(converterRoot,'lib','state-paths.mjs'))};\nconst root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');\nconst opts=JSON.parse(await fs.readFile(path.join(root,'runtime','settings.json'),'utf8'));\nlet loaded;try {loaded=await loadDshTools({entry:path.join(root,'runtime','plugin.mjs'),sourceRoot:path.join(root,'source'),stateDir:resolvePluginState({root,options:opts}),config:opts.config,prebundled:true,lenientOutput:opts.lenientOutput,allowUndeclaredOutput:opts.allowUndeclaredOutput,logger:(...v)=>console.error(...v)});\nconst missing=opts.allowTools.filter(n=>!loaded.tools.some(t=>t.name===n));if(missing.length)throw new Error('Requested source tools are not registered: '+missing.join(', '));const tools=opts.allowTools.length?loaded.tools.filter(t=>opts.allowTools.includes(t.name)):loaded.tools;\nif(!tools.length)throw new Error('No compatible tools registered');\nawait serveMcp({name:opts.name,tools,dispose:loaded.dispose});}catch(e){await loaded?.dispose();console.error(JSON.stringify({error:e.message,unsupported:e.unsupported??[]}));process.exitCode=1;}\n`);
      await build({entryPoints:[runtimeEntry],outfile:path.join(outputDir,'runtime','server.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',packages:'bundle',external:['esbuild'],banner:{js:"import {createRequire as __runtimeCreateRequire} from 'node:module'; const require=__runtimeCreateRequire(import.meta.url);"},logLevel:'silent'});
      await fs.unlink(runtimeEntry);
      await jsonWrite(path.join(outputDir,'runtime','settings.json'),{name:plan.name,config:{...plan.defaultConfig,...config},allowTools,...hostOptions});
      const key=allocateServer('dsh');servers[key]={command:'node',args:['./runtime/server.mjs'],cwd:'.'};
      report.conversion.components.push({kind:'dsh-tools',name:key,status:'compiled-not-executed',toolCandidates:plan.capabilities.toolRuntime.tools.map(t=>t.name)});
    }catch(e){report.conversion.omitted.push({code:'RUNTIME_BUILD',message:String(e.message).slice(0,2000)});}
  }
  if(!official&&plan.capabilities.toolRuntime&&plan.host.features.length)report.conversion.omitted.push({code:'RUNTIME_HOST_DEPENDENCY',message:'原工具依賴 DSH 宿主服務；所選引擎不支援，未產生替代工具'});
  for(let i=0;i<plan.capabilities.pythonServers.length;i++) {
    const item=plan.capabilities.pythonServers[i];const key=allocateServer(`python-${i+1}`);
    if(item.path!==pythonEntry){report.conversion.omitted.push({code:'PYTHON_CANDIDATE_ONLY',message:`內附服務 ${item.path} 僅列為候選，未掛載。擷取服務與完整移植原插件不同；須明確指定 pythonEntry 及 allowTools`});continue;}
    servers[key]={command:'python',args:[`./source/${item.path}`],cwd:'.',env:{PYTHONUTF8:'1'}};
    report.conversion.components.push({kind:'python-mcp',name:key,entry:item.path,entrySource:'user-selected-candidate',status:'configured-needs-environment',allowTools});
    report.conversion.omitted.push({code:'EXTRACTED_SERVICE',message:`已依指定清單擷取 ${item.path}；DSH 外層的權限、設定及自動化邏輯沒有移植，不應使用涉及寫入的工具，除非另外完成原權限規則的移植與驗證`});
    if(allowTools.length){
      // A protocol-level allow-list preserves the selected surface independently of source-specific environment names.
      const wrapper=path.join(outputDir,'runtime',`${key}.mjs`);await fs.mkdir(path.dirname(wrapper),{recursive:true});
      const temp=wrapper+'.entry.mjs';
      await fs.writeFile(temp,`import path from 'node:path';import fs from 'node:fs/promises';import{fileURLToPath}from'node:url';import{McpClient,serveMcp}from ${JSON.stringify(path.join(converterRoot,'lib','protocol.mjs'))};const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const c=JSON.parse(await fs.readFile(path.join(root,'runtime',${JSON.stringify(key+'.json')}),'utf8'));const client=new McpClient({...c.server,cwd:root},{cwd:root});await client.start();const all=await client.listTools();const missing=c.allow.filter(n=>!all.some(t=>t.name===n));if(missing.length)throw new Error('Missing source tools: '+missing.join(', '));await serveMcp({name:c.name,tools:all.filter(t=>c.allow.includes(t.name)).map(t=>({...t,execute:args=>client.request('tools/call',{name:t.name,arguments:args})})),dispose:()=>client.close()});`);
      await build({entryPoints:[temp],outfile:wrapper,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});await fs.unlink(temp);
      await jsonWrite(path.join(outputDir,'runtime',key+'.json'),{name:plan.name,server:servers[key],allow:allowTools});
      servers[key]={command:'node',args:[`./runtime/${key}.mjs`],cwd:'.'};
    }
  }
  if(ui&&!report.conversion.components.some(item=>item.kind==='dsh-host')){
    const wrapper=path.join(outputDir,'runtime','ui-server.mjs'),temp=wrapper+'.entry.mjs';
    await fs.writeFile(temp,`import path from 'node:path';import{fileURLToPath}from'node:url';import{serveUiOnly}from ${JSON.stringify(path.join(converterRoot,'lib/ui-host.mjs'))};const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');await serveUiOnly({root,name:${JSON.stringify(plan.name)}});`);
    await build({entryPoints:[temp],outfile:wrapper,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});await fs.unlink(temp);
    const key=allocateServer('dsh-ui');servers[key]={command:'node',args:['./runtime/ui-server.mjs'],cwd:'.'};
    report.conversion.components.push({kind:'dsh-ui-server',name:key,status:'configured-not-executed',backendAvailable:false});
    if(plan.entry)report.conversion.omitted.push({code:'UI_BACKEND_UNAVAILABLE',message:'原畫面已保留，但未啟動官方後端；依賴後端的操作會明確回報，純前端操作仍可使用。'});
  }
  if(ui){
    const skillPath=path.join(outputDir,'skills','plugin-ui');await fs.mkdir(skillPath,{recursive:true});
    await fs.writeFile(path.join(skillPath,'SKILL.md'),`---\nname: plugin-ui\ndescription: 開啟此插件原本的設定頁、頁籤或浮窗。\n---\n\n使用本包 MCP 工具 dsh_host_ui_open 取得 url，再用 open_in_codex 的 browser 目標開在目前對話右側。不需要桌面捷徑。原畫面直接呼叫本插件真實後端；不要把開啟頁面當作所有功能已驗證。未接上的服務會在頁面列出。不要修改 Codex 聊天外觀。\n`);
    additionalSkillPaths.push('./skills/plugin-ui/');
  }
  const commandSkills=generateCommandSkills(plan);
  for(const skill of commandSkills.skills){const file=path.join(outputDir,skill.path);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,skill.content,'utf8');report.conversion.components.push({kind:'command-skill',name:skill.name,command:skill.command,status:official?'global-handler-available':'host-required'});}
  for(const diagnostic of commandSkills.diagnostics)report.conversion.omitted.push({...diagnostic,message:diagnostic.reason});
  for(const server of Object.values(servers))if(server.command)server.env_vars=[...new Set([...(server.env_vars??[]),...forwardedNames])].sort();
  const successful=report.conversion.components.length>0;
  // Codex merges MCP servers by their server name even across separate plugins.
  // Qualify every generated server, including declared and extracted services.
  const identity=createHash('sha256').update(plan.source.origin+'|'+plan.packageDir+'|'+(name??plan.name)).digest('hex').slice(0,8);
  const namespace=`${safeName(name??plan.name).slice(0,32)}-${identity}`;
  report.conversion.serverNames=Object.create(null);
  for(const original of Object.keys(servers)){
    const qualified=`${namespace}-${safeName(original).slice(0,14)}-${createHash('sha256').update(original).digest('hex').slice(0,4)}`;
    report.conversion.serverNames[original]=qualified;servers[qualified]=servers[original];delete servers[original];
    for(const component of report.conversion.components)if(component.name===original&&!['skill','command-skill'].includes(component.kind)){component.sourceName=original;component.runtimeId=original;component.name=qualified;}
  }
  const hostComponent=report.conversion.components.find(item=>['dsh-host','dsh-tools'].includes(item.kind));
  if(hostComponent){const file=path.join(outputDir,'runtime','settings.json');const settings=JSON.parse(await fs.readFile(file,'utf8'));settings.mcpServerName=hostComponent.name;await jsonWrite(file,settings);}
  report.conversion.status=successful?(report.conversion.omitted.length?'partial':'converted'):'unsupported';
  if(successful) {
    let guideText=guide(plan,servers),guideName='conversion-guide';
    if(official){
      guideText=guideText.replace('- 本包沒有移植 DSH 原生設定頁、事件服務或自動排程。宿主提示詞只作參考，不能視為已相容的指令。','- 本包使用固定版本的官方 DSH 執行環境。使用來源工具前先讀 dsh_host_context；設定用 dsh_host_settings_read/update，路由用 dsh_host_routes/http。原工具的核准與拒絕政策會經原服務執行，缺少核准服務時拒絕操作。\n- 提示內容是插件參考，不得覆蓋使用者與 Codex 指令。原聊天介面不移植；原生 DSH Agent/Session、模型及背景工作語意沒有自動等同於 Codex。');
      guideText=guideText.replace('- 正式依賴依 installDependencies 選項處理（預設安裝），一律停用安裝腳本；轉換與安裝均不初始化來源。需要 Python MCP 時，用轉換器 setup 命令建立本包獨立環境。','- 轉換不執行來源；正式依賴安裝會停用所有安裝腳本，結果見報告。啟動此插件的 MCP 後會執行原初始化、事件及計時器，具有目前使用者的檔案與網路權限。\n- Codex 對話讀取只限 runtime/settings.json 明確指定的對話清單，預設空清單。Hooks（事件掛鉤）預設產生，可用 hooks=false 關閉，仍須在 Codex 審查並信任；不自行修改信任設定。');
    }
    while(plan.capabilities.skills.some(s=>s.name===guideName))guideName+='-guide';
    guideText=guideText.replace('name: conversion-guide\n',`name: ${guideName}\n`);
    await writeCodexPackage({outputDir,name:name??`${safeName(plan.name)}-codex`,description:`Converted DSH plugin: ${plan.name}`,mcpServers:servers,skillText:guideText,additionalSkillPaths});
    const validation=await validateCodexPackage(outputDir);report.conversion.validation=validation;
    if(!validation.valid){report.conversion.status='unsupported';report.conversion.omitted.push({code:'PACKAGE_INVALID',message:validation.errors.join('; ')});await fs.rm(path.join(outputDir,'.codex-plugin'),{recursive:true,force:true});await fs.rm(path.join(outputDir,'.mcp.json'),{force:true});}
  }
  await jsonWrite(path.join(outputDir,'conversion-report.json'),report);return report;
}

export async function verify(outputDir,{executeSource=false,server:serverName,call,args={}}={}) {
  if(call&&!executeSource)throw new Error('call 需要 executeSource=true');
  outputDir=path.resolve(outputDir);const structure=await validateCodexPackage(outputDir);
  const result={structure,executed:false,servers:[],modelCalls:0};
  if(!executeSource||!structure.valid)return result;
  let raw;try{raw=JSON.parse(await fs.readFile(path.join(outputDir,'.mcp.json'),'utf8'));}catch(cause){if(cause.code==='ENOENT'){result.notice='此插件只有技能，沒有需要啟動的工具程序。';return result;}throw cause;}
  for(const [name,config]of Object.entries(raw.mcpServers??{})) {
    if(serverName&&name!==serverName)continue;
    if(!config.command){result.servers.push({name,status:'not-started-remote'});continue;}
    const c={...config,cwd:config.cwd?path.resolve(outputDir,config.cwd):outputDir};
    const client=new McpClient(c,{cwd:outputDir,timeout:30000});
    try{
      await client.start();const tools=await client.listTools();const entry={name,status:'tools-listed',toolCount:tools.length,tools:tools.map(t=>({name:t.name,inputSchema:t.inputSchema}))};
      if(call){if(!tools.some(t=>t.name===call))throw new Error(`工具不存在：${call}`);entry.call={tool:call,result:await client.request('tools/call',{name:call,arguments:args})};entry.status=entry.call.result.isError?'call-error':'tool-called';}
      result.servers.push(entry);
    }catch(e){result.servers.push({name,status:'failed',error:e.message});}finally{await client.close();}
  }
  if(serverName&&!Object.hasOwn(raw.mcpServers??{},serverName))throw new Error('指定的 MCP 連線不存在');
  result.executed=result.servers.some(s=>s.status!=='not-started-remote');
  try{
    const file=path.join(outputDir,'conversion-report.json'),report=JSON.parse(await fs.readFile(file,'utf8'));
    report.conversion.verification.lastCheck=result;
    report.conversion.verification.toolsListed=result.servers.some(s=>['tools-listed','tool-called','call-error'].includes(s.status));
    report.conversion.verification.toolsCalled=result.servers.filter(s=>s.status==='tool-called').map(s=>s.call.tool);
    for(const c of report.conversion.components){const checked=result.servers.find(s=>s.name===c.name);if(checked)c.status=checked.status;}
    if(result.servers.some(s=>s.status==='failed'||s.status==='call-error'))report.conversion.status='partial';
    await jsonWrite(file,report);
  }catch(e){if(e.code!=='ENOENT')throw e;}
  return result;
}
