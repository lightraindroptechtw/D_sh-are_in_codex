import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import {BlockList, isIP} from 'node:net';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import semver from 'semver';

export const DEFAULT_MARKETS = Object.freeze([
  Object.freeze({id:'dsh-open',title:'DSH 開放插件市場',url:'https://dshopen.org/index.json'}),
  Object.freeze({id:'awesome-dsh',title:'DSH 社群精選',url:'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json'}),
]);

function fail(message, code='MARKET_INDEX_INVALID') { throw Object.assign(new Error(message),{code}); }
function object(value,path) { if(!value||typeof value!=='object'||Array.isArray(value))fail(`${path}: 必須是物件`);return value; }
function text(value,path) { if(typeof value!=='string'||!value.trim())fail(`${path}: 必須是非空文字`);return value; }
function localized(value,path,{optional=false}={}) {
  if(value===undefined&&optional)return {};
  if(typeof value==='string')return {en:text(value,path)};
  object(value,path);if(!Object.hasOwn(value,'en'))fail(`${path}.en: 缺少英文備援文字`);
  return Object.fromEntries(Object.entries(value).map(([key,item])=>{
    if(!/^[a-z]{2,8}(-[a-z0-9]{1,8})*$/.test(key))fail(`${path}: 無效語言代碼`);
    return [key,text(item,`${path}.${key}`)];
  }));
}
function selectText(value,locale,fallback='') { return value[locale]||value[locale.split('-')[0]]||value.zh||value.en||fallback; }

/** Validate web links without fetching them. Fragments are permitted only for display homepages. */
export function validateMarketUrl(input,{allowFragment=false,allowQuery=true,httpsOnly=false}={}) {
  if(typeof input!=='string'||/[\x00-\x20\x7f\\]/.test(input))fail('市場網址含有無效字元','MARKET_URL_INVALID');
  let url;try{url=new URL(input);}catch{fail('市場網址無效','MARKET_URL_INVALID');}
  if(!['http:','https:'].includes(url.protocol)||(httpsOnly&&url.protocol!=='https:')||url.username||url.password||(!allowFragment&&url.hash)||(!allowQuery&&url.search))fail('市場網址必須使用允許的 HTTP/HTTPS 格式，且不可含憑證或禁用的查詢與片段','MARKET_URL_INVALID');
  return url.href;
}

function directory(value,path) {
  text(value,path);if(value.split('/').some(part=>!part||part==='.'||part==='..'||!/^[a-zA-Z0-9._@+-]+$/.test(part)))fail(`${path}: 必須是安全的相對目錄`);
  return value;
}
function packageName(value,path) {
  text(value,path);
  if(value.length>214||!/^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/.test(value)||['node_modules','favicon.ico'].includes(value))fail(`${path}: 無效 npm 套件名稱`);
  return value;
}
function versionRow(row,path) {
  object(row,path);const version=text(row.version,`${path}.version`);
  if(!semver.valid(version)||!/^[0-9]/.test(version))fail(`${path}.version: 必須是精確的語意版本`);
  if(!Number.isInteger(row.publishTimestamp)||row.publishTimestamp<0||row.publishTimestamp>=1e11)fail(`${path}.publishTimestamp: 無效發佈時間`);
  const src=object(row.source,`${path}.source`);let source;
  if(src.type==='npm') {
    if(semver.valid(version)!==version)fail(`${path}.version: npm 必須使用正式的精確版本`);
    source={type:'npm'};
    if(src.registry!==undefined)source.registry=validateMarketUrl(src.registry,{allowQuery:false});
  } else if(src.type==='git') {
    const url=validateMarketUrl(src.url,{httpsOnly:true,allowQuery:false});
    if(url!==src.url||new URL(url).pathname.split('/').filter(Boolean).length<2||url.endsWith('/')||/\.(tgz|tar\.gz)$/.test(url))fail(`${path}.source.url: 必須是明確的 HTTPS Git 倉庫網址`);
    if(typeof src.commit!=='string'||!/^[0-9a-f]{40}$/.test(src.commit))fail(`${path}.source.commit: 必須是 40 位小寫十六進位提交`);
    source={type:'git',url,commit:src.commit};
    if(src.path!==undefined)source.path=directory(src.path,`${path}.source.path`);
  } else fail(`${path}.source.type: 不支援的來源種類`);
  const engines={};
  // Real community indexes still include engines:{}; absence is preserved and is not a compatibility claim.
  if(row.engines!==undefined) {
    object(row.engines,`${path}.engines`);
    if(row.engines.dsh!==undefined) {
      if(typeof row.engines.dsh!=='string'||!row.engines.dsh.trim()||!semver.validRange(row.engines.dsh))fail(`${path}.engines.dsh: 無效版本範圍`);
      engines.dsh=row.engines.dsh;
    }
  }
  return {version,publishTimestamp:row.publishTimestamp,source,engines};
}

