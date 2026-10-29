import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareStaticSourceWheel} from './python-static-wheel.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const error=(message,code='PYTHON_DEPENDENCIES_UNSUPPORTED')=>Object.assign(Error(message),{code});
const contained=(root,file)=>{const rel=path.relative(root,file);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
function environment(){const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[key])env[key]=process.env[key];return {...env,PYTHONUTF8:'1',PYTHONNOUSERSITE:'1',PIP_CONFIG_FILE:process.platform==='win32'?'NUL':'/dev/null'};}
export function runPythonSetup(command,args,{cwd,timeout=180000}={}){
  return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,env:environment(),windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(error('Python 依賴處理逾時','PYTHON_SETUP_TIMEOUT'));},timeout);child.once('error',cause=>{clearTimeout(timer);reject(cause);});child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>4*1024*1024)child.kill();});child.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-8192);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});
}
export async function resolveLocalPython({python,runner=runPythonSetup}={}){
  const candidates=python?[python]:['python','python3'];
  for(const command of candidates){
    try{const result=await runner(command,['-I','-c','import sys,json;print(json.dumps({"executable":sys.executable,"version":list(sys.version_info[:3])}))']);if(result.code!==0)continue;const info=JSON.parse(result.stdout.trim());if(!path.isAbsolute(info.executable)||info.version?.[0]!==3||info.version[1]<10)continue;return {command:await fs.realpath(info.executable),version:info.version};}catch{}
  }
  throw error('找不到可用的本機 Python 3.10+；不會執行來源自動下載安裝器','PYTHON_UNAVAILABLE');
}
async function requirements(packageRoot,components){
  const files=[...new Set(components.filter(c=>c.kind==='python-mcp'||c.kind==='declared-mcp'&&c.language==='python'&&c.entry).flatMap(c=>[...(c.dependencyFiles??[]),...(c.requirements?[c.requirements]:[])]))],lines=[];
  for(const relative of files){
    const file=path.resolve(packageRoot,'source',relative),source=await fs.realpath(path.join(packageRoot,'source'));
    if(!contained(source,file)||!contained(source,await fs.realpath(file)))throw error('Python requirements 超出固定來源');
    if((await fs.stat(file)).size>1024*1024)throw error('Python 依賴 metadata 檔案過大');
    const name=path.basename(file);
    if(name!=='requirements.txt')throw error('不支援的 Python 依賴 metadata 檔案');
    const input=(await fs.readFile(file,'utf8')).split(/\r?\n/);
    for(const raw of input){
      let line=raw.replace(/\s+#.*$/,'').trim();if(!line||line.startsWith('#'))continue;
      // One public-index requirement per line. Reject includes, URLs, local
      // projects, editable installs and custom indexes before invoking pip.
      if(!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_.,-]+\])?(?:\s*(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!-]+(?:\s*,\s*(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!-]+)*)?$/.test(line))throw error('Python 依賴僅接受 PyPI 套件及版本條件；不接受網址、路徑、額外索引或建置指令');
      lines.push(line);
    }
  }
  return [...new Set(lines)].sort();
}

// Trusted standard-library extraction, never imports a downloaded distribution.
const extractScript=String.raw`import sys,json,zipfile,pathlib,stat,shutil
manifest=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
dest=pathlib.Path(sys.argv[2]).resolve();dest.mkdir(parents=True,exist_ok=True)
seen=set();total=0
for artifact in manifest:
 with zipfile.ZipFile(artifact['file']) as z:
  members=z.infolist()
  if len(members)>30000:raise ValueError('too many wheel members')
  for item in members:
   name=item.filename
   if '\\' in name or name.startswith('/') or ':' in name:raise ValueError('unsafe wheel member')
   parts=pathlib.PurePosixPath(name).parts
   if '..' in parts or stat.S_ISLNK(item.external_attr>>16):raise ValueError('unsafe wheel member')
   if item.is_dir():continue
   if parts and parts[0].endswith('.data'):
    if len(parts)<3 or parts[1] not in ('purelib','platlib'):continue
    parts=parts[2:]
   target=dest.joinpath(*parts).resolve()
   if not target.is_relative_to(dest):raise ValueError('wheel escapes destination')
   key=str(target).casefold()
   if key in seen:raise ValueError('overlapping wheel files')
   seen.add(key);total+=item.file_size
   if item.file_size>100*1024*1024 or total>512*1024*1024:raise ValueError('expanded wheels too large')
   target.parent.mkdir(parents=True,exist_ok=True)
   with z.open(item) as source,target.open('xb') as output:shutil.copyfileobj(source,output)
print(json.dumps({'files':len(seen),'bytes':total}))
`;
async function textReviewCopy(source,destination){
  await fs.mkdir(destination,{recursive:true});let binaryFiles=0,textFiles=0;
  async function walk(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory()){await walk(file);continue;}const bytes=await fs.readFile(file);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{binaryFiles++;continue;}if(text.includes('\0')){binaryFiles++;continue;}const target=path.join(destination,path.relative(source,file));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);textFiles++;}}
  await walk(source);return {textFiles,binaryFiles};
}

/** Resolve wheels without executing source builds; pin every downloaded byte.
 * Returned dependency files are NOT approved: the market must review them and
 * verify the artifact digest before passing the runtime to package security. */
