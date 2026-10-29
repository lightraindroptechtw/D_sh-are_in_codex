import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {runGuarded} from './sandbox-launch.mjs';
import {planMcpTargets} from './mcp-targets.mjs';
import {build} from 'esbuild';
import {installDshCli} from './dsh-cli-install.mjs';
import {createHash} from 'node:crypto';
import {createPluginSecurity} from './plugin-security.mjs';

const lib=path.dirname(fileURLToPath(import.meta.url));
export async function secureGeneratedPackage(packageRoot,{stateDir,report,codexHome,dataRoot,converterRoot,pythonRuntime,onProgress=()=>{},runGuardedImpl=runGuarded}){
  const handoff=await fs.readFile(path.join(lib,'../data/permission-handoff-skill.md'),'utf8');
  const instructions=handoff.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1];
  if(!instructions)throw Error('缺少交回 Codex 審核的權限指引');
  const skillRoot=path.join(packageRoot,'skills');
  for(const directory of await fs.readdir(skillRoot,{withFileTypes:true}).catch(cause=>{if(cause.code==='ENOENT')return [];throw cause;})){
    if(!directory.isDirectory())continue;
    const skill=path.join(skillRoot,directory.name,'SKILL.md');
    try{let content=await fs.readFile(skill,'utf8');content=content.replace('具有目前使用者的檔案與網路權限','受到 Codex 原生檔案與子程序限制，本機連線可能可用');await fs.writeFile(skill,content+'\n\n'+instructions+'\n');}catch(cause){if(cause.code!=='ENOENT')throw cause;}
  }
  const manifestFile=path.join(packageRoot,'.mcp.json');let config;
  try{config=JSON.parse(await fs.readFile(manifestFile,'utf8'));}catch(cause){if(cause.code==='ENOENT')return {enforced:true,codeExecution:false};throw cause;}
  await fs.mkdir(stateDir,{recursive:true});
  const activeCodexHome=path.resolve(codexHome??process.env.CODEX_HOME??path.join(os.homedir(),'.codex'));
  // The configured Node roots and the host's own native policy are the file
  // controls. Do not silently append a second blacklist beyond that standard.
  const protectedPaths=[];
  const planned=await planMcpTargets(packageRoot,{config,report,pythonRuntime});config=planned.config;
  const targets=planned.targets;
  report.conversion.omitted??=[];report.conversion.omitted.push(...planned.omitted);
  report.conversion.securityNotices=[...(report.conversion.securityNotices??[]),...planned.notices];
  if(planned.omitted.length)report.conversion.status='partial';
  const sourceProcess=report.conversion.components.some(component=>component.kind==='dsh-host')?'worker':'inline';
  await fs.mkdir(path.join(packageRoot,'runtime'),{recursive:true});
  for(const [from,to] of [['sandbox-launch.mjs','security-launch.mjs'],['sandbox-entry.mjs','sandbox-entry.mjs'],['execution-policy.mjs','execution-policy.mjs'],['permission-broker.mjs','permission-broker.mjs'],['protocol.mjs','protocol.mjs']])await fs.copyFile(path.join(lib,from),path.join(packageRoot,'runtime',to));
  for(const name of ['plugin-security.mjs','plugin-security-server.mjs','source-process-policy.mjs']){
    try{await fs.copyFile(path.join(lib,name),path.join(packageRoot,'runtime',name));}catch(cause){if(cause.code!=='ENOENT')throw cause;}
  }
  await build({entryPoints:[path.join(lib,'codex-task-mcp.mjs')],outfile:path.join(packageRoot,'runtime/codex-task-mcp.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import {createRequire as __mcpCreateRequire} from 'node:module';const require=__mcpCreateRequire(import.meta.url);"},logLevel:'silent'});
  await build({entryPoints:[path.join(lib,'dsh-codex-task.mjs')],outfile:path.join(packageRoot,'runtime/dsh-codex-task.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:"import {createRequire as __taskCreateRequire} from 'node:module';const require=__taskCreateRequire(import.meta.url);"},logLevel:'silent'});
  await installDshCli(packageRoot);
  const settingsFile=path.join(packageRoot,'runtime/settings.json');let settings;
  try{settings=JSON.parse(await fs.readFile(settingsFile,'utf8'));}catch(cause){if(cause.code!=='ENOENT')throw cause;}
  // Only converter-owned sensitive-field metadata is carried here. Plugin
  // private filenames, interpreter fields and runtime overlays are not guessed.
  const runtimeBindings={};
  const pluginId=report.name??path.basename(packageRoot),securityDataRoot=path.resolve(dataRoot??path.join(activeCodexHome,'dsh-to-codex-market'),'plugin-security');
  const declaredSecrets=(report.environment?.requestedEnvNames??[]).filter(name=>/(?:^|_)(?:API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTHORIZATION|COOKIE|PRIVATE_?KEY)(?:_|$)/i.test(name)),sensitiveConfigFields=[],secretValues={};
  const collect=(value,trail=[])=>{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){
    const current=[...trail,key];
    if(typeof item==='string'&&/(?:api.?key|token|secret|password|passwd|credential|authorization|cookie)/i.test(key)&&!/(?:env|name|path|file|ref)$/i.test(key)){
      const secretName='config:'+current.join('.'),envName='DSH_PLUGIN_SECRET_'+createHash('sha256').update(secretName).digest('hex').slice(0,16).toUpperCase();
      sensitiveConfigFields.push({path:current,secretName,envName});declaredSecrets.push({name:secretName,envName,provided:true});if(item)secretValues[secretName]=item;value[key]='';
    }else if(item&&typeof item==='object')collect(item,current);
  }};
  collect(settings?.config);
  if(sensitiveConfigFields.length){
    const secrets=createPluginSecurity({pluginId,pluginName:pluginId,dataRoot:path.join(securityDataRoot,pluginId),pluginDir:packageRoot,declaredSecrets});
    try{await secrets.load();await secrets.update({secrets:secretValues});}finally{await secrets.close();}
    runtimeBindings.sensitiveConfigFields=sensitiveConfigFields;
    report.conversion.securityNotices.push({code:'SENSITIVE_CONFIG_MOVED',message:'看似金鑰的設定已改用插件外的敏感欄位；有填寫的值已移出程式資料夾，尚未填寫的值可在插件安全設定補上。避免透過命令列或一般設定傳入敏感值。',fields:sensitiveConfigFields.map(field=>field.secretName)});
  }
  if(settings){
    settings.runtimeBindings=runtimeBindings;
    Object.assign(settings,{stateRoot:path.resolve(stateDir),stateMode:'persistent',homeMode:'isolated',passEnv:[],interception:false,securityDataRoot:path.resolve(dataRoot??path.join(activeCodexHome,'dsh-to-codex-market'),'plugin-security'),pluginId:report.name??path.basename(packageRoot),pluginName:report.name??path.basename(packageRoot),...(sourceProcess==='worker'?{workerPermissions:{readRoots:[path.resolve(packageRoot),path.resolve(stateDir),path.resolve(settings.workspace??process.cwd())],writeRoots:[path.resolve(stateDir),path.resolve(settings.workspace??process.cwd())]}}:{})});
    if(typeof settings.entry==='string'&&report.conversion.components.some(component=>component.kind==='dsh-host')){
      const {precompileSource}=await import('./precompile-source.mjs');
      try{const compiled=await precompileSource({packageRoot,settings});if(compiled.entries)settings.precompiledEntries=compiled.entries;else{settings.precompiledSource=compiled.file;settings.precompiledSourceMarker=compiled.marker;}}
      catch(cause){report.conversion.securityNotices.push({code:'PRECOMPILE_UNAVAILABLE',message:`來源預先編譯未完成：${cause.message}。啟動時會使用一般編譯流程。`});}
    }
    await fs.writeFile(settingsFile,JSON.stringify(settings,null,2)+'\n');
  }
  const readRoots=[path.resolve(packageRoot)];
  const trustedRuntimeHashes={};for(const name of ['dsh-codex-cli.mjs','dsh-host-worker.mjs'])try{trustedRuntimeHashes[name]=createHash('sha256').update(await fs.readFile(path.join(packageRoot,'runtime',name))).digest('hex');}catch(cause){if(cause.code!=='ENOENT')throw cause;}
  const policy={schemaVersion:3,followHost:true,codexHome:activeCodexHome,workspace:settings?.workspace??process.cwd(),stateDir:path.resolve(stateDir),targets,trustedRuntimeHashes,denyRead:protectedPaths,readRoots,sourceProcess,network:'inherit-no-extra-restriction',environment:'declared-provided-secrets-only',securityDataRoot,pluginId,pluginName:pluginId,declaredSecrets,postingTools:report.securityScan?.postingTools??report.securityScan?.findings?.filter(item=>item.category==='posting').map(item=>item.toolName).filter(Boolean)??[]};
  await fs.writeFile(path.join(packageRoot,'runtime/security-policy.json'),JSON.stringify(policy,null,2)+'\n');
  await fs.writeFile(manifestFile,JSON.stringify(config,null,2)+'\n');
  await fs.writeFile(path.join(packageRoot,'conversion-report.json'),JSON.stringify(report,null,2)+'\n');
  await onProgress({stage:'sandbox',message:'已設定插件權限；若宿主無法提供原生限制，會列出差異，由你決定'});
  let probe={enforced:true};
  if(targets.length)try{probe=await runGuardedImpl({stateDir,denyRead:protectedPaths,readRoots,probeOnly:true});}catch(cause){probe={enforced:false,available:false,message:`Codex 原生限制檢測未完成：${cause.message}。可使用 Node 資料夾限制，或在插件設定關閉限制。`};}
  return {...probe,codeExecution:targets.length>0,remoteMcp:planned.remote,omitted:planned.omitted,notices:planned.notices};
}
