import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {MARKETS,npmDownloadsUrls,parseNpmDownloads,npmIcon,npmManifestUrl} from './cc-market-catalog.mjs';
import {createCCMarketInstalled} from './cc-market-installed.mjs';
import {readMarkets} from './cc-market-markets.mjs';
import {readReadme} from './cc-market-readme.mjs';
import {downloadMarketSource} from './market-operations.mjs';
import {run} from './source.mjs';
import {renderCCScanOverview} from './security-scan.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const compact=e=>({...e,versions:e.versions.slice(0,30).map(v=>({version:v.version,published:v.published,type:v.source.type,floating:Boolean(v.floating)}))});
const searchSchema={type:'object',additionalProperties:false,required:['results'],properties:{results:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['name','reason'],properties:{name:{type:'string'},reason:{type:'string'}}}}}};
const fold=text=>String(text??'').normalize('NFKC').toLocaleLowerCase();
  export function marketSearchCandidates(entries,keywords) {
    const clean = list => [...new Set(list.filter(k => typeof k === 'string').map(k => fold(k).trim()).filter(k => k && k.length <= 40))];
    // 一個字串是一組；一個陣列是一組同義詞
    const groups = (Array.isArray(keywords) ? keywords : []).map(g => clean(Array.isArray(g) ? g.slice(0, 12) : [g])).filter(g => g.length).slice(0, 10);
    if (!groups.length) return [];
    const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 含中日韓文字的詞不管空白：作者常寫「B 站」，關鍵字是「b站」也要對到。
    const squeeze = text => text.replace(/\s+/g, '');
    const matcher = t => (/^[a-z0-9][a-z0-9 .+#-]*$/.test(t)
      ? (re => d => re.test(d))(new RegExp(`(?:^|[^a-z0-9])${escape(t)}${t.length <= 3 ? '(?![a-z0-9])' : ''}`))
      : (s => d => squeeze(d).includes(s))(squeeze(t)));
    const docs = entries.map(e => ({
      e,
      head: fold([e.name, e.title].join(' | ')),
      body: fold([e.description, e.category, ...(e.keywords ?? [])].join(' | ')),
    }));
    // 每一組、每個插件的分數：組裡分數最高的詞
    const groupScores = groups.map((terms, g) => {
      const best = new Float64Array(docs.length);
      for (const t of terms) {
        const match = matcher(t);
        const hits = docs.map(d => (match(d.head) ? 1.5 : match(d.body) ? 1 : 0));
        const df = hits.filter(Boolean).length;
        if (!df) continue;
        const weight = Math.log(1 + docs.length / df) * (g === 0 ? 2 : 1);
        hits.forEach((hit, i) => { best[i] = Math.max(best[i], hit * weight); });
      }
      return best;
    });
    const scored = [];
    docs.forEach((d, i) => {
      const score = groupScores.reduce((sum, best) => sum + best[i], 0);
      if (score > 0) scored.push([score, d.e]);
    });
    scored.sort((a, b) => b[0] - a[0] || (b[1].downloads ?? b[1].downloadsRange ?? 0) - (a[1].downloads ?? a[1].downloadsRange ?? 0));
    return scored.slice(0, 40).map(([, e]) => ({ name: e.name, title: e.title, description: e.description.slice(0, 160), category: e.category || '' }));
  }

/** Two small, explicit Luna calls: multilingual keywords, then at most forty compact candidates. */
export async function codexMarketSearch({query,lang,entries,dataRoot,codexHome,codexCommand=process.env.CODEX_BIN||'codex',runImpl=run,onProgress=()=>{}}){
 const dir=path.join(dataRoot,'ai-search',crypto.randomUUID());await fs.mkdir(dir,{recursive:true});
 const env={OPENAI_API_KEY:undefined,CODEX_API_KEY:undefined,NODE_OPTIONS:undefined,NODE_PATH:undefined,...(codexHome?{CODEX_HOME:codexHome}:{})};
 const auth=await runImpl(codexCommand,['login','status'],{cwd:dir,env,timeout:10000});
 if(auth.code!==0||!/logged in using ChatGPT/i.test((auth.stdout??'')+'\n'+(auth.stderr??'')))throw fail('Codex 尚未使用 ChatGPT 登入，Luna 搜尋未送出。');
 const prompts=(await fs.readFile(new URL('../data/market-search-prompt.md',import.meta.url),'utf8')).matchAll(/\x60\x60\x60text\r?\n([\s\S]*?)\r?\n\x60\x60\x60/g),blocks=[...prompts].map(m=>m[1]);
 if(blocks.length!==2)throw fail('找不到完整可編輯搜尋提示詞，尚未呼叫模型。');
 async function ask(stage,schemaValue,payload,prompt){const schema=path.join(dir,stage+'-schema.json'),out=path.join(dir,stage+'-result.json');await fs.writeFile(schema,JSON.stringify(schemaValue));const input=prompt+'\n'+JSON.stringify(payload);if(input.length>16000)throw fail('搜尋候選超過 16000 字元上限，尚未送出本階段。');
 const args=['-a','never','exec','--json','--ignore-user-config','--ignore-rules','--sandbox','read-only','--ephemeral','--skip-git-repo-check','-C',dir,'--model','gpt-6-luna','--output-schema',schema,'--output-last-message',out,'-c','project_doc_max_bytes=0','-c','web_search="disabled"','-c','model_reasoning_effort="low"'];
 for(const feature of ['plugins','apps','shell_tool','unified_exec','code_mode_host'])args.push('--disable',feature);args.push('-');
 const result=await runImpl(codexCommand,args,{cwd:dir,env,timeout:180000,input});if(result.code!==0)throw fail('Luna 搜尋未完成；請確認登入、模型和可用額度後重試。');return JSON.parse(await fs.readFile(out,'utf8'));}
 const keywordSchema={type:'object',additionalProperties:false,required:['keywords'],properties:{keywords:{type:'array',maxItems:10,items:{type:'array',maxItems:12,items:{type:'string'}}}}};
 await onProgress({message:'Luna 正在把描述整理成多語關鍵字（本階段不送市場清單）。'});
 const keywords=await ask('keywords',keywordSchema,{query,lang},blocks[0]);if(!Array.isArray(keywords.keywords))throw fail('Luna 關鍵字格式不正確。');
 const candidates=marketSearchCandidates(entries,keywords.keywords);while(candidates.length&&JSON.stringify({query,lang,candidates}).length+blocks[1].length>16000)candidates.pop();
 await onProgress({message:'已從 '+entries.length+' 個插件選出 '+candidates.length+' 個候選；只把這些精簡介紹送給 Luna 排序。',candidateCount:candidates.length});
 if(!candidates.length)return [];
 const value=await ask('rank',searchSchema,{query,lang,candidates},blocks[1]);if(!Array.isArray(value.results)||value.results.length>20)throw fail('Luna 搜尋回覆格式不正確。');
 const names=new Set(candidates.map(e=>e.name)),seen=new Set();return value.results.filter(r=>names.has(r?.name)&&typeof r.reason==='string'&&!seen.has(r.name)&&seen.add(r.name)).map(r=>({name:r.name,reason:r.reason.slice(0,300)}));
}
export function createCCMarketAdapter({operations,dataRoot,codexHome,fetchText,searchImpl=codexMarketSearch,dispatchReview,now=()=>Date.now()}={}){
 fetchText??=async url=>{try{return (await downloadMarketSource(url,{limit:8*1024*1024,timeoutMs:30000})).toString('utf8');}catch(cause){if(/HTTP 404/.test(cause.message))return undefined;throw cause;}};
 const lastGood=new Map(),readmes=new Map(),counts=new Map(),icons=new Map(),jobs=new Map();let entries=[],meta={phase:'idle',sources:[],readAt:0,markets:MARKETS},loading,queue=Promise.resolve();
 const management=createCCMarketInstalled({operations,dataRoot,getEntries:()=>entries,now});
 async function catalog(refresh=false){if(refresh||meta.phase==='idle')loading??=(async()=>{const result=await readMarkets(async url=>{const text=await fetchText(url);if(text===undefined)throw Error('HTTP 404');return text;},lastGood,now());if(result.entries)entries=result.entries;meta={phase:entries.length?'ready':'error',sources:result.sources,readAt:now(),markets:MARKETS,...(!entries.length?{error:'目前無法讀取社群清單，請重新讀取。'}:{})};})().finally(()=>{loading=undefined;});await loading;return {meta,entries:entries.map(compact)};}
 function lookup(name,version){const entry=entries.find(e=>e.name===name),picked=entry?.versions.find(v=>v.version===version);if(!entry||!picked)throw fail('清單裡沒有這個插件或版本',404);return {entry,picked};}
 async function resolve(entry,picked){let version=picked.version,source={...picked.source},name=entry.name;
  if(source.type==='release')throw fail('GitHub 發布檔目前只能看介紹與自述文件。');
  if(picked.floating&&source.type==='npm'){const raw=JSON.parse(await fetchText('https://registry.npmjs.org/'+encodeURIComponent(name)+'/latest'));version=raw.version;}
  if(picked.floating&&source.type==='git'){const repo=/^https:\/\/github.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(source.url);if(!repo)throw fail('GitHub 來源格式不正確');const commit=JSON.parse(await fetchText(`https://api.github.com/repos/${repo[1]}/${repo[2]}/commits/HEAD`)).sha;if(!/^[a-f0-9]{40}$/.test(commit))throw fail('查不到固定提交');source.commit=commit;const manifest=JSON.parse(await fetchText(`https://raw.githubusercontent.com/${repo[1]}/${repo[2]}/${commit}/${source.path?source.path+'/':''}package.json`));name=manifest.name;version=manifest.version;}
  return {plugin:{...entry,name,catalogName:entry.name,versions:[{version,source}]},version};
 }
 function publicJob(j){const {plugin,resolvedVersion,...value}=j;return value;}
 function enqueue(action,fields,task){const active=[...jobs.values()].filter(j=>['queued','running'].includes(j.phase));if(active.length>=10)throw fail('排隊的工作太多，請等前面的完成。',429);if(active.some(j=>j.action===action&&(action==='ai-search'||j.name===fields.name)))throw fail('相同工作正在進行。',409);if(jobs.size>=200){const oldest=[...jobs.values()].find(j=>!['queued','running'].includes(j.phase));if(oldest)jobs.delete(oldest.id);}const job={id:crypto.randomUUID(),action,...fields,phase:'queued',text:'等待處理…',created:now()};jobs.set(job.id,job);queue=queue.catch(()=>{}).then(async()=>{job.phase='running';try{await task(job);management.invalidate();job.phase='done';}catch(cause){job.phase='error';job.text=String(cause.message??cause).slice(0,2000);job.error={code:cause.code??'MARKET_OPERATION_FAILED',message:job.text};}});return publicJob(job);}
 const progress=job=>update=>{job.text=update.message??job.text;if(update.aiPlan)job.aiPlan=update.aiPlan;if(update.aiProgress)job.aiProgress=update.aiProgress;if(update.candidateCount!==undefined)job.candidateCount=update.candidateCount;};
 async function handle(method,pathname,params,data){
  if(method==='GET'&&pathname==='/capabilities')return operations.capabilities?operations.capabilities():{apiSchema:{found:false,reason:'目前沒有提供能力摘要，請依主對話實際工具判斷。'}};
  if(method==='POST'&&pathname==='/source-review'){
   if(typeof data.source!=='string'||!data.source.trim())throw fail('需要來源');
   return enqueue('source-review',{name:data.source,title:data.source},async job=>{
    job.result=await operations.reviewSource({source:data.source,packageDir:data.packageDir,aiScope:data.aiScope,onProgress:progress(job)});
    job.name=job.result.packageName;job.version=job.result.version;job.path=job.result.path;job.markdown=job.result.markdown;
    job.handoff={status:'awaiting-main-conversation',reviewId:job.result.reviewId,sourceRoot:job.path,packageName:job.name,version:job.version,sourceDigest:job.result.sourceReview?.sourceDigest};
    job.text='來源已固定並掃描；請由目前主對話閱讀報告。未轉換、未安裝、未另開模型。';
   });
  }
  if(method==='POST'&&pathname==='/source-install'){
   if(data.consent!==true)throw fail('請先查看掃描與審查結果並明確同意安裝');
   return enqueue('source-install',{name:data.reviewId,title:'安裝已審查來源'},async job=>{job.result=await operations.installReviewed({reviewId:data.reviewId,consent:true,forceObfuscated:data.forceObfuscated===true,...(data.rewriteId?{rewriteId:data.rewriteId}:{}),onProgress:progress(job)});job.path=job.result.packageRoot;job.text=job.result.installed?'已安裝，請新開 Codex 聊天載入；尚未驗證第三方工具功能。':'轉換結果沒有可安裝能力，請查看省略項目。';});
  }
  if(method==='POST'&&pathname==='/source-rewrite')return enqueue('source-rewrite',{name:data.reviewId??data.rewriteId,title:'補寫缺少的功能'},async job=>{job.result=await operations.rewrite(data);job.text='補寫步驟完成；尚未安裝，請由目前對話接續。';});
  if(method==='GET'&&pathname==='/installed'){await catalog();return management.installed(params.get('fresh')==='1');}
  if(method==='POST'&&pathname==='/manage'){await catalog();return management.manage(data);}
  if(method==='GET'&&pathname==='/favorites')return {names:await management.readFavorites()};
  if(method==='POST'&&pathname==='/favorites'){if(data?.on)await catalog();return management.favorite(data);}
  if(method==='GET'&&pathname==='/icons'){
   await catalog();const wanted=[...new Set((params.get('names')??'').split(','))].filter(name=>entries.some(entry=>entry.name===name)).slice(0,60),missing=wanted.filter(name=>!icons.has(name));
   for(let index=0;index<missing.length;index+=8)await Promise.all(missing.slice(index,index+8).map(async name=>{const entry=entries.find(entry=>entry.name===name),latest=entry.versions[0];if(entry.icon){icons.set(name,entry.icon);return;}try{icons.set(name,latest?.source.type==='npm'?(npmIcon(JSON.parse(await fetchText(npmManifestUrl(name,latest.floating?'latest':latest.version))),name)??null):null);}catch{icons.set(name,null);}}));
   return {icons:Object.fromEntries(wanted.map(name=>[name,icons.get(name)??null]))};
  }
  if(method==='POST'&&pathname==='/review-complete'){const result=await operations.completeConversationReview({reviewId:data.reviewId,judgment:data.judgment});for(const job of jobs.values())if(['review','review-again','source-review'].includes(job.action)&&job.result?.reviewId===data.reviewId){job.result={...job.result,...result};job.handoff={...job.handoff,status:'reviewed-main-conversation'};job.text='目前 Codex 主對話已完成審查，請查看意見並決定是否繼續。';}return result;}
  if(method==='GET'&&pathname==='/catalog')return catalog(params.get('refresh')==='1');
  if(method==='GET'&&pathname==='/readme'){const {entry,picked}=lookup(params.get('name'),params.get('version')),key=entry.name+'@'+picked.version;if(!readmes.has(key)){try{const found=await readReadme(fetchText,entry,picked);readmes.set(key,found?{phase:'done',text:found.text.slice(0,300000),truncated:found.text.length>300000,url:found.url,from:found.from,base:found.url.replace(/[^/]*$/,'')}:{phase:'none'});}catch(cause){return {phase:'error',error:cause.message};}}return readmes.get(key);}
  if(method==='GET'&&pathname==='/downloads'){const names=(params.get('names')??'').split(',').filter(n=>entries.some(e=>e.name===n&&e.versions[0]?.source.type==='npm')).slice(0,100);await Promise.all(npmDownloadsUrls(names.filter(n=>!counts.has(n))).map(async url=>{try{for(const [n,c]of parseNpmDownloads(JSON.parse(await fetchText(url))))counts.set(n,c);}catch{}}));for(const n of names)if(!counts.has(n))counts.set(n,null);return {counts:Object.fromEntries(names.map(n=>[n,counts.get(n)]))};}
  if(method==='GET'&&pathname==='/jobs')return {jobs:[...jobs.values()].slice(-50).map(publicJob)};
  if(method==='POST'&&pathname==='/jobs'){
   if(data.action==='install-package'){if(data.consent!==true||typeof data.packageRoot!=='string')throw fail('請查看轉換結果並同意安裝');return enqueue('install',{title:'已轉換的插件'},async job=>{job.result=await operations.install({packageRoot:data.packageRoot},{onProgress:progress(job)});job.text='已安裝，請新開 Codex 聊天載入。';});}
   if(data.action==='ai-search'){if(typeof data.query!=='string'||!data.query.trim()||data.query.length>300)throw fail('描述要寫 1 到 300 個字');return enqueue('ai-search',{query:data.query},async job=>{job.text='正在使用 Codex ChatGPT 登入搜尋…';job.results=await searchImpl({query:data.query,lang:data.lang,entries,dataRoot,codexHome,onProgress:progress(job)});job.text=`AI 搜尋完成，找到 ${job.results.length} 個插件。`;});}
   if(data.action==='open-folder'){const original=jobs.get(data.job);if(!original?.path)throw fail('這個工作沒有資料夾可以開');return enqueue('open-folder',{name:original.name,path:original.path},async job=>{await operations.openFolder(original.path);job.text='已開啟資料夾';});}
   if(['prepare','install','review-again'].includes(data.action)){
    const previous=jobs.get(data.job);if(!previous||previous.phase!=='done')throw fail('請先完成前一項工作');
    return enqueue(data.action,{name:previous.name,version:previous.version,title:previous.title},async job=>{
     job.plugin=previous.plugin;job.resolvedVersion=previous.resolvedVersion;
     if(data.action==='review-again'){
      const aiScope=data.aiScope??'auto';if(!['auto','code','all','none'].includes(aiScope))throw fail('不支援的審查範圍');
      job.result=await operations.review(job.plugin,{version:job.resolvedVersion,reviewId:previous.result.reviewId,aiScope,skipAI:true,onProgress:progress(job)});job.path=job.result.path;
      if(previous.handoff)previous.handoff.status='superseded';
      job.handoff={status:aiScope==='none'?'static-only':'awaiting-main-conversation',aiScope,reviewId:job.result.reviewId,sourceRoot:job.path,packageName:job.plugin.name,version:job.resolvedVersion};
      if(aiScope!=='none'&&dispatchReview)try{const sent=await dispatchReview({reviewId:job.result.reviewId});if(sent?.submitted!==true)throw Error('桌面沒有確認接收審查。');job.handoff.status='submitted-to-main-conversation';}catch(cause){job.handoff.deliveryError=cause.message;}
      job.text=aiScope==='none'?'已選擇只看固定規則結果，未送出模型審查。':'已依你選的範圍準備，等待目前主對話審查。';
     }else if(data.action==='prepare'){
      if(data.consent!==true)throw fail('請先查看報告並同意轉換');
      const complete=previous.result?.sourceReview?.reviewOrigin==='main-conversation';
      if(!complete&&data.skipMainReview!==true)throw fail('目前主對話尚未完成；可等審查回報，或勾選「只看固定掃描繼續」後轉換。');
      job.result=await operations.prepare(job.plugin,{version:job.resolvedVersion,reviewId:previous.result.reviewId,consent:true,forceObfuscated:data.forceObfuscated===true,onProgress:progress(job)});job.path=job.result.packageRoot;job.text='轉換完成，請查看權限並決定安裝。';
     }else{
      if(previous.action!=='prepare'||!['ready','partial'].includes(previous.result?.status))throw fail('請先完成可用插件的轉換檢查');
      job.result=await operations.install(previous.result,{onProgress:progress(job)});job.text='已安裝，請新開 Codex 聊天載入。';
     }
    });
   }
   if(!['review','scan','download'].includes(data.action))throw fail('不認得的動作');const {entry,picked}=lookup(data.name,data.version);return enqueue(data.action,{name:entry.name,version:picked.version,title:entry.title},async job=>{const resolved=await resolve(entry,picked);job.plugin=resolved.plugin;job.resolvedVersion=resolved.version;const options={version:resolved.version,onProgress:progress(job),reviewSettings:data.reviewSettings,skipAI:true,aiScope:'none'};job.result=await operations[data.action](resolved.plugin,options);job.path=job.result.path;if(data.action==='review'){
 job.handoff={status:'awaiting-main-conversation',reviewId:job.result.reviewId,sourceRoot:job.path,packageName:resolved.plugin.name,version:resolved.version,sourceDigest:job.result.sourceReview?.sourceDigest};
 if(dispatchReview)try{const sent=await dispatchReview({reviewId:job.result.reviewId});if(sent?.submitted!==true)throw Error('桌面沒有確認接收這筆審查。');job.handoff.status='submitted-to-main-conversation';job.handoff.transport=sent.transport;}catch(cause){job.handoff.deliveryError=cause.message;}
 }job.text=data.action==='download'?'已下載來源；未執行、未安裝。':data.action==='scan'?'固定規則掃描完成；未呼叫 AI、未安裝。':(job.handoff?.status==='submitted-to-main-conversation'?'已送到開啟市場的 Codex 主對話，請到對話查看審查進度。':('來源已下載並掃描，但尚未送進主對話。'+(job.handoff?.deliveryError??'請從 Codex 對話開啟市場以連接。')));if(data.action==='scan'&&job.result.scan)job.markdown=renderCCScanOverview(job.result.scan,{source:{origin:job.result.packageName??job.name,root:job.path,remote:true},reportPath:job.result.reportPath});else if(job.result.scan)job.markdown='```json\n'+JSON.stringify(job.result.scan,null,2)+'\n```';});
  }
  throw fail('找不到這個市場操作',404);
 }
 return {handle,close:async()=>{await queue;await management.close();},get jobs(){return jobs;}};
}
