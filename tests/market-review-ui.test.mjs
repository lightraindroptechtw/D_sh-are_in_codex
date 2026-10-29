import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import domino from '@mixmark-io/domino';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';

test('main conversation advice appears before closed raw scan details',async()=>{
 const {run}=await browserFixture();
 const box=run(`marketUI.resultControls({action:'review',phase:'done',result:{sourceReview:{status:'approved',reviewOrigin:'main-conversation',summary:'主對話完成白話判讀',coverageNotice:'只讀了入口檔',aiPlan:{inputChars:3000}},scan:{files:[{file:'index.mjs'}],findings:[{file:'index.mjs',line:1,label:'網路'}]}}})`);
 assert.match(box.firstChild.textContent,/主對話完成白話判讀/);
 const detail=Array.from(box.querySelectorAll('details')).find(el=>el.querySelector('summary').textContent.includes('固定規則掃描原始結果'));
 assert.ok(detail);assert.equal(detail.hasAttribute('open'),false);assert.equal(JSON.parse(detail.querySelector('pre').textContent).findings[0].line,1);
 assert.match(box.textContent,/繼續轉換/);
});

test('submitted review shows delivery status without asking the user to copy a prompt',async()=>{
 const {run}=await browserFixture();
 const box=run(`marketUI.resultControls({action:'review',phase:'done',handoff:{status:'submitted-to-main-conversation'},result:{}})`);
 assert.match(box.textContent,/已送到開啟市場的 Codex 主對話/);assert.equal(box.querySelectorAll('textarea').length,0);
});

async function browserFixture({url='http://127.0.0.1:1234/',storage={getItem:()=>'',setItem(){}},fetchImpl=()=>{throw Error('Unexpected network');}}={}){
 const html=await fs.readFile(new URL('../web/market/index.html',import.meta.url),'utf8');
 const code=await fs.readFile(new URL('../web/market/app.js',import.meta.url),'utf8');
 const bundled=await build({stdin:{contents:code+'\nexport {state,render,renderDetail,chooseLang,filtered,resultControls,currentReviewSettings,reviewSettingsPanel,setFilter,KEY,api,applyInstalled,toggleFavorite,manageAction,loadIcons,indexEntries,syncAi};',resolveDir:fileURLToPath(new URL('../web/market/',import.meta.url)),loader:'js'},bundle:true,format:'iife',globalName:'marketUI',write:false});
 const window=domino.createWindow(html,url),prototype=window.Element.prototype;
 prototype.append=function(...nodes){for(const child of nodes)this.appendChild(typeof child==='string'?window.document.createTextNode(child):child);};

 prototype.replaceChildren=function(...nodes){while(this.firstChild)this.removeChild(this.firstChild);this.append(...nodes);};prototype.scrollIntoView=function(){};
 Object.defineProperty(prototype,'dataset',{configurable:true,get(){return Object.fromEntries(Array.from(this.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),a.value]));}});
 const location=new URL(url);
 const context=vm.createContext({document:window.document,window,Node:window.Node,Element:window.Element,location,history:{replaceState(_state,_title,next){location.href=new URL(next,location).href;}},sessionStorage:storage,localStorage:{getItem:()=>null,setItem(){}},navigator:{language:'zh-TW'},URL,URLSearchParams,Intl,Date,setTimeout:()=>0,clearTimeout(){},setInterval:()=>1,clearInterval(){},ResizeObserver:class{observe(){}},fetch:fetchImpl});
 vm.runInContext(bundled.outputFiles[0].text,context);return {document:window.document,location,run:script=>vm.runInContext(script,context)};
}
test('CC market retains language, search, filters, sorting, versions and editable review controls',async()=>{
 const {document,run}=await browserFixture();
 run(`marketUI.state.entries=[{name:'alpha',title:'Alpha',description:'影片字幕',author:'作者',category:'媒體',markets:['open'],updated:1,stars:2,versions:[{version:'1.0.0',type:'npm',published:1}],haystack:'alpha 影片字幕'},{name:'beta',title:'Beta',description:'工具',author:'作者',category:'工具',markets:['awesome'],updated:2,stars:10,versions:[{version:'2.0.0',type:'git',published:2}],haystack:'beta 工具'}];marketUI.state.counts.set('alpha',null);marketUI.state.meta={markets:[],sources:[]};marketUI.state.q='字幕';marketUI.render();`);
 assert.equal(document.querySelectorAll('.card').length,1);assert.match(document.getElementById('grid').textContent,/Alpha/);
 run(`marketUI.state.q='';marketUI.state.sort='stars';marketUI.render();`);assert.match(document.querySelector('.card h3').textContent,/Beta/);
 run(`marketUI.chooseLang('en');`);assert.equal(document.documentElement.lang,'en');assert.equal(document.querySelectorAll('#lang-panel button').length,9);
 run(`marketUI.state.selected='alpha';marketUI.state.version='1.0.0';marketUI.state.readmes.set('alpha@1.0.0',{phase:'none'});marketUI.renderDetail();`);
 assert.equal(document.getElementById('review-limit').value,'60000');assert.equal(document.getElementById('review-representatives').value,'3');assert.match(document.querySelector('.panel').textContent,/沿用該對話的模型與思考強度/);
 assert.match(document.querySelector('.panel').textContent,/review|Review/);
});
test('over-budget source review exposes three scope choices and explicit conversion consent',async()=>{
 const {document,run}=await browserFixture();
 run(`document.body.append(marketUI.resultControls({id:'review',action:'review',phase:'done',result:{reviewId:'source-id',sourceReview:{status:'needs-choice',summary:'超過用量建議上限，尚未呼叫 AI',aiPlan:{inputChars:90000,softLimitChars:60000}}}}));`);
 assert.match(document.body.textContent,/90000/);assert.match(document.body.textContent,/60000/);assert.match(document.body.textContent,/尚未呼叫 AI/);
 const buttons=Array.from(document.querySelectorAll('button')).map(el=>el.textContent);for(const label of ['只審程式片段','照樣審查全部合併後片段','不用 AI','繼續轉換'])assert.ok(buttons.includes(label),label);
 assert.equal(document.querySelectorAll('input[type=checkbox]').length,2);
});

