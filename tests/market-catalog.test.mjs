import {test} from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import {DEFAULT_MARKETS,fetchMarketIndex,normalizeMarketIndex,searchMarket,validateMarketUrl} from '../lib/market-catalog.mjs';

const indexUrl='https://market.example/index.json';
const npmVersion=(version='1.0.0')=>({version,publishTimestamp:1790000000,source:{type:'npm'},engines:{}});
function fixture() {
  return {format:1,title:{en:'Community plugins',zh:'社群插件'},description:'A community index',metadata:{categories:{tools:{title:{en:'Tools',zh:'工具'}}},labels:{reviewed:{title:{en:'Reviewed',zh:'已審查'}}}},plugins:[
    {name:'@example/memory',title:{en:'Memory notebook',zh:'記憶筆記'},description:{en:'Find project decisions',zh:'尋找專案決策'},author:'Jane Doe',homepage:'https://example.org/memory#readme',repository:{url:'https://github.com/example/plugins',directory:'packages/memory'},metadata:{category:'tools',keywords:['archive'],labels:['reviewed']},versions:[npmVersion('1.0.0'),{...npmVersion('2.0.0-beta.1'),source:{type:'npm',registry:'https://registry.npmjs.org/'},engines:{dsh:'>=0.2.0-rc.2'}}]},
    {name:'git-plugin',description:'Read local notes',versions:[{version:'0.3.1+git.123',publishTimestamp:1790000001,source:{type:'git',url:'https://github.com/example/project',commit:'a'.repeat(40),path:'packages/plugin'},engines:{dsh:'*'}}]},
  ]};
}
const response=(value=fixture(),options={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'},...options});
const code=expected=>error=>error.code===expected;

test('normalization preserves real format-1 npm, git, localization and monorepo fields without mutating source',()=>{
  const raw=fixture(),copy=structuredClone(raw),catalog=normalizeMarketIndex(raw,{sourceUrl:indexUrl,sourceId:'test'}),[first,second]=catalog.plugins;
  assert.deepEqual(raw,copy);assert.equal(catalog.total,2);assert.equal(catalog.title,'社群插件');assert.equal(catalog.description,'A community index');
  assert.equal(first.id,'test:@example/memory');assert.equal(first.sourceUrl,indexUrl);assert.equal(first.title,'記憶筆記');assert.equal(first.titleLocalized.en,'Memory notebook');assert.equal(first.categoryTitle,'工具');assert.equal(first.author,'Jane Doe');
  assert.equal(first.versions[0].version,'2.0.0-beta.1');assert.equal(first.versions[0].source.registry,'https://registry.npmjs.org/');assert.deepEqual(first.versions[1].engines,{});
  assert.deepEqual(first.repository,{url:'https://github.com/example/plugins',directory:'packages/memory'});assert.equal(first.homepage,'https://example.org/memory#readme');
  assert.equal(second.title,'git-plugin');assert.equal(second.versions[0].version,'0.3.1+git.123');assert.equal(second.versions[0].source.path,'packages/plugin');assert.equal(catalog.categories[0].count,1);
});

test('all languages, names, authors, keywords, declared category and label titles are searchable',()=>{
  const catalog=normalizeMarketIndex(fixture(),{locale:'en'});
  for(const query of ['記憶筆記','memory notebook','專案決策','JANE DOE','archive','工具','已審查'])assert.equal(searchMarket(catalog,{query}).items[0]?.name,'@example/memory',query);
  assert.equal(searchMarket(catalog,{query:'Jane archive'}).total,1);assert.equal(searchMarket(catalog,{query:'Jane missing'}).total,0);
  assert.equal(searchMarket(catalog,{category:'tools'}).total,1);assert.equal(searchMarket(catalog,{category:'undeclared'}).total,0);
});

test('full indexes above 6,000 rows remain searchable and paginated without truncation',()=>{
  const raw={format:1,title:'Large market',plugins:Array.from({length:7013},(_,i)=>({name:`plugin-${i}`,versions:[npmVersion()]}))};
  const catalog=normalizeMarketIndex(raw),last=searchMarket(catalog,{page:36,pageSize:200});
  assert.equal(catalog.total,7013);assert.equal(last.total,7013);assert.equal(last.totalPages,36);assert.equal(last.items.length,13);assert.equal(last.items.at(-1).name,'plugin-7012');
  assert.equal(searchMarket(catalog,{query:'plugin-7012'}).total,1);assert.equal(searchMarket(catalog,{page:37,pageSize:200}).items.length,0);
  assert.throws(()=>searchMarket(catalog,{pageSize:201}),code('MARKET_QUERY_INVALID'));assert.throws(()=>searchMarket(catalog,{page:0}),code('MARKET_QUERY_INVALID'));
});

test('untrusted HTML and instruction-like source strings stay literal text and no icons are retained',()=>{
  const raw=fixture();raw.plugins[0].title='<script>globalThis.compromised=true</script>';raw.plugins[0].description='<img src=x onerror=alert(1)>';raw.plugins[0].icon='data:image/svg+xml;base64,PHN2Zz4=';
  const item=normalizeMarketIndex(raw).plugins[0];assert.equal(item.title,raw.plugins[0].title);assert.equal(item.description,raw.plugins[0].description);assert.equal('icon' in item,false);assert.equal(globalThis.compromised,undefined);
});

test('invalid format, duplicate identity and malformed localization reject the index rather than silently dropping rows',()=>{
  for(const mutate of [r=>r.format=2,r=>r.plugins.push(structuredClone(r.plugins[0])),r=>r.plugins[0].versions.push(npmVersion()),r=>r.title={zh:'只有中文'},r=>r.plugins[0].name='../../escape',r=>r.plugins[0].versions=[]]){
    const raw=fixture();mutate(raw);assert.throws(()=>normalizeMarketIndex(raw),code('MARKET_INDEX_INVALID'));
  }
});

test('versions, git commits, source types, registry URLs and relative directories are validated',()=>{
  for(const mutate of [r=>r.plugins[0].versions[0].version='latest',r=>r.plugins[0].versions[0].version='1.0.0;echo hacked',r=>r.plugins[1].versions[0].source.commit='main',r=>r.plugins[1].versions[0].source.path='../escape',r=>r.plugins[1].versions[0].source.url='http://github.com/example/repo',r=>r.plugins[0].versions[0].source={type:'shell',command:'echo bad'},r=>r.plugins[0].versions[0].source.registry='https://user:secret@example.org/',r=>r.plugins[0].repository.directory='packages\\escape',r=>r.plugins[0].versions[0].engines.dsh='bad-range']) {
    const raw=fixture();mutate(raw);assert.throws(()=>normalizeMarketIndex(raw));
  }
});

test('metadata references use own-property semantics, including constructor ids',()=>{
  const raw=fixture();raw.metadata.categories=JSON.parse('{"constructor":{"title":"Special"}}');raw.plugins[0].metadata.category='constructor';
  assert.equal(normalizeMarketIndex(raw).plugins[0].categoryTitle,'Special');
  raw.plugins[0].metadata.category='toString';assert.throws(()=>normalizeMarketIndex(raw),code('MARKET_INDEX_INVALID'));
});

test('exact distribution tags stay separate from highest version and reject missing targets',()=>{
  const raw=fixture();raw.plugins[0]['dist-tags']={latest:'1.0.0',next:'2.0.0-beta.1'};
  const item=normalizeMarketIndex(raw).plugins[0];assert.equal(item.distTags.latest,'1.0.0');assert.equal(item.latestVersion,'2.0.0-beta.1');
  raw.plugins[0]['dist-tags'].latest='9.0.0';assert.throws(()=>normalizeMarketIndex(raw),code('MARKET_INDEX_INVALID'));
});

test('download reads an entire JSON stream with explicit redirect policy and returns normalized data',async()=>{
  let calls=0;const catalog=await fetchMarketIndex(indexUrl,{fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,indexUrl);assert.equal(options.redirect,'manual');assert.equal(options.method,'GET');return response();
  }});
  assert.equal(calls,1);assert.equal(catalog.total,2);assert.ok(catalog.downloadBytes>0);assert.ok(catalog.fetchedAt);assert.equal(DEFAULT_MARKETS.length,2);
});

