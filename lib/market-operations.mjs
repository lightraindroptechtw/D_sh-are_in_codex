import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isIP} from 'node:net';
import semver from 'semver';
import os from 'node:os';
import {writeManagedPluginEnabled} from './codex-market-config.mjs';
import {acquireSource, filesIn, inside, run} from './source.mjs';
import {resolveDirectSource} from './market-direct-source.mjs';
import {validateCodexPackage} from './codex-package.mjs';
import {fetchPublicResource} from './market-catalog.mjs';
import {createSecurityReviewer} from './security-review.mjs';
import {scanSecurity,renderCCScanOverview} from './security-scan.mjs';
import {scanSecurity as scanSecurityCC} from './cc-security-scan.mjs';
import {writeSecurityReport} from './security-report.mjs';
import {secureGeneratedPackage} from './security-package.mjs';
import {preparePythonDependencies} from './python-deps.mjs';
import {createMarketDownloads} from './market-downloads.mjs';

const MARKET='dsh-community-converted';
const packageNamePattern=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const defaults={archiveBytes:40*1024*1024,expandedBytes:100*1024*1024,metadataBytes:2*1024*1024,fileCount:10000};
const digest=value=>createHash('sha256').update(value).digest('hex');
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const writeJson=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});};
async function replaceJson(file,value){const temp=file+'.'+randomUUID()+'.tmp';await writeJson(temp,value);await fs.rename(temp,file);}
function validateName(value){if(typeof value!=='string'||value.length>214||!packageNamePattern.test(value))throw new Error('插件套件名稱不合法');return value;}
function validateVersion(value){if(typeof value!=='string'||semver.valid(value)!==value)throw new Error('需要完整且固定的語義版本');return value;}
function convertedName(name){const stem=name.replace(/^@/,'').replaceAll('/','-').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,44)||'plugin';return `dsh-${stem}-${digest(name).slice(0,10)}`;}
function relativePackagePath(value='.'){
  if(typeof value!=='string'||value.includes('\\')||value.includes('\0')||path.posix.isAbsolute(value)||path.win32.isAbsolute(value)||value.split('/').some(p=>p==='..'||p.includes(':')))throw new Error('套件路徑必須位於來源之內');
  return value;
}
function publicHttps(value){
  let url;try{url=new URL(value);}catch{throw new Error('來源網址不合法');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.hash||isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||host==='localhost'||/\.(localhost|local|internal|test|invalid)$/.test(host))throw new Error('來源只接受不含帳密的公開 HTTPS 網址');
  return url;
}
export async function downloadMarketSource(url,{fetchImpl=fetchPublicResource,limit,timeoutMs=60000}){
  if(!Number.isSafeInteger(limit)||limit<=0||!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>300000)throw new Error('無效來源下載限制');
  const controller=new AbortController();let rejectTimeout,response,reader;
  const timeout=new Promise((_,reject)=>{rejectTimeout=reject;});
  const timer=setTimeout(()=>{const cause=new Error('來源下載失敗或逾時');controller.abort(cause);void reader?.cancel(cause).catch(()=>{});rejectTimeout(cause);},timeoutMs);
  const operation=async()=>{for(let redirects=0;redirects<=3;redirects++){
    publicHttps(url);
    try{response=await fetchImpl(url,{redirect:'manual',signal:controller.signal,headers:{accept:'application/json, application/octet-stream;q=0.9','accept-encoding':'identity'}});controller.signal.throwIfAborted();}catch{throw new Error('來源下載失敗或逾時');}
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await response.body?.cancel?.();
      if(!location||redirects===3)throw new Error('來源重新導向超過上限');url=new URL(location,url).href;continue;
    }
    if(!response.ok){await response.body?.cancel?.();throw new Error(`來源下載失敗（HTTP ${response.status}）`);}
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel?.();throw new Error('來源下載超過大小上限');}
    const chunks=[];let size=0;
    if(!response.body?.getReader)throw new Error('來源下載內容為空');
    reader=response.body.getReader();
    try{for(;;){controller.signal.throwIfAborted();const {done,value}=await reader.read();controller.signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('來源下載超過大小上限');}chunks.push(Buffer.from(value));}}
    finally{reader.releaseLock();reader=undefined;}
    return Buffer.concat(chunks);
  }};
  try{return await Promise.race([operation(),timeout]);}finally{clearTimeout(timer);}
}
const download=downloadMarketSource;
function verifyIntegrity(bytes,dist){
  const values=typeof dist.integrity==='string'?dist.integrity.trim().split(/\s+/):[];
  const candidates=values.map(value=>/^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/.exec(value)).filter(Boolean);
  if(candidates.length){
    const order=['sha512','sha384','sha256','sha1'];candidates.sort((a,b)=>order.indexOf(a[1])-order.indexOf(b[1]));
    const algorithm=candidates[0][1],actual=createHash(algorithm).update(bytes).digest();
    if(!candidates.filter(c=>c[1]===algorithm).some(c=>{const expected=Buffer.from(c[2],'base64');return expected.length===actual.length&&timingSafeEqual(actual,expected);}))throw new Error('來源壓縮包完整性校驗失敗');
    return `${algorithm}-${actual.toString('base64')}`;
  }
  if(typeof dist.shasum==='string'&&/^[a-f0-9]{40}$/i.test(dist.shasum)&&createHash('sha1').update(bytes).digest('hex')===dist.shasum.toLowerCase())return `sha1-${Buffer.from(dist.shasum,'hex').toString('base64')}`;
  throw new Error('來源缺少有效的完整性雜湊或校驗失敗');
}
function tarText(buffer){return buffer.subarray(0,buffer.indexOf(0)<0?buffer.length:buffer.indexOf(0)).toString('utf8');}
function tarNumber(buffer){const raw=tarText(buffer).trim();if(!/^[0-7]*$/.test(raw))throw new Error('不支援壓縮包數值格式');return raw?Number.parseInt(raw,8):0;}
function paxFields(buffer){
  const fields={};let cursor=0;
  while(cursor<buffer.length){const space=buffer.indexOf(32,cursor);if(space<0)throw new Error('PAX 壓縮包格式錯誤');const lengthText=buffer.subarray(cursor,space).toString();if(!/^[1-9]\d*$/.test(lengthText))throw new Error('PAX 壓縮包格式錯誤');const length=Number(lengthText),end=cursor+length;if(!Number.isSafeInteger(length)||end>buffer.length||end<=space+2||buffer[end-1]!==10)throw new Error('PAX 壓縮包格式錯誤');const record=buffer.subarray(space+1,end-1).toString('utf8'),equals=record.indexOf('=');if(equals<1)throw new Error('PAX 壓縮包格式錯誤');fields[record.slice(0,equals)]=record.slice(equals+1);cursor=end;}
  if(Object.keys(fields).some(key=>/linkpath|sparse|realsize/i.test(key)))throw new Error('不接受壓縮包連結或稀疏檔案');
  return fields;
}
function archivePath(value,stripRoot){
  if(typeof value!=='string'||value.includes('\\')||/[\x00-\x1f]/.test(value)||!value.startsWith(stripRoot+'/')||path.win32.isAbsolute(value))throw new Error('壓縮包路徑不安全');
  const pieces=value.slice(stripRoot.length+1).replace(/\/$/,'').split('/');
  if(pieces.length===1&&pieces[0]==='')return '';
  if(pieces.some(part=>!part||part==='.'||part==='..'||/[<>:"|?*]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new Error('壓縮包路徑不安全');
  return pieces.join('/');
}
/** Strict npm tar reader: regular files/directories and POSIX PAX only; never links. */
export async function extractNpmArchive(bytes,destination,{expandedBytes=defaults.expandedBytes,fileCount=defaults.fileCount,stripRoot='package'}={}){
  if(!/^[a-zA-Z0-9._-]+$/.test(stripRoot)||stripRoot==='.'||stripRoot==='..')throw new Error('壓縮包根目錄不合法');
  let tar;try{tar=gunzipSync(bytes,{maxOutputLength:expandedBytes});}catch{throw new Error('來源壓縮包格式錯誤或解壓超過大小上限');}
  const entries=[],seen=new Set();let offset=0,total=0,pax={},globalPax={},terminated=false;
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(byte=>byte===0)){terminated=true;if(tar.subarray(offset).some(byte=>byte!==0))throw new Error('壓縮包結尾包含非零資料');break;}
    const checksum=tarNumber(header.subarray(148,156));let sum=0;for(let i=0;i<512;i++)sum+=(i>=148&&i<156)?32:header[i];if(sum!==checksum)throw new Error('壓縮包標頭校驗失敗');
    const type=String.fromCharCode(header[156]||48),headerSize=tarNumber(header.subarray(124,136));
    let size=headerSize;
    if(!['x','g'].includes(type)&&({...globalPax,...pax}).size!==undefined){const raw=({...globalPax,...pax}).size;if(!/^\d+$/.test(raw))throw new Error('PAX 檔案大小不合法');size=Number(raw);}
    if(!Number.isSafeInteger(size)||size<0||offset+size>tar.length)throw new Error('壓縮包檔案大小不合法');
    const content=tar.subarray(offset,offset+size);offset+=Math.ceil(size/512)*512;
    if(offset>tar.length)throw new Error('來源壓縮包不完整');
    if(type==='x'||type==='g'){const fields=paxFields(content);if(type==='g'){if(fields.path!==undefined||fields.size!==undefined)throw new Error('不支援全域 PAX 路徑或大小');globalPax={...globalPax,...fields};}else pax={...pax,...fields};continue;}
    if(!['0','5'].includes(type)||tarText(header.subarray(157,257)))throw new Error('不接受壓縮包符號連結、硬連結或特殊檔案');
    const metadata={...globalPax,...pax};pax={};
    const prefix=tarText(header.subarray(345,500)),name=metadata.path??(prefix?prefix+'/':'')+tarText(header.subarray(0,100));
    const relative=archivePath(name,stripRoot);if(!relative){if(type!=='5')throw new Error('壓縮包根目錄不是資料夾');continue;}
    const key=relative.toLowerCase();if(seen.has(key))throw new Error('壓縮包包含重複路徑');seen.add(key);
    total+=size;if(total>expandedBytes||entries.length>=fileCount)throw new Error('來源解壓超過大小或檔案數上限');
    if(type==='5'&&size!==0)throw new Error('壓縮包資料夾內容不合法');entries.push({relative,directory:type==='5',content,executable:Boolean(tarNumber(header.subarray(100,108))&0o111)});
  }
  if(!terminated||Object.keys(pax).length)throw new Error('來源壓縮包缺少完整結尾');
  // Validate the entire archive before creating any source file.
  await fs.mkdir(destination,{recursive:false});
  for(const entry of entries){const target=path.join(destination,...entry.relative.split('/'));if(!inside(destination,target))throw new Error('壓縮包路徑超出來源');if(entry.directory)await fs.mkdir(target,{recursive:true});else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.content,{flag:'wx',mode:entry.executable?0o755:0o644});}}
  return {files:entries.filter(e=>!e.directory).length,bytes:total};
}

