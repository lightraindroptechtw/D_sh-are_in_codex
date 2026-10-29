import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createPluginSecurity,detectPostingTools} from '../lib/plugin-security.mjs';

async function fixture(t,options={}){const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-security-test-'));const security=createPluginSecurity({pluginId:'fixture',pluginName:'測試插件',dataRoot,openBrowser:async()=>{},...options});t.after(async()=>{await security.close();await fs.rm(dataRoot,{recursive:true,force:true});});await security.load();return security;}

test('conversation sharing and background followups have independent migrated boolean settings and four-part change notices',async t=>{
  const s=await fixture(t),file=path.join(s.dataRoot,'settings.json');
  assert.equal(s.snapshot().settings.shareConversation,true);assert.equal(s.snapshot().settings.allowFollowups,false);
  // A prior settings file has neither field. Its other choices must survive.
  await fs.writeFile(file,JSON.stringify({allowModelCalls:false,allowAgents:true,posting:{mode:'deny'}}));
  const migrated=(await s.load()).settings;
  assert.equal(migrated.shareConversation,true);assert.equal(migrated.allowFollowups,false);assert.equal(migrated.allowModelCalls,false);assert.equal(migrated.allowAgents,true);assert.equal(migrated.posting.mode,'deny');
  for(const field of ['shareConversation','allowFollowups'])for(const value of [null,'true',1,{},[]])await assert.rejects(s.update({[field]:value}),{code:'SECURITY_SETTINGS_INVALID'});
  await s.update({shareConversation:false,allowFollowups:true});
  const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(saved.shareConversation,false);assert.equal(saved.allowFollowups,true);assert.equal(saved.allowModelCalls,false);assert.equal(saved.allowAgents,true);
  const other=createPluginSecurity({pluginId:'fixture',dataRoot:s.dataRoot});t.after(()=>other.close());
  assert.equal((await other.load()).settings.shareConversation,false);assert.equal(other.snapshot().settings.allowFollowups,true);
  const changes=s.snapshot().notifications.filter(n=>n.kind==='setting-changed');assert.equal(changes.length,2);
  for(const notice of changes){for(const field of ['what','why','setting','impact'])assert.ok(notice[field]);for(const label of ['發生什麼：','原因：','在哪裡設定：','影響：'])assert.ok(notice.text.includes(label));}
  assert.match(changes[0].setting,/讓插件知道目前對話裡發生的事/);assert.match(changes[1].setting,/允許插件主動送出訊息/);
});

test('security page renders and saves both conversation checkboxes through the authenticated settings API',async t=>{
  const s=await fixture(t),ui=await s.ensureUi(),headers={Authorization:`Bearer ${ui.accessToken}`},state=await(await fetch(ui.origin+'/api/state',{headers})).json();
  const browserCode=await(await fetch(ui.origin+'/client.js')).text();
  class Element{constructor(tag){this.tagName=tag;this.children=[];this.type='';}append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(...children){this.children=children;}}
  const elements=new Map(),requests=[];
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);},createElement(tag){return new Element(tag);}};
  vm.runInNewContext(browserCode,{document,URLSearchParams,location:{hash:'#access='+ui.accessToken,pathname:'/'},sessionStorage:{getItem(){},setItem(){}},history:{replaceState(){}},setInterval(){},fetch:async(url,options)=>{requests.push({url,options});return fetch(ui.origin+url,options);}});
  for(let i=0;i<50&&!elements.get('settings')?.onsubmit;i++)await new Promise(resolve=>setTimeout(resolve,10));
  const form=elements.get('settings'),labels=form.children.filter(child=>child.tagName==='label'),share=labels.find(label=>label.textContent?.startsWith('讓插件知道目前對話裡發生的事')),followups=labels.find(label=>label.textContent?.startsWith('允許插件主動送出訊息'));
  assert.ok(share);assert.ok(followups);assert.equal(share.children[0].checked,true);assert.equal(followups.children[0].checked,false);
  share.children[0].checked=false;followups.children[0].checked=true;await form.onsubmit({preventDefault(){}});
  const submission=JSON.parse(requests.find(request=>request.url==='/api/settings').options.body);assert.equal(submission.shareConversation,false);assert.equal(submission.allowFollowups,true);
  const saved=(await s.load()).settings;assert.equal(saved.shareConversation,false);assert.equal(saved.allowFollowups,true);assert.equal(saved.allowModelCalls,state.settings.allowModelCalls);assert.equal(saved.allowAgents,state.settings.allowAgents);
});

