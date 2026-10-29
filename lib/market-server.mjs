import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DEFAULT_MARKETS,fetchMarketIndex,searchMarket} from './market-catalog.mjs';
import {createCCMarketAdapter} from './cc-market-adapter.mjs';
import {createMarketOperations} from './market-operations.mjs';
import {createDesktopConversation} from './codex-desktop-conversation.mjs';

const pluginRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const error=(message,status=400,code='MARKET_REQUEST_INVALID')=>Object.assign(new Error(message),{status,code});
export const defaultMarketRoot=()=>path.resolve(process.env.DSH_CODEX_MARKET_DATA_ROOT??path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'dsh-to-codex-market'));
export const resolveCodexHome=value=>path.resolve(value??process.env.CODEX_HOME??path.join(os.homedir(),'.codex'));

/** Human-operated loopback interface. It never turns a page view into source execution. */
export async function startMarketServer({dataRoot=defaultMarketRoot(),port=0,sources=DEFAULT_MARKETS,operations,fetchIndex=fetchMarketIndex,codexHome,version,idleTimeoutMs=60*60*1000,ccFetchText,ccSearchImpl,desktopConversation}={}){
  dataRoot=path.resolve(dataRoot);await fs.mkdir(path.join(dataRoot,'catalog-cache'),{recursive:true});
  version??=(await json(path.join(pluginRoot,'package.json'))).version;
  codexHome=resolveCodexHome(codexHome);
  const contextFile=path.join(dataRoot,'codex-target.json');
  try{await fs.writeFile(contextFile,JSON.stringify({codexHome})+'\n',{flag:'wx'});}catch(cause){
    if(cause.code!=='EEXIST')throw cause;
    const context=await json(contextFile);
    if(path.resolve(context.codexHome)!==codexHome)throw error('這個市場資料夾屬於另一個 Codex 設定資料夾，請使用不同的市場資料夾');
  }
  operations??=await createMarketOperations({dataRoot,codexHome});
  desktopConversation??=createDesktopConversation({context:null});
  const ccMarket=createCCMarketAdapter({operations,dataRoot,codexHome,fetchText:ccFetchText,searchImpl:ccSearchImpl,dispatchReview:request=>desktopConversation.sendReview(request)});
  const csrfToken=crypto.randomBytes(24).toString('hex'),accessToken=crypto.randomBytes(32).toString('hex'),instanceId=crypto.randomUUID();
  const catalogs=new Map(),loading=new Map(),jobs=new Map(),activeInstalls=new Map();
  let queue=Promise.resolve(),closed=false,idleTimer,origin;
  const evidence=await json(path.join(pluginRoot,'data','function-evidence.json')).catch(()=>({plugins:[]}));
  const knownSource=url=>{const row=sources.find(x=>x.url===(url||sources[0]?.url));if(!row)throw error('請選擇清單內的市場來源');return row;};
  const cacheFile=url=>path.join(dataRoot,'catalog-cache',crypto.createHash('sha256').update(url).digest('hex')+'.json');
  async function catalogFor(url,refresh=false){
    const source=knownSource(url);if(!refresh&&catalogs.has(source.url))return catalogs.get(source.url);
    if(loading.has(source.url))return loading.get(source.url);
    const pending=(async()=>{
      try{
        const catalog=await fetchIndex(source.url,{sourceId:source.id});
        catalog.stale=false;catalogs.set(source.url,catalog);
        await fs.writeFile(cacheFile(source.url),JSON.stringify(catalog));return catalog;
      }catch(cause){
        const previous=catalogs.get(source.url)??await json(cacheFile(source.url)).catch(()=>null);
        if(!previous)throw error('目前無法讀取市場，請稍後按「更新清單」重試。',502,cause.code??'MARKET_FETCH_FAILED');
        const cached={...previous,stale:true,error:'目前連線失敗，正在顯示上次取得的清單。'};catalogs.set(source.url,cached);return cached;
      }
    })();loading.set(source.url,pending);try{return await pending;}finally{loading.delete(source.url);}
  }
  async function installed(){const value=await operations.installed();return Array.isArray(value)?value:value.items??[];}
  function itemFor(plugin,records=[]){
    const selected=plugin.distTags?.latest??plugin.latestVersion??plugin.versions?.[0]?.version;
    const tested=evidence.plugins?.find(x=>x.name===plugin.name&&x.version===selected&&!x.privateRepair);
    const record=records.find(x=>(x.packageName??x.sourceName??x.name)===plugin.name);
    return {...plugin,version:selected,author:plugin.author&&typeof plugin.author==='object'?plugin.author.name??'':plugin.author??'',repository:plugin.repository&&typeof plugin.repository==='object'?plugin.repository.url:plugin.repository,installed:Boolean(record),installedAt:record?.installedAt,pluginId:record?.pluginId,...(tested?{testedFunctions:{count:tested.cases,version:tested.version,summary:tested.scope,converterVersion:tested.converterVersion}}:{}),limitations:tested?[tested.scope,'只驗證所列功能；其他功能尚未確認。']:[]};
  }
  function enqueue(action,task){
    if(jobs.size>=300)for(const [id,row]of jobs){if(['completed','failed'].includes(row.state)){jobs.delete(id);break;}}
    const row={id:crypto.randomUUID(),action,state:'queued',phase:'queued',message:'等待處理',createdAt:new Date().toISOString()};jobs.set(row.id,row);
    queue=queue.catch(()=>{}).then(async()=>{
      row.state='running';row.startedAt=new Date().toISOString();
      const onProgress=update=>{row.phase=update.stage??update.phase??row.phase;row.message=update.message??row.message;if(update.aiProgress)row.aiProgress=update.aiProgress;if(update.aiPlan)row.aiPlan=update.aiPlan;};
      try{row.result=await task(onProgress);row.state='completed';row.phase='completed';row.message=action==='install'?'已安裝，請新開 Codex 聊天載入':'檢查已完成；請查看審查與權限結果，尚未安裝';}
      catch(cause){row.failedPhase=row.phase;row.state='failed';row.phase='failed';row.error={code:cause.code??'MARKET_OPERATION_FAILED',message:String(cause.message??cause).slice(0,1600)};row.message=row.error.message;}
      finally{row.finishedAt=new Date().toISOString();}
    });return row;
  }
  function publicJob(row){return {...row,result:row.result?{...row.result,report:undefined}:undefined};}
  async function body(req,maxBytes=16384){
    if(req.headers['content-type']?.split(';')[0]!=='application/json')throw error('請使用 JSON 格式送出操作',415);
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>maxBytes)throw error('操作資料過大',413);}
    try{const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value;}catch{throw error('操作資料格式錯誤');}
  }
  const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.host!==new URL(origin).host)throw error('拒絕不相符的本機主機名稱',403,'MARKET_HOST_REJECTED');
      if(req.headers['sec-fetch-site']==='cross-site')throw error('拒絕其他網站發起的請求',403,'MARKET_ORIGIN_REJECTED');
      clearTimeout(idleTimer);if(idleTimeoutMs>0){idleTimer=setTimeout(()=>{if([...jobs.values()].some(x=>['queued','running'].includes(x.state)))return;void close();},idleTimeoutMs);idleTimer.unref?.();}
      res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
      const url=new URL(req.url,origin),p=url.pathname;
      if(p.startsWith('/api/')&&req.headers.authorization!==`Bearer ${accessToken}`)throw error('請從桌面捷徑重新開啟市場；此頁面沒有本次啟動的存取授權',401,'MARKET_ACCESS_REQUIRED');
      if(closed&&req.method==='POST')throw error('市場正在關閉，請稍後重新開啟',503);
      if(p.startsWith('/api/cc/')){
        let data;if(req.method==='POST'){if(req.headers['x-csrf-token']!==csrfToken||req.headers.origin&&req.headers.origin!==origin)throw error('操作驗證失敗',403,'MARKET_CSRF_REJECTED');data=await body(req,p==='/api/cc/review-complete'?262144:16384);}
        if(p==='/api/cc/conversation-bind'&&req.method==='POST')return send(res,200,await desktopConversation.bind(data));
        if(p==='/api/cc/conversation'&&req.method==='GET')return send(res,200,desktopConversation.status());
        return send(res,200,await ccMarket.handle(req.method,p.slice('/api/cc'.length),url.searchParams,data));
      }
      if(req.method==='GET'&&p==='/api/health')return send(res,200,{ok:true,instanceId,pid:process.pid,version});
      if(req.method==='GET'&&p==='/api/config')return send(res,200,{version,sources,csrfToken,url:origin,mode:'local',requiresNewChatAfterInstall:true});
      if(req.method==='GET'&&p==='/api/review-settings')return send(res,200,await operations.reviewSettings());
      if(req.method==='GET'&&p==='/api/prepared')return send(res,200,await operations.preparedPackages?.()??{items:[],notices:[]});
      if(req.method==='GET'&&p==='/api/catalog'){
        const catalog=await catalogFor(url.searchParams.get('sourceUrl'),url.searchParams.get('refresh')==='1'),records=await installed();
        const listing=searchMarket(catalog,{query:url.searchParams.get('q')??'',category:url.searchParams.get('category')??'',page:Number(url.searchParams.get('page')??1),pageSize:Number(url.searchParams.get('pageSize')??24)});
        return send(res,200,{...listing,items:listing.items.map(x=>itemFor(x,records)),source:{url:catalog.sourceUrl,title:catalog.title},fetchedAt:catalog.fetchedAt,stale:catalog.stale,error:catalog.error});
      }
      if(req.method==='GET'&&p==='/api/plugin'){
        const catalog=await catalogFor(url.searchParams.get('sourceUrl')),plugin=catalog.plugins.find(x=>x.name===url.searchParams.get('name'));if(!plugin)throw error('市場內找不到這個插件',404);
        return send(res,200,itemFor(plugin,await installed()));
      }
      if(req.method==='GET'&&p==='/api/installed'){
        const records=await installed();return send(res,200,{items:records.map(record=>{
          const name=record.packageName??record.sourceName??record.name;
          const plugin=[...catalogs.values()].flatMap(x=>x.plugins).find(x=>x.name===name);
          return plugin?{...itemFor(plugin,records),version:record.version??record.packageVersion}:{...record,name,title:record.title??name,description:'已透過本機市場安裝',installed:true,category:'',versions:[{version:record.version??record.packageVersion}]};
        })});
      }
      if(req.method==='GET'&&p.startsWith('/api/jobs/')){const row=jobs.get(p.slice('/api/jobs/'.length));if(!row)throw error('找不到這項操作，請重新準備安裝',404);return send(res,200,publicJob(row));}
      if(req.method==='POST'){
        if(req.headers['x-csrf-token']!==csrfToken||req.headers.origin&&req.headers.origin!==origin)throw error('操作驗證失敗，請重新整理市場頁面',403,'MARKET_CSRF_REJECTED');
        const data=await body(req);
        if(p==='/api/review-settings')return send(res,200,await operations.reviewSettings(data));
        if(p==='/api/refresh'){const catalog=await catalogFor(data.sourceUrl,true);return send(res,200,{total:catalog.total,fetchedAt:catalog.fetchedAt,stale:catalog.stale,error:catalog.error});}
        if(p==='/api/shutdown'){send(res,200,{closed:true});setImmediate(()=>void close());return;}
        if(['/api/jobs','/api/review','/api/prepare','/api/install'].includes(p)){
          if(p!=='/api/jobs')data.action=p.slice('/api/'.length);
          if(data.action==='review'||data.action==='prepare'){
            const catalog=await catalogFor(data.sourceUrl),plugin=catalog.plugins.find(x=>x.name===data.name);if(!plugin)throw error('請從市場清單選擇插件');
            if(!plugin.versions.some(x=>x.version===data.version))throw error('所選版本不在市場清單內');
            const verified=evidence.plugins?.find(x=>x.name===plugin.name&&x.version===data.version&&!x.privateRepair);
            const conversionOptions=verified?.conversionOptions??{};
            if(data.action==='review'){
              if(typeof operations.review!=='function')throw error('市場來源掃描尚未提供');
              const row=enqueue('review',onProgress=>operations.review(plugin,{version:data.version,onProgress,skipAI:data.skipAI!==false,reviewId:data.reviewId,aiScope:data.aiScope,reviewSettings:data.reviewSettings}));return send(res,202,publicJob(row));
            }
            if((p==='/api/prepare'||data.reviewId)&&(!data.reviewId||data.consent!==true))throw error('請先查看掃描報告並明確同意轉換');
            const row=enqueue('prepare',onProgress=>operations.prepare(plugin,{version:data.version,onProgress,conversionOptions,reviewId:data.reviewId,consent:data.consent,forceObfuscated:data.forceObfuscated===true}));return send(res,202,publicJob(row));
          }
          if(data.action==='install'){
            if(typeof data.packageRoot==='string'){const row=enqueue('install',onProgress=>operations.install({packageRoot:data.packageRoot},{onProgress}));return send(res,202,publicJob(row));}
            const previous=jobs.get(data.preparedJobId);if(!previous||previous.action!=='prepare'||previous.state!=='completed'||!['ready','partial'].includes(previous.result?.status))throw error('請先完成可用插件的轉換檢查');
            const active=jobs.get(activeInstalls.get(previous.id));if(active&&active.state!=='failed')return send(res,202,publicJob(active));
            const row=enqueue('install',onProgress=>operations.install(previous.result,{onProgress}));activeInstalls.set(previous.id,row.id);return send(res,202,publicJob(row));
          }
          throw error('不支援這項操作');
        }
      }
      if(req.method==='GET'){
        const name=p==='/'||p==='/market/'?'index.html':p.replace(/^\/market\//,'/').slice(1);
        if(!['index.html','market.js','market.css','app.js','app.css','markdown.js','i18n.js'].includes(name))throw error('找不到頁面',404);
        const bytes=await fs.readFile(path.join(pluginRoot,'web','market',name));res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store'});res.end(bytes);return;
      }
      throw error('不支援這個頁面或操作',404);
    }catch(cause){if(!res.headersSent)send(res,cause.status??400,{error:{code:cause.code??'MARKET_REQUEST_FAILED',message:String(cause.message??cause).slice(0,1800)}});else res.destroy();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
  async function close(){if(closed)return;closed=true;clearTimeout(idleTimer);await queue;await ccMarket.close();await desktopConversation.close();server.closeIdleConnections?.();await new Promise(resolve=>server.close(resolve));}
  return {url:origin,accessToken,instanceId,server,dataRoot,version,codexHome,converterRoot:pluginRoot,close,jobs};
}
