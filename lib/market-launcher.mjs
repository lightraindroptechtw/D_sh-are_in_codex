import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {defaultMarketRoot,resolveCodexHome} from './market-server.mjs';
import {desktopConversationContext} from './codex-desktop-conversation.mjs';
import semver from 'semver';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function canReplaceMarket(record,{converterRoot=root,version,codexHome}={}){
  const normalized=value=>{const p=path.resolve(value);return process.platform==='win32'?p.toLowerCase():p;};
  return Boolean(record&&typeof record.codexHome==='string'&&typeof record.converterRoot==='string'&&typeof codexHome==='string'&&semver.valid(record.version)&&semver.valid(version)&&semver.lt(record.version,version)
    &&normalized(record.codexHome)===normalized(codexHome)
    &&path.basename(record.converterRoot)===record.version&&path.basename(converterRoot)===version
    &&path.basename(path.dirname(converterRoot))==='dsh-to-codex'
    &&normalized(path.dirname(record.converterRoot))===normalized(path.dirname(converterRoot)));
}
export async function marketRecord(dataRoot){
  try{
    const record=JSON.parse(await fs.readFile(path.join(dataRoot,'server.json'),'utf8')),url=new URL(record.url);
    if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)return null;
    const response=await fetch(record.url+'/api/health',{headers:{authorization:`Bearer ${record.accessToken}`},signal:AbortSignal.timeout(800)}),health=await response.json();
    return response.ok&&health.ok&&health.instanceId===record.instanceId?record:null;
  }catch{return null;}
}
export function openMarketBrowser(url){
  const value=new URL(url);if(value.hostname!=='127.0.0.1'||value.protocol!=='http:'||value.search||value.pathname!=='/'||value.hash&&!/^#access=[a-f0-9]{64}$/.test(value.hash))throw new Error('市場只開啟本機頁面');
  const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  return new Promise((resolve,reject)=>execFile(command,args,{windowsHide:true},error=>error?reject(error):resolve()));
}
/** Launch only on an explicit human/tool request; never on ordinary plugin startup. */
export async function launchMarket({dataRoot=defaultMarketRoot(),codexHome,open=false,port=0,conversationContext=null}={}){
  dataRoot=path.resolve(dataRoot);await fs.mkdir(dataRoot,{recursive:true});
  codexHome=resolveCodexHome(codexHome);
  const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
  let record=await marketRecord(dataRoot),restartedForUpgrade=false;
  if(record&&canReplaceMarket(record,{version,codexHome})){
    const headers={authorization:'Bearer '+record.accessToken};
    const jobsResponse=await fetch(record.url+'/api/cc/jobs',{headers,signal:AbortSignal.timeout(10000)});
    if(!jobsResponse.ok)throw new Error('市場暫時無法回報工作狀態，請稍後再試。');
    const jobs=await jobsResponse.json();
    if(jobs.jobs?.some(job=>['queued','running'].includes(job.phase)))throw new Error('市場仍有工作進行中，完成後再呼叫開啟指令即可更新；不用手動關閉服務。');
    const config=await(await fetch(record.url+'/api/config',{headers,signal:AbortSignal.timeout(10000)})).json();
    const stopped=await fetch(record.url+'/api/shutdown',{method:'POST',headers:{...headers,'content-type':'application/json','x-csrf-token':config.csrfToken,origin:record.url},body:'{}',signal:AbortSignal.timeout(10000)});
    if(!stopped.ok)throw new Error('舊版市場尚未關閉，請稍後再呼叫開啟指令。');
    for(let attempt=0;attempt<40&&await marketRecord(dataRoot);attempt++)await pause(150);
    if(await marketRecord(dataRoot))throw new Error('舊版市場還在關閉，請稍後再試。');
    record=null;restartedForUpgrade=true;
  }
  if(!record){
    const log=await fs.open(path.join(dataRoot,'market.log'),'a');
    const args=[path.join(root,'bin','marketplace.mjs'),'--serve','--data-root',dataRoot,'--port',String(port)];if(codexHome)args.push('--codex-home',path.resolve(codexHome));
    const child=spawn(process.execPath,args,{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});child.unref();
    let failure;child.once('error',cause=>{failure=cause;});
    try{for(let attempt=0;attempt<80;attempt++){record=await marketRecord(dataRoot);if(record)break;if(failure)throw failure;await pause(150);}}finally{await log.close();}
    if(!record)throw new Error('市場未能啟動，請查看市場資料夾內的 market.log');
  }
  if(record.codexHome!==codexHome||record.converterRoot!==root||record.version!==version)throw new Error('已有另一個版本或設定資料夾的市場正在執行，請先關閉該市場，再重新開啟');
  let conversation;
  if(conversationContext){
    const headers={authorization:'Bearer '+record.accessToken};
    const config=await(await fetch(record.url+'/api/config',{headers})).json();
    const response=await fetch(record.url+'/api/cc/conversation-bind',{method:'POST',headers:{...headers,'content-type':'application/json','x-csrf-token':config.csrfToken},body:JSON.stringify(conversationContext)});
    conversation=await response.json();
  }
  const browserUrl=record.url+'/#access='+record.accessToken;
  if(open)await openMarketBrowser(browserUrl);
  return {url:browserUrl,conversation,version:record.version,started:true,...(restartedForUpgrade?{restartedForUpgrade:true}:{}),installedAnyPlugin:false,message:'市場已開啟。先查看固定規則掃描與 Codex 意見，再由你決定是否轉換及安裝；AI 無法完成時仍可依掃描結果繼續。'};
}
