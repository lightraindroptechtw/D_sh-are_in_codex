import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(message,code)=>Object.assign(new Error(message),{code});
const secretName=/(?:key|token|secret|password|passwd|credential|authorization|cookie)/i;
const postingPattern=/(?:^|[_.:\s-])(?:send|post|publish|tweet|reply|comment|message|email|submit)(?:$|[_.:\s-])|發送|發文|發布|寄信|留言|回覆/i;
export const DEFAULT_PLUGIN_SECURITY=Object.freeze({restrictionsEnabled:true,allowDirectSpawn:false,allowModelCalls:true,allowAgents:true,shareConversation:true,allowFollowups:false,nativeToolHooks:false,extraReadFolders:[],extraWriteFolders:[],missingHostMetadataMode:'workspace',posting:{mode:'confirm',include:[],exclude:[],hourLimit:10,dayLimit:50,paused:false}});

export function detectPostingTools(tools=[]){return tools.filter(tool=>{const name=typeof tool==='string'?tool:tool.name??tool.id??'';return !/(?:^|[_.:-])(?:read|search|draft|list|get|fetch)(?:$|[_.:-])/i.test(name)&&postingPattern.test(name);}).map(tool=>typeof tool==='string'?tool:tool.name??tool.id);}
function declaredFields(fields){
  if(Array.isArray(fields))return fields.map(field=>typeof field==='string'?{name:field,provided:true}:field).filter(field=>field&&typeof field.name==='string');
  return Object.entries(fields??{}).map(([name,field])=>({name,...(typeof field==='object'?field:{provided:field===true})}));
}
function mergeSettings(current,patch){
  const next={...current,...patch,posting:{...current.posting,...patch.posting}};
  for(const field of ['restrictionsEnabled','allowDirectSpawn','allowModelCalls','allowAgents','shareConversation','allowFollowups','nativeToolHooks'])if(typeof next[field]!=='boolean')throw fail('安全設定必須是開啟或關閉','SECURITY_SETTINGS_INVALID');
  if(!['workspace','state-only','unrestricted'].includes(next.missingHostMetadataMode)||!['confirm','auto','deny'].includes(next.posting.mode))throw fail('安全設定選項無效','SECURITY_SETTINGS_INVALID');
  for(const field of ['extraReadFolders','extraWriteFolders'])if(!Array.isArray(next[field])||next[field].some(folder=>typeof folder!=='string'||!path.isAbsolute(folder)))throw fail('額外資料夾必須使用完整路徑','SECURITY_SETTINGS_INVALID');
  for(const field of ['include','exclude'])if(!Array.isArray(next.posting[field])||next.posting[field].some(name=>typeof name!=='string'))throw fail('發文工具清單格式無效','SECURITY_SETTINGS_INVALID');
  for(const field of ['hourLimit','dayLimit'])if(!Number.isSafeInteger(next.posting[field])||next.posting[field]<0)throw fail('發文上限必須是非負整數，0 表示不限','SECURITY_SETTINGS_INVALID');
  return next;
}
const contained=(root,target)=>{const rel=path.relative(path.resolve(root),path.resolve(target));return !rel||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};