test('reload in the same tab restores the access key and authorizes API requests after the URL fragment is removed',async()=>{
 const key='a'.repeat(64),saved=new Map(),calls=[];
 const storage={getItem:name=>saved.get(name)??null,setItem:(name,value)=>saved.set(name,value)};
 const fetchImpl=async(route,options)=>{calls.push({route,headers:options.headers});return {ok:true,json:async()=>route==='/api/config'?{csrfToken:'synthetic-csrf'}:route==='/api/review-settings'?{model:'gpt-6.1-sol',reasoningEffort:'medium',maxInputChars:60000,representativePerCategory:3}:route.includes('catalog')?{entries:[],meta:{markets:[],sources:[]}}:route.includes('jobs')?{jobs:[]}:{items:[]}};};
 const first=await browserFixture({url:'http://127.0.0.1:1234/#access='+key,storage,fetchImpl});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(first.run('marketUI.KEY'),key);assert.equal(first.location.hash,'');assert.equal(saved.get('market-access'),key);
 const reload=await browserFixture({url:first.location.href,storage,fetchImpl});
 await new Promise(resolve=>setImmediate(resolve));
 assert.notEqual(reload.document,first.document);assert.equal(reload.location.hash,'');assert.equal(reload.run('marketUI.KEY'),key);
 await reload.run("marketUI.api('/api/prepared')");
 assert.equal(calls.filter(call=>call.route==='/api/config').length,2);
 for(const call of calls)assert.equal(call.headers.authorization,'Bearer '+key,call.route);
 assert.doesNotMatch(reload.document.getElementById('summary').textContent,/少了存取鑰匙/);
});
test('all nine missing-key and offline translations use the native Codex market entrypoint without a shortcut',async()=>{
 const text=await fs.readFile(new URL('../web/market/i18n.js',import.meta.url),'utf8');
 for(const key of ['nokey','offline']){
  const messages=Array.from(text.matchAll(new RegExp("'"+key+"': '([^'\\n]*)',",'g')),match=>match[1]);
  assert.equal(messages.length,9,key);
  for(const message of messages){assert.match(message,/Codex/);assert.match(message,/\$dsh-to-codex:dsh-market/);assert.match(message,/DSH/);assert.doesNotMatch(message,/\$dsh-market\b|\/dsh-market|捷徑|快捷方式|shortcut|ショートカット|바탕 화면|acceso directo|raccourci|ярлык|سطح المكتب/);}
  assert.match(messages[0],/回到 Codex 對話/);assert.match(messages[0],/開啟 DSH 插件市場/);assert.match(messages[2],/Codex conversation/);assert.match(messages[2],/Open the DSH plugin market/);
  if(key==='offline'){assert.match(messages[0],/插件會重新啟動服務/);assert.match(messages[2],/plugin will restart the service/);}
 }
});

