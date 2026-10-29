/* Ported from dsh-to-claude/lib/install-local.mjs renderReviewOverview and
 * lib/security-scan.mjs renderSecurityMarkdown. Scan rules remain unchanged;
 * platform descriptions use the current Codex implementation.
 *
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

import {secretOptionsFromScan} from './cc-security-scan.mjs';
import {DEFAULT_PLUGIN_SECURITY} from './plugin-security.mjs';

const cell=value=>String(value??'').replace(/\r?\n/g,' ').replace(/\|/g,'\\|');
const inline=value=>'`'+cell(value).replace(/`/g,'\\`')+'`';
const slash=value=>String(value).replace(/\\/g,'/');
const loc=item=>item.path?inline(`${item.path}${item.line?':'+item.line:''}`):'（無位置）';
const clip=(text,max=160)=>{const value=String(text).replace(/\s+/g,' ').trim();return value.length>max?value.slice(0,max-1)+'…':value;};
const CONTEXT_NOTE={client:'（DSH 前端畫面程式）',test:'（測試／範例）',python:'（Python）',runtime:''};
const FLAG_TEXT={absolute:'絕對路徑',home:'使用者家目錄',parent:'用 .. 往外',write:'寫入',delete:'刪除'};
const KIND_TEXT={comment:'留言／回覆',message:'私訊／訊息',email:'寄信',post:'公開發文',other:'對外送出內容'};

/** Describes existing defaults only; rendering never changes settings. */
export function renderCodexSettings(scan,{plan=null}={}){
  const defaults=DEFAULT_PLUGIN_SECURITY,s=scan.summary,rows=[];
  const enabled=key=>defaults[key]?'開啟':'關閉';
  if(s.spawnsProcesses)rows.push(['插件直接啟動程序',enabled('allowDirectSpawn'),'插件安全設定 → 允許直接啟動程序（`allowDirectSpawn`）；一般權限下仍可逐次確認指令']);
  if(s.outboundToolNames.length||s.internalOutboundToolNames.length)rows.push(['對外發文',defaults.posting.mode==='confirm'?'每次確認':defaults.posting.mode==='auto'?'自動':'禁止','插件安全設定 → 發文模式（`posting.mode`）']);
  const services=new Set(plan?.host?.services??[]);
  if(services.has('llm'))rows.push(['插件呼叫模型',enabled('allowModelCalls'),'插件安全設定 → 允許呼叫模型（`allowModelCalls`）']);
  if(services.has('agents')||services.has('subagents'))rows.push(['插件建立與操作代理',enabled('allowAgents'),'插件安全設定 → 允許建立與操作代理（`allowAgents`）']);
  const events=new Set((plan?.host?.chatEvents??[]).map(item=>item.name));
  if(events.has('session/event'))rows.push(['讓插件知道目前對話裡發生的事',enabled('shareConversation'),'插件安全設定 → 對話分享（`shareConversation`）']);
  if(events.has('agent.followup'))rows.push(['插件主動送出訊息',enabled('allowFollowups'),'插件安全設定 → 允許插件主動送出訊息（`allowFollowups`）']);
  if((plan?.host?.behaviors??[]).some(item=>item.kind==='tool-hook'))rows.push(['原生工具掛鉤',enabled('nativeToolHooks'),'插件安全設定 → 允許使用原生工具掛鉤（`nativeToolHooks`）']);
  if(s.fileFlags.absolute||s.fileFlags.home||s.fileFlags.parent)rows.push(['讀寫工作資料夾以外的位置','依插件安全設定的可讀／可寫資料夾決定','插件安全設定 → 額外讀取／寫入資料夾（`extraReadFolders`／`extraWriteFolders`）']);
  const lines=['## 透過市場安裝後的預設設定',''];
  if(rows.length){lines.push('| 功能 | 預設 | 調整方式 |','|---|---|---|');for(const [feature,value,setting]of rows)lines.push(`| ${cell(feature)} | ${cell(value)} | ${cell(setting)} |`);}
  else lines.push('- 依掃描結果，沒有需要特別列出的設定。');
  lines.push('','這裡列出程式目前的預設值，未讀取已安裝插件的個人設定；實際支援情形以轉換報告與宿主回傳的權限為準。');
  return lines.join('\n');
}