/** Pure data projection. Strings remain text; callers must use textContent or HTML escaping. */
export function normalizeMarketIndex(raw,{sourceUrl='',sourceId,locale='zh'}={}) {
  object(raw,'index');if(raw.format!==1)fail('index.format: 僅支援格式 1');
  if(!Array.isArray(raw.plugins))fail('index.plugins: 必須是陣列');
  if(sourceUrl)sourceUrl=validateMarketUrl(sourceUrl);
  sourceId=sourceId||createHash('sha256').update(sourceUrl||'offline').digest('hex').slice(0,16);
  const titleLocalized=localized(raw.title,'index.title'),descriptionLocalized=localized(raw.description,'index.description',{optional:true});
  const metadata=raw.metadata===undefined?{}:object(raw.metadata,'index.metadata');
  function declarations(key) {
    const values=metadata[key]===undefined?{}:object(metadata[key],`index.metadata.${key}`);
    return Object.entries(values).map(([id,row])=>{
      text(id,`index.metadata.${key}.id`);object(row,`index.metadata.${key}.${id}`);
      const titleLocalized=localized(row.title,`index.metadata.${key}.${id}.title`);
      return {id,title:selectText(titleLocalized,locale),titleLocalized,count:0};
    });
  }
  const categories=declarations('categories'),labels=declarations('labels');
  const categoryMap=new Map(categories.map(row=>[row.id,row])),labelMap=new Map(labels.map(row=>[row.id,row]));
  const names=new Set();
  const plugins=raw.plugins.map((row,index)=>{
    const path=`index.plugins[${index}]`;object(row,path);const name=packageName(row.name,`${path}.name`);
    if(names.has(name))fail(`${path}.name: 重複的套件名稱`);names.add(name);
    const titleLocalized=localized(row.title,`${path}.title`,{optional:true}),descriptionLocalized=localized(row.description,`${path}.description`,{optional:true});
    const meta=row.metadata===undefined?{}:object(row.metadata,`${path}.metadata`);
    const category=meta.category===undefined?'':text(meta.category,`${path}.metadata.category`);
    if(category&&!categoryMap.has(category))fail(`${path}.metadata.category: 未宣告的分類`);
    const keywordValues=meta.keywords??[],labelValues=meta.labels??[];
    if(!Array.isArray(keywordValues)||!keywordValues.every(value=>typeof value==='string'))fail(`${path}.metadata.keywords: 必須是文字陣列`);
    if(!Array.isArray(labelValues)||labelValues.some(value=>!labelMap.has(value))||new Set(labelValues).size!==labelValues.length)fail(`${path}.metadata.labels: 無效或未宣告的標籤`);
    if(!Array.isArray(row.versions)||!row.versions.length)fail(`${path}.versions: 至少需要一個明確版本`);
    const versions=row.versions.map((value,i)=>versionRow(value,`${path}.versions[${i}]`));
    if(new Set(versions.map(value=>value.version)).size!==versions.length)fail(`${path}.versions: 重複版本`);
    versions.sort((a,b)=>semver.rcompare(a.version,b.version));
    let repository=null;
    if(row.repository!==undefined) {
      object(row.repository,`${path}.repository`);repository={url:validateMarketUrl(row.repository.url,{allowQuery:false})};
      if(row.repository.directory!==undefined)repository.directory=directory(row.repository.directory,`${path}.repository.directory`);
    }
    if(category)categoryMap.get(category).count++;
    for(const label of labelValues)labelMap.get(label).count++;
    const distTags={};
    if(row['dist-tags']!==undefined)for(const [tag,target] of Object.entries(object(row['dist-tags'],`${path}.dist-tags`))) {
      if(!tag||/[\s@/#\\]/.test(tag)||semver.validRange(tag)||!versions.some(value=>value.version===target))fail(`${path}.dist-tags: 無效通道或未列出的版本`);
      Object.defineProperty(distTags,tag,{value:target,enumerable:true});
    }
    return {id:`${sourceId}:${name}`,sourceId,sourceUrl,name,title:selectText(titleLocalized,locale,name),description:selectText(descriptionLocalized,locale),titleLocalized,descriptionLocalized,
      author:row.author===undefined?'':text(row.author,`${path}.author`),category,categoryTitle:categoryMap.get(category)?.title||'',
      homepage:row.homepage===undefined?'':validateMarketUrl(row.homepage,{allowFragment:true}),repository,
      keywords:[...keywordValues],labels:[...labelValues],labelTitles:labelValues.map(value=>labelMap.get(value).title),
      versions,distTags,latestVersion:versions[0].version,publishTimestamp:Math.max(...versions.map(value=>value.publishTimestamp))};
  });
  return {format:1,sourceUrl,sourceId,title:selectText(titleLocalized,locale),description:selectText(descriptionLocalized,locale),titleLocalized,descriptionLocalized,plugins,categories,labels,total:plugins.length};
}

export function searchMarket(catalog,{query='',category='',page=1,pageSize=24}={}) {
  if(!Number.isInteger(Number(page))||Number(page)<1)fail('page: 必須為正整數','MARKET_QUERY_INVALID');
  if(!Number.isInteger(Number(pageSize))||Number(pageSize)<1||Number(pageSize)>200)fail('pageSize: 必須為 1 至 200','MARKET_QUERY_INVALID');
  page=Number(page);pageSize=Number(pageSize);
  if(typeof query!=='string'||query.length>2000||typeof category!=='string')fail('無效的搜尋條件','MARKET_QUERY_INVALID');
  const terms=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const items=catalog.plugins.filter(row=>{
    if(category&&row.category!==category)return false;
    const categoryInfo=catalog.categories.find(value=>value.id===row.category);
    const labelInfo=row.labels.map(id=>catalog.labels.find(value=>value.id===id));
    const words=[row.name,row.author,row.category,...Object.values(row.titleLocalized),...Object.values(row.descriptionLocalized),...row.keywords,...row.labels,...Object.values(categoryInfo?.titleLocalized||{}),...labelInfo.flatMap(value=>Object.values(value?.titleLocalized||{}))].join('\n').normalize('NFKC').toLocaleLowerCase();
    return terms.every(term=>words.includes(term));
  });
  return {items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize,totalPages:Math.ceil(items.length/pageSize),categories:catalog.categories};
}

const privateIPv4=new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]])privateIPv4.addSubnet(network,prefix,'ipv4');
const publicIPv6=new BlockList(),specialIPv6=new BlockList();publicIPv6.addSubnet('2000::',3,'ipv6');
for(const [network,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])specialIPv6.addSubnet(network,prefix,'ipv6');
function isPublicAddress(address) {
  if(isIP(address)===4)return !privateIPv4.check(address,'ipv4');
  if(isIP(address)===6)return publicIPv6.check(address,'ipv6')&&!specialIPv6.check(address,'ipv6');
  return false;
}
function checkPublicHost(url) {
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if((isIP(host)&&!isPublicAddress(host))||host==='localhost'||(!isIP(host)&&!host.includes('.'))||/\.(localhost|local|internal|home|lan)$/i.test(host))fail('索引網址不可存取本機或私人網路','MARKET_URL_BLOCKED');
}