async function acquireNpm(plugin,selected,{sourcesRoot,fetchImpl,limits}){
  const registry=publicHttps(selected.source.registry??'https://registry.npmjs.org/');
  if(registry.search)throw new Error('npm registry 網址不可包含查詢參數');
  registry.pathname=registry.pathname.replace(/\/?$/,'/');
  const metadataUrl=new URL(encodeURIComponent(plugin.name)+'/'+encodeURIComponent(selected.version),registry).href;
  let metadata;try{metadata=JSON.parse((await download(metadataUrl,{fetchImpl,limit:limits.metadataBytes})).toString('utf8'));}catch(error){if(error instanceof SyntaxError)throw new Error('npm 版本資料格式錯誤');throw error;}
  if(metadata.name!==plugin.name||metadata.version!==selected.version)throw new Error('npm 回傳的套件名稱或版本不符');
  if(typeof metadata.dist?.tarball!=='string')throw new Error('npm 版本沒有來源壓縮包');
  const bytes=await download(metadata.dist.tarball,{fetchImpl,limit:limits.archiveBytes});
  const integrity=verifyIntegrity(bytes,metadata.dist),sourceRoot=path.join(sourcesRoot,randomUUID());
  await extractNpmArchive(bytes,sourceRoot,limits);
  const manifest=await readJson(path.join(sourceRoot,'package.json'));
  if(manifest.name!==plugin.name||manifest.version!==selected.version)throw new Error('來源壓縮包的套件名稱或版本不符');
  return {root:sourceRoot,packageDir:'.',provenance:{type:'npm',registry:registry.href,version:selected.version,integrity,archiveSha256:digest(bytes)}};
}
async function packageDirectory(root,relative){const result=await fs.realpath(path.resolve(root,relative));if(!inside(await fs.realpath(root),result))throw new Error('套件路徑超出來源');return result;}
async function assertManagedPath(root,file){const actualRoot=await fs.realpath(root),actual=await fs.realpath(file);if(!inside(actualRoot,actual))throw new Error('產物路徑超出市場資料夾');return actual;}
function toolsFrom(report){return (report.capabilities?.toolRuntime?.tools??[]).map(tool=>({name:tool.name,description:tool.description??''}));}
/** Hash every artifact entry, including executable modes and internal npm .bin links. */
async function packageDigest(root){
  const hash=createHash('sha256');root=await fs.realpath(root);
  async function visit(directory){
    const entries=await fs.readdir(directory,{withFileTypes:true});entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    for(const entry of entries){
      const absolute=path.join(directory,entry.name),relative=path.relative(root,absolute).split(path.sep).join('/');
      if(relative==='.market-prepared.json')continue;
      const stat=await fs.lstat(absolute);
      if(stat.isSymbolicLink()){
        // npm creates internal executable links on POSIX. Record the link itself,
        // and refuse links that expose files outside this reviewed artifact.
        await assertManagedPath(root,absolute);
        hash.update(JSON.stringify(['link',relative,await fs.readlink(absolute)])+'\n');
      }else if(stat.isDirectory()){
        hash.update(JSON.stringify(['directory',relative,stat.mode&0o777])+'\n');await visit(absolute);
      }else if(stat.isFile()){
        hash.update(JSON.stringify(['file',relative,stat.mode&0o777,stat.size,digest(await fs.readFile(absolute))])+'\n');
      }else throw new Error('轉換產物包含不支援的特殊檔案');
    }
  }
  await visit(root);return hash.digest('hex');
}

