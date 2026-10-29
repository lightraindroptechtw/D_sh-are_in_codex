// CC market contract, backed by signed Codex conversion receipts and the real Codex inventory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import semver from 'semver';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const clip=text=>String(text??'').trim().slice(-1000);
const sameRepo=(a,b)=>String(a??'').replace(/\.git$/,'').replace(/\/+$/,'').toLowerCase()===String(b??'').replace(/\.git$/,'').replace(/\/+$/,'').toLowerCase();
export function matchEntry(source,entries){
  const npm=/^npm:(.+)$/.exec(source.origin??'');if(npm)return entries.find(entry=>entry.name===npm[1]);
  if(source.origin){const candidates=entries.filter(entry=>entry.versions.some(version=>version.source.type==='git'&&sameRepo(version.source.url,source.origin))),dir=String(source.packageDir??'').replace(/\\/g,'/').replace(/^\.\/?$/,'');
    const exact=candidates.find(entry=>entry.versions.some(version=>version.source.type==='git'&&sameRepo(version.source.url,source.origin)&&(version.source.path??'')===dir));if(exact||candidates.length)return exact??(source.packageDir==null?candidates[0]:undefined);}
  return entries.find(entry=>entry.name===source.name);
}
export function newerVersion(source,entry){
  const latest=entry.versions.find(version=>!version.floating&&version.source.type!=='release');if(!latest)return;
  if(latest.source.type==='npm')return semver.valid(source.version)&&semver.valid(latest.version)&&semver.gt(latest.version,source.version)?latest.version:undefined;
  return latest.source.commit&&source.commit&&latest.source.commit!==source.commit?latest.version:undefined;
}
const sourceOf=item=>item.marketSource??{origin:item.source?.type==='git'?item.source.url:`npm:${item.packageName}`,name:item.packageName,version:item.version,commit:item.source?.commit??null,packageDir:item.source?.packageDir??null};