test('latest CC toolbar keeps status and category filters in the funnel',async()=>{
 const {document,run}=await browserFixture();
 const toolbar=document.getElementById('toolbar');
 assert.deepEqual(Array.from(toolbar.children).map(el=>el.className),['sort','ghost tip','count','tools']);
 assert.deepEqual(Array.from(toolbar.querySelector('.tools').children).map(el=>el.id),['filter-wrap']);
 assert.equal(document.getElementById('cat-row'),null);
 assert.equal(document.querySelectorAll('#filter-panel section h2')[1].textContent,'分類');
 assert.deepEqual(Array.from(document.querySelectorAll('#filter-panel .codex-local-packages button')).map(el=>el.textContent),['待安裝的轉換結果']);
 assert.equal(document.getElementById('count').textContent,'');
 run("marketUI.state.ai={phase:'running',query:'字幕'};marketUI.render();");
 assert.match(document.getElementById('count').textContent,/Luna.*字幕/);
 run('marketUI.state.ai=null;marketUI.render();');assert.equal(document.getElementById('count').textContent,'');
});
test('latest CC source copy has recorded hashes and the exact original stylesheet before isolated detail-control additions',async()=>{
 const root=new URL('../web/market/',import.meta.url),record=JSON.parse(await fs.readFile(new URL('CC-LATEST-SYNC.json',root),'utf8'));
 assert.ok(Number.isFinite(Date.parse(record.copiedAt)));assert.equal(record.platformAdaptations.length,3);
 for(const entry of record.files){assert.match(entry.sourceSha256,/^[a-f0-9]{64}$/);const content=await fs.readFile(new URL('../'+entry.destination,new URL('../',root)));assert.equal(createHash('sha256').update(content).digest('hex'),entry.destinationSha256,entry.destination);}
 const css=await fs.readFile(new URL('app.css',root),'utf8'),base=css.split('/* Codex-specific controls')[0],cssEntry=record.files.find(entry=>entry.source.endsWith('app.css'));
 assert.equal(createHash('sha256').update(base).digest('hex'),cssEntry.sourceSha256);
 assert.doesNotMatch(css,/Keep the imported CC toolbar/);assert.equal(record.layoutChecks.normalRenderStructureMatchesSource,true);
});

test('catalog category identifiers filter and translated names remain searchable after switching languages',async()=>{
 const {document,run}=await browserFixture();
 run(`marketUI.state.entries=[{name:'alpha',title:'Alpha',description:'',author:'',category:'工具與能力',categoryId:'tools',markets:['open'],updated:1,versions:[{version:'1.0.0',type:'npm'}]},{name:'beta',title:'Beta',description:'',author:'',category:'記憶',categoryId:'memory',markets:['open'],updated:1,versions:[{version:'1.0.0',type:'git'}]}];marketUI.state.counts.set('alpha',null);marketUI.state.icons.set('alpha',null);marketUI.indexEntries();marketUI.state.q='工具';marketUI.render();`);
 assert.equal(document.querySelectorAll('.card').length,1);
 run(`marketUI.chooseLang('en');marketUI.state.q='capabilities';marketUI.render();`);
 assert.equal(document.querySelectorAll('.card').length,1);
 run(`marketUI.state.q='';marketUI.state.category='memory';marketUI.render();`);
 assert.equal(document.querySelector('.card h3').textContent,'Beta');
 assert.match(document.querySelector('#filter-panel .cats').textContent,/Memory/);
});