test('owner-only storage, declared provided secrets, exact redaction and separate command environment',async t=>{
  const s=await fixture(t,{declaredSecrets:['API_KEY',{name:'UNPROVIDED',provided:false}]});
  assert.equal(s.snapshot().settings.allowModelCalls,true);assert.equal(s.snapshot().settings.allowAgents,true);assert.equal(s.snapshot().settings.posting.mode,'confirm');
  await assert.rejects(s.update({secrets:{UNPROVIDED:'unavailable'}}),{code:'SECURITY_SECRET_UNDECLARED'});
  await s.update({secrets:{API_KEY:'fixture-secret-012345'}});
  const state=s.snapshot();assert.equal(state.storage.verified,true);assert.equal(state.storage.method,process.platform==='win32'?'windows-owner-only-acl':'posix-owner-only');assert.equal(state.storage.encrypted,false);
  assert.deepEqual(s.commandEnvironment({HOME:'ordinary',OTHER_KEY:'ambient',SESSION_TOKEN:'ambient'}),{HOME:'ordinary'});
  assert.deepEqual(s.sourceEnvironment({HOME:'ordinary',OTHER_KEY:'ambient'}),{HOME:'ordinary',API_KEY:'fixture-secret-012345'});
  assert.equal(s.commandEnvironment({}, {providedSecrets:['API_KEY']}).API_KEY,'fixture-secret-012345');
  const redacted=s.redact({content:'fixture-secret-012345 fixture-secret-012345',nested:['12345',new Error('failed fixture-secret-012345')]});
  assert.equal(redacted.content,'[已隱藏敏感值] [已隱藏敏感值]');assert.equal(redacted.nested[0],'12345');assert.equal(redacted.nested[1].message,'failed [已隱藏敏感值]');
  const other=createPluginSecurity({pluginId:'fixture',dataRoot:s.dataRoot,declaredSecrets:['API_KEY']});await other.load();await other.update({allowModelCalls:false});await other.close();assert.equal((await s.load()).settings.allowModelCalls,false);
  const notice=await s.notify({kind:'model-call',details:'fixture-secret-012345'});for(const field of ['what','why','setting','impact'])assert.ok(notice[field]);assert.equal(notice.details,'[已隱藏敏感值]');
  assert.equal((await fs.readFile(path.join(s.dataRoot,'settings.json'),'utf8')).includes('fixture-secret-012345'),false);
  assert.equal((await fs.readFile(path.join(s.dataRoot,'notifications.json'),'utf8')).includes('fixture-secret-012345'),false);
});

test('posting confirmation, persistent auto warning, manual inclusion/exclusion, rate pause, no actual send',async t=>{
  let approvals=0,sends=0;const s=await fixture(t,{postingTools:['custom_publish'],approvalHandler:async request=>{approvals++;assert.equal(request.destination,'local-fixture');assert.equal(request.fullContent,'完整測試內容');return 'alwaysAuto';}});
  const tool=s.wrapTool({name:'custom_publish',execute:async()=>{sends++;return {content:[{type:'text',text:'fixture completed'}]};}});
  const result=await tool.execute({destination:'local-fixture',content:'完整測試內容'});
  assert.equal(sends,1);assert.equal(approvals,1);assert.match(result.content.at(-1).text,/發生什麼/);assert.match(result._meta.securitySettingsUrl,/http:\/\/127\.0\.0\.1:/);
  await tool.execute({destination:'local-fixture',content:'完整測試內容'});assert.equal(approvals,1);assert.equal(s.snapshot().notifications.filter(n=>n.kind==='posting-auto-warning').length,1);
  const sentNotice=s.snapshot().notifications.find(n=>n.kind==='posting-sent');assert.match(sentNotice.text,/目的地：local-fixture/);assert.match(sentNotice.text,/內容開頭：完整測試內容/);assert.match(sentNotice.text,/插件回報發送成功/);assert.doesNotMatch(sentNotice.text,/目的平台已收到/);
  assert.equal(s.snapshot().history.length,2);assert.equal(s.snapshot().settings.posting.mode,'auto');
  await s.update({posting:{hourLimit:2}});await assert.rejects(tool.execute({destination:'local-fixture',content:'完整測試內容'}),{code:'SECURITY_POSTING_RATE_LIMIT'});assert.equal(sends,2);assert.equal(s.snapshot().settings.posting.paused,false);
  await s.update({posting:{paused:false,mode:'deny',include:['unusual'],exclude:['custom_publish']}});
  assert.equal((await s.gatePosting({toolName:'custom_publish'})).posting,false);await assert.rejects(s.gatePosting({toolName:'unusual'}),{code:'SECURITY_POSTING_DENIED'});
  assert.deepEqual(detectPostingTools([{name:'get_comments',description:'發送留言'},'draft_email','search_posts','send_message','publish_post']),['send_message','publish_post']);
});