/** No source module is initialized by preparation or installation. */
export async function createMarketOperations({dataRoot,converterRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),codexCommand=process.env.CODEX_BIN||'codex',codexHome,convertImpl,runImpl=run,acquireImpl,fetchImpl=fetchPublicResource,limits:customLimits={},installDependencies=true,reviewer,sandboxImpl=secureGeneratedPackage,python,pythonDependenciesImpl=preparePythonDependencies,pluginEnabledWriter=writeManagedPluginEnabled}={}){
  if(typeof dataRoot!=='string'||!dataRoot)throw new Error('需要市場資料資料夾');
  dataRoot=path.resolve(dataRoot);await fs.mkdir(dataRoot,{recursive:true});dataRoot=await fs.realpath(dataRoot);
  const limits={...defaults,...customLimits};for(const value of Object.values(limits))if(!Number.isSafeInteger(value)||value<=0)throw new Error('來源大小限制必須是正整數');
  const packagesRoot=path.join(dataRoot,'packages'),sourcesRoot=path.join(dataRoot,'sources'),statesRoot=path.join(dataRoot,'states');
  for(const dir of [packagesRoot,sourcesRoot,statesRoot]){await fs.mkdir(dir,{recursive:true});await assertManagedPath(dataRoot,dir);}
  reviewer??=await createSecurityReviewer({dataRoot,codexHome,codexCommand});
  const receiptKeyFile=path.join(dataRoot,'local-market-receipt-key');
  try{await fs.writeFile(receiptKeyFile,randomBytes(32),{flag:'wx',mode:0o600});}catch(cause){if(cause.code!=='EEXIST')throw cause;}
  const receiptKey=await fs.readFile(receiptKeyFile);if(receiptKey.length!==32)throw new Error('市場完整性簽章金鑰無效');
  const signReceipt=value=>createHmac('sha256',receiptKey).update(JSON.stringify(value)).digest('hex');
  async function saveSigned(file,record){await writeJson(file,{...record,signature:signReceipt(record)});}
  async function readSigned(file){const value=await readJson(file),{signature,...record}=value,expected=signReceipt(record);if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error('持久紀錄已變更或簽章無效');return record;}

  const marketplaceFile=path.join(dataRoot,'.agents','plugins','marketplace.json'),installedFile=path.join(dataRoot,'installed.json');
  let installQueue=Promise.resolve();
  async function installed(){try{const data=await readJson(installedFile);if(!Array.isArray(data))throw new Error('已安裝紀錄格式錯誤');return data;}catch(error){if(error.code==='ENOENT')return [];throw error;}}
  const downloadedSources=createMarketDownloads({dataRoot,sourcesRoot,saveSigned,readSigned,sourceDigest:packageDigest,installed});
  const downloads=()=>downloadedSources.list();
  const deleteDownloaded=name=>marketMutation(()=>downloadedSources.remove(name));
  async function reviewSettings(patch){
    if(patch===undefined){if(typeof reviewer.getSettings!=='function')throw new Error('審查設定尚未提供');return reviewer.getSettings();}
    if(typeof reviewer.updateSettings!=='function')throw new Error('審查設定尚未提供');return reviewer.updateSettings(patch);
  }
  async function downloadSource(plugin,{version,onProgress=()=>{}}={}){
    validateName(plugin?.name);validateVersion(version);
    const selected=plugin.versions?.find(item=>item.version===version);if(!selected?.source||!['npm','git'].includes(selected.source.type))throw new Error('市場沒有指定的固定版本或來源不受支援');

    await onProgress({stage:'download',message:'正在下載固定版本來源'});
    let acquired;
    if(acquireImpl)acquired=await acquireImpl(plugin,selected,{dataRoot,sourcesRoot,limits});
    else if(selected.source.type==='npm')acquired=await acquireNpm(plugin,selected,{sourcesRoot,fetchImpl,limits});
    else{
      if(typeof selected.source.commit!=='string'||!/^[a-f0-9]{40}$/i.test(selected.source.commit))throw new Error('Git 來源需要完整的 40 位提交雜湊');
      const url=publicHttps(selected.source.url),parts=url.pathname.replace(/\.git$/,'').split('/').filter(Boolean);
      if(url.hostname!=='github.com'||url.search||parts.length!==2||parts.some(p=>!/^[a-zA-Z0-9_.-]+$/.test(p)))throw new Error('Git 來源只接受固定提交的公開 GitHub 倉庫網址');
      const bytes=await download(`https://codeload.github.com/${parts[0]}/${parts[1]}/tar.gz/${selected.source.commit}`,{fetchImpl,limit:limits.archiveBytes});
      const sourceRoot=path.join(sourcesRoot,randomUUID());await extractNpmArchive(bytes,sourceRoot,{...limits,stripRoot:parts[1]+'-'+selected.source.commit});
      acquired={root:sourceRoot,packageDir:relativePackagePath(selected.source.path??plugin.repository?.directory??'.'),provenance:{type:'git',url:url.href,commit:selected.source.commit,archiveSha256:digest(bytes)}};
    }
    acquired.root=await assertManagedPath(sourcesRoot,acquired.root);
    const manifest=await readJson(path.join(await packageDirectory(acquired.root,relativePackagePath(acquired.packageDir??'.')),'package.json'));
    if(manifest.name!==plugin.name||manifest.version!==version)throw new Error('來源套件名稱或版本與市場不符');
    const result={...acquired,path:acquired.root,packageName:manifest.name,version:manifest.version};
    await downloadedSources.record({plugin,acquired:result});
    return result;
  }
  async function scan(plugin,options={}){
    const acquired=await downloadSource(plugin,options),scan=await scanSecurityCC(acquired.root,{packageDir:acquired.packageDir??'.'});
    const reportPath=path.join(dataRoot,'scans',randomUUID()+'.json');await writeJson(reportPath,scan);
    return {...acquired,scan,reportPath};
  }
  async function openFolder(target){const folder=await assertManagedPath(dataRoot,target);if(!(await fs.stat(folder)).isDirectory())throw new Error('目標不是資料夾');const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';const result=await runImpl(command,[folder],{cwd:dataRoot,timeout:10000});if(result.code!==0)throw new Error('無法開啟資料夾');return {path:folder};}
  async function review(plugin,{version,onProgress=()=>{},skipAI=true,reviewId,aiScope='auto',reviewSettings:settings}={},providedAcquired){
    validateName(plugin?.name);validateVersion(version);
    if(!['auto','code','all','none'].includes(aiScope))throw new Error('不支援的 AI 審查範圍');
    const selected=plugin.versions?.find(item=>item.version===version);if(!selected?.source)throw new Error('市場沒有指定的固定版本');
    if(!['npm','git'].includes(selected.source.type)&&!(providedAcquired&&selected.source.type==='local'))throw new Error('不支援此來源類型');
    let acquired;
    if(reviewId!==undefined){
      if(typeof reviewId!=='string'||!/^[a-f0-9-]{36}$/.test(reviewId))throw new Error('無效來源掃描識別');
      const previous=await readSigned(path.join(dataRoot,'reviewed-sources',reviewId+'.json'));
      if(previous.packageName!==plugin.name||previous.version!==version)throw new Error('所選套件版本與掃描來源不符');
      acquired=previous.acquired;await assertManagedPath(sourcesRoot,acquired.root);await reviewer.verify(acquired.root,previous.sourceReview);
      await onProgress({stage:'review',message:'重用已下載且完整性核對相符的來源，套用你選擇的審查範圍'});
    }else acquired=providedAcquired??await downloadSource(plugin,{version,onProgress});
    acquired.root=await assertManagedPath(sourcesRoot,acquired.root);
    const packageDir=relativePackagePath(acquired.packageDir??'.'),sourcePackage=await packageDirectory(acquired.root,packageDir);
    const sourceManifest=await readJson(path.join(sourcePackage,'package.json'));
    if(sourceManifest.name!==plugin.name||sourceManifest.version!==version)throw new Error('來源套件名稱或版本與市場不符');
    await onProgress({stage:'review',message:'正在依固定規則掃描來源；AI 僅複查標出位置，無法使用時可略過'});
    const sourceReview=await reviewer.review(acquired.root,{onProgress,skipAI,aiScope,reviewSettings:settings});
    await reviewer.verify(acquired.root,sourceReview);
    const scan=sourceReview.scan??await scanSecurity(acquired.root),reused=reviewId!==undefined;
    reviewId??=randomUUID();
    const context={reviewId,packageName:plugin.name,version,status:'reviewed',plugin,acquired,packageDir,sourceManifest,sourceReview,scan};
    const contextFile=path.join(dataRoot,'reviewed-sources',reviewId+'.json');
    if(reused)await replaceJson(contextFile,{...context,signature:signReceipt(context)});else await saveSigned(contextFile,context);
    return {reviewId,packageName:plugin.name,version,status:'reviewed',path:acquired.root,sourceReview,scan,source:acquired.provenance??null};
  }
  async function reviewSource({source,packageDir='.',aiScope='auto',onProgress=()=>{}}={}){
    if(!['auto','code','all','none'].includes(aiScope))throw Error('不支援的 AI 審查範圍');
    const resolved=await resolveDirectSource(source,{packageDir,readJsonUrl:async url=>JSON.parse((await download(url,{fetchImpl,limit:limits.metadataBytes})).toString('utf8'))});
    let {plugin,version}=resolved,acquired;
    if(resolved.type==='local'){
      await onProgress({stage:'download',message:'正在建立本機來源的固定副本；不執行來源程式'});
      const files=(await filesIn(resolved.path,{limit:limits.fileCount})).filter(file=>!inside(dataRoot,file));
      const destination=path.join(sourcesRoot,randomUUID());await fs.mkdir(destination);
      let bytes=0;
      for(const file of files){const content=await fs.readFile(file);bytes+=content.length;if(bytes>limits.expandedBytes)throw Error('本機來源超過大小上限');const target=path.join(destination,path.relative(resolved.path,file));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});}
      const manifest=await readJson(path.join(await packageDirectory(destination,resolved.packageDir),'package.json'));
      version=validateVersion(manifest.version);validateName(manifest.name);
      plugin={name:manifest.name,versions:[{version,source:{type:'local',path:resolved.path}}]};
      acquired={root:destination,packageDir:resolved.packageDir,provenance:{type:'local',origin:resolved.path,version}};
    }
    validateName(plugin.name);validateVersion(version);
    const result=await review(plugin,{version,onProgress,skipAI:true,aiScope},acquired);
    const ccScan=await scanSecurityCC(result.path,{packageDir:acquired?.packageDir??resolved.packageDir??'.'});
    const reportPath=path.join(dataRoot,'scans',result.reviewId+'.json');await writeJson(reportPath,ccScan);
    const markdown=renderCCScanOverview(ccScan,{source:{origin:resolved.pinnedSource??resolved.path??source,root:result.path,remote:resolved.type!=='local'},reportPath});
    const markdownPath=path.join(dataRoot,'scans',result.reviewId+'.md');await fs.writeFile(markdownPath,markdown,{flag:'wx'});
    return {...result,ccScan,reportPath,markdown,markdownPath,pinnedSource:resolved.pinnedSource??`local-snapshot:${result.reviewId}`,packageDir:acquired?.packageDir??resolved.packageDir??'.',startedModel:false,converted:false,installed:false};
  }
  async function installReviewed({reviewId,consent,forceObfuscated=false,rewriteId,onProgress=()=>{}}={}){
    if(consent!==true)throw Error('請先查看掃描與審查結果並明確同意安裝');
    if(typeof reviewId!=='string'||!/^[a-f0-9-]{36}$/.test(reviewId))throw Error('無效來源掃描識別');
    const context=await readSigned(path.join(dataRoot,'reviewed-sources',reviewId+'.json'));
    if(!context.plugin)throw Error('此紀錄沒有固定來源資訊，請重新掃描');
    const prepared=await prepare(context.plugin,{version:context.version,reviewId,consent:true,forceObfuscated,rewriteId,onProgress});
    if(prepared.status==='unsupported')return {installed:false,reviewId,version:context.version,status:'unsupported',packageRoot:prepared.packageRoot,components:prepared.components,omitted:prepared.omitted,sourceToolCount:prepared.sourceToolCount,toolsVerified:false,preparationNotices:prepared.preparationNotices};
    const result=await install(prepared,{onProgress});
    return {...result,reviewId,status:prepared.status,components:prepared.components,omitted:prepared.omitted,sourceToolCount:prepared.sourceToolCount,toolsVerified:false,preparationNotices:prepared.preparationNotices,notice:'安裝與功能驗證分開：已登記安裝，尚未初始化或逐項呼叫第三方工具。'};
  }
  async function completeConversationReview({reviewId,judgment}={}){
    if(typeof reviewId!=='string'||!/^[a-f0-9-]{36}$/.test(reviewId))throw new Error('無效來源掃描識別');
    const file=path.join(dataRoot,'reviewed-sources',reviewId+'.json'),context=await readSigned(file);
    await assertManagedPath(sourcesRoot,context.acquired.root);await reviewer.verify(context.acquired.root,context.sourceReview);
    if(typeof reviewer.completeConversationReview!=='function')throw new Error('目前尚未提供主對話審查提交');
    const sourceReview=await reviewer.completeConversationReview(context.acquired.root,context.sourceReview,judgment);
    await reviewer.verify(context.acquired.root,sourceReview);const updated={...context,sourceReview};
    await replaceJson(file,{...updated,signature:signReceipt(updated)});
    return {reviewId,packageName:context.packageName,version:context.version,status:'reviewed',path:context.acquired.root,sourceReview,scan:context.scan,source:context.acquired.provenance??null};
  }
  async function rewriteRecord(rewriteId){
    if(typeof rewriteId!=='string'||!/^[a-f0-9-]{36}$/.test(rewriteId))throw Error('無效補寫識別');
    const record=await readSigned(path.join(dataRoot,'rewrite-records',rewriteId+'.json'));
    await assertManagedPath(path.join(dataRoot,'rewrites'),record.workDir);return record;
  }
  /** Prepare code for the current conversation; never start a model here. */
  async function rewrite({action='check',reviewId,rewriteId,model='current-conversation',effort='current-conversation',aiScope='auto'}={}){
    if(!['auto','code','all','none'].includes(aiScope))throw Error('不支援的 AI 審查範圍');
    const api=await import('./rewrite.mjs');
    if(action==='finish'){
      const record=await rewriteRecord(rewriteId),context=await readSigned(path.join(dataRoot,'reviewed-sources',record.reviewId+'.json'));
      await reviewer.verify(context.acquired.root,context.sourceReview);
      if(await api.hashRewriteSource(context.acquired.root)!==record.sourceHash)throw Error('補寫來源已變更，請重新準備');
      const result=await api.finishRewrite(record.workDir,{expectedPreparationHash:record.preparationHash});
      const next={...record,artifactHash:result.artifactHash,finishedAt:new Date().toISOString()};
      await replaceJson(path.join(dataRoot,'rewrite-records',rewriteId+'.json'),{...next,signature:signReceipt(next)});
      const pluginDir=path.join(record.workDir,'plugin'),scan=result.scan;
      const {makeReviewPlan}=await import('./security-review-plan.mjs');
      const prompt=await fs.readFile(path.join(converterRoot,'data/security-review-prompt.md'),'utf8');
      const plan=makeReviewPlan(scan,{settings:await reviewer.getSettings(),aiScope,prompt,sourceDigest:result.artifactHash});
      const needsChoice=plan.aiPlan.exceedsBudget&&aiScope!=='all';
      return {action,rewriteId,reviewId:record.reviewId,sourceHash:record.sourceHash,artifactHash:result.artifactHash,
        status:aiScope==='none'?'static-only':needsChoice?'needs-choice':'awaiting-main-conversation',aiPlan:plan.aiPlan,
        ...(needsChoice||aiScope==='none'?{choices:['code','all','none']}:{untrustedSourceData:{files:plan.files}}),
        abilitySummary:result.abilitySummary,result:result.result,
        reportPath:result.reportPath??path.join(record.workDir,'scan','security-report.json'),resultPath:path.join(pluginDir,api.RESULT_FILE),
        startedModel:false,sourceExecuted:false,rewrittenCodeExecuted:false,installed:false,
        notice:'補寫尚未安裝或執行。請讓使用者看過新增功能、程式能力及未完成項目，再明確同意安裝這份補寫結果。'};
    }
    if(!['check','prepare'].includes(action))throw Error('補寫只支援 check、prepare、finish');
    if(typeof reviewId!=='string'||!/^[a-f0-9-]{36}$/.test(reviewId))throw Error('請先審查來源並提供 reviewId');
    const context=await readSigned(path.join(dataRoot,'reviewed-sources',reviewId+'.json'));
    await reviewer.verify(context.acquired.root,context.sourceReview);
    const options={packageDir:context.packageDir,cacheDir:sourcesRoot};
    const check=await api.rewriteCheck(context.acquired.root,options);
    const {capabilitySummary}=await import('./codex-capabilities.mjs');
    const capabilities=await capabilitySummary({command:codexCommand,dataRoot});
    if(action==='check')return {action,reviewId,sourceHash:check.sourceHash,targets:check.targets,license:check.license,meaningful:check.meaningful,
      modules:check.modules?.map(item=>({id:item.id,enabled:item.enabled,reason:item.reason})),capabilities,startedModel:false,sourceExecuted:false,installed:false};
    const id=randomUUID(),sourceHash=await api.hashRewriteSource(context.acquired.root),workDir=path.join(dataRoot,'rewrites',id);
    const preview=path.join(dataRoot,'rewrite-previews',id);await fs.mkdir(path.dirname(preview),{recursive:true});await fs.mkdir(path.dirname(workDir),{recursive:true});
    const convert=convertImpl??(await import(pathToFileURL(path.join(converterRoot,'lib','converter.mjs')).href)).convert;
    await convert(context.acquired.root,{outputDir:preview,cacheDir:sourcesRoot,packageDir:context.packageDir,name:convertedName(context.packageName),installDependencies:false,stateRoot:statesRoot});
    const result=await api.prepareRewrite(context.acquired.root,{...options,workDir,basePackageDir:preview,expectedSourceHash:sourceHash,capabilities,model,effort});
    const record={rewriteId:id,reviewId,workDir,sourceHash,preparationHash:result.preparationHash,model,effort};
    await saveSigned(path.join(dataRoot,'rewrite-records',id+'.json'),record);
    return {action,rewriteId:id,reviewId,workDir,sourceHash,preparationHash:result.preparationHash,taskPath:path.join(workDir,api.TASK_FILE),pluginDir:path.join(workDir,'plugin'),capabilities,
      startedModel:false,sourceExecuted:false,rewrittenCodeExecuted:false,installed:false,notice:'目前只準備補寫工作資料夾；由目前對話依任務檔實作，不另開模型。補寫完先檢查及回報，使用者同意後才安裝。'};
  }
  async function prepare(plugin,{version,onProgress=()=>{},conversionOptions={},reviewId,consent,forceObfuscated=false,rewriteId}={}){
    validateName(plugin?.name);validateVersion(version);
    if(!conversionOptions||typeof conversionOptions!=='object'||Array.isArray(conversionOptions)||Object.entries(conversionOptions).some(([key,value])=>!['lenientOutput','allowUndeclaredOutput'].includes(key)||typeof value!=='boolean'))throw new Error('輸出相容設定只接受 lenientOutput 與 allowUndeclaredOutput 布林值');
    const appliedOutputCompatibility={lenientOutput:false,allowUndeclaredOutput:false,...conversionOptions};
    // Legacy direct callers explicitly request preparation. Browser callers supply reviewId and human consent.
    if(reviewId&&consent!==true)throw new Error('請先查看掃描報告並明確同意轉換');
    if(!reviewId){const result=await review(plugin,{version,onProgress});reviewId=result.reviewId;}
    if(typeof reviewId!=='string'||!/^[a-f0-9-]{36}$/.test(reviewId))throw new Error('無效來源掃描識別');
    const context=await readSigned(path.join(dataRoot,'reviewed-sources',reviewId+'.json'));
    if(context.packageName!==plugin.name||context.version!==version)throw new Error('所選套件版本與掃描來源不符');
    const {acquired,packageDir,sourceManifest,sourceReview,scan}=context;
    await assertManagedPath(sourcesRoot,acquired.root);await reviewer.verify(acquired.root,sourceReview);
    if(scan.obfuscated&&forceObfuscated!==true)throw Object.assign(new Error('來源含混淆或不易閱讀內容，預設不轉換；使用者明確選擇強制繼續後可重試'),{code:'OBFUSCATED_SOURCE_CONFIRMATION_REQUIRED'});
    const name=convertedName(plugin.name),parent=path.join(packagesRoot,name,version);await fs.mkdir(parent,{recursive:true});await assertManagedPath(dataRoot,parent);
    const packageRoot=path.join(parent,randomUUID());
    await onProgress({stage:'convert',message:'正在轉換；此階段不初始化來源或呼叫來源模型'});
    const convert=convertImpl??(await import(pathToFileURL(path.join(converterRoot,'lib','converter.mjs')).href)).convert;
    const report=await convert(acquired.root,{outputDir:packageRoot,cacheDir:sourcesRoot,packageDir,name,homeMode:'isolated',installDependencies,stateRoot:statesRoot,moduleOptions:{agents:{allowModelCalls:true,backend:'codex-broker'},llm:{allowModelCalls:true,backend:'codex-broker'}},...appliedOutputCompatibility});
    let rewriteScan=null;
    if(rewriteId){
      const record=await rewriteRecord(rewriteId);
      if(record.reviewId!==reviewId||!record.artifactHash)throw new Error('補寫結果尚未完成，或不是這份已審查來源');
      const {applyRewrite,scanRewriteResources}=await import('./rewrite.mjs');
      const applied=await applyRewrite(record.workDir,{pluginDir:packageRoot,name,expectedSourceHash:record.sourceHash,expectedPreparationHash:record.preparationHash,expectedArtifactHash:record.artifactHash});
      report.conversion.rewrite={rewriteId,...applied,sourceExecuted:false,rewrittenCodeExecuted:false};
      if(applied.wired!==false){
        rewriteScan=await scanRewriteResources(packageRoot,{scanDir:path.join(dataRoot,'rewrite-review',randomUUID())});
        report.rewriteSecurityScan=rewriteScan;
        report.environment??={};report.environment.requestedEnvNames=[...new Set([...(report.environment.requestedEnvNames??[]),...(rewriteScan.ccScan?.environment??[]).map(item=>item.name).filter(Boolean),...(rewriteScan.ccScan?.secrets?.credentialRefs??[]).map(item=>item.name).filter(Boolean)])];
        report.conversion.components??=[];report.conversion.components.push({kind:'rewrite',name:'照原始碼補寫',status:'configured-not-executed'});
        report.conversion.status='partial';
      }
      await fs.writeFile(path.join(packageRoot,'conversion-report.json'),JSON.stringify(report,null,2)+'\n');
    }
    await assertManagedPath(packagesRoot,packageRoot);
    const preparationNotices=[];
    if(sourceReview.status==='needs-choice')preparationNotices.push('來源 AI 審查超過用量建議上限；本次只附固定規則掃描，仍可決定安裝。');
    let remainingReviewChars=sourceReview.aiPlan?.softLimitChars===undefined?undefined:Math.max(0,sourceReview.aiPlan.softLimitChars-(sourceReview.aiProgress?.sentChars??0));
    let skipAdditionalAI=sourceReview.reviewOrigin==='main-conversation'||['skipped','needs-choice','quota-paused','unavailable','rejected'].includes(sourceReview.status);
    const reviewAdditional=async(root,options)=>{
      const skipAI=skipAdditionalAI||remainingReviewChars===0;
      const receipt=await reviewer.review(root,{...options,skipAI,...(remainingReviewChars!==undefined&&!skipAI?{reviewSettings:{maxInputChars:Math.max(1,remainingReviewChars)}}:{})});
      if(remainingReviewChars!==undefined)remainingReviewChars=Math.max(0,remainingReviewChars-(receipt.aiProgress?.sentChars??0));
      if(['skipped','needs-choice','quota-paused','unavailable','rejected'].includes(receipt.status))skipAdditionalAI=true;
      if(skipAI)preparationNotices.push('本階段依照不用 AI 的選擇，或前一階段已停止／已用完建議量，只附固定規則掃描；仍可安裝。');
      return receipt;
    };
    if(report.conversion.sourceDependencies?.status==='failed')preparationNotices.push('部分依賴取得失敗；相關能力可能無法使用，請依轉換報告決定。');
    let dependencyReview=null,dependencyReviewRoot=null;
    if(report.conversion.sourceDependencies?.installed?.length){
      await onProgress({stage:'dependency-review',message:'正在整理實際取得的第三方依賴，準備交給 Codex 審查'});
      dependencyReviewRoot=path.join(dataRoot,'dependency-review',randomUUID());await fs.mkdir(dependencyReviewRoot,{recursive:true});
      await fs.cp(path.join(packageRoot,'source'),path.join(dependencyReviewRoot,'source'),{recursive:true,errorOnExist:true,force:false});
      await fs.cp(path.join(packageRoot,'runtime/source-deps'),path.join(dependencyReviewRoot,'dependencies'),{recursive:true,errorOnExist:true,force:false});
      dependencyReview=await reviewAdditional(dependencyReviewRoot,{onProgress:update=>onProgress({...update,stage:'dependency-review',message:'正在掃描實際取得的第三方依賴；與來源共用這次建議用量，不自動增加額度'})});
      if(dependencyReview.status==='needs-choice')preparationNotices.push('第三方依賴 AI 審查超過用量建議上限，未自動增加用量或分批呼叫；已附掃描與用量估計，仍可決定安裝。');
      if(dependencyReview.scan?.obfuscated&&forceObfuscated!==true)throw Object.assign(new Error('依賴含混淆內容；明確選擇強制繼續後可重試'),{code:'OBFUSCATED_SOURCE_CONFIRMATION_REQUIRED'});
      await reviewer.verify(dependencyReviewRoot,dependencyReview);
    }
    report.securityScan=rewriteScan?{...scan,postingTools:[...(scan.postingTools??[]),...(rewriteScan.postingTools??[])],findings:[...scan.findings,...rewriteScan.findings],files:[...scan.files,...rewriteScan.files],assets:[...(scan.assets??[]),...(rewriteScan.assets??[])],obfuscated:scan.obfuscated||rewriteScan.obfuscated,summary:Object.fromEntries(Object.keys({...scan.summary,...rewriteScan.summary}).map(key=>[key,(scan.summary[key]??0)+(rewriteScan.summary[key]??0)])),additionalScan:{kind:'rewrite',summary:rewriteScan.summary,ccScan:rewriteScan.ccScan}}:scan;
    await fs.writeFile(path.join(packageRoot,'security-scan.json'),JSON.stringify(report.securityScan,null,2)+'\n');
    if(rewriteScan)await fs.writeFile(path.join(packageRoot,'rewrite-security-scan.json'),JSON.stringify(rewriteScan,null,2)+'\n');
    const components=report.conversion?.components??[],omitted=report.conversion?.omitted??[];
    const pythonComponents=components.filter(item=>item.kind==='python-mcp'||item.kind==='declared-mcp'&&item.language==='python'&&item.entry);
    let pythonDependencies=null,pythonDependencyReview=null,pythonDependencyDigest=null,pythonRuntime;
    if(pythonComponents.length){
      try{
        if(!installDependencies&&pythonComponents.some(item=>item.requirements||item.dependencyFiles?.length))throw new Error('使用者略過依賴準備');
        pythonDependencies=await pythonDependenciesImpl(packageRoot,{components:pythonComponents,python,onProgress});
      }catch(cause){
        if(cause.code==='SECURITY_INTEGRITY_FAILED')throw cause;
        const notice='Python 依賴準備未完成；依賴 Python 的功能尚未驗證，可能不可用；其他工具仍可保留。';
        preparationNotices.push(notice);report.conversion.pythonDependencies={status:'unavailable',notice,sourceBuildExecuted:false};
        omitted.push(...pythonComponents.map(item=>({kind:'python-dependency',entry:item.entry,requirements:item.requirements??null,code:'PYTHON_DEPENDENCIES_UNAVAILABLE',message:notice})));
        report.conversion.status=components.length?'partial':'unsupported';
      }
      if(pythonDependencies){
      const pythonRoot=await assertManagedPath(packageRoot,pythonDependencies.reviewRoot),textRoot=await assertManagedPath(pythonRoot,pythonDependencies.textReviewRoot);
      pythonDependencyDigest=await packageDigest(pythonRoot);
      await onProgress({stage:'python-dependency-review',message:'正在掃描 Python 依賴；AI 僅複查標出位置，發行檔與二進位內容以固定雜湊綁定且未逐行審查'});
      pythonDependencyReview=await reviewAdditional(textRoot,{onProgress:update=>onProgress({...update,stage:'python-dependency-review'})});
      if(pythonDependencyReview.status==='needs-choice')preparationNotices.push('Python 依賴 AI 審查超過用量建議上限，未自動增加用量或分批呼叫；已附掃描與用量估計，仍可決定安裝。');
      if(pythonDependencyReview.scan?.obfuscated&&forceObfuscated!==true)throw Object.assign(new Error('Python 依賴含混淆內容；明確選擇強制繼續後可重試'),{code:'OBFUSCATED_SOURCE_CONFIRMATION_REQUIRED'});
      await reviewer.verify(textRoot,pythonDependencyReview);
      if(pythonDependencyDigest!==await packageDigest(pythonRoot))throw new Error('Python 依賴在審查期間已變更，須重新準備');
      pythonRuntime={command:pythonDependencies.pythonExecutable,pythonPaths:pythonDependencies.pythonPaths};
      report.conversion.pythonDependencies={status:'reviewed',requirements:pythonDependencies.requirements,artifacts:pythonDependencies.artifacts,staticSources:pythonDependencies.staticSources??[],textFiles:pythonDependencies.textFiles,binaryFiles:pythonDependencies.binaryFiles,sourceBuildExecuted:false,binaryReview:pythonDependencies.binaryReview,artifactDigest:pythonDependencyDigest};
      const settingsFile=path.join(packageRoot,'runtime/settings.json');
      try{const settings=await readJson(settingsFile);settings.pythonRuntime=pythonRuntime;await fs.writeFile(settingsFile,JSON.stringify(settings,null,2)+'\n');}catch(cause){if(cause.code!=='ENOENT')throw cause;}
      }
      await fs.writeFile(path.join(packageRoot,'conversion-report.json'),JSON.stringify(report,null,2)+'\n');
    }
    let status=report.conversion?.status==='converted'?'ready':report.conversion?.status==='partial'?'partial':'unsupported';
    let manifestHash=null;
    if(status!=='unsupported'&&components.length){
      const manifestFile=path.join(packageRoot,'.codex-plugin','plugin.json');await assertManagedPath(packageRoot,manifestFile);
      const manifest=await readJson(manifestFile);if(manifest.name!==name)throw new Error('轉換產物名稱不符');
      manifest.version=version;await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
      await onProgress({stage:'sandbox',message:'正在設定並檢查執行限制'});
      var sandbox;try{sandbox=await sandboxImpl(packageRoot,{stateDir:path.join(statesRoot,name),report,onProgress,codexHome,dataRoot,converterRoot,pythonRuntime});}catch(cause){if(cause.code==='SECURITY_INTEGRITY_FAILED')throw cause;sandbox={enforced:false,notice:'執行限制檢查未完成，請依報告決定是否安裝。'};}
      if(sandbox.enforced!==true)preparationNotices.push('執行限制未完整生效；不作為安裝硬性門檻，由使用者決定。');
      const validation=await validateCodexPackage(packageRoot);if(!validation.valid)throw new Error('轉換產物結構驗證失敗');
      manifestHash=digest(await fs.readFile(manifestFile));
    }else status='unsupported';
    const sourceTools=toolsFrom(report);
    const security={sourceReview,dependencyReview,dependencyStatus:report.conversion.sourceDependencies?.status??'unknown',pythonDependencyReview,pythonDependencyStatus:pythonDependencies?'reviewed':pythonComponents.length?'unavailable':'not-needed',pythonDependencyDigest,pythonArtifacts:pythonDependencies?.artifacts??[],pythonBinaryReview:pythonDependencies?.binaryReview??null,sandbox:sandbox??null};
    const selectedSource=plugin.versions?.find(item=>item.version===version)?.source;
    const marketSource={origin:acquired.provenance?.type==='local'?acquired.provenance.origin:acquired.provenance?.type==='git'?acquired.provenance.url:selectedSource?.type==='git'?selectedSource.url:`npm:${plugin.name}`,name:plugin.name,version,commit:acquired.provenance?.commit??selectedSource?.commit??null,packageDir:acquired.packageDir??selectedSource?.path??'.'};
    const prepared={reviewId,consent:true,forceObfuscated,preparationNotices,packageName:plugin.name,catalogName:plugin.catalogName??plugin.name,version,status,components,omitted,sourceTools,sourceToolCount:sourceTools.length,license:report.license??sourceManifest.license??null,packageRoot,manifestName:name,source:acquired.provenance??null,marketSource,appliedOutputCompatibility,security,report};
    await fs.writeFile(path.join(packageRoot,'conversion-report.json'),JSON.stringify(report,null,2)+'\n');
    await writeSecurityReport(packageRoot,{report,scan:report.securityScan,sourceReview,notices:preparationNotices});
    const preparedDigest=await packageDigest(packageRoot);
    const approvalRecord={prepared:structuredClone(prepared),sourceRoot:acquired.root,sourceReview,dependencyReviewRoot,dependencyReview,pythonDependencyReview,pythonTextRoot:pythonDependencies?.textReviewRoot??null,pythonReviewRoot:pythonDependencies?.reviewRoot??null,pythonDependencyDigest,digest:preparedDigest};
    await saveSigned(path.join(packageRoot,'.market-prepared.json'),{schemaVersion:3,...prepared,manifestHash,packageDigest:preparedDigest,approval:approvalRecord});
    await onProgress({stage:'prepared',message:status==='unsupported'?'此版本沒有可安裝的保留能力':'轉換完成，可檢查後安裝'});
    return prepared;
  }
  async function doInstall(prepared,{onProgress=()=>{}}={}){
    await onProgress({stage:'install-check',message:'正在重新核對審查紀錄與安裝內容是否相符'});
    if(!prepared||typeof prepared.packageRoot!=='string')throw new Error('需要完成轉換的產物');
    const packageRoot=await assertManagedPath(packagesRoot,prepared.packageRoot),diskReceipt=await readSigned(path.join(packageRoot,'.market-prepared.json')),approval=diskReceipt.approval;
    if(diskReceipt.schemaVersion!==3||!approval||approval.prepared.packageRoot!==packageRoot)throw new Error('持久安裝紀錄無效，請重新準備');
    await reviewer.verify(approval.sourceRoot,approval.sourceReview);
    if(approval.dependencyReview)await reviewer.verify(approval.dependencyReviewRoot,approval.dependencyReview);
    if(approval.pythonDependencyReview){await reviewer.verify(approval.pythonTextRoot,approval.pythonDependencyReview);if(approval.pythonDependencyDigest!==await packageDigest(approval.pythonReviewRoot))throw new Error('Python 依賴檔案已變更，請重新準備');}
    const receipt=approval.prepared;
    validateName(receipt.packageName);validateVersion(receipt.version);
    if(!['ready','partial'].includes(receipt.status)||!receipt.components?.length)throw new Error('此產物沒有可安裝的保留能力');
    const manifestFile=path.join(packageRoot,'.codex-plugin','plugin.json');await assertManagedPath(packageRoot,manifestFile);const manifest=await readJson(manifestFile);
    if(manifest.name!==convertedName(receipt.packageName)||manifest.version!==receipt.version)throw new Error('轉換產物已變更，請重新準備');
    if(!(await validateCodexPackage(packageRoot)).valid)throw new Error('轉換產物結構驗證失敗');
    if(diskReceipt.packageDigest!==approval.digest||approval.digest!==await packageDigest(packageRoot))throw new Error('轉換產物檔案已變更，請重新準備');
    await onProgress({stage:'install',message:'正在登記本機市集並交由 Codex 安裝'});
    let marketplace;try{marketplace=await readJson(marketplaceFile);}catch(error){if(error.code!=='ENOENT')throw error;marketplace={name:MARKET,plugins:[]};}
    if(marketplace.name!==MARKET||!Array.isArray(marketplace.plugins))throw new Error('既有市集格式或名稱不符');
    for(const entry of marketplace.plugins){if(entry.source?.source!=='local'||typeof entry.source.path!=='string'||!inside(dataRoot,path.resolve(dataRoot,entry.source.path)))throw new Error('既有市集含超出資料夾的來源');await assertManagedPath(dataRoot,path.resolve(dataRoot,entry.source.path));}
    const entry={name:manifest.name,source:{source:'local',path:'./'+path.relative(dataRoot,packageRoot).split(path.sep).join('/')},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'};
    const prior=marketplace.plugins.findIndex(item=>item.name===manifest.name);if(prior>=0)marketplace.plugins[prior]=entry;else marketplace.plugins.push(entry);
    await fs.mkdir(path.dirname(marketplaceFile),{recursive:true});await assertManagedPath(dataRoot,path.dirname(marketplaceFile));await replaceJson(marketplaceFile,marketplace);
    const env=codexHome?{CODEX_HOME:path.resolve(codexHome)}:{};
    if(codexHome)await fs.mkdir(path.resolve(codexHome),{recursive:true});
    for(const args of [['plugin','marketplace','add',dataRoot,'--json'],['plugin','add',`${manifest.name}@${MARKET}`,'--json']]){
      let result;try{result=await runImpl(codexCommand,args,{cwd:dataRoot,env,timeout:120000});}catch{throw new Error('Codex 安裝命令失敗；產物已保留，可重試');}
      if(result.code!==undefined&&result.code!==0)throw new Error('Codex 安裝命令失敗；產物已保留，可重試');
      // Some CLI versions return success via an explicit JSON field.
      if(typeof result.stdout==='string'&&result.stdout.trim()){try{const response=JSON.parse(result.stdout);if(response.success===false||response.error)throw new Error('CODEX_FAILED');}catch(error){if(error.message==='CODEX_FAILED')throw new Error('Codex 回報安裝失敗；產物已保留，可重試');}}
    }
    const pluginId=`${manifest.name}@${MARKET}`,record={installed:true,pluginId,name:receipt.packageName,manifestName:manifest.name,version:receipt.version,packageRoot,installedAt:new Date().toISOString(),message:'已安裝，請新開 Codex 聊天載入'};
    const records=await installed(),index=records.findIndex(item=>item.pluginId===pluginId);if(index<0)records.push(record);else records[index]=record;await replaceJson(installedFile,records);
    await onProgress({stage:'installed',message:record.message});return record;
  }
  function install(prepared,options){const pending=installQueue.then(()=>doInstall(prepared,options));installQueue=pending.catch(()=>{});return pending;}
  async function preparedPackages({includeInstalled=false}={}){
    const records=await installed(),items=[],notices=[];
    for(const parent of await fs.readdir(packagesRoot,{withFileTypes:true})){
      if(!parent.isDirectory()||parent.isSymbolicLink())continue;
      const directory=path.join(packagesRoot,parent.name);
      for(const child of await fs.readdir(directory,{withFileTypes:true})){
        if(!child.isDirectory()||child.isSymbolicLink())continue;
        const versionRoot=path.join(directory,child.name);
        for(const instance of await fs.readdir(versionRoot,{withFileTypes:true})){
        if(!instance.isDirectory()||instance.isSymbolicLink())continue;
        const packageRoot=path.join(versionRoot,instance.name);
        if(!includeInstalled&&records.some(record=>record.packageRoot===packageRoot))continue;
        try{await assertManagedPath(packagesRoot,packageRoot);const receipt=await readSigned(path.join(packageRoot,'.market-prepared.json'));if(receipt.schemaVersion!==3||!['ready','partial'].includes(receipt.status)||!receipt.components?.length)continue;const {approval,signature,report,...prepared}=receipt;items.push(prepared);}
        catch(cause){if(cause.code!=='ENOENT')notices.push(`待安裝內容無法恢復：${packageRoot}。原因：${cause.message}；其他項目仍可繼續。`);}
        }
      }
    }
    return {items,notices};
  }
  async function managedPackages(){
    const {items,notices}=await preparedPackages({includeInstalled:true});
    return {items:items.filter(item=>item.manifestName===convertedName(item.packageName)).map(item=>({...item,pluginId:`${item.manifestName}@${MARKET}`})),notices};
  }
  async function pluginCommand(args,{timeout=60000}={}){
    if(!Array.isArray(args)||args[0]!=='plugin')throw new Error('只接受 Codex 插件指令');
    return runImpl(codexCommand,args,{cwd:dataRoot,env:codexHome?{CODEX_HOME:path.resolve(codexHome)}:{},timeout});
  }
  function marketMutation(task){const pending=installQueue.then(task);installQueue=pending.catch(()=>{});return pending;}
  function setManagedEnabled(pluginId,enabled){return marketMutation(async()=>{
      if(typeof enabled!=='boolean'||!(await managedPackages()).items.some(item=>item.pluginId===pluginId))throw new Error('找不到具有有效簽章的受管插件');
      const home=path.resolve(codexHome??process.env.CODEX_HOME??path.join(os.homedir(),'.codex'));await fs.mkdir(home,{recursive:true});
      return pluginEnabledWriter({pluginId,enabled,codexHome:home,command:codexCommand});
    });
  }
  async function doForgetManaged(manifestName){
      const {items}=await managedPackages(),selected=items.filter(item=>item.manifestName===manifestName);
      if(!selected.length)throw new Error('找不到具有有效簽章的受管插件');
      // Resolve every target before changing any record or recursively deleting on Windows.
      const actualPackages=await fs.realpath(packagesRoot),targets=[];
      for(const item of selected){
        const lexical=path.resolve(item.packageRoot),actual=await assertManagedPath(packagesRoot,lexical);
        if(lexical===path.resolve(packagesRoot)||actual===actualPackages||!inside(packagesRoot,lexical)||path.relative(packagesRoot,lexical).split(path.sep)[0]!==manifestName)throw new Error('拒絕刪除受管產物資料夾以外的路徑');
        targets.push(actual);
      }
      let marketplace;try{marketplace=await readJson(marketplaceFile);}catch(cause){if(cause.code!=='ENOENT')throw cause;}
      if(marketplace){if(marketplace.name!==MARKET||!Array.isArray(marketplace.plugins))throw new Error('既有市集格式或名稱不符');marketplace.plugins=marketplace.plugins.filter(item=>item.name!==manifestName);await replaceJson(marketplaceFile,marketplace);}
      await replaceJson(installedFile,(await installed()).filter(item=>item.manifestName!==manifestName&&item.pluginId!==`${manifestName}@${MARKET}`));
      for(const target of targets){await assertManagedPath(packagesRoot,target);await fs.rm(target,{recursive:true,force:false});}
      return {removed:targets.length};
  }
  const forgetManaged=manifestName=>marketMutation(()=>doForgetManaged(manifestName));
  function removeManaged(manifestName){return marketMutation(async()=>{
    const item=(await managedPackages()).items.find(item=>item.manifestName===manifestName);if(!item)throw new Error('找不到具有有效簽章的受管插件');
    const list=async()=>{const result=await pluginCommand(['plugin','list','--json']);let value;try{value=JSON.parse(result.stdout);}catch{}if(result.code!==0||!Array.isArray(value?.installed))throw new Error('無法確認 Codex 的插件安裝狀態，產物與管理紀錄已保留');return value.installed;};
    if((await list()).some(row=>row.pluginId===item.pluginId&&row.installed!==false)){
      const result=await pluginCommand(['plugin','remove',item.pluginId,'--json'],{timeout:120000});let response;try{response=JSON.parse(result.stdout);}catch{}
      if(result.code!==0||response?.success===false||response?.error)throw new Error('Codex 解除安裝失敗，產物與管理紀錄已保留');
      if((await list()).some(row=>row.pluginId===item.pluginId&&row.installed!==false))throw new Error('Codex 尚未確認解除安裝，產物與管理紀錄已保留');
    }
    return doForgetManaged(manifestName);
  });}
  const capabilities=async()=>{const {capabilitySummary}=await import('./codex-capabilities.mjs');return capabilitySummary({command:codexCommand,dataRoot});};
  return {review,reviewSource,installReviewed,rewrite,capabilities,reviewSettings,prepare,install,installed,preparedPackages,managedPackages,pluginCommand,setManagedEnabled,forgetManaged,removeManaged,completeConversationReview,download:downloadSource,downloads,deleteDownloaded,scan,openFolder};
}