test('installed state, update controls, favorites and real icons use the latest CC contracts',async()=>{
 const calls=[],key='b'.repeat(64);
 const fetchImpl=async(route,options)=>{calls.push({route,options});return {ok:true,json:async()=>route==='/api/config'?{csrfToken:'csrf'}:route==='/api/review-settings'?{maxInputChars:60000,representativePerCategory:3}:route.includes('/catalog')?{entries:[],meta:{markets:[],sources:[]}}:route.includes('/jobs')?{jobs:[]}:route.includes('/favorites')?{names:options.body&&JSON.parse(options.body).on?['alpha']:[]}:route.includes('/icons')?{icons:{alpha:'https://cdn.example/icon.svg'}}:{known:true,items:{}}};};
 const {document,run}=await browserFixture({url:'http://127.0.0.1:1234/#access='+key,fetchImpl});
 await new Promise(resolve=>setImmediate(resolve));
 run(`marketUI.state.entries=[{name:'alpha',title:'Alpha',description:'',author:'',category:'工具與能力',categoryId:'tools',markets:['open'],updated:1,versions:[{version:'2.0.0',type:'npm'},{version:'1.0.0',type:'npm'}]}];marketUI.state.counts.set('alpha',null);marketUI.indexEntries();marketUI.applyInstalled({known:true,items:{alpha:{plugin:'alpha@market',status:'enabled',version:'1.0.0',update:'2.0.0'}}});`);
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(document.getElementById('grid').textContent,/更新.*2\.0\.0/);
 assert.match(document.getElementById('grid').textContent,/停用/);
 assert.equal(document.querySelector('.avatar img').getAttribute('src'),'https://cdn.example/icon.svg');
 assert.equal(document.querySelector('.avatar img').getAttribute('referrerpolicy'),'no-referrer');
 await run('marketUI.toggleFavorite(marketUI.state.entries[0])');
 assert.equal(document.querySelector('.star').getAttribute('aria-pressed'),'true');
 run(`marketUI.state.view='favorites';marketUI.render();`);
 assert.equal(document.querySelectorAll('.card').length,1);
 assert.equal(document.querySelector('#filter-panel section .chip[data-view="favorites"] .n')?.textContent??Array.from(document.querySelectorAll('#filter-panel section .chip')).find(el=>el.textContent.includes('收藏'))?.querySelector('.n')?.textContent,'1');
 const favorite=calls.find(call=>call.route==='/api/cc/favorites'&&call.options.body);
 assert.deepEqual(JSON.parse(favorite.options.body),{name:'alpha',on:true});
 assert.equal(favorite.options.headers['x-csrf-token'],'csrf');
 assert.ok(calls.some(call=>call.route==='/api/cc/installed'));
});

