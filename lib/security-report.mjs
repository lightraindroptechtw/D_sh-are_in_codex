import fs from 'node:fs/promises';
import path from 'node:path';

const literal=value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
export async function writeSecurityReport(packageRoot,{report={},scan=report.securityScan,sourceReview=report.securityReview,notices=[]}={}){
  const keys=(report.environment?.requestedEnvNames??[]).filter(name=>/key|token|secret|password|credential|cookie|authorization/i.test(name));
  const data={plugin:report.name,version:report.version,description:report.description??'以來源宣告及實際工具為準。',riskPosition:'風險高於單純使用 Codex；所有保護只能降低風險，AI 審查不是安全保證。會發文或開子代理的插件不建議使用完整存取權。',sourceReview:sourceReview??{status:'unreviewed',summary:'未經 AI 審查，可依固定規則掃描自行決定。'},scan,requiredSecretFields:keys,notices:[...notices,...(report.conversion?.securityNotices??[])],omitted:report.conversion?.omitted??[],recommendation:'先查看具體命中位置與設定。能力強不是拒絕理由；可疑或 AI 不可用時由你決定。'};
  await fs.writeFile(path.join(packageRoot,'security-report.json'),JSON.stringify(data,null,2)+'\n');
  const budget=data.sourceReview.aiPlan,progress=data.sourceReview.aiProgress,usage=data.sourceReview.modelUsage;
  const cost=data.sourceReview.reviewOrigin==='main-conversation'?`由目前 Codex 主對話完成判讀，模型與思考強度沿用主對話設定，沒有另外啟動審查模型。${literal(data.sourceReview.coverageNotice)} 主對話實際詞元用量未由此程序量測。`:budget?`預估輸入 ${budget.inputChars} 字、${budget.expectedModelCalls} 次模型呼叫；合併 ${budget.groupCount} 組，提供 ${budget.selectedGroups} 個代表片段。模型：${literal(budget.model??'Codex 預設')}；思考強度：${literal(budget.reasoningEffort)}。額度百分比無法由字數可靠換算。${progress&&typeof progress.sentChars==='number'?` 已交給 Codex ${progress.sentChars} 字，尚未送 ${progress.remainingChars} 字，完成 ${progress.completedCalls} 次。`:''}`:'';
  const text=[`# ${literal(report.name??'插件')}：安裝前安全報告`,'',data.riskPosition,'','## 插件做什麼','',literal(data.description),'','## 掃描與 AI 意見','',`固定規則命中 ${scan?.findings?.length??0} 個位置，列在 security-scan.json；圖片、字型等 ${scan?.assets?.length??0} 個非文字資產未逐行審查。`,'',cost,'',literal(data.sourceReview.summary),'',...(data.sourceReview.findings??[]).map(f=>`- ${literal(f.file)}：${literal(f.reason)}`),'','## 需要哪些金鑰','',keys.length?keys.map(key=>`- ${literal(key)}：請在插件安全設定的敏感欄位填寫。`).join('\n'):'來源未明確宣告必填的金鑰名稱；這不代表已執行驗證所有連線。','','## 建議與未保留的功能','',data.recommendation,'',...data.notices.map(item=>`- ${literal(typeof item==='string'?item:item.message??item.reason??item.code)}`),...data.omitted.map(item=>`- ${literal(item.message??item.reason??item.code)}`),''].join('\n');
  const actual=usage?.available?`\n## Codex 回報的實際詞元\n\n輸入 ${usage.inputTokens??'未提供'}，其中快取 ${usage.cachedInputTokens??'未提供'}；輸出 ${usage.outputTokens??'未提供'}。詞元數不能換算成帳戶額度百分比。\n`:'';
  await fs.writeFile(path.join(packageRoot,'安全報告.md'),text+actual);return data;
}
