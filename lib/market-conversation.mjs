import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {marketRecord,launchMarket} from './market-launcher.mjs';
import {defaultMarketRoot} from './market-server.mjs';
import {makeReviewPlan} from './security-review-plan.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
/** Main-conversation transport. This module never starts an AI or runs source code. */
export function createMarketConversation({dataRoot=defaultMarketRoot(),readRecord=marketRecord,fetchImpl=fetch,launchImpl=launchMarket}={}){
 async function connection(){const record=await readRecord(dataRoot);if(!record)throw Error('市場尚未開啟，請先使用 open_dsh_market 開啟。');return record;}
 async function request(record,pathname,{body}={}){
  const headers={Authorization:'Bearer '+record.accessToken};
  if(body){const config=await request(record,'/api/config');Object.assign(headers,{'Content-Type':'application/json','X-CSRF-Token':config.csrfToken,Origin:record.url});}
  const response=await fetchImpl(record.url+pathname,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok)throw Error(result.error?.message??result.error??'市場操作未完成');return result;
 }
 async function pending({waitMs=0,reviewId,aiScope='auto'}={}){
  if(!Number.isInteger(waitMs)||waitMs<0||waitMs>55000)throw Error('等待時間須為 0 到 55000 毫秒。');
  if(!['auto','code','all','none'].includes(aiScope))throw Error('請選擇自動、程式、全部或不用 AI。');
  const record=await connection(),deadline=Date.now()+waitMs;let selected;
  do{const result=await request(record,'/api/cc/jobs');selected=result.jobs.find(job=>['awaiting-main-conversation','submitted-to-main-conversation'].includes(job.handoff?.status)&&(!reviewId||job.handoff.reviewId===reviewId));if(selected||Date.now()>=deadline)break;await new Promise(resolve=>setTimeout(resolve,Math.min(500,Math.max(1,deadline-Date.now()))));}while(true);
  if(!selected)return {status:'no-pending-review',message:'目前沒有等待主對話審查的市場項目。',startedModel:false};
  if(aiScope==='auto'&&selected.handoff.aiScope)aiScope=selected.handoff.aiScope;
  const receipt=selected.result.sourceReview,settings=await request(record,'/api/review-settings');
  let capabilities;try{capabilities=await request(record,'/api/cc/capabilities');}catch(cause){capabilities={apiSchema:{found:false,reason:'能力摘要暫時無法取得：'+String(cause.message).slice(0,180)}};}
  const editable=await fs.readFile(path.join(root,'data/security-review-prompt.md'),'utf8'),prompt=editable.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1]??'';
  const plan=makeReviewPlan(receipt.scan,{settings,aiScope,prompt,sourceDigest:receipt.sourceDigest,hostContext:capabilities}),needsChoice=plan.aiPlan.exceedsBudget&&aiScope!=='all';
  return {status:aiScope==='none'?'static-only':needsChoice?'needs-choice':'awaiting-main-conversation',reviewId:selected.handoff.reviewId,plugin:selected.name,version:selected.handoff.version??selected.result.version??selected.resolvedVersion??selected.version,sourceRoot:selected.path,sourceDigest:receipt.sourceDigest,
   aiPlan:{...plan.aiPlan,model:'current-conversation',reasoningEffort:'current-conversation',expectedModelCalls:0},
   staticReportPath:path.join(dataRoot,'reviews',receipt.id,'review.json'),reviewPromptPath:path.join(root,'data/security-review-prompt.md'),
   capabilities,startedModel:false,notice:'由目前對話閱讀代表片段並回報，這個工具不另開模型。完整固定掃描保存在本機報告與市場畫面，未逐一讀取被省略的位置。',
   ...(needsChoice||aiScope==='none'?{choices:['code','all','none']}:{untrustedSourceData:{files:plan.files,categories:JSON.parse(plan.input.split('UNTRUSTED_SOURCE_DATA_JSON\n')[1]).categories}})};
 }
 async function complete({reviewId,judgment}){
  const record=await connection(),result=await request(record,'/api/cc/review-complete',{body:{reviewId,judgment}});
  if(!result.sourceReview)return result;
  const receipt=result.sourceReview;
  // Full receipts and raw findings remain local. Returning them through MCP
  // would silently send the entire scan after a bounded representative review.
  return {reviewId:result.reviewId,packageName:result.packageName,version:result.version,status:result.status,path:result.path,
   sourceReview:{id:receipt.id,status:receipt.status,reviewOrigin:receipt.reviewOrigin,risk:receipt.risk,summary:receipt.summary,coveredFiles:receipt.coveredFiles,coverageNotice:receipt.coverageNotice,sourceDigest:receipt.sourceDigest},
   staticReportPath:path.join(dataRoot,'reviews',receipt.id,'review.json'),startedModel:false,installed:false};
 }
 async function waitJob(record,id){
  const deadline=Date.now()+30*60*1000;
  while(Date.now()<deadline){const {jobs}=await request(record,'/api/cc/jobs'),job=jobs.find(item=>item.id===id);if(!job)throw Error('找不到這筆來源工作');if(job.phase==='error')throw Object.assign(Error(job.text),{code:job.error?.code??'MARKET_OPERATION_FAILED'});if(job.phase==='done')return job;await new Promise(resolve=>setTimeout(resolve,250));}
  throw Error('來源工作仍在處理；可從市場工作紀錄查看結果');
 }
 async function reviewSource({source,packageDir,aiScope='auto'}={}){
  await launchImpl({dataRoot,open:false});const record=await connection();
  const queued=await request(record,'/api/cc/source-review',{body:{source,packageDir,aiScope}}),job=await waitJob(record,queued.id);
  const conversation=await pending({reviewId:job.result.reviewId,aiScope});
  const result=job.result;
  return {reviewId:result.reviewId,packageName:result.packageName,version:result.version,pinnedSource:result.pinnedSource,packageDir:result.packageDir,path:result.path,
   reportPath:result.reportPath,markdownPath:result.markdownPath,originalMarkdownPath:result.markdownPath,
   ...conversation,jobId:job.id,startedModel:false,sourceExecuted:false,converted:false,installed:false};
 }
 async function installReviewed({reviewId,consent,forceObfuscated=false,rewriteId}={}){
  if(consent!==true)throw Error('請先查看掃描與審查結果並明確同意安裝');
  await launchImpl({dataRoot,open:false});const record=await connection();
  const queued=await request(record,'/api/cc/source-install',{body:{reviewId,consent:true,forceObfuscated,...(rewriteId?{rewriteId}:{})}});
  const job=await waitJob(record,queued.id);return {...job.result,jobId:job.id};
 }
 async function rewrite(args={}){
  await launchImpl({dataRoot,open:false});const record=await connection();
  const queued=await request(record,'/api/cc/source-rewrite',{body:args});return (await waitJob(record,queued.id)).result;
 }
 return {pending,complete,reviewSource,installReviewed,rewrite};
}