/** CC evidence sections with the same limits and category selection. */
export function renderCCScanDetails(scan,{reportPath=null}={}){
  const s=scan.summary,lines=[];
  const list=(rows,format,limit=25)=>{for(const row of rows.slice(0,limit))lines.push('- '+format(row));if(rows.length>limit)lines.push(`- ……還有 ${rows.length-limit} 處，見 ${inline(reportPath?slash(reportPath):'security-report.json')}`);};
  const proc=scan.processes.filter(item=>item.context!=='test');
  if(proc.length){lines.push('## 自己開程式','','以下是直接啟動其他程式的位置。轉換後的處理依 Codex 權限與插件安全設定；可在「允許直接啟動程序」調整，設定名稱為 `allowDirectSpawn`。','');list(proc,item=>`${loc(item)}${CONTEXT_NOTE[item.context]??''}：${item.api}，程式 ${item.program?'`'+item.program+'`':'看不出來'+(item.expression?`（\`${item.expression}\`）`:'')}`);lines.push('');}
  const net=scan.network.filter(item=>item.context!=='test');
  if(net.length){lines.push('## 連網路','','以下列出靜態規則辨識到的連線。轉換器不額外限制網路；本報告不測試連線是否成功。','');list(net,item=>`${loc(item)}${CONTEXT_NOTE[item.context]??''}：${item.api}${item.domain?'，網域 `'+item.domain+'`':''}`);lines.push('');}
  const fileRows=scan.fileAccess.filter(item=>item.context!=='test'&&(item.flags?.length));
  if(fileRows.length){lines.push('## 讀寫檔案（只列有寫入、刪除、絕對路徑、家目錄或 .. 往外的）','');list(fileRows,item=>`${loc(item)}${CONTEXT_NOTE[item.context]??''}：${item.api}（${(item.flags??[]).map(f=>FLAG_TEXT[f]??f).join('、')}）${item.target?'，路徑 `'+item.target+'`':''}`);lines.push('');}
  const home=scan.homeReferences.filter(item=>item.context!=='test');
  if(home.length){lines.push('## 用到使用者家目錄','');list(home,item=>`${loc(item)}${CONTEXT_NOTE[item.context]??''}：${item.kind==='os.homedir'?'os.homedir()':'環境變數 '+item.name}`,15);lines.push('');}
  if(s.secretNames.length||scan.secrets.credentialRefs.length||scan.secrets.hardcoded.length){
    lines.push('## 金鑰','');
    for(const item of scan.secrets.names)lines.push(`- \`${item.name}\`：${item.locations.map(l=>loc(l)+(l.via?'（'+l.via+'）':'')).join('、')}`);
    for(const item of scan.secrets.credentialRefs.filter(r=>r.context!=='test').slice(0,15))lines.push(`- DSH 憑證服務 ${item.api}：${item.name?'`'+item.name+'`':'名稱是動態的'}，${loc(item)}`);
    for(const item of scan.secrets.hardcoded.filter(r=>r.context!=='test').slice(0,15))lines.push(`- 寫死的字串 \`${item.name}\`（${item.length} 字，值未記錄）：${loc(item)}`);
    lines.push('');
  }
  const whole=scan.wholeEnvironment.filter(item=>item.context!=='test');
  if(whole.length){lines.push('## 把整份環境變數交出去','');list(whole,item=>`${loc(item)}${CONTEXT_NOTE[item.context]??''}：${item.code??item.api??'傳遞整份環境變數'}`);lines.push('');}
  const toolRows=scan.tools.filter(item=>item.outbound);
  if(toolRows.length||scan.tools.length||scan.internalTools.some(item=>item.outbound)){
    lines.push('## 對外發文','','「對外發文」指插件用你的名義把內容送給別人或公開出去（留言、私訊、寄信、發文）。讀取、搜尋、建立草稿不算。透過市場安裝後，這些工具預設每次確認；可在插件安全設定的發文模式調整，設定名稱為 `posting.mode`。判斷依工具名稱與描述，可能誤判；可在安全設定的發文工具清單修正。','');
    if(toolRows.length)for(const item of toolRows)lines.push(`- \`${item.name}\`（${KIND_TEXT[item.kind]??item.kind}）：${item.description?clip(item.description,80):'沒有描述'}。${loc(item)}；判斷依據：${item.reason}${item.targetFields?.length?`；目的地欄位 ${item.targetFields.join('、')}`:''}${item.textFields?.length?`；內容欄位 ${item.textFields.join('、')}`:''}`);
    else lines.push('- 沒有判定為對外發文的工具');
    const other=scan.tools.filter(item=>!item.outbound);
    if(other.length)lines.push('',`其他工具（判定不是對外發文）：${other.map(item=>'`'+item.name+'`').join('、')}`);
    const internal=scan.internalTools.filter(item=>item.outbound);
    if(internal.length){lines.push('','插件內附的 Python 工具中，判定會對外發文的：');for(const item of internal)lines.push(`- \`${item.name}\`（${KIND_TEXT[item.kind]??item.kind}）：${loc(item)}`);}
    lines.push('');
  }
  if(scan.obfuscation.files.length||scan.obfuscation.minified.length){
    lines.push('## 混淆與壓縮','');
    for(const item of scan.obfuscation.files)lines.push(`- **混淆** ：${loc(item)}${CONTEXT_NOTE[item.context]??''}：${item.reasons.join('；')}`);
    list(scan.obfuscation.minified,item=>`壓縮（不算混淆）：${loc(item)}${CONTEXT_NOTE[item.context]??''}，最長一行 ${item.maxLineLength} 字`,15);
    lines.push('');
  }
  if(scan.otherLanguages.length){lines.push('## 其他語言的檔案','');list(scan.otherLanguages,item=>`${loc(item)}（${item.language}）：${item.executed}${item.referencedBy?.length?'，出現在 '+item.referencedBy.slice(0,3).map(r=>'`'+r+'`').join('、'):''}`,30);lines.push('');}
  if(scan.installScripts.length){lines.push('## 安裝腳本','');for(const item of scan.installScripts)lines.push(`- \`${item.name}\`：\`${item.command}\`（${item.note}）`);lines.push('');}
  if(scan.files.bundledDependencies.files)lines.push('## 打包的依賴','',`\`node_modules\` 裡有 ${scan.files.bundledDependencies.files} 個檔案（${scan.files.bundledDependencies.packages.length} 個套件），只統計、沒有掃描。`,'');
  return lines.join('\n').trim().replace(/^## /gm,'### ');
}