/** The fallback secret file is outside plugin code and owner-only; no claim of OS vault encryption. */
export async function protectOwnerOnly(target,{directory=false}={}){
  if(process.platform!=='win32'){
    await fs.chmod(target,directory?0o700:0o600);
    const info=await fs.stat(target);if((info.mode&0o077)!==0||info.uid!==process.getuid())throw fail('無法驗證敏感儲存權限','SECURITY_SECRET_STORAGE_UNSAFE');
    return {verified:true,method:'posix-owner-only',owner:String(info.uid)};
  }
  const powershell=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const script=`$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(path.resolve(target)).toString('base64')}')); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[IO.${directory?'Directory':'File'}]::GetAccessControl($p); $acl.SetAccessRuleProtection($true,$false); foreach($r in @($acl.Access)){$null=$acl.RemoveAccessRuleSpecific($r)}; $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',${directory?"'ContainerInherit,ObjectInherit'":"'None'"},'None','Allow'); $acl.AddAccessRule($rule); $acl.SetOwner($sid); [IO.${directory?'Directory':'File'}]::SetAccessControl($p,$acl); $check=[IO.${directory?'Directory':'File'}]::GetAccessControl($p); $bad=@($check.Access|Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value}); if(-not $check.AreAccessRulesProtected -or $bad.Count -gt 0 -or $check.Owner -ne $sid.Translate([Security.Principal.NTAccount]).Value){throw 'Owner-only ACL verification failed'}; [Console]::WriteLine('{"verified":true,"method":"windows-owner-only-acl","owner":"'+$sid.Value+'"}')`;
  const {stdout}=await exec(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000});
  return JSON.parse(stdout.trim());
}