function nativeFetch(url,options) {
  return new Promise((resolve,reject)=>{
    const request=(url.protocol==='https:'?https:http).request(url,{method:'GET',signal:options.signal,headers:options.headers,
      lookup(hostname,lookupOptions,callback) {
        dns.lookup(hostname,{all:true,verbatim:true},(error,addresses)=>{
          if(error)return callback(error);
          if(!addresses.length||addresses.some(row=>!isPublicAddress(row.address)))return callback(Object.assign(new Error('索引網域解析到本機或私人網路'),{code:'MARKET_URL_BLOCKED'}));
          callback(null,lookupOptions.all?addresses:addresses[0].address,...(lookupOptions.all?[]:[addresses[0].family]));
        });
      }},response=>resolve({status:response.statusCode,ok:response.statusCode>=200&&response.statusCode<300,url:url.href,headers:{get:key=>response.headers[key.toLowerCase()]},body:Readable.toWeb(response)}));
    request.on('error',reject);request.end();
  });
}

/** Fetch one public HTTP(S) hop, pinning the checked DNS answers to the socket.
 * Redirects are returned to the caller and must be checked as separate hops.
 * The signal stays attached to the request while its response body is consumed.
 */
export function fetchPublicResource(input,options={}) {
  const url=new URL(validateMarketUrl(String(input)));checkPublicHost(url);
  return nativeFetch(url,options);
}