/** Pure CC overview and evidence rendering, adapted to the existing Codex settings. */
export function renderCCScanOverview(scan,{plan=null,source={},reportPath=null}={}){
  const s=scan.summary,cell=value=>String(value??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' '),code=list=>list.map(value=>'`'+cell(value)+'`').join('、'),live=list=>list.filter(item=>item.context!=='test');
  const lines=[`# DSH 插件安全掃描：${cell(scan.package.name)}${scan.package.version?' '+cell(scan.package.version):''}`,'','固定規則的靜態掃描，沒有呼叫 AI，也沒有執行插件。只標出值得去看的位置，不代表安全，也不代表惡意。','','## 一覽','','| 項目 | 結果 | 處數 |','|---|---|---|'];
  const row=(item,result,count='')=>lines.push(`| ${item} | ${result} | ${count} |`);
  row('能不能審查',s.obfuscated?'無法審查：有混淆過的程式碼':'可以審查（沒看到混淆過的程式碼）',s.obfuscatedFiles.length||'');
  row('自己開程式',s.spawnsProcesses?`會：${code(s.programs)}${s.unknownPrograms?`；${s.unknownPrograms} 處看不出程式名稱`:''}`:'沒看到',live(scan.processes).length||'');
  row('連網路',s.usesNetwork?`會：${s.domains.length?code(s.domains):'網域看不出來（網址是組出來的）'}`:'沒看到',live(scan.network).length||'');
  row('寫入或刪除檔案',s.writesFiles?`會（${s.fileFlags.write} 處）${s.fileFlags.absolute?`，${s.fileFlags.absolute} 處用絕對路徑`:''}${s.fileFlags.parent?`，${s.fileFlags.parent} 處用 .. 往外`:''}`:'沒看到',live(scan.fileAccess).length||'');
  row('用到使用者家目錄',s.fileFlags.home?'會':'沒看到',s.fileFlags.home||'');
  row('需要金鑰',s.secretNames.length?`需要：${code(s.secretNames)}`:'沒看到',s.secretNames.length||'');
  row('用你的帳號對外發文的工具',s.outboundToolNames.length?`有：${code(s.outboundToolNames)}`:'沒有',s.outboundToolNames.length||'');
  if(s.internalOutboundToolNames.length)row('內附 Python 工具裡會對外發文的',code(s.internalOutboundToolNames),s.internalOutboundToolNames.length);
  row('工具總數',s.tools);
  row('其他語言的檔案',s.otherLanguageFiles?`${s.otherLanguageFiles} 個，其中 ${s.otherLanguagesExecuted.length} 個可能會被執行`:'沒有',s.otherLanguageFiles||'');
  row('執行檔或二進位檔（看不到內容）',s.binaries.length?code(s.binaries):'沒有',s.binaries.length||'');
  row('安裝腳本',s.installScripts.length?`${code(s.installScripts)}（本次未執行）`:'沒有',s.installScripts.length||'');
  row('把整份環境變數交出去',s.passesWholeEnvironment?'有（環境變數裡可能有你其他的金鑰）':'沒看到');
  row('寫死、看起來像金鑰的字串',s.hardcodedSecrets?`${s.hardcodedSecrets} 處（值沒有記錄）`:'沒看到',s.hardcodedSecrets||'');
  row('壓縮過的程式（難以閱讀，不算混淆）',s.minifiedFiles.length?`${s.minifiedFiles.length} 個檔案`:'沒有',s.minifiedFiles.length||'');
  const metadata=[];
  if(source.origin)metadata.push(`- 來源：${inline(source.origin)}${source.npm?.version?`（npm 版本 ${cell(source.npm.version)}）`:''}${source.commit?`（提交 ${inline(source.commit.slice(0,12))}）`:''}`);
  if(source.root)metadata.push(`- 原始碼${source.remote?'已下載到':'位置'}：${inline(slash(source.root))}（沒有安裝，也沒有執行）`);
  if(reportPath)metadata.push(`- 完整掃描結果（JSON，每項附檔案與行號）：${inline(slash(reportPath))}`);
  if(metadata.length)lines.splice(2,0,...metadata,'');
  const secrets=secretOptionsFromScan(scan,{displayName:plan?.name??scan.package.name});
  if(secrets.length){
    lines.push('','## 需要的金鑰','','| 環境變數 | 用到的功能 | 程式位置 |','|---|---|---|');
    for(const item of secrets)lines.push(`| ${inline(item.env)} | ${cell(item.features)} | ${cell(item.locations.map(location=>`${location.path}${location.line?':'+location.line:''}`).join('、'))} |`);
    lines.push('','安裝後可在插件安全設定的敏感欄位填寫。敏感值保存在插件目錄外、只允許目前使用者存取的本機檔案，檔案本身未加密。不需要那些功能可以留空。');
  }
  lines.push('',renderCodexSettings(scan,{plan}));
  if(plan){
    const unsupported=plan.conversion?.intrinsicallyUnsupported??[];
    const issues=plan.issues??[];
    if(plan.host?.client||unsupported.length||issues.length){
      lines.push('','## Codex 不支援或尚待確認的 DSH 功能','');
      if(plan.host?.client)lines.push('- DSH 的畫面、側欄與原生聊天按鈕不轉換。');
      for(const item of unsupported)lines.push(`- ${cell(item.reason??item.feature)}`);
      for(const item of issues)lines.push(`- ${cell(item.message??item.code)}`);
    }
  }
  lines.push('','## 逐項位置','',renderCCScanDetails(scan,{reportPath})||'- 沒有需要逐項列出的位置。','');
  return lines.join('\n');
}