export function createPluginSecurity({pluginId,pluginName=pluginId,dataRoot,pluginDir,declaredSecrets=[],postingTools=[],approvalHandler,notificationHandler,openBrowser,now=()=>Date.now(),approvalTimeoutMs=300000}={}){
  if(typeof pluginId!=='string'||!pluginId)throw new TypeError('需要插件識別碼');
  const folder=pluginId.replace(/[^a-z0-9_.-]/gi,'-')+'-'+crypto.createHash('sha256').update(pluginId).digest('hex').slice(0,10);
  const root=path.resolve(dataRoot??path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'dsh-plugin-security',folder));
  if(pluginDir&&contained(pluginDir,root))throw fail('安全設定與敏感資料必須存放在插件目錄外','SECURITY_SECRET_STORAGE_UNSAFE');
  const files={settings:path.join(root,'settings.json'),secrets:path.join(root,'secrets.json'),notifications:path.join(root,'notifications.json'),history:path.join(root,'posting-history.json')};
  let settings=clone(DEFAULT_PLUGIN_SECURITY),secrets={},notifications=[],history=[],loaded=false,storageProtection=null,ui=null,uiPromise=null,pending=0,writeQueue=Promise.resolve();
  const declarations=declaredFields(declaredSecrets).map(field=>({...field,displayName:field.displayName??`${/password|passwd/i.test(field.name)?'密碼':/cookie/i.test(field.name)?'登入 Cookie（登入識別資料）':/token/i.test(field.name)?'存取權杖':'API 金鑰'}（${field.name.replace(/^config:/,'')}）`})),automaticTools=new Set(postingTools.map(tool=>typeof tool==='string'?tool:tool.name??tool.toolName??tool.id).filter(Boolean));
  const runtimeSecrets=new Set();
  const rememberSecrets=values=>{for(const value of values??[])if(typeof value==='string'&&value.length>=6)runtimeSecrets.add(value);};
  const known=()=>[...runtimeSecrets,...Object.values(secrets),...declarations.filter(d=>d.provided&&typeof d.value==='string').map(d=>d.value)].filter(v=>typeof v==='string'&&v.length>=6).sort((a,b)=>b.length-a.length);
  function redact(value){
    const seen=new WeakSet();
    const visit=input=>{
      if(typeof input==='string'){for(const token of known())input=input.split(token).join('[已隱藏敏感值]');return input;}
      if(input instanceof Error){const output=new Error(visit(input.message));output.name=input.name;output.code=input.code;output.stack=visit(input.stack);for(const [key,val]of Object.entries(input))output[key]=visit(val);return output;}
      if(!input||typeof input!=='object')return input;if(seen.has(input))return '[循環內容]';seen.add(input);
      if(Buffer.isBuffer(input))return Buffer.from(visit(input.toString('utf8')));
      return Array.isArray(input)?input.map(visit):Object.fromEntries(Object.entries(input).map(([key,val])=>[visit(key),visit(val)]));
    };return visit(value);
  }
  async function save(file,value,{sensitive=false}={}){
    const operation=async()=>{const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(sensitive?value:redact(value),null,2)+'\n',{mode:0o600,flag:'wx'});try{await protectOwnerOnly(temp);await fs.rename(temp,file);if(sensitive)storageProtection=await protectOwnerOnly(file);}catch(error){await fs.rm(temp,{force:true});throw error;}};
    const result=writeQueue.catch(()=>{}).then(operation);writeQueue=result;return result;
  }
  const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
  async function withPostingLock(action){
    const lock=path.join(root,'posting.lock');let acquired=false;
    for(let attempt=0;attempt<200;attempt++){
      try{await fs.mkdir(lock,{mode:0o700});acquired=true;await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid}),{mode:0o600});break;}
      catch(error){if(error.code!=='EEXIST')throw error;let owner;try{owner=await read(path.join(lock,'owner.json'),null);}catch(cause){if(!(cause instanceof SyntaxError))throw cause;}if(owner?.pid){try{process.kill(owner.pid,0);}catch(cause){if(cause.code==='ESRCH'){await fs.rm(lock,{recursive:true,force:true});continue;}}}await new Promise(resolve=>setTimeout(resolve,25));}
    }
    if(!acquired)throw fail('另一個聊天正在核對發文次數，請稍後重試','SECURITY_POSTING_BUSY');
    try{return await action();}finally{await fs.rm(lock,{recursive:true,force:true});}
  }
  async function load(){
    if(loaded){settings=mergeSettings(clone(DEFAULT_PLUGIN_SECURITY),await read(files.settings,settings));secrets=await read(files.secrets,secrets);history=await read(files.history,history);return snapshot();}await fs.mkdir(root,{recursive:true,mode:0o700});storageProtection=await protectOwnerOnly(root,{directory:true});
    settings=mergeSettings(clone(DEFAULT_PLUGIN_SECURITY),await read(files.settings,{}));secrets=await read(files.secrets,{});notifications=await read(files.notifications,[]);history=await read(files.history,[]);
    try{await fs.access(files.secrets);storageProtection=await protectOwnerOnly(files.secrets);}catch(error){if(error.code!=='ENOENT')throw error;}
    loaded=true;return snapshot();
  }
  const settingLabels={allowModelCalls:'允許呼叫模型',allowAgents:'允許建立與操作代理',shareConversation:'讓插件知道目前對話裡發生的事',allowFollowups:'允許插件主動送出訊息',allowDirectSpawn:'允許直接啟動程序',restrictionsEnabled:'啟用轉換器的額外限制',nativeToolHooks:'允許使用原生工具掛鉤'};
  const settingImpact=(field,enabled)=>field==='shareConversation'?(enabled?'插件可收到目前主對話的訊息、工具呼叫與結果，並讀取接入後的紀錄。':'停止轉交後續對話內容，也無法透過對話查詢服務讀取已收集紀錄；一般模型與代理呼叫仍可使用。'):field==='allowFollowups'?(enabled?'插件背景工作可要求續接目前對話；仍依宿主實際支援的續接介面處理。':'插件背景工作不會主動續接目前對話；一般模型與代理呼叫仍可使用。'):field==='restrictionsEnabled'?'關閉時不套用轉換器的額外檔案與程序限制，主平台本身的權限仍然有效。':`依賴這項能力的工具現在${enabled?'可以嘗試執行':'會受限'}；每次使用仍會通知。`;
  function restrictedFeatures(){
    const values=[];
    for(const [field,feature]of [['allowModelCalls','呼叫模型'],['allowAgents','建立與操作代理'],['allowDirectSpawn','直接啟動程序'],['nativeToolHooks','使用原生工具掛鉤']])if(settings[field]===false)values.push({id:'setting:'+field,kind:'disabled-setting',what:`目前未開啟「${feature}」。`,why:'插件安全設定中的對應選項目前關閉。',setting:`插件安全設定 → ${settingLabels[field]}`,impact:field==='allowDirectSpawn'?'直接啟動子程序會受限；一般權限下仍可逐次確認允許的指令。':`需要${feature}的功能目前受限；開啟後可重試。`});
    for(const field of declarations)if(field.provided===true&&!(typeof secrets[field.name]==='string'&&secrets[field.name])&&!(typeof field.value==='string'&&field.value))values.push({id:'secret:'+field.name,kind:'missing-secret',what:`敏感欄位「${field.displayName}」尚未設定。`,why:'插件宣告需要由你提供這個欄位，目前沒有可用值。',setting:`插件安全設定 → 敏感欄位 → ${field.displayName}`,impact:'需要這個欄位的功能可能無法登入或執行；設定後會從這份目前受限清單移除。'});
    const latest=new Map();for(const notice of notifications)if(['tool-restricted','startup-failed'].includes(notice.kind))latest.set(notice.kind+':'+(notice.details?.toolName??'startup'),notice);
    for(const notice of latest.values())if(!notice.resolved)values.push({id:notice.id,kind:notice.kind,what:notice.what,why:notice.why,setting:notice.setting,impact:notice.impact});
    return redact(values);
  }
  function snapshot(){return {pluginId,pluginName,settings:clone(settings),declaredSecrets:declarations.map(({name,provided,displayName})=>({name,displayName,provided:provided===true,configured:typeof secrets[name]==='string'&&!!secrets[name]})),postingTools:[...automaticTools],restrictedFeatures:restrictedFeatures(),notifications:redact(notifications),history:redact(history),storage:{path:files.secrets,...storageProtection,encrypted:false},notificationTransport:'本機網頁通知與工具結果；目前沒有原生桌面通知介面。'};}
  async function resolveRestrictedFeatures({toolName,kind}={}){let changed=false;for(const notice of notifications)if(['tool-restricted','startup-failed'].includes(notice.kind)&&!notice.resolved&&(!kind||notice.kind===kind)&&(!toolName||notice.details?.toolName===toolName)){notice.resolved=true;notice.resolvedAt=new Date(now()).toISOString();changed=true;}if(changed)await save(files.notifications,notifications);return restrictedFeatures();}
  async function update(patch={}){
    await load();const {secrets:provided,...configuration}=patch;const next=mergeSettings(settings,configuration);
    if(provided){for(const [name,value]of Object.entries(provided)){if(!declarations.some(d=>d.name===name&&d.provided===true))throw fail('此敏感欄位未宣告為 provided，不能交給插件','SECURITY_SECRET_UNDECLARED');if(value!==null&&typeof value!=='string')throw fail('敏感欄位必須是文字','SECURITY_SETTINGS_INVALID');}for(const [name,value]of Object.entries(provided)){if(value===null)delete secrets[name];else secrets[name]=value;}await save(files.secrets,secrets,{sensitive:true});}
    const previous=settings;settings=next;
    if(next.posting.mode==='auto'&&!next.posting.autoWarningAcknowledged){settings.posting.autoWarningAcknowledged=true;await notify({kind:'posting-auto-warning',what:'此插件已切換成自動發文。',why:'自動發文可能觸發目的平台的垃圾訊息或頻率限制。',setting:'插件安全設定 → 發文模式，可改回每次確認或禁止。',impact:'之後符合清單及次數上限的發文會直接執行，完成後仍會通知並留下紀錄。'});}
    await save(files.settings,settings);
    for(const field of ['allowModelCalls','allowAgents','shareConversation','allowFollowups','allowDirectSpawn','restrictionsEnabled','nativeToolHooks'])if(previous[field]!==next[field])await notify({kind:'setting-changed',what:`已${next[field]?'開啟':'關閉'}「${settingLabels[field]}」。`,why:'這是你在插件安全設定中做的變更。',setting:`插件安全設定 → ${settingLabels[field]}`,impact:settingImpact(field,next[field])});
    return snapshot();
  }
  async function notify(event={}){
    if(['startup-ready','startup-success'].includes(event.kind))await resolveRestrictedFeatures({kind:'startup-failed'});
    if(!loaded)await load();const names={'model-call':'插件正在呼叫模型','agent-create':'插件正在建立代理','agent-send':'插件正在傳送代理任務','missing-host-metadata':'這次工具呼叫沒有附主平台的工作區權限資料'};
    const notice=redact({id:crypto.randomUUID(),at:new Date(now()).toISOString(),pluginId,pluginName,kind:event.kind??'notice',what:event.what??names[event.kind]??'插件狀態已變更',why:event.why??'插件執行這項功能需要使用對應能力。',setting:event.setting??'插件安全設定，可關閉呼叫模型、代理能力或調整工作區權限。',impact:event.impact??'這次操作會依目前設定執行；關閉後依賴此能力的工具會顯示受限原因。',details:event.details??null});
    notice.text=`發生什麼：${notice.what}\n原因：${notice.why}\n在哪裡設定：${notice.setting}\n影響：${notice.impact}`;
    notifications.push(notice);if(notifications.length>1000)notifications=notifications.slice(-1000);await save(files.notifications,notifications);await notificationHandler?.(notice);return notice;
  }
  function commandEnvironment(environment=process.env,{providedSecrets=[]}={}){
    if(!loaded)throw fail('請先載入插件安全設定','SECURITY_SETTINGS_NOT_LOADED');
    const result=Object.fromEntries(Object.entries(environment).filter(([name,value])=>value!==undefined&&!secretName.test(name)&&!/^CODEX_APP_TOOLS_/i.test(name)));
    const allowed=new Set(providedSecrets);for(const declaration of declarations)if(declaration.provided===true&&allowed.has(declaration.name)){const value=secrets[declaration.name]??declaration.value;if(typeof value==='string')result[declaration.envName??declaration.name]=value;}
    return result;
  }
  function sourceEnvironment(environment=process.env){return commandEnvironment(environment,{providedSecrets:declarations.filter(field=>field.provided===true).map(field=>field.name)});}
  async function ensureUi(){if(!uiPromise)uiPromise=(async()=>{const {startPluginSecurityServer}=await import('./plugin-security-server.mjs');ui=await startPluginSecurityServer({security:api,openBrowser});return ui;})();try{return await uiPromise;}catch(error){uiPromise=null;throw error;}}
  async function requestApproval(request={}){
    await load();const clean=redact({id:crypto.randomUUID(),pluginId,pluginName,...request});let decision;
    if(approvalHandler)decision=await approvalHandler(clean);
    else{const server=await ensureUi();await notify({kind:request.kind??'approval',what:'插件正在等待你確認本機指令。',why:request.reason??'目前權限需要由你核對指令內容。',setting:server.url,impact:'按「僅這一次」才會執行這條指令；取消或逾時均不會執行。',details:clean});decision=await server.requestApproval(clean,{timeoutMs:approvalTimeoutMs});}
    return decision==='once'||decision?.action==='once'||decision===true||decision?.approved===true;
  }
  function isPosting(toolName,tool){return !settings.posting.exclude.includes(toolName)&&(settings.posting.include.includes(toolName)||automaticTools.has(toolName)||detectPostingTools([tool??toolName]).length>0);}
  async function postingDenied(code,what,why){const notice=await notify({kind:'posting-denied',what,why,setting:'插件安全設定 → 發文模式，可選每次確認、自動或禁止。',impact:'這次沒有呼叫發文工具，也沒有送出內容。'});throw fail(notice.text,code);}
  async function checkPostingLimit(){
    const timestamp=now(),day=history.filter(row=>row.mode==='auto'&&['sent','reserved'].includes(row.status)&&Date.parse(row.at)>timestamp-86400000),hour=day.filter(row=>Date.parse(row.at)>timestamp-3600000);
    const p=settings.posting,windows=[[hour,p.hourLimit,3600000],[day,p.dayLimit,86400000]],blocked=windows.filter(([rows,limit])=>limit>0&&rows.length>=limit);
    if(!p.paused&&!blocked.length)return;
    const retryAt=p.paused?null:Math.max(...blocked.map(([rows,limit,duration])=>rows.map(row=>Date.parse(row.at)).sort((a,b)=>a-b)[rows.length-limit]+duration));
    const notice=await notify({kind:'posting-rate-paused',what:p.paused?'自動發文已由你暫停。':'自動發文正在等待次數時間窗恢復。',why:p.paused?'你已勾選暫停自動發文。':`已達自動發文次數上限；最早可於 ${new Date(retryAt).toISOString()} 重試。`,setting:'插件安全設定 → 自動發文次數上限（0 表示不限）與手動暫停。',impact:p.paused?'這次沒有發送；取消勾選後可重試；每次真人確認不受影響。':'這次沒有發送；時間窗過後可自動恢復，下一次呼叫會重新檢查；每次真人確認不受影響。',details:{manuallyPaused:p.paused,retryAt:retryAt===null?null:new Date(retryAt).toISOString()}});
    const error=fail(notice.text,'SECURITY_POSTING_RATE_LIMIT');if(retryAt!==null)error.retryAt=new Date(retryAt).toISOString();throw error;
  }
  async function gatePosting({toolName='',tool,args={},destination,content}={}){
    await load();if(!isPosting(toolName,tool))return {allowed:true,posting:false,finish:async()=>{}};
    if(settings.posting.mode==='deny')return postingDenied('SECURITY_POSTING_DENIED','此插件的發文功能已禁止。','目前的發文模式是禁止。');
    if(settings.posting.mode==='auto')await checkPostingLimit();
    const data=Array.isArray(args)?args[0]??{}:args;
    const request=redact({id:crypto.randomUUID(),pluginId,pluginName,toolName,destination:destination??data.destination??data.to??data.channel??data.url??data.recipient??'工具未提供可辨識的目的地，請核對完整參數',fullContent:content??data.content??data.body??data.message??data.text??JSON.stringify(data,null,2),arguments:data});
    if(settings.posting.mode==='confirm'){
      let decision;
      if(approvalHandler)decision=await approvalHandler(request);
      else{const server=await ensureUi();await notify({kind:'posting-approval',what:'插件正在等待你確認發文。',why:'每次確認模式需要先核對目的地及完整內容。',setting:server.url,impact:'選擇「這次送出」「以後都自動發」或「不要送出」之前，不會送出。',details:request});decision=await server.requestApproval(request,{timeoutMs:approvalTimeoutMs});}
      if(decision==='alwaysAuto'||decision?.action==='alwaysAuto')await update({posting:{mode:'auto'}});
      else if(decision!=='once'&&decision?.action!=='once')return postingDenied('SECURITY_POSTING_CANCELED','這次發文已取消。','你選擇不要送出，或沒有在等待時間內確認。');
    }
    const executionMode=settings.posting.mode;request.mode=executionMode;
    // A plugin can run in multiple chats/processes. Reserve its slot under an
    // owner-only filesystem lock, before calling any source tool.
    await withPostingLock(async()=>{
      await load();
      if(settings.posting.mode==='deny')return postingDenied('SECURITY_POSTING_DENIED','這次發文已停止。','等待期間，發文模式已改成禁止。');
      if(executionMode==='auto'&&settings.posting.mode==='confirm')return postingDenied('SECURITY_POSTING_CANCELED','這次自動發文已停止。','等待期間，模式已改為每次確認；請重試並由你確認內容。');
      if(executionMode==='auto')await checkPostingLimit();
      history.push(redact({...request,at:new Date(now()).toISOString(),status:'reserved'}));await save(files.history,history);
    });let finished=false;
    return {allowed:true,posting:true,request,finish:async(success=true)=>{if(finished)return;finished=true;let entry;
      await withPostingLock(async()=>{history=await read(files.history,history);entry=redact({...request,at:new Date(now()).toISOString(),status:success?'sent':'failed'});const index=history.findIndex(row=>row.id===request.id);if(index<0)history.push(entry);else history[index]=entry;await save(files.history,history);});
      if(success)await notify({kind:'posting-sent',what:`插件回報發送成功。工具：${toolName}；目的地：${entry.destination}；內容開頭：${String(entry.fullContent).slice(0,160)}`,why:`依照你選擇的${entry.mode==='auto'?'自動發文':'每次確認'}模式執行。`,setting:'插件安全設定 → 發文模式、自動發文次數上限與歷史紀錄。',impact:'這是插件回報的結果，未另外確認目的平台的送達狀態；完整目的地與內容保留在本機紀錄。',details:entry});}};
  }
  function wrapTool(tool){
    const field=['execute','run','handler','invoke'].find(name=>typeof tool?.[name]==='function');if(!field)return tool;
    const original=tool[field],toolName=tool.name??tool.id??'';
    async function restricted(error,args){
      const message=String(error?.message??error),code=String(error?.code??'');if(code.startsWith('SECURITY_POSTING_')||!/denied|permission|EACCES|EPERM|SECURITY_|不允許|受限|拒絕|禁止|限制/i.test(code+' '+message))return null;
      const input=args[0]??{},target=error?.path??input.path??input.filePath??input.file??input.cwd;
      const model=/model|模型/i.test(code+' '+message),agent=/agent|代理/i.test(code+' '+message),shell=/spawn|shell|程序|指令/i.test(code+' '+message);
      return notify({kind:'tool-restricted',what:`工具「${toolName}」目前受限。${target?`目標路徑：${target}`:''}`,why:model?'目前設定不允許這次呼叫模型。':agent?'目前設定不允許這次建立或操作代理。':shell?'這次啟動程序的權限或人工確認條件尚未滿足。':'這次工具操作沒有取得所需的檔案存取權限。',setting:model?'插件安全設定 → 允許呼叫模型。':agent?'插件安全設定 → 允許建立與操作代理。':shell?'插件安全設定 → 允許直接啟動程序；或在本機確認頁核准這次指令。':'插件安全設定 → 額外可讀／可寫資料夾，填入這次所需的完整路徑；主平台工作區權限也必須允許。',impact:'本次操作未完成。調整對應設定後可重試；不要把這項受限結果視為功能已完成。',details:{toolName,targetPath:target??null,error:message,code}});
    }
    return {...tool,[field]:async function(...args){
      await load();const previous=new Set(notifications.map(notice=>notice.id)),server=await ensureUi();let ticket;
      try{
        ticket=await gatePosting({toolName,tool,args});const result=await original.apply(this,args);await ticket.finish(result?.isError!==true);
        if(result?.isError)await restricted(new Error(result.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')??'工具未完成'),args);else await resolveRestrictedFeatures({toolName,kind:'tool-restricted'});
        const clean=redact(result);if(Array.isArray(clean?.content)){const notices=notifications.filter(notice=>!previous.has(notice.id));return {...clean,content:[...clean.content,{type:'text',text:[...notices.map(notice=>notice.text),`插件安全設定、通知與發文紀錄：${server.url}`].join('\n\n')}],_meta:{...clean._meta,securitySettingsUrl:server.url}};}return clean;
      }catch(error){await ticket?.finish(false);const notice=await restricted(error,args),clean=redact(error);if(notice)clean.message+='\n'+notice.text;clean.message+=`\n插件安全設定、通知與發文紀錄：${server.url}`;throw clean;}
    }};
  }
  const api={load,update,redact,rememberSecrets,notify,requestApproval,gatePosting,wrapTool,commandEnvironment,sourceEnvironment,snapshot,isPosting,ensureUi,resolveRestrictedFeatures,close:async()=>{await ui?.close();await writeQueue;},dataRoot:root};return api;
}
