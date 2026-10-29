import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {run} from './source.mjs';
import {scanSecurity} from './security-scan.mjs';
import {snapshotSource,reviewSchema} from './security-review.mjs';
import {makeReviewPlan,reviewSettings as normalizeSettings} from './security-review-plan.mjs';
import {createCodexControl} from './codex-control.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failure=message=>Object.assign(new Error(message),{code:'SECURITY_INTEGRITY_FAILED'});
export async function createSecurityReviewer({dataRoot,codexHome,codexCommand=process.env.CODEX_BIN||'codex',runImpl=run,readUsage,limits={},timeoutMs=180000}={}){
  const reviews=path.join(path.resolve(dataRoot),'reviews'),settingsFile=path.join(path.resolve(dataRoot),'review-settings.json');await fs.mkdir(reviews,{recursive:true,mode:0o700});
  async function getSettings(){let saved={};try{saved=JSON.parse(await fs.readFile(settingsFile,'utf8'));}catch(cause){if(cause.code!=='ENOENT')throw cause;}return normalizeSettings(saved);}
  async function updateSettings(patch){const saved=normalizeSettings({...await getSettings(),...patch});await fs.writeFile(settingsFile,JSON.stringify(saved,null,2)+'\n');return saved;}
  const keyFile=path.join(reviews,'local-review-key');try{await fs.writeFile(keyFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});}catch(cause){if(cause.code!=='EEXIST')throw cause;}
  const key=await fs.readFile(keyFile);if(key.length!==32)throw failure('審查簽章金鑰無效');
  const sign=value=>crypto.createHmac('sha256',key).update(JSON.stringify(value)).digest('hex'),validate=new Ajv().compile(reviewSchema);
  async function usage(){
    try{
      let value;
      if(readUsage)value=await readUsage();
      else if(runImpl!==run)return {available:false,notice:'此測試沒有查詢真實帳戶；未使用模型。'};
      else{const control=await createCodexControl({command:codexCommand,codexHome,authentication:'chatgpt',allowModelCalls:false,timeoutMs:8000});try{value=await control.readRateLimits();}finally{await control.close();}}
      if(value?.available===false)return value;
      const active=value.rateLimits??value.rateLimitsByLimitId?.codex??value;
      return {available:true,checkedAt:new Date().toISOString(),primary:active.primary??null,secondary:active.secondary??null,limitId:active.limitId??null,exhausted:Boolean(active.rateLimitReachedType||[active.primary,active.secondary].some(window=>typeof window?.usedPercent==='number'&&window.usedPercent>=100)),notice:'這是目前帳戶狀態；無法把本次字數可靠換算成額度百分比。'};
    }catch{return {available:false,notice:'目前讀不到帳戶額度。字數與詞元估算仍可查看；不因此限制安裝。'};}
  }
  async function review(sourceRoot,{onProgress=()=>{},skipAI=false,aiScope='auto',reviewSettings:overrides={}}={}){
    if(!['auto','code','all','none'].includes(aiScope))throw Error('請選擇自動、只審程式、全部或不用 AI。');
    const snapshot=await snapshotSource(sourceRoot,limits),scan=await scanSecurity(sourceRoot,{snapshot}),id=crypto.randomUUID(),job=path.join(reviews,id);await fs.mkdir(job,{mode:0o700});
    const settings=normalizeSettings({...await getSettings(),...overrides});
    const editable=await fs.readFile(path.join(root,'data/security-review-prompt.md'),'utf8'),prompt=editable.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1]??'';
    const plan=makeReviewPlan(scan,{settings,aiScope,prompt,sourceDigest:snapshot.digest}),{aiPlan}=plan;
    const progress={sentChars:0,completedChars:0,remainingChars:aiPlan.inputChars,submittedCalls:0,completedCalls:0};
    let status='not-needed',risk='unknown',summary='固定規則沒有標出需 AI 複查的位置。',findings=[],result,modelUsage={available:false};
    await onProgress({stage:'scan',message:'已完成檔案分類與重複標記合併，正在估算送審用量。',scan,aiPlan,aiProgress:{...progress}});
    if(skipAI||aiScope==='none'){aiPlan.expectedModelCalls=0;status='skipped';summary='本次不用 AI，只提供固定規則掃描；仍可繼續轉換安裝。';}
    else if(aiPlan.scopeFindingCount){
      aiPlan.quota=await usage();
      await onProgress({stage:'review-estimate',message:`合併前 ${aiPlan.findingCount} 處，這次預計送 ${aiPlan.inputChars} 字、1 次模型呼叫。`,aiPlan,aiProgress:{...progress}});
      if(aiPlan.exceedsBudget&&aiScope!=='all'){status='needs-choice';summary=`預估 ${aiPlan.inputChars} 字，超過你設定的 ${settings.maxInputChars} 字建議值，尚未送給模型。可選只審程式、照樣全部審查，或不用 AI；安裝不受影響。`;}
      else if(aiPlan.quota.exhausted){status='quota-paused';summary=`Codex 回報目前額度已達上限，這次尚未送出。已送 0 字，剩 ${aiPlan.inputChars} 字；可以稍後重試或不用 AI 繼續。`;}
      else try{
        const env={OPENAI_API_KEY:undefined,CODEX_API_KEY:undefined,NODE_OPTIONS:undefined,NODE_PATH:undefined,...(codexHome?{CODEX_HOME:path.resolve(codexHome)}:{})};
        const auth=await runImpl(codexCommand,['login','status'],{cwd:job,env,timeout:10000});
        if(auth.code!==0||!/logged in using ChatGPT/i.test((auth.stdout??'')+'\n'+(auth.stderr??'')))throw Error('未使用 ChatGPT Codex 登入；沒有送出 AI 複查');
        if(!prompt)throw Error('找不到可編輯提示詞，沒有送出 AI 複查');
        const schemaFile=path.join(job,'response-schema.json'),outFile=path.join(job,'result.json');await fs.writeFile(schemaFile,JSON.stringify(reviewSchema));
        const args=['-a','never','exec','--json','--ignore-user-config','--ignore-rules','--sandbox','read-only','--ephemeral','--skip-git-repo-check','-C',job,'--output-schema',schemaFile,'--output-last-message',outFile,'-c','project_doc_max_bytes=0','-c','web_search="disabled"','-c',`model_reasoning_effort=${JSON.stringify(settings.reasoningEffort)}`];
        if(settings.model)args.push('--model',settings.model);
        for(const feature of ['plugins','apps','shell_tool','unified_exec','code_mode_host'])args.push('--disable',feature);args.push('-');
        Object.assign(progress,{sentChars:aiPlan.inputChars,remainingChars:0,submittedCalls:1});
        await onProgress({stage:'review',message:`正在複查 ${aiPlan.selectedGroups} 組代表片段（${aiPlan.inputChars} 字）；只執行一次，思考強度 ${settings.reasoningEffort}。`,aiPlan,aiProgress:{...progress}});
        const execution=await runImpl(codexCommand,args,{cwd:job,env,timeout:timeoutMs,input:plan.input});
        for(const line of (execution.stdout??'').split(/\r?\n/)){try{const event=JSON.parse(line);if(event.type==='turn.completed'&&event.usage){const usage=event.usage;modelUsage={available:true,inputTokens:typeof usage.input_tokens==='number'?usage.input_tokens:null,cachedInputTokens:typeof usage.cached_input_tokens==='number'?usage.cached_input_tokens:null,outputTokens:typeof usage.output_tokens==='number'?usage.output_tokens:null};}}catch{}}
        if(execution.code!==0){const diagnostic=(execution.stderr??'')+'\n'+(execution.stdout??'');throw Error(/usage.limit|quota|rate.limit|insufficient|too many requests/i.test(diagnostic)?'Codex 回報額度或頻率限制，已立即停止，沒有自動重試':/timed?.?out|timeout/i.test(diagnostic)?'AI 複查逾時，沒有自動重試':`AI 複查未完成（結束代碼 ${execution.code}）；所選模型或思考強度可能不受支援，請調整設定後重試`);}
        result=JSON.parse(await fs.readFile(outFile,'utf8'));const paths=plan.files.map(file=>file.path).sort();
        if(!validate(result)||result.sourceDigest!==snapshot.digest||JSON.stringify([...result.coveredFiles].sort())!==JSON.stringify(paths)||!result.summary.trim())throw Error('AI 回覆格式或來源識別不符');
        Object.assign(progress,{completedChars:aiPlan.inputChars,completedCalls:1});
        status=result.verdict==='reject'?'rejected':result.verdict==='manual_review'?'manual_review':'approved';risk=result.risk;summary=result.summary;findings=result.findings;
      }catch(cause){status='unavailable';summary=`AI 複查未完成：${cause instanceof SyntaxError?'回覆格式無法讀取':cause.message}。已送 ${progress.sentChars} 字，尚未送 ${progress.remainingChars} 字；未取得完成的判讀。可以重試或只看掃描後繼續安裝。`;}
    }
    if((await snapshotSource(sourceRoot,limits)).digest!==snapshot.digest)throw failure('審查期間原始碼已變更，請重新掃描');
    const record={id,status,sourceDigest:snapshot.digest,sourceRoot:snapshot.sourceRoot,summary,findings,coveredFiles:result&&progress.completedCalls?result.coveredFiles:[],risk,scan,aiPlan,aiProgress:progress,modelUsage,modelReview:progress.completedCalls===1,reviewedAt:new Date().toISOString(),scope:'typed-files; representative-excerpts-only; advisory; user-controlled-budget',reviewParts:progress.completedCalls,policyVersion:2};
    const receipt={...record,signature:sign(record)};await fs.writeFile(path.join(job,'review.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return receipt;
  }
  async function verify(sourceRoot,receipt){
    if(!receipt||!/^[a-f0-9-]{36}$/.test(receipt.id??''))throw failure('缺少有效來源掃描紀錄');let saved;try{saved=JSON.parse(await fs.readFile(path.join(reviews,receipt.id,'review.json'),'utf8'));}catch{throw failure('找不到有效來源掃描紀錄');}
    const {signature,...record}=saved,expected=sign(record);if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))||receipt.signature!==signature||record.policyVersion!==2)throw failure('掃描紀錄簽章無效或已遭竄改');
    if(record.sourceDigest!==(await snapshotSource(sourceRoot,limits)).digest||record.sourceRoot!==await fs.realpath(sourceRoot))throw failure('來源與掃描快照不符，請重新掃描');return saved;
  }
  /** Accept an advisory judgment from the active conversation without invoking a model or CLI. */
  async function completeConversationReview(sourceRoot,priorReceipt,judgment){
    const prior=await verify(sourceRoot,priorReceipt);
    if(!validate(judgment)||judgment.sourceDigest!==prior.sourceDigest||!judgment.summary.trim())throw failure('主對話審查回覆格式或來源識別不符');
    const result=JSON.parse(JSON.stringify(judgment)),existingFiles=new Set(prior.scan.files.map(file=>file.file));
    if(result.coveredFiles.some(file=>!existingFiles.has(file)))throw failure('主對話審查的已覆蓋檔案不在原始掃描中');
    const coveredFiles=[...new Set(result.coveredFiles)],uncoveredFiles=[...existingFiles].filter(file=>!coveredFiles.includes(file));
    const id=crypto.randomUUID(),job=path.join(reviews,id),reviewedAt=new Date().toISOString();
    const coverageNotice=coveredFiles.length?`主對話回報已覆蓋 ${coveredFiles.length} 個檔案，未覆蓋 ${uncoveredFiles.length} 個檔案；不代表已閱讀檔案中的所有片段。`:'主對話沒有回報任何已覆蓋檔案；未確認讀過任何來源檔案或片段。';
    const {signature:previousSignature,...original}=prior;
    const record={...original,id,priorReviewId:prior.id,reviewOrigin:'main-conversation',status:result.verdict==='reject'?'rejected':result.verdict==='manual_review'?'manual_review':'approved',risk:result.risk,summary:result.summary,findings:result.findings,coveredFiles,uncoveredFiles,coverageNotice,modelReview:true,reviewedAt,
      aiProgress:{origin:'main-conversation',cliCalls:0,usageMeasured:false,notice:'本次判讀由主對話提交；此操作沒有啟動 CLI（命令列介面）或模型，未量測主對話的實際輸入字數或詞元用量。'},
      modelUsage:{available:false,notice:'主對話用量未由此操作量測。'},reviewParts:1,scope:'main-conversation; declared-coverage-only; advisory; no-install-gate'};
    // Recheck after accepting the judgment; sign only a still-current source snapshot.
    await verify(sourceRoot,prior);
    await fs.mkdir(job,{mode:0o700});const receipt={...record,signature:sign(record)};
    await fs.writeFile(path.join(job,'review.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return receipt;
  }
  return {review,verify,completeConversationReview,getSettings,updateSettings};
}