test('loopback approval page requires bearer and CSRF, shows complete masked destination and content, buttons decide once',async t=>{
  let opened;const s=await fixture(t,{declaredSecrets:['API_KEY'],openBrowser:async url=>{opened=url;}});await s.update({secrets:{API_KEY:'fixture-secret-012345'}});const ui=await s.ensureUi();
  const headers={Authorization:`Bearer ${ui.accessToken}`};assert.equal((await fetch(ui.origin+'/api/state')).status,401);
  const pending=s.requestApproval({kind:'shell',command:'echo fixture-secret-012345',cwd:s.dataRoot,reason:'fixture only'});
  let state;for(let tries=0;tries<20;tries++){state=await (await fetch(ui.origin+'/api/state',{headers})).json();if(state.approvals.length)break;await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(state.approvals.length,1);assert.equal(state.approvals[0].command,'echo [已隱藏敏感值]');
  assert.equal(opened,ui.url);
  const request={id:state.approvals[0].id,action:'once'};
  assert.equal((await fetch(ui.origin+'/api/approval',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(request)})).status,403);
  assert.equal((await fetch(ui.origin+'/api/approval',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-CSRF-Token':state.csrfToken},body:JSON.stringify(request)})).status,200);assert.equal(await pending,true);
  const browserCode=await (await fetch(ui.origin+'/client.js')).text();assert.doesNotThrow(()=>new vm.Script(browserCode));for(const text of ['這次送出','以後都自動發','不要送出'])assert.ok(browserCode.includes(text));assert.match(await (await fetch(ui.origin)).text(),/目前沒有原生桌面通知介面/);
});

test('market review is a separate human consent step and incomplete AI review does not gate installation',async()=>{
  const text=await fs.readFile(new URL('../web/market/market.js',import.meta.url),'utf8');
  assert.match(text,/\/api\/review/);assert.match(text,/\/api\/prepare/);assert.match(text,/reviewId:reviewed.result.reviewId,consent:true,forceObfuscated/);assert.match(text,/JSON.stringify\(result.scan/);assert.match(text,/AI 未完成/);assert.doesNotMatch(text,/install.disabled[^\n]*sourceReview\?\.status !== 'approved'/);
  assert.match(text,/install.disabled = unsupported \|\| !result.components\?\.length;/);assert.doesNotMatch(text,/install.disabled[^\n]*(?:enforced|sourceReview|known)/);assert.doesNotMatch(text,/尚未確認執行限制，不能安裝/);assert.match(text,/已配置 Node.js/);assert.match(text,/主平台原生權限的同步尚未確認/);assert.match(text,/這項差異不會阻擋安裝/);
});

test('two broker instances share reserved posting slots so concurrent chats cannot exceed limits',async t=>{
  const first=await fixture(t,{postingTools:['send_message']});await first.update({posting:{mode:'auto',hourLimit:1,dayLimit:1}});
  const second=createPluginSecurity({pluginId:'fixture',dataRoot:first.dataRoot,postingTools:['send_message'],openBrowser:async()=>{}});await second.load();t.after(()=>second.close());
  const results=await Promise.allSettled([first.gatePosting({toolName:'send_message',args:{to:'fixture',content:'one'}}),second.gatePosting({toolName:'send_message',args:{to:'fixture',content:'two'}})]);
  const accepted=results.filter(result=>result.status==='fulfilled');assert.equal(accepted.length,1);assert.equal(results.find(result=>result.status==='rejected').reason.code,'SECURITY_POSTING_RATE_LIMIT');
  await accepted[0].value.finish(false);assert.equal((await first.load()).history.length,1);assert.equal(first.snapshot().history[0].status,'failed');
});

test('human-confirmed posts bypass automatic rate limits; cancel, deny and blocked paths receive four-part notices',async t=>{
  let decision='once';const s=await fixture(t,{postingTools:['send_message'],approvalHandler:async()=>decision});await s.update({posting:{mode:'confirm',hourLimit:1,dayLimit:1,paused:true}});
  for(let i=0;i<2;i++){const ticket=await s.gatePosting({toolName:'send_message',args:{to:'fixture',content:'human confirmed'}});await ticket.finish(true);}
  assert.equal(s.snapshot().history.length,2);assert.ok(s.snapshot().history.every(row=>row.mode==='confirm'));
  decision='cancel';await assert.rejects(s.gatePosting({toolName:'send_message'}),{code:'SECURITY_POSTING_CANCELED'});const canceled=s.snapshot().notifications.at(-1);for(const field of ['what','why','setting','impact'])assert.ok(canceled[field]);
  await s.update({posting:{mode:'deny'}});await assert.rejects(s.gatePosting({toolName:'send_message'}),{code:'SECURITY_POSTING_DENIED'});assert.equal(s.snapshot().notifications.at(-1).kind,'posting-denied');
  const blockedPath=path.join(s.dataRoot,'blocked','file.txt');const fileTool=s.wrapTool({name:'read_file',execute:async()=>{throw Object.assign(new Error('EACCES permission denied: '+blockedPath),{code:'EACCES',path:blockedPath});}});
  await assert.rejects(fileTool.execute({path:blockedPath}),error=>error.message.includes('發生什麼：')&&error.message.includes(blockedPath)&&error.message.includes('額外可讀／可寫資料夾'));
});