test('converted install opens permission details before explicit installation and remove requires a second click',async()=>{
 const calls=[],key='c'.repeat(64);
 const fetchImpl=async(route,options)=>{calls.push({route,options});return {ok:true,json:async()=>route==='/api/config'?{csrfToken:'csrf'}:route==='/api/review-settings'?{maxInputChars:60000,representativePerCategory:3}:route.includes('/catalog')?{entries:[],meta:{markets:[],sources:[]}}:route.includes('/jobs')?{jobs:[]}:route.includes('/favorites')?{names:[]}:route==='/api/prepared'?{items:[{catalogName:'alpha',packageName:'alpha-package',packageRoot:'C:/synthetic/alpha',version:'1.0.0',components:[{kind:'skill',name:'保留的技能'}],security:{sandbox:{notice:'合成權限限制'}}}]}:route==='/api/cc/manage'?{ok:true,installed:{known:true,items:{}}}:{known:true,items:{}}};};
 const {document,run}=await browserFixture({url:'http://127.0.0.1:1234/#access='+key,fetchImpl});
 await new Promise(resolve=>setImmediate(resolve));
 run(`marketUI.state.entries=[{name:'alpha',title:'Alpha',description:'',author:'',category:'',categoryId:'',markets:[],updated:1,versions:[{version:'1.0.0',type:'git'}]}];marketUI.state.installed={alpha:{status:'converted',version:'1.0.0'}};`);
 await run(`marketUI.manageAction('install',marketUI.state.entries[0])`);
 assert.match(document.querySelector('.panel').textContent,/實際保留的功能/);
 assert.match(document.querySelector('.panel').textContent,/合成權限限制/);
 assert.match(document.querySelector('.panel').textContent,/同意權限並安裝到 Codex/);
 assert.equal(calls.filter(call=>call.route==='/api/cc/manage').length,0);
 await run(`marketUI.manageAction('remove',marketUI.state.entries[0])`);
 assert.equal(calls.filter(call=>call.route==='/api/cc/manage').length,0);
 await run(`marketUI.manageAction('remove',marketUI.state.entries[0])`);
 const remove=calls.find(call=>call.route==='/api/cc/manage');
 assert.deepEqual(JSON.parse(remove.options.body),{action:'remove',name:'alpha'});
});

test('Luna candidate progress is refreshed even when the job phase stays running',async()=>{
 const {document,run}=await browserFixture();
 run(`marketUI.state.ai={id:'search',phase:'running',query:'字幕',text:'想關鍵字'};marketUI.state.jobs=[{id:'search',phase:'running',text:'已找到 12 個候選插件',candidateCount:12}];marketUI.syncAi();`);
 assert.match(document.getElementById('grid').textContent,/12 個候選插件/);
 assert.equal(run('marketUI.state.ai.candidateCount'),12);
});

test('unknown installation status keeps the warning label and hides all management buttons',async()=>{
 const {document,run}=await browserFixture();
 run(`marketUI.state.entries=[{name:'alpha',title:'Alpha',description:'',author:'',category:'',categoryId:'',markets:[],updated:1,versions:[{version:'2.0.0',type:'git'},{version:'1.0.0',type:'git'}]}];marketUI.indexEntries();marketUI.applyInstalled({known:false,error:'合成清單讀取失敗',items:{alpha:{plugin:'alpha@market',status:'converted',version:'1.0.0',update:'2.0.0'}}});`);
 assert.equal(run('marketUI.state.installed.alpha.status'),'unknown');
 assert.match(document.querySelector('.card .pills .warn').textContent,/安裝狀態不明/);
 assert.deepEqual(Array.from(document.querySelectorAll('.card-actions button')).map(button=>button.textContent),['詳情']);
 assert.match(document.getElementById('toast').textContent,/安裝狀態不明.*合成清單讀取失敗/);
 run(`marketUI.state.selected='alpha';marketUI.state.version='2.0.0';marketUI.state.readmes.set('alpha@2.0.0',{phase:'none'});marketUI.renderDetail();`);
 const manage=Array.from(document.querySelectorAll('.panel section')).find(section=>section.querySelector('h3')?.textContent==='管理');
 assert.ok(manage);assert.match(manage.textContent,/安裝狀態不明/);assert.equal(manage.querySelectorAll('button').length,0);
 run(`marketUI.chooseLang('en')`);
 assert.match(document.querySelector('.card .pills .warn').textContent,/Install status unknown/);
 run(`marketUI.applyInstalled({known:true,items:{alpha:{status:'unknown',version:'1.0.0'}}})`);
 assert.equal(document.querySelectorAll('.card-actions button').length,1);
 run(`marketUI.applyInstalled({known:true,items:{alpha:{status:'enabled',version:'1.0.0'}}})`);
 assert.match(document.querySelector('.card-actions').textContent,/Disable/);
});
