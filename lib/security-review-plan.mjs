import {isProgramFile} from './security-scan.mjs';
export const DEFAULT_REVIEW_SETTINGS=Object.freeze({maxInputChars:60000,representativePerCategory:3,excerptChars:600,model:'gpt-6.1-sol',reasoningEffort:'medium'});
export function reviewSettings(value={}){
  const settings={...DEFAULT_REVIEW_SETTINGS,...value};
  for(const name of ['maxInputChars','representativePerCategory','excerptChars'])if(!Number.isSafeInteger(settings[name])||settings[name]<1)throw Error(`${name} 必須是正整數；這是可自行調整的送審用量設定。`);
  if(settings.model!==null&&(typeof settings.model!=='string'||!settings.model.trim()))settings.model=null;
  if(!['none','minimal','low','medium','high','xhigh','max'].includes(settings.reasoningEffort))throw Error('請選擇支援的思考強度。');
  return settings;
}
/** Counts and compression are local and deterministic. No quota is spent. */
export function makeReviewPlan(scan,{settings:options={},aiScope='auto',prompt='',sourceDigest='',hostContext}={}){
  const settings=reviewSettings(options),source=scan.findings.filter(item=>aiScope!=='code'||isProgramFile(item.file)),groups=new Map();
  for(const finding of source){const key=JSON.stringify([finding.file,finding.category]);let group=groups.get(key);if(!group){group={file:finding.file,category:finding.category,label:finding.label,count:0,firstLine:finding.line,lastLine:finding.line,snippet:finding.excerpt.slice(0,settings.excerptChars)};groups.set(key,group);}group.count++;group.lastLine=finding.endLine??finding.line;}
  const categories=new Map();for(const group of groups.values()){const category=categories.get(group.category)??{category:group.category,findings:0,groups:0,representatives:[]};category.groups++;category.findings+=group.count;if(category.representatives.length<settings.representativePerCategory)category.representatives.push(group);categories.set(group.category,category);}
  const selected=[...categories.values()].flatMap(category=>category.representatives),selectedFiles=[...new Set(selected.map(group=>group.file))];
  // Do not send scan.files, full file inventory, or duplicate snippets again.
  const files=selectedFiles.map(file=>({path:file,content:selected.filter(group=>group.file===file).map(group=>`[L${group.firstLine}] ${group.snippet}\n${group.label}：共 ${group.count} 處，最後位置 L${group.lastLine}`).join('\n')}));
  const omittedFindings=source.length-selected.length;
  const data={sourceDigest,files,categories:[...categories.values()].map(({representatives,...category})=>({...category,representatives:representatives.map(({snippet,...group})=>group)})),scope:'Only representative excerpts are provided; counts do not mean other occurrences were reviewed. Documentation examples are not executed behavior.'};
  const input=prompt+'\n\nTRUSTED_HOST_CONTEXT_JSON\n'+JSON.stringify({scope:'advisory representative excerpts only; no install gate',aiScope,...(hostContext?{capabilities:hostContext}:{})})+'\n\nUNTRUSTED_SOURCE_DATA_JSON\n'+JSON.stringify(data);
  const inputChars=[...input].length;
  const aiPlan={findingCount:scan.findings.length,scopeFindingCount:source.length,groupCount:groups.size,selectedGroups:selected.length,omittedFindings,inputChars,estimatedTokens:{min:Math.ceil(inputChars/4),max:inputChars},softLimitChars:settings.maxInputChars,exceedsBudget:inputChars>settings.maxInputChars,model:settings.model,reasoningEffort:settings.reasoningEffort,expectedModelCalls:source.length?1:0,quota:{available:false},notice:'字數包含提示詞與合併後片段，不含模型輸出與服務內部開銷；詞元只是粗估。送出量是交給 Codex 的輸入，不等於已計費量；無法可靠換算額度百分比。沒有逐一審查被省略的片段。超過建議值可自行繼續，不是安裝限制。'};
  return {input,aiPlan,files,settings};
}
