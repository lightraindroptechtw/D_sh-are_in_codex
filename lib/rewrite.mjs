// MIT. Fixed-rule preparation and review binding for Codex rewrites.
// Nothing in this module imports a source plugin or runs generated code/models.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {acquireSource, copySource, inside} from './source.mjs';
import {inspectSource} from './inspect.mjs';
import {writeCodexPackage, validateCodexPackage} from './codex-package.mjs';
import {snapshotSource} from './security-review.mjs';
import {scanSecurity} from './security-scan.mjs';
import {selectModules} from './modules/index.mjs';

export const TASK_FILE='補寫任務.json';
export const RESULT_FILE='補寫結果.json';
export const BASELINE_FILE='寫之前的檔案.json';
export const WRITABLE=['skills/rewrite/','runtime/rewrite/','assets/rewrite/','hooks/rewrite/',RESULT_FILE];
export const CONCLUSIONS=['done','partial','codex-cannot'];
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const slash=value=>value.split(path.sep).join('/');
const json=value=>JSON.stringify(value,null,2)+'\n';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,code='REWRITE_INTEGRITY_FAILED')=>Object.assign(new Error(message),{code});
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const writeJson=(file,value)=>fs.writeFile(file,json(value),'utf8');
const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const writable=relative=>WRITABLE.some(name=>name.endsWith('/')?relative===name.slice(0,-1)||relative.startsWith(name):relative===name);
const safeName=name=>String(name).replace(/^@[^/]+\//,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,53)||'rewritten';
const bound=(actual,expected,label)=>{if(typeof expected!=='string'||!(/^[a-f0-9]{64}$/.test(expected))||actual!==expected)throw fail(label+' 已變更或缺少已綁定的雜湊');};
async function safeWritePath(root,relative){
  let current=root;
  for(const part of ['.',...relative.split('/').filter(Boolean)]){
    current=path.resolve(current,part);if(!inside(root,current))throw fail('寫入路徑超出插件');
    try{if((await fs.lstat(current)).isSymbolicLink())throw fail('寫入路徑不可經過符號連結：'+relative);}catch(error){if(error.code==='ENOENT')return;throw error;}
  }
}

/** Same digest as the existing signed source review; no plugin execution. */
export async function hashRewriteSource(sourceRoot){return (await snapshotSource(sourceRoot)).digest;}

// Include directories and executable modes. Existing npm links may be copied,
// but a rewrite cannot introduce or modify any symbolic link.
async function inventory(root){
  root=await fs.realpath(root);const result=Object.create(null);
  async function visit(directory){
    for(const entry of(await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
      const absolute=path.join(directory,entry.name),relative=slash(path.relative(root,absolute)),stat=await fs.lstat(absolute);
      if(stat.isSymbolicLink()){
        if(!inside(root,await fs.realpath(absolute)))throw fail('產物包含通往外部的連結：'+relative);
        result[relative]={kind:'link',target:await fs.readlink(absolute)};
      }else if(stat.isDirectory()){result[relative]={kind:'directory',mode:stat.mode&0o777};await visit(absolute);}
      else if(stat.isFile())result[relative]={kind:'file',mode:stat.mode&0o777,bytes:stat.size,sha256:sha(await fs.readFile(absolute))};
      else throw fail('產物包含特殊檔案：'+relative);
    }
  }
  await visit(root);return result;
}
const inventoryHash=entries=>sha(json(entries));
function changed(before,after){return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(name=>JSON.stringify(before[name])!==JSON.stringify(after[name])).sort();}

function licenseAdvice(pkg){
  const value=typeof pkg.license==='string'?pkg.license:null;
  return {spdx:value,requiresUserDecision:!value||!(/^(?:MIT|MIT-0|ISC|BSD-\d-CLAUSE|APACHE-2\.0|0BSD|UNLICENSE|CC0-1\.0)$/i.test(value)),
    notice:!value?'原插件沒有宣告授權；已列為待使用者決定，不由固定規則禁止補寫。':`原插件授權：${value}。保留來源授權；改寫與公開方式由使用者依原授權決定。`};
}
function rewriteTargets(plan){
  const targets=[];
  if(plan.host?.client||(plan.issues??[]).some(row=>row.code==='NATIVE_UI'))targets.push({feature:'DSH 前端畫面',reason:plan.host?.frontend?'已有共用的獨立畫面執行環境；優先保留原設定頁、頁籤與浮窗，只補尚未接上的服務。不修改 Codex 聊天外觀。':'尚未找到可載入的原前端；可補成獨立網頁、技能或工具。不修改 Codex 聊天外觀。',kind:'native-ui'});
  const modules=selectModules(plan,{},{});
  for(const row of modules){
    const unsupported=Object.entries(row.descriptor?.methods??{}).filter(([,item])=>item.support==='unsupported').map(([name,item])=>({method:name,reason:item.reason}));
    if(!row.descriptor?.methods||Object.keys(row.descriptor.methods).length===0||unsupported.length)targets.push({feature:'DSH 服務 '+row.id,kind:'service',reason:unsupported.length?'部分方法沒有對應實作。':row.reason,unsupported});
  }
  return {targets,modules};
}

/** Read-only. Acquiring a remote source may download it, but never executes it. */
export async function rewriteCheck(input,{packageDir='.',sourceEntry,cacheDir,ref}={}){
  const source=await acquireSource(input,{cacheDir,ref});
  const packageRoot=await fs.realpath(path.resolve(source.root,packageDir));
  if(!inside(source.root,packageRoot))throw fail('套件目錄超出來源');
  const plan=await inspectSource(source,{packageDir,sourceEntry});
  const pkg=await readJson(path.join(packageRoot,'package.json'));
  const {targets,modules}=rewriteTargets(plan),sourceHash=await hashRewriteSource(source.root);
  return {source:{...source,packageRoot,packageDir:plan.packageDir},sourceRoot:source.root,sourceHash,sourceDigest:sourceHash,plan,license:licenseAdvice(pkg),targets,modules,
    meaningful:targets.length>0,sourceExecuted:false,rewrittenCodeExecuted:false,startedModel:false,modelCalls:0,installed:false};
}

/** Create a fresh workDir. basePackageDir is an already converted preview, optional.
 * No conversion, installation, dependency fetching or model call happens here. */
export async function prepareRewrite(input,{workDir,basePackageDir,expectedSourceHash,allowedMcpServers=['rewrite'],capabilities={},model='current-conversation',effort='current-conversation',...options}={}){
  if(!workDir)throw fail('需要新的 workDir','REWRITE_WORKDIR_REQUIRED');
  if(!Array.isArray(allowedMcpServers)||allowedMcpServers.some(name=>typeof name!=='string'||!(/^[A-Za-z0-9_-]+$/.test(name)))||new Set(allowedMcpServers).size!==allowedMcpServers.length)throw fail('allowedMcpServers 必須是互不重複的服務名稱');
  const check=await rewriteCheck(input,options);if(expectedSourceHash!==undefined)bound(check.sourceHash,expectedSourceHash,'來源');
  workDir=path.resolve(workDir);
  if(inside(check.sourceRoot,workDir)||inside(workDir,check.sourceRoot))throw fail('補寫工作目錄與來源不可互相包含');
  if(basePackageDir&&(inside(path.resolve(basePackageDir),workDir)||inside(workDir,path.resolve(basePackageDir))))throw fail('預覽來源與補寫工作目錄不可互相包含');
  await fs.mkdir(path.dirname(workDir),{recursive:true});await fs.mkdir(workDir,{recursive:false});
  const pluginDir=path.join(workDir,'plugin'),pinnedSource=path.join(workDir,'source-snapshot');
  await fs.mkdir(pinnedSource);await copySource(check.sourceRoot,pinnedSource);
  const sourceCopyHash=await hashRewriteSource(pinnedSource);
  if(basePackageDir){await inventory(basePackageDir);await fs.cp(basePackageDir,pluginDir,{recursive:true,dereference:false});}
  else await fs.mkdir(pluginDir);
  const targetSource=path.join(pluginDir,'source');
  if(await exists(targetSource))bound(await hashRewriteSource(targetSource),sourceCopyHash,'預覽插件來源');
  else await fs.cp(pinnedSource,targetSource,{recursive:true});
  if(!await exists(path.join(pluginDir,'.codex-plugin','plugin.json'))){
    await writeCodexPackage({outputDir:pluginDir,name:safeName(check.plan.name),version:'0.1.0',description:'依原始碼補寫的 Codex 插件預覽',
      skillText:'---\nname: conversion-guide\ndescription: 閱讀此補寫插件的成果與限制。\n---\n\n先讀根目錄的補寫結果.json；尚未完成或未驗證的功能不得當作已可使用。\n'});
  }
  // Empty parent directories are made before the immutable baseline, so only
  // the named rewrite subtrees can be added later.
  for(const name of ['skills','runtime','assets','hooks'])await fs.mkdir(path.join(pluginDir,name),{recursive:true});
  const before=await inventory(pluginDir);
  const record={schemaVersion:1,sourceRoot:check.sourceRoot,sourceHash:check.sourceHash,sourceCopyHash,packageDir:check.source.packageDir,
    allowedMcpServers:[...allowedMcpServers],before,source:check.source,license:check.license,targets:check.targets,capabilities,requestedExecution:{model,effort,startedModel:false}};
  await writeJson(path.join(workDir,BASELINE_FILE),record);
  const preparationHash=sha(json(record));
  const task={schemaVersion:1,source:{root:pinnedSource,packageDir:check.source.packageDir,sourceHash:check.sourceHash},pluginDir,
    writable:WRITABLE,allowedMcpServers,targets:check.targets,license:check.license,capabilities,requestedExecution:{model,effort,startedModel:false},
    instructions:['只在 writable 所列位置補寫，保持既有轉換產物與來源不變。','使用 Codex 支援的技能、MCP 工具或獨立網頁；不要把 Claude Code 的 register.tsx 當成 Codex 介面。',
      '不要自行呼叫模型、啟動第三方程式或安裝依賴。由目前對話或使用者指定的子代理處理。','將已完成、未完成與無法實作的部分寫入補寫結果.json；區分靜態檢查與實際執行。',
      'model 與 effort 只記錄使用者選擇，不會自動更換目前對話。不同模型需由使用者切換或經明確授權交給子代理；不得試打模型來檢查額度。',
      '新增 MCP 宣告寫在補寫結果.json 的 mcpServers，只能使用 allowedMcpServers 的名稱；不得直接改 .mcp.json。','hooks/rewrite/ 只是資源目錄，這個版本不自動掛載原生掛鉤。需要掛鉤時如實列為尚待串接。'],
    resultSchema:{conclusion:CONCLUSIONS,implemented:['已完成的具體行為'],limitations:['未完成或實測限制'],mcpServers:{},verification:{rewrittenCodeExecuted:false}}};
  await writeJson(path.join(workDir,TASK_FILE),task);
  await writeJson(path.join(pluginDir,RESULT_FILE),{schemaVersion:1,conclusion:'partial',implemented:[],limitations:['等待補寫，尚未驗證。'],mcpServers:{},verification:{rewrittenCodeExecuted:false}});
  bound(await hashRewriteSource(check.sourceRoot),check.sourceHash,'準備期間來源');
  return {...check,workDir,pluginDir,taskPath:path.join(workDir,TASK_FILE),resultPath:path.join(pluginDir,RESULT_FILE),preparationHash,sourceCopyHash,wired:false};
}

async function boundPreparation(workDir,expectedPreparationHash){
  workDir=await fs.realpath(workDir);
  const raw=await fs.readFile(path.join(workDir,BASELINE_FILE),'utf8');bound(sha(raw),expectedPreparationHash,'補寫基準');
  const record=JSON.parse(raw);
  for(const relative of ['plugin','source-snapshot']){
    if((await fs.lstat(path.join(workDir,relative))).isSymbolicLink())throw fail('補寫工作目錄不可被替換成符號連結');
  }
  bound(await hashRewriteSource(record.sourceRoot),record.sourceHash,'原始來源');
  bound(await hashRewriteSource(path.join(workDir,'source-snapshot')),record.sourceCopyHash,'固定來源副本');
  const pluginDir=path.join(workDir,'plugin'),after=await inventory(pluginDir),changes=changed(record.before,after);
  const outside=changes.filter(name=>!writable(name));if(outside.length)throw fail('補寫改動超出允許位置：'+outside.join('、'),'REWRITE_OUTSIDE_ALLOWED');
  if(changes.some(name=>after[name]?.kind==='link'))throw fail('補寫不得新增或修改符號連結');
  return {record,pluginDir,after,changes,workDir};
}
function validateResult(result,record){
  if(!object(result)||!CONCLUSIONS.includes(result.conclusion)||!Array.isArray(result.implemented)||!Array.isArray(result.limitations)||[...result.implemented,...result.limitations].some(value=>typeof value!=='string'||!value.trim()))throw fail('補寫結果格式不正確','REWRITE_RESULT_INVALID');
  if(result.conclusion==='done'&&!result.implemented.length)throw fail('done 必須列出實作行為','REWRITE_RESULT_INVALID');
  const servers=result.mcpServers??{};if(!object(servers))throw fail('mcpServers 必須是物件');
  for(const [name,server]of Object.entries(servers)){
    if(!record.allowedMcpServers.includes(name))throw fail('MCP 服務名稱未列入白名單：'+name,'REWRITE_MCP_NOT_ALLOWED');
    if(!object(server)||!((typeof server.command==='string'&&server.command.trim())||(typeof server.url==='string'&&server.url.trim()))||server.command&&server.url)throw fail('MCP 服務設定缺少單一 command 或 url：'+name);
    if(server.args!==undefined&&(!Array.isArray(server.args)||server.args.some(arg=>typeof arg!=='string')))throw fail('MCP args 必須是字串陣列');
    if(server.url){let url;try{url=new URL(server.url);}catch{throw fail('MCP url 格式不正確');}if(!['http:','https:'].includes(url.protocol))throw fail('MCP url 必須是 HTTP(S)');}
    for(const value of [server.command,...(server.args??[])])if(typeof value==='string'&&value.startsWith('./')&&!inside('/package',path.resolve('/package',value)))throw fail('MCP 相對路徑超出插件');
    if(server.cwd!==undefined&&server.cwd!=='.')throw fail('補寫 MCP 的 cwd 必須是插件根目錄 .');
  }
  return servers;
}

/** Static scan and integrity checks only. Caller retains both returned hashes in
 * its signed review context before asking for installation approval. */
export async function scanRewriteResources(pluginDir,{scanDir}={}){
  if(!scanDir)throw fail('需要補寫掃描資料夾');await fs.mkdir(scanDir,{recursive:true});
  for(const relative of WRITABLE){const from=path.join(pluginDir,relative);if(await exists(from)){const target=path.join(scanDir,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.cp(from,target,{recursive:true,dereference:false});}}
  const result=await readJson(path.join(pluginDir,RESULT_FILE));
  if(Object.keys(result.mcpServers??{}).length)await writeJson(path.join(scanDir,'.mcp.json'),{mcpServers:result.mcpServers});
  return scanSecurity(scanDir);
}

export async function finishRewrite(workDir,{expectedPreparationHash}={}){
  const state=await boundPreparation(workDir,expectedPreparationHash),{record,pluginDir}=state;
  const result=await readJson(path.join(pluginDir,RESULT_FILE)),servers=validateResult(result,record);
  const validation=await validateCodexPackage(pluginDir);if(!validation.valid)throw fail('補寫預覽結構無效：'+validation.errors.join('；'),'REWRITE_PACKAGE_INVALID');
  const scan=await scanRewriteResources(pluginDir,{scanDir:path.join(state.workDir,'scan-input-'+crypto.randomUUID())}),scanDir=path.join(state.workDir,'scan');await fs.mkdir(scanDir,{recursive:true});
  const scanPath=path.join(scanDir,'security-report.json');await writeJson(scanPath,scan);
  const current=await boundPreparation(workDir,expectedPreparationHash);
  if(inventoryHash(current.after)!==inventoryHash(state.after))throw fail('掃描期間補寫產物已變更');
  const artifactHash=inventoryHash(state.after),abilitySummary={categories:[...new Set(scan.findings.map(row=>row.category))],postingTools:scan.postingTools.map(row=>row.name),mcpServers:Object.keys(servers),hookResourcesOnly:state.changes.some(name=>name.startsWith('hooks/rewrite/')),scanSummary:scan.summary};
  const sealed={schemaVersion:1,sourceHash:record.sourceHash,preparationHash:expectedPreparationHash,artifactHash,changes:state.changes,result,abilitySummary,scanPath,
    sourceExecuted:false,rewrittenCodeExecuted:false,startedModel:false,modelCalls:0,installed:false,wired:false,validation};
  const reportPath=path.join(state.workDir,'補寫檢查.json');await writeJson(reportPath,sealed);
  return {...sealed,workDir:state.workDir,pluginDir,scan,reportPath,resultPath:path.join(pluginDir,RESULT_FILE)};
}

/** Copy only reviewed rewrite resources into an uninstalled generated package.
 * This never installs/starts MCP. The caller must secure/review/install the final
 * package using its normal path after this returns. */
export async function applyRewrite(workDir,{pluginDir,name,expectedSourceHash,expectedPreparationHash,expectedArtifactHash}={}){
  if(!pluginDir)throw fail('需要目的插件目錄');
  const state=await boundPreparation(workDir,expectedPreparationHash),{record}=state;
  bound(record.sourceHash,expectedSourceHash,'核准來源');bound(inventoryHash(state.after),expectedArtifactHash,'已審查補寫產物');
  const result=await readJson(path.join(state.pluginDir,RESULT_FILE)),servers=validateResult(result,record);
  if(result.conclusion==='codex-cannot'||!result.implemented.length)return {wired:false,sourceHash:record.sourceHash,artifactHash:expectedArtifactHash,result,installed:false,sourceExecuted:false,rewrittenCodeExecuted:false};
  pluginDir=path.resolve(pluginDir);
  if(inside(state.workDir,pluginDir)||inside(pluginDir,state.workDir)||inside(record.sourceRoot,pluginDir)||inside(pluginDir,record.sourceRoot))throw fail('套用目的地不可與來源或補寫工作目錄互相包含');
  await fs.mkdir(pluginDir,{recursive:true});await inventory(pluginDir);
  for(const relative of ['source','.codex-plugin/plugin.json','.mcp.json',RESULT_FILE,'補寫來源與授權.md',...WRITABLE.filter(item=>item.endsWith('/')),...state.changes])await safeWritePath(pluginDir,relative);
  const destinationSource=path.join(pluginDir,'source');
  if(await exists(destinationSource))bound(await hashRewriteSource(destinationSource),record.sourceCopyHash,'目的插件來源');
  const manifestPath=path.join(pluginDir,'.codex-plugin','plugin.json');
  let manifest=await exists(manifestPath)?await readJson(manifestPath):null;
  if(!manifest){const preview=await readJson(path.join(state.pluginDir,'.codex-plugin','plugin.json'));manifest={...preview,name:name??preview.name};}
  const mcpPath=path.join(pluginDir,'.mcp.json'),existing=await exists(mcpPath)?await readJson(mcpPath):{mcpServers:{}};
  if(!object(existing.mcpServers))throw fail('目的插件 .mcp.json 無效');
  for(const serverName of Object.keys(servers))if(Object.hasOwn(existing.mcpServers,serverName))throw fail('補寫 MCP 與既有服務同名：'+serverName,'REWRITE_MCP_COLLISION');
  for(const resource of state.changes.filter(relative=>relative!==RESULT_FILE))if(await exists(path.join(pluginDir,resource)))throw fail('補寫資源與既有目的檔案衝突：'+resource,'REWRITE_DESTINATION_COLLISION');
  // All boundary/collision checks happen before writing destination resources.
  if(!await exists(destinationSource))await fs.cp(path.join(state.workDir,'source-snapshot'),destinationSource,{recursive:true});
  for(const prefix of WRITABLE.filter(item=>item.endsWith('/'))){
    const from=path.join(state.pluginDir,prefix);if(await exists(from))await fs.cp(from,path.join(pluginDir,prefix),{recursive:true,dereference:false});
  }
  await fs.copyFile(path.join(state.pluginDir,RESULT_FILE),path.join(pluginDir,RESULT_FILE));
  const previewManifest=await readJson(path.join(state.pluginDir,'.codex-plugin','plugin.json'));
  // Preserve a converted package's chosen identity and skill registrations.
  if(!manifest.skills)manifest.skills='./skills/';
  const skillPaths=Array.isArray(manifest.skills)?manifest.skills:[manifest.skills];
  if(await exists(path.join(pluginDir,'skills','rewrite','SKILL.md'))&&!skillPaths.includes('./skills/'))manifest.skills=[...skillPaths,'./skills/rewrite/'];
  if(!await exists(path.join(pluginDir,'skills','conversion-guide','SKILL.md'))&&previewManifest.skills){
    const guide=path.join(state.pluginDir,'skills','conversion-guide');
    if(await exists(guide))await fs.cp(guide,path.join(pluginDir,'skills','conversion-guide'),{recursive:true});
  }
  if(Object.keys(servers).length){await writeJson(mcpPath,{...existing,mcpServers:{...existing.mcpServers,...servers}});manifest.mcpServers='./.mcp.json';}
  await fs.mkdir(path.dirname(manifestPath),{recursive:true});await writeJson(manifestPath,manifest);
  await fs.writeFile(path.join(pluginDir,'補寫來源與授權.md'),`此插件的補寫部分依 ${record.source.origin} 原始碼製作。\n\n${record.license.notice}\n\n來源雜湊：${record.sourceHash}\n補寫產物雜湊：${expectedArtifactHash}\n\n來源授權檔保留在 source/。本步驟只寫入未安裝的產物，沒有執行補寫程式。\n`,'utf8');
  const validation=await validateCodexPackage(pluginDir);if(!validation.valid)throw fail('套用後插件結構無效：'+validation.errors.join('；'),'REWRITE_PACKAGE_INVALID');
  bound(inventoryHash(await inventory(state.pluginDir)),expectedArtifactHash,'套用期間補寫產物');
  bound(await hashRewriteSource(record.sourceRoot),record.sourceHash,'套用期間來源');
  return {wired:true,pluginDir,sourceHash:record.sourceHash,artifactHash:expectedArtifactHash,result,validation,mcpServers:Object.keys(servers),installed:false,sourceExecuted:false,rewrittenCodeExecuted:false};
}