export function createCCMarketInstalled({operations,dataRoot,getEntries,now=()=>Date.now()}){
  let cached,managing=false,favoriteQueue=Promise.resolve();
  async function state(){
    const managed=operations.managedPackages?await operations.managedPackages():{items:[],notices:[]};
    const downloads=operations.downloads?(await operations.downloads()).items:[];
    if(!managed.items.length)return {known:true,plugins:[],notices:managed.notices??[],downloads};
    let listed,rows;
    try{listed=await operations.pluginCommand(['plugin','list','--json']);const value=listed.code===0?JSON.parse(listed.stdout):null;rows=Array.isArray(value?.installed)?value.installed:null;}catch(cause){listed={stderr:cause.message};}
    const byId=new Map((rows??[]).filter(row=>row?.installed!==false).map(row=>[row.pluginId,row]));
    const records=operations.installed?await operations.installed():[],grouped=new Map();
    for(const item of managed.items){const list=grouped.get(item.pluginId)??[];list.push(item);grouped.set(item.pluginId,list);}
    const plugins=[];for(const [id,items]of grouped){const row=byId.get(id),record=records.find(record=>record.pluginId===id),picked=row?(items.find(item=>item.packageRoot===record?.packageRoot)??items.find(item=>item.version===row.version)??items.at(-1)):items.at(-1);
      plugins.push({plugin:picked.manifestName,pluginId:id,status:!rows?'unknown':row?(row.enabled===false?'disabled':'enabled'):'converted',source:sourceOf(picked),prepared:picked});}
    return {known:Boolean(rows),...(rows?{}:{error:clip(listed?.stderr||listed?.stdout)||'無法確認 Codex 的插件安裝狀態。'}),plugins,notices:managed.notices??[],downloads};
  }
  function publicState(value){const entries=getEntries(),items=Object.create(null),others=[];
    for(const plugin of value.plugins){const entry=matchEntry(plugin.source,entries)??entries.find(entry=>entry.name===plugin.prepared.catalogName);if(!entry){others.push({plugin:plugin.plugin,status:plugin.status});continue;}const update=newerVersion(plugin.source,entry);items[entry.name]={plugin:plugin.plugin,status:plugin.status,version:plugin.source.version,...(update?{update}:{})};}
    const downloads=Object.create(null);
    for(const downloaded of [...(value.downloads??[])].sort((a,b)=>String(a.downloadedAt??'').localeCompare(String(b.downloadedAt??'')))){
      const entry=entries.find(entry=>entry.name===downloaded.catalogName)??entries.find(entry=>entry.name===downloaded.packageName),name=entry?.name??downloaded.catalogName;
      if(items[name]&&items[name].status!=='converted')continue;
      const source={version:downloaded.version,commit:downloaded.provenance?.commit},update=entry?newerVersion(source,entry):undefined;
      downloads[name]={version:downloaded.version,...(update?{update}:{})};
    }
    return {known:value.known,...(value.error?{error:value.error}:{}),items,others,downloads,...(value.notices.length?{notices:value.notices}:{})};
  }
  async function installed(fresh=false){if(!fresh&&cached&&now()-cached.at<5000)return cached.body;const body=publicState(await state());cached={at:now(),body};return body;}
  const invalidate=()=>{cached=undefined;};
  async function manage(body){
    if(managing)throw fail('上一個安裝、啟用、停用或移除還沒完成。',409);
    if(!['install','enable','disable','remove','delete'].includes(body?.action)||typeof body.name!=='string')throw fail('不認得的動作');
    managing=true;try{
      const current=await state(),entries=getEntries();
      if(body.action==='delete'){
        if(!current.known)return {ok:false,text:'無法確認 Codex 的插件安裝狀態，沒有刪除來源。',installed:publicState(current)};
        const snapshot=publicState(current);
        if(!snapshot.downloads[body.name])throw fail('這個插件沒有下載過，或已經安裝了',404);
        if(typeof operations.deleteDownloaded!=='function')throw fail('目前無法刪除已下載來源');
        try{await operations.deleteDownloaded(body.name);invalidate();return {ok:true,text:'已刪除尚未安裝的下載來源。',installed:await installed(true)};}
        catch(cause){invalidate();return {ok:false,text:`刪除失敗：${clip(cause.message)}`,installed:await installed(true)};}
      }
      const item=current.plugins.find(plugin=>(matchEntry(plugin.source,entries)?.name??plugin.prepared.catalogName)===body.name||plugin.plugin===body.name);
      if(!item)throw fail('這個插件沒有用市場轉換或安裝過',404);
      if(!current.known)return {ok:false,text:'無法確認 Codex 的插件安裝狀態，沒有執行管理動作。',installed:publicState(current)};
      const words={install:'安裝',enable:'啟用',disable:'停用',remove:'移除'};
      try{
        if(body.action==='install')await operations.install(item.prepared);
        else if(body.action==='enable'||body.action==='disable'){
          if(item.status==='converted')throw Error('請先安裝插件');
          await operations.setManagedEnabled(item.pluginId,body.action==='enable');
        }else await operations.removeManaged(item.plugin);
        invalidate();const after=await state(),actual=after.plugins.find(plugin=>plugin.pluginId===item.pluginId),expected=body.action==='disable'?'disabled':body.action==='remove'?undefined:'enabled';
        const ok=after.known&&(body.action==='install'?actual?.status!=='converted'&&Boolean(actual):body.action==='remove'?!actual:actual?.status===expected);
        const installedBody=publicState(after);cached={at:now(),body:installedBody};return {ok,text:ok?`${words[body.action]}完成${body.action==='remove'?'；使用者狀態與設定已保留。':'；請新開 Codex 聊天載入。'}`:`Codex 尚未確認${words[body.action]}後的狀態，請重新讀取。`,installed:installedBody};
      }catch(cause){invalidate();return {ok:false,text:`${words[body.action]}失敗：${clip(cause.message)}`,installed:await installed(true)};}
    }finally{managing=false;}
  }
  const favoritesFile=path.join(dataRoot,'state','market-favorites.json');
  async function readFavorites(){let value;try{value=JSON.parse(await fs.readFile(favoritesFile,'utf8'));}catch(cause){if(cause.code!=='ENOENT')throw fail('收藏紀錄無法讀取，請保留原檔後修復。');return []; }return Array.isArray(value?.names)?[...new Set(value.names.filter(name=>typeof name==='string'&&name.length<=300))].slice(-1000):[];}
  function favorite(body){const pending=favoriteQueue.then(async()=>{
    if(typeof body?.name!=='string'||!body.name||body.name.length>300||typeof body.on!=='boolean')throw fail('收藏的格式不對');
    if(body.on&&!getEntries().some(entry=>entry.name===body.name))throw fail('清單裡沒有這個插件',404);
    const names=(await readFavorites()).filter(name=>name!==body.name);if(body.on)names.push(body.name);const kept=names.slice(-1000),temp=`${favoritesFile}.${randomUUID()}.tmp`;await fs.mkdir(path.dirname(favoritesFile),{recursive:true});await fs.writeFile(temp,JSON.stringify({names:kept},null,2)+'\n');await fs.rename(temp,favoritesFile);return {names:kept};
  });favoriteQueue=pending.catch(()=>{});return pending;}
  return {installed,manage,readFavorites,favorite,invalidate,close:()=>favoriteQueue};
}