export async function preparePythonDependencies(packageRoot,{components=[],python,runner=runPythonSetup,fetchImpl=fetch,onProgress=()=>{},maxWheelBytes=100*1024*1024,maxTotalBytes=256*1024*1024}={}){
  const runtime=await resolveLocalPython({python,runner});
  const specs=await requirements(packageRoot,components);
  const root=path.join(path.resolve(packageRoot),'runtime','python-environment'),wheelhouse=path.join(root,'wheels'),library=path.join(root,'site-packages'),textReviewRoot=path.join(root,'text-review');
  await fs.mkdir(wheelhouse,{recursive:true});
  const requirementFile=path.join(root,'requirements.txt'),resolutionFile=path.join(root,'resolution.json');
  await fs.writeFile(requirementFile,specs.join('\n')+'\n');
  await onProgress({stage:'python-dependencies',message:'正在解析 Python 固定發行檔；不執行來源安裝或建置腳本'});
  let installations=[];const staticSources=[];
  if(specs.length){
    let resolution;
    for(let attempt=0;attempt<5;attempt++){
      resolution=await runner(runtime.command,['-I','-m','pip','--isolated','--disable-pip-version-check','install','--dry-run','--ignore-installed','--only-binary=:all:','--no-input','--index-url','https://pypi.org/simple',...(staticSources.length?['--find-links',path.join(root,'static-wheels')]:[]),'--report',resolutionFile,'-r',requirementFile],{cwd:root});
      if(resolution.code===0)break;
      const diagnostic=(resolution.stdout??'')+'\n'+(resolution.stderr??''),missing=[];
      const block=diagnostic.match(/some packages[^\n]*no matching distributions[^\n]*:\r?\n([\s\S]+?)(?:\r?\n\r?\n|$)/i)?.[1];
      if(block)for(const line of block.split(/\r?\n/)){const name=line.trim();if(/^[a-z0-9][a-z0-9._-]*$/i.test(name))missing.push(name);}
      for(const match of diagnostic.matchAll(/No matching distribution found for ([a-z0-9][a-z0-9._-]*)/ig))missing.push(match[1]);
      const next=[...new Set(missing)].filter(name=>!staticSources.some(item=>item.name.toLowerCase().replaceAll('_','-')===name.toLowerCase().replaceAll('_','-')));
      if(!next.length||staticSources.length+next.length>4)break;
      for(const name of next){await onProgress({stage:'python-dependencies',message:`${name} 沒有 wheel；正在核對固定來源包的靜態安裝資訊，不執行來源建置`});staticSources.push(await prepareStaticSourceWheel(name,{root,python:runtime.command,runner,fetchImpl}));}
    }
    if(resolution.code!==0)throw error('無法取得完整 Python wheel 依賴；未執行來源建置','PYTHON_DEPENDENCY_RESOLUTION_FAILED');
    installations=JSON.parse(await fs.readFile(resolutionFile,'utf8')).install;
    if(!Array.isArray(installations)||installations.length>150)throw error('Python 依賴解析結果不完整或過大');
  }
  const artifacts=[];let total=0;
  for(const row of installations){
    const name=row.metadata?.name,version=row.metadata?.version,source=row.download_info?.url,hash=row.download_info?.archive_info?.hashes?.sha256;
    let url;try{url=new URL(source);}catch{throw error('Python 發行檔缺少來源');}
    const staticSource=url.protocol==='file:'?staticSources.find(item=>path.resolve(item.wheel)===path.resolve(fileURLToPath(url))):null;
    if((!staticSource&&(url.protocol!=='https:'||url.hostname!=='files.pythonhosted.org'||url.username||url.password||url.search||url.hash))||!url.pathname.endsWith('.whl')||!/^\w[\w.-]*$/.test(name??'')||typeof version!=='string'||!version||!/^\w[\w.+!-]*$/.test(version)||!/^\w{64}$/.test(hash??'')||!/^[a-f0-9]+$/i.test(hash)||staticSource&&hash!==staticSource.wheelSha256)throw error('Python 依賴不是具 SHA256 的公開 PyPI wheel 或已固定的靜態封裝');
    const response=staticSource?new Response(await fs.readFile(staticSource.wheel)):await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw error('Python wheel 下載失敗');
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.length;total+=chunk.length;if(bytes>maxWheelBytes||total>maxTotalBytes)throw error('Python wheel 超過大小限制');chunks.push(chunk);}
    const content=Buffer.concat(chunks);if(sha(content)!==hash.toLowerCase())throw error('Python wheel SHA256 不符');
    const file=path.join(wheelhouse,path.posix.basename(url.pathname));await fs.writeFile(file,content,{flag:'wx'});
    artifacts.push({name,version,sha256:hash.toLowerCase(),source:staticSource?.source??url.href,...(staticSource?{sourceSha256:staticSource.sha256,method:staticSource.method}:{}),file});
  }
  const manifestFile=path.join(root,'artifacts.json');await fs.writeFile(manifestFile,JSON.stringify(artifacts,null,2)+'\n');
  const extracted=await runner(runtime.command,['-I','-c',extractScript,manifestFile,library],{cwd:root});if(extracted.code!==0)throw error('Python wheel 內容無法安全展開');
  const coverage=await textReviewCopy(library,textReviewRoot);
  for(const item of staticSources)await textReviewCopy(item.sourceRoot,path.join(textReviewRoot,'static-sources',item.name));
  const receipt={schemaVersion:1,status:'needs-review',interpreter:runtime,requirements:specs,artifacts:artifacts.map(({file,...artifact})=>({...artifact,file:path.relative(packageRoot,file).split(path.sep).join('/')})),staticSources:staticSources.map(({name,version,source,sha256,method})=>({name,version,source,sha256,method})),...coverage,sourceBuildExecuted:false,binaryReview:'distribution provenance and SHA256; binary instructions not line-reviewed'};
  await fs.writeFile(path.join(textReviewRoot,'dependency-provenance.json'),JSON.stringify(receipt,null,2)+'\n');
  await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  return {...receipt,reviewRoot:root,textReviewRoot,pythonExecutable:runtime.command,pythonPaths:[path.relative(packageRoot,library).split(path.sep).join('/')]};
}