/** Download JSON only. No redirect, source execution, installation, icon loading, or model call. */
export async function fetchMarketIndex(input,{fetchImpl,timeoutMs=30000,maxBytes=128*1024*1024,signal,...normalizeOptions}={}) {
  const sourceUrl=validateMarketUrl(input),url=new URL(sourceUrl);checkPublicHost(url);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>128*1024*1024)fail('無效下載限制','MARKET_FETCH_CONFIG_INVALID');
  const controller=new AbortController();let rejectAbort;
  const abortPromise=new Promise((_,reject)=>{rejectAbort=reject;});
  function abort(reason) {controller.abort(reason);rejectAbort(reason);}
  const onAbort=()=>abort(signal.reason||Object.assign(new Error('市場下載已取消'),{code:'MARKET_FETCH_ABORTED'}));
  const timer=setTimeout(()=>abort(Object.assign(new Error('市場索引下載逾時'),{code:'MARKET_FETCH_TIMEOUT'})),timeoutMs);
  if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});
  try {
    const operation=async()=>{
      controller.signal.throwIfAborted();
      const options={method:'GET',redirect:'manual',signal:controller.signal,headers:{accept:'application/json','accept-encoding':'identity','user-agent':'dsh-to-codex-market/0.5.0'}};
      const response=await (fetchImpl?fetchImpl(sourceUrl,options):fetchPublicResource(sourceUrl,options));
      const cancel=()=>response.body?.cancel?.().catch(()=>{});
      if(response.status>=300&&response.status<400){cancel();fail('市場索引不允許重新導向','MARKET_FETCH_REDIRECT');}
      if(!response.ok){cancel();fail(`市場索引下載失敗（HTTP ${response.status}）`,'MARKET_FETCH_HTTP');}
      if(response.redirected||(response.url&&response.url!==sourceUrl)){cancel();fail('市場索引來源網址變更','MARKET_FETCH_REDIRECT');}
      const encoding=response.headers.get('content-encoding');
      if(encoding&&encoding!=='identity'&&!fetchImpl){cancel();fail('市場索引伺服器忽略未壓縮要求','MARKET_FETCH_ENCODING');}
      const length=Number(response.headers.get('content-length'));
      if(Number.isFinite(length)&&length>maxBytes){cancel();fail('市場索引超過下載大小限制','MARKET_FETCH_TOO_LARGE');}
      if(!response.body?.getReader){cancel();fail('市場索引沒有可讀取的內容','MARKET_FETCH_BODY');}
      const reader=response.body.getReader(),chunks=[];let size=0;
      try {while(true){controller.signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('市場索引超過下載大小限制','MARKET_FETCH_TOO_LARGE');}chunks.push(value);}}
      finally {reader.releaseLock();}
      let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('市場索引不是有效的 UTF-8 JSON','MARKET_FETCH_JSON');}
      return {...normalizeMarketIndex(raw,{...normalizeOptions,sourceUrl}),fetchedAt:new Date().toISOString(),downloadBytes:size};
    };
    return await Promise.race([operation(),abortPromise]);
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
