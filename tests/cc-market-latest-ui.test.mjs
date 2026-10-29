import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import domino from '@mixmark-io/domino';
import {build} from 'esbuild';

async function fixture(){
 const html=await fs.readFile(new URL('../web/market/index.html',import.meta.url),'utf8');
 const source=await fs.readFile(new URL('../web/market/app.js',import.meta.url),'utf8');
 const code=await build({stdin:{contents:source+'\nexport {state,render,filtered,setFilter,chooseLang,applyInstalled,manageAction,pollJobs,message,jobStatus};',resolveDir:fileURLToPath(new URL('../web/market/',import.meta.url))},bundle:true,format:'iife',globalName:'ui',write:false});
 const window=domino.createWindow(html,'http://127.0.0.1:1234/'),p=window.Element.prototype,intervals=new Map(),calls=[];let timer=0;
 p.append=function(...nodes){for(const n of nodes)this.appendChild(typeof n==='string'?window.document.createTextNode(n):n);};
 p.replaceChildren=function(...nodes){while(this.firstChild)this.removeChild(this.firstChild);this.append(...nodes);};p.scrollIntoView=function(){};
 Object.defineProperty(p,'dataset',{configurable:true,get(){return Object.fromEntries(Array.from(this.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),a.value]));}});
 const context=vm.createContext({document:window.document,window,Node:window.Node,Element:window.Element,location:new URL('http://127.0.0.1:1234/'),history:{replaceState(){}},sessionStorage:{getItem:()=>'',setItem(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{language:'zh-TW'},URL,URLSearchParams,Intl,Date,setTimeout:()=>0,clearTimeout(){},setInterval:fn=>{intervals.set(++timer,fn);return timer;},clearInterval:id=>intervals.delete(id),ResizeObserver:class{observe(){}},fetch:async(route,options)=>{calls.push({route,options});return {ok:true,json:async()=>route==='/api/config'?{csrfToken:'synthetic-csrf'}:route==='/api/cc/manage'?{ok:true,installed:{known:true,items:{},downloads:{}}}:route==='/api/cc/jobs'?{jobs:[{id:'done',action:'download',phase:'done',created:Date.now()}]}:route==='/api/cc/installed'?{known:true,items:{},downloads:{beta:{version:'1.0.0'}}}:{}};}});
 vm.runInContext(code.outputFiles[0].text,context);
 const run=script=>vm.runInContext(script,context);
 run(`ui.state.entries=[{name:'alpha',title:'Alpha',description:'',category:'工具',categoryId:'tools',markets:[],versions:[{version:'2.0.0',type:'npm'}]},{name:'beta',title:'Beta',description:'',category:'記憶',categoryId:'memory',markets:[],versions:[{version:'2.0.0',type:'git'},{version:'1.0.0',type:'git'}]}];for(const entry of ui.state.entries){ui.state.counts.set(entry.name,null);ui.state.icons.set(entry.name,null);}ui.applyInstalled({known:true,items:{alpha:{status:'enabled',version:'2.0.0'}},downloads:{beta:{version:'1.0.0',update:'2.0.0'}}});`);
 return {document:window.document,run,calls,tick:async()=>{for(const fn of [...intervals.values()])await fn();}};
}

test('latest CC status filters use the funnel and show downloaded version and update',async()=>{
 const {document,run}=await fixture();
 assert.deepEqual(Array.from(document.querySelector('.tools').children).map(el=>el.id),['filter-wrap']);
 assert.deepEqual(Array.from(document.querySelectorAll('#filter-panel section h2')).map(el=>el.textContent),['狀態','分類','清單','Codex','安裝方式']);
 const status=document.querySelector('#filter-panel section').textContent;
 for(const label of ['已安裝','未安裝','已下載未安裝','收藏'])assert.match(status,new RegExp(label));
 run(`ui.setFilter({view:'downloaded'},false)`);
 assert.equal(document.querySelectorAll('.card').length,1);assert.equal(document.querySelector('.card h3').textContent,'Beta');
 assert.match(document.querySelector('.downloaded').textContent,/1\.0\.0.*2\.0\.0/);assert.match(document.querySelector('.card-actions').textContent,/刪除/);
 run(`ui.setFilter({view:'notInstalled'},false)`);assert.equal(run('ui.filtered()[0].name'),'beta');
 run(`ui.setFilter({view:'installed'},false)`);assert.equal(run('ui.filtered()[0].name'),'alpha');
 run(`ui.applyInstalled({known:true,items:{beta:{status:'enabled'}},downloads:{beta:{version:'1.0.0'}}});ui.setFilter({view:'downloaded'},false)`);
 assert.equal(document.querySelectorAll('.card').length,0);assert.equal(run('Object.keys(ui.state.downloads).length'),0);
});

test('download deletion requires its own second click within the four-second countdown and preserves CSRF',async()=>{
 const {document,run,calls,tick}=await fixture();
 await run(`ui.manageAction('delete',ui.state.entries[1])`);
 assert.match(document.querySelectorAll('.card')[1].textContent,/確定刪除？\(4\)/);assert.equal(calls.length,0);
 await tick();assert.match(document.querySelectorAll('.card')[1].textContent,/確定刪除？\(3\)/);
 await tick();await tick();await tick();assert.equal(run('ui.state.confirmRemove'),null);assert.equal(calls.length,0);
 await run(`ui.manageAction('delete',ui.state.entries[1])`);assert.equal(calls.length,0);
 await run(`ui.manageAction('delete',ui.state.entries[1])`);
 const request=calls.find(call=>call.route==='/api/cc/manage');assert.deepEqual(JSON.parse(request.options.body),{action:'delete',name:'beta'});assert.equal(request.options.headers['x-csrf-token'],'synthetic-csrf');assert.match(document.getElementById('toast').textContent,/已刪除 Beta/);
});

test('download completion refreshes the inventory without starting any model',async()=>{
 const {run,tick,calls}=await fixture();run('ui.pollJobs()');await tick();await new Promise(resolve=>setImmediate(resolve));
 assert.ok(calls.some(call=>call.route==='/api/cc/installed'));assert.equal(run('ui.state.downloads.beta.version'),'1.0.0');assert.ok(calls.every(call=>!call.options.body));
});

test('server message codes, unknown fallback and safe Markdown image labels follow all nine languages',async()=>{
 const {run}=await fixture();
 assert.equal(run(`ui.message('missing',{},'原文')`),'原文');
 for(const language of ['zh-Hant','zh-Hans','en','ja','ko','es','fr','ru','ar']){
  run(`ui.chooseLang(${JSON.stringify(language)})`);
  const label=run(`ui.message('downloaded.version',{v:'1.2.3'},'fallback')`);assert.match(label,/1\.2\.3/);assert.notEqual(label,'fallback');
  const text=run(`ui.jobStatus({phase:'done',code:'msg.download.done',params:{path:'C:/fixture'},text:'fallback',markdown:'![unsafe](javascript:alert)'})`).textContent;
  assert.match(text,/C:\/fixture/);assert.doesNotMatch(text,/fallback|javascript/);
 }
 const {missingKeys}=await import('../web/market/i18n.js');for(const gaps of Object.values(missingKeys())){assert.deepEqual(gaps.missing,[]);assert.deepEqual(gaps.extra,[]);}
});