test('download rejects redirects and failed status without following target URLs',async()=>{
  let calls=0;
  await assert.rejects(fetchMarketIndex(indexUrl,{fetchImpl:async()=>{calls++;return new Response('',{status:302,headers:{location:'http://127.0.0.1/secret'}});}}),code('MARKET_FETCH_REDIRECT'));
  assert.equal(calls,1);await assert.rejects(fetchMarketIndex(indexUrl,{fetchImpl:async()=>response({}, {status:404})}),code('MARKET_FETCH_HTTP'));
  await assert.rejects(fetchMarketIndex(indexUrl,{fetchImpl:async()=>({...response(),ok:true,status:200,redirected:true,body:new ReadableStream(),headers:new Headers()})}),code('MARKET_FETCH_REDIRECT'));
});

test('download enforces advertised and streamed byte limits and cancels oversized content',async()=>{
  await assert.rejects(fetchMarketIndex(indexUrl,{maxBytes:20,fetchImpl:async()=>response(fixture(),{headers:{'content-length':'1000'}})}),code('MARKET_FETCH_TOO_LARGE'));
  let canceled=false;const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(30));},cancel(){canceled=true;}});
  await assert.rejects(fetchMarketIndex(indexUrl,{maxBytes:20,fetchImpl:async()=>new Response(body)}),code('MARKET_FETCH_TOO_LARGE'));assert.equal(canceled,true);
});

