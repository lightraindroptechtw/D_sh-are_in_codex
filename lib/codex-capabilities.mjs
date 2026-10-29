import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import semver from 'semver';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

const execute=promisify(execFile),cache=new Map();
const schemaCache=new Map();
export const SUPPORTED_HOOKS=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop','SubagentStart','SubagentStop','Notification','PreCompact','SessionEnd','Interrupt'];

/** Version/help probes never create a thread, log in, or send a model request. */
export async function probeCodexCapabilities({command='codex',refresh=false,runner=execute}={}){
  if(!refresh&&runner===execute&&cache.has(command))return cache.get(command);
  const probing=(async()=>{
    let version=null,appServer=false;
    try{const result=await runner(command,['--version'],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});version=result.stdout.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1]??null;}catch{}
    if(version)try{const result=await runner(command,['app-server','--help'],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});appServer=/--stdio|generate-json-schema|\[OPTIONS\]/.test(result.stdout);}catch{}
    const supported=Boolean(version&&semver.gte(version,'0.160.0',{includePrerelease:true}));
    return {codexVersion:version,available:Boolean(version),mcp:supported,skills:supported,appServer:supported&&appServer,elicitation:supported?'negotiated':false,hooks:Object.fromEntries(SUPPORTED_HOOKS.map(name=>[name,supported&&name!=='Notification'])),probe:{versionCommandOnly:true,helpCommandOnly:true,modelCalls:0},limitations:['Codex 0.160.0 hooks/list was verified to ignore Notification; this event is disabled until a newer capability is explicitly verified.','Hook availability is version checked; actual execution still requires the user to trust generated hooks.','Elicitation is checked again against the connected MCP client capabilities for each call.']};
  })();
  if(runner===execute){cache.set(command,probing);probing.catch(()=>cache.delete(command));}
  return probing;
}

/** Extract names and parameter references, never send the full schema to AI. */
export function summarizeProtocolSchema(schema){
  const methods=[];
  for(const item of schema.oneOf??schema.anyOf??[]){
    const names=item.properties?.method?.enum??(item.properties?.method?.const?[item.properties.method.const]:[]);
    const ref=item.properties?.params?.$ref,definition=ref?.startsWith('#/definitions/')?schema.definitions?.[ref.slice(14)]:item.properties?.params;
    for(const name of names)if(typeof name==='string')methods.push({name,parameters:Object.keys(definition?.properties??{}),...(ref?{ref}:{})});
  }
  return [...new Map(methods.map(item=>[item.name,item])).values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export async function protocolCapabilities({command='codex',codexVersion,dataRoot,runner=execute,refresh=false}={}){
  if(!semver.valid(codexVersion))return {found:false,reason:'無法確認 Codex 版本，未產生 API 摘要；仍可依目前工具與說明繼續。',modelCalls:0};
  const identity=createHash('sha256').update(String(command)).digest('hex').slice(0,12);
  const root=path.resolve(dataRoot??path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'dsh-to-codex-market'),'capabilities',`${codexVersion}-${identity}`),key=root;
  if(!refresh&&schemaCache.has(key))return schemaCache.get(key);
  const pending=(async()=>{
    await fs.mkdir(root,{recursive:true});const receiptFile=path.join(root,'summary.json');
    if(!refresh)try{const existing=JSON.parse(await fs.readFile(receiptFile,'utf8'));if(existing.codexVersion===codexVersion&&existing.command===command){await fs.access(existing.schemaPath);return existing;}}catch{}
    const output=path.join(root,'schema-'+randomUUID());
    try{
      await runner(command,['app-server','generate-json-schema','--out',output],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
      const schemaPath=path.join(output,'ClientRequest.json'),schema=JSON.parse(await fs.readFile(schemaPath,'utf8')),methods=summarizeProtocolSchema(schema);
      if(!methods.length)throw Error('產生的資料沒有可辨識的 API 方法');
      const markdownPath=path.join(root,'Codex功能摘要.md');
      const markdown=[`# Codex ${codexVersion} API 功能摘要`,'','由目前 Codex 直接產生的協定定義整理，不是 Claude Code 的型別檔。方法存在不代表目前對話已授權或能使用；畫面工具另以主對話當前工具為準。','',...methods.map(item=>`- \`${item.name}\`：參數 ${item.parameters.slice(0,12).join('、')||'無'}${item.parameters.length>12?'等':''}`),'',`完整定義：${schemaPath}`].join('\n');
      await fs.writeFile(markdownPath,markdown+'\n');
      const result={found:true,codexVersion,command,path:markdownPath,schemaPath,methods:methods.map(item=>item.name),methodCount:methods.length,modelCalls:0,source:'installed-codex-generated-schema'};
      const temp=receiptFile+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(result,null,2));await fs.rename(temp,receiptFile);return result;
    }catch(cause){return {found:false,codexVersion,reason:`Codex API 摘要未能產生：${String(cause.message).slice(0,220)}。可依目前對話工具繼續，不作為安裝門檻。`,modelCalls:0};}
  })();schemaCache.set(key,pending);try{const result=await pending;if(!result.found)schemaCache.delete(key);return result;}catch(cause){schemaCache.delete(key);throw cause;}
}

/** Version-matched generated protocol plus the separate host UI assessment. */
export async function capabilitySummary(options={}){
  const probe=await probeCodexCapabilities(options);
  const apiSchema=await protocolCapabilities({...options,codexVersion:probe.codexVersion});
  return {codexVersion:probe.codexVersion,available:probe.available,modelCalls:0,apiSchema,
    interfaces:[
      {name:'skills',label:'技能與對話指令',status:probe.skills?'available':'unconfirmed'},
      {name:'mcp',label:'MCP 工具連接協定',status:probe.mcp?'available':'unconfirmed'},
      {name:'browser-page',label:'獨立本機網頁',status:'host-dependent',note:'網頁可獨立實作；在 Codex 顯示須使用目前可用的開頁工具，不代表可修改 Codex 聊天介面。'},
      {name:'hooks',label:'事件掛鉤',status:'partial',events:Object.entries(probe.hooks).filter(([,ok])=>ok).map(([name])=>name),note:'支援事件須按實際連線與安裝信任狀態確認。'},
      {name:'dsh-ui',label:'DSH 側欄、輸入框與訊息元件',status:'unavailable',note:'不能原樣掛到 Codex；可按功能改寫成獨立網頁、工具或技能。'}
    ],notice:'API 方法來自目前 Codex 產生的協定定義；畫面與工具須再核對目前對話的實際連線。存在定義不等於已有權限，也不會自動提供 Claude Code 的 $ 物件或 DSH 原生畫面。'};
}

export function moduleAvailability(descriptor,capabilities){
  const min=descriptor.requires?.minimumCodexVersion;
  if(min&&(!semver.valid(capabilities.codexVersion)||!semver.gte(capabilities.codexVersion,min,{includePrerelease:true})))return {enabled:false,reason:`需要 Codex ${min} 以上，目前版本未確認或過舊`};
  for(const name of descriptor.requires?.capabilities??[]){let value=capabilities;for(const part of name.split('.'))value=value?.[part];if(!value)return {enabled:false,reason:`缺少 Codex 能力 ${name}`};}
  return {enabled:true};
}
