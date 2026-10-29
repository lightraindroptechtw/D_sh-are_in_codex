import fs from 'node:fs/promises';
import path from 'node:path';

const npmName=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** Parse a user supplied source without executing a package or a package manager. */
export function parseDirectSource(source,{packageDir='.'}={}){
 if(typeof source!=='string'||!source.trim()||source.includes('\0'))throw Error('需要 npm 套件、公開 GitHub 網址或本機資料夾');
 source=source.trim();
 if(typeof packageDir!=='string'||packageDir.includes('\\')||packageDir.includes('\0')||path.posix.isAbsolute(packageDir)||path.win32.isAbsolute(packageDir)||packageDir.split('/').some(p=>p==='..'||p.includes(':')))throw Error('套件路徑必須位於來源之內');
 if(/^https?:\/\//i.test(source)){
  const url=new URL(source),parts=url.pathname.replace(/\/$/,'').split('/').filter(Boolean);
  const validShape=parts.length===2||(parts.length>=4&&parts[2]==='tree');
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||!validShape)throw Error('來源只接受公開 HTTPS GitHub 倉庫或 tree 網址');
  const [owner,rawRepo]=parts,repo=rawRepo.replace(/\.git$/,'');
  if(![owner,repo].every(p=>/^[A-Za-z0-9_.-]+$/.test(p)))throw Error('GitHub 倉庫名稱不合法');
  const ref=parts[2]==='tree'?decodeURIComponent(parts[3]):'HEAD';
  if(!ref||/[\x00-\x20]/.test(ref))throw Error('GitHub 分支或提交不合法');
  const inferred=parts.slice(4).map(decodeURIComponent).join('/');
  if(inferred&&packageDir==='.')return parseDirectSource(`https://github.com/${owner}/${repo}/tree/${encodeURIComponent(ref)}`,{packageDir:inferred});
  return {type:'git',url:`https://github.com/${owner}/${repo}`,owner,repo,ref,packageDir};
 }
 if(source.startsWith('npm:')||(!source.startsWith('.')&&!/[\\:]/.test(source)&&!path.isAbsolute(source))){
  const text=source.replace(/^npm:/,''),separator=text.lastIndexOf('@'),split=separator>0;
  const name=split?text.slice(0,separator):text,spec=split?text.slice(separator+1):'latest';
  if(npmName.test(name)&&spec&&!/[\s/\\?#]/.test(spec))return {type:'npm',name,spec,packageDir};
  if(source.startsWith('npm:'))throw Error('npm 套件名稱或版本不合法');
 }
 return {type:'local',path:path.resolve(source),packageDir};
}

export async function resolveDirectSource(source,{packageDir='.',readJsonUrl}={}){
 // Existing relative folders take precedence over a similarly named npm package.
 let local;
 if(typeof source==='string'&&!/^npm:|^https?:\/\//i.test(source))try{if((await fs.stat(path.resolve(source))).isDirectory())local=path.resolve(source);}catch{}
 const parsed=parseDirectSource(local??source,{packageDir});
 if(parsed.type==='local'){
  const root=await fs.realpath(parsed.path);
  if(!(await fs.stat(root)).isDirectory())throw Error('本機來源必須是資料夾');
  return {...parsed,path:root};
 }
 if(typeof readJsonUrl!=='function')throw Error('需要來源資料讀取器');
 if(parsed.type==='npm'){
  if(parsed.packageDir!=='.')throw Error('npm 套件不接受額外套件子目錄');
  const metadata=await readJsonUrl('https://registry.npmjs.org/'+encodeURIComponent(parsed.name)+'/'+encodeURIComponent(parsed.spec));
  if(metadata.name!==parsed.name)throw Error('npm 回傳的套件名稱不符');
  return {plugin:{name:parsed.name,versions:[{version:metadata.version,source:{type:'npm'}}]},version:metadata.version,pinnedSource:`npm:${parsed.name}@${metadata.version}`};
 }
 const commitResult=await readJsonUrl(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(parsed.ref)}`),commit=commitResult.sha;
 if(typeof commit!=='string'||!/^[a-f0-9]{40}$/i.test(commit))throw Error('GitHub 沒有回傳固定提交');
 const suffix=parsed.packageDir==='.'?'':parsed.packageDir.split('/').map(encodeURIComponent).join('/')+'/';
 const manifest=await readJsonUrl(`https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${commit}/${suffix}package.json`);
 return {plugin:{name:manifest.name,versions:[{version:manifest.version,source:{type:'git',url:parsed.url,commit,path:parsed.packageDir}}]},version:manifest.version,pinnedSource:`${parsed.url}/tree/${commit}`,packageDir:parsed.packageDir};
}