test('download rejects invalid JSON and invalid UTF-8, while preserving normal non-ASCII strings',async()=>{
  for(const value of ['<html>not JSON</html>',new Uint8Array([0xff,0xfe])])await assert.rejects(fetchMarketIndex(indexUrl,{fetchImpl:async()=>new Response(value)}),code('MARKET_FETCH_JSON'));
});

test('timeout and cancellation terminate a stalled injected request, including pre-aborted signals',async()=>{
  await assert.rejects(fetchMarketIndex(indexUrl,{timeoutMs:15,fetchImpl:()=>new Promise(()=>{})}),code('MARKET_FETCH_TIMEOUT'));
  const controller=new AbortController();controller.abort(new Error('fixture canceled'));let called=false;
  await assert.rejects(fetchMarketIndex(indexUrl,{signal:controller.signal,fetchImpl:async()=>{called=true;return response();}}),/fixture canceled/);assert.equal(called,false);
});

test('index URL validation blocks local aliases, credentials, non-web schemes and fragments before fetching',async()=>{
  let calls=0;
  for(const url of ['http://localhost/index.json','http://127.0.0.1/','http://2130706433/','http://10.0.0.1/','http://[::1]/','http://[::ffff:127.0.0.1]/','http://[2001::1]/','http://[2001:db8::1]/','https://user:password@example.org/','file:///etc/passwd','https://example.org/index.json#fragment'])await assert.rejects(fetchMarketIndex(url,{fetchImpl:async()=>{calls++;return response();}}));
  assert.equal(calls,0);assert.equal(validateMarketUrl('https://example.org/#readme',{allowFragment:true}),'https://example.org/#readme');
});

test('actual native request rejects private DNS resolution before connecting',async t=>{
  let lookups=0;t.mock.method(dns,'lookup',(hostname,options,callback)=>{lookups++;callback(null,[{address:'127.0.0.1',family:4}]);});
  await assert.rejects(fetchMarketIndex('https://market.fixture.invalid/index.json'),code('MARKET_URL_BLOCKED'));assert.equal(lookups,1);
});
