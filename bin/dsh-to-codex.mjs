#!/usr/bin/env node
import {desktopConversationContext} from '../lib/codex-desktop-conversation.mjs';
import {openPluginMarket} from '../lib/plugin-market-entry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {inspectSource} from '../lib/inspect.mjs';
import {convert,verify} from '../lib/converter.mjs';
import {acquireSource} from '../lib/source.mjs';
import {scanSecurity} from '../lib/security-scan.mjs';
import {secureGeneratedPackage} from '../lib/security-package.mjs';
import {preparePythonDependencies} from '../lib/python-deps.mjs';
import {writeSecurityReport} from '../lib/security-report.mjs';
import {serveMcp} from '../lib/protocol.mjs';
import {migrateLegacyState} from '../lib/state-paths.mjs';
import {controlDaemon} from '../lib/daemon-control.mjs';
import {createMarketConversation} from '../lib/market-conversation.mjs';
import {reviewSchema} from '../lib/security-review.mjs';

const output=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function options(argv) {
  const result={_:[]};
  for(let i=0;i<argv.length;i++) {
    const v=argv[i];if(!v.startsWith('--')){result._.push(v);continue;}
    const key=v.slice(2);if(['execute-source','hooks','no-hooks','no-install-dependencies','lenient-output','allow-undeclared-output','dry-run','help','open'].includes(key))result[key]=true;
    else {if(i+1>=argv.length||argv[i+1].startsWith('--'))throw new Error(`缺少 ${v} 的值`);const val=argv[++i];if(key==='allow-tool')(result.allowTools??=[]).push(val);else if(key==='pass-env')(result.passEnv??=[]).push(val);else result[key]=val;}
  }
  return result;
}
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function inspect(input,opts={}) {
  const src=await acquireSource(input,{cacheDir:opts.cacheDir??path.resolve('.dsh-source-cache'),ref:opts.ref});
  return inspectSource(src,{sourceEntry:opts.sourceEntry,packageDir:opts.packageDir});
}
export async function convertPublic(input,opts={}){
  const acquired=await acquireSource(input,{cacheDir:opts.cacheDir??path.resolve('.dsh-source-cache'),ref:opts.ref});
  const scan=await scanSecurity(acquired.root);
  const report=await convert(acquired.root,{...opts,moduleOptions:{agents:{allowModelCalls:true,backend:'codex-broker'},llm:{allowModelCalls:true,backend:'codex-broker'},...(opts.moduleOptions??{})},workspace:opts.workspace??process.cwd()});
  report.securityScan=scan;report.securityReview={status:'unreviewed',summary:'此來源由直接轉換入口處理，未經 AI 審查；請查看隨附的固定規則掃描結果。'};
  const out=path.resolve(opts.outputDir);
  await fs.writeFile(path.join(out,'security-scan.json'),JSON.stringify(scan,null,2)+'\n');
  await fs.writeFile(path.join(out,'security-report.json'),JSON.stringify(report.securityReview,null,2)+'\n');
  if(report.conversion.status!=='unsupported')report.conversion.security=await secureGeneratedPackage(out,{stateDir:opts.stateRoot??path.join(out,'.state'),report,dataRoot:opts.securityDataRoot});
  await writeSecurityReport(out,{report});
  await fs.writeFile(path.join(out,'conversion-report.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
export async function setupGenerated(outputDir,options={}) {
  const root=path.resolve(outputDir),report=await readJson(path.join(root,'conversion-report.json'));
  const components=[...(report.conversion.components??[]).filter(item=>item.kind==='python-mcp'),...(report.capabilities?.pythonServers??[]).map(item=>({kind:'python-mcp',entry:item.path,requirements:item.requirements}))];
  const result=await preparePythonDependencies(root,{...options,components});
  const settingsFile=path.join(root,'runtime/settings.json');let settings={};try{settings=await readJson(settingsFile);}catch(cause){if(cause.code!=='ENOENT')throw cause;}
  settings.pythonRuntime={command:result.pythonExecutable,pythonPaths:result.pythonPaths};await fs.writeFile(settingsFile,JSON.stringify(settings,null,2)+'\n');
  await secureGeneratedPackage(root,{stateDir:settings.stateRoot??path.join(root,'.state'),report,pythonRuntime:settings.pythonRuntime});
  return {...result,notice:'Python 依賴已準備；此入口未進行 AI 審查，請查看固定規則掃描與發行檔來源紀錄。'};
}
async function verifyPublic(outputDir,options={}) {
  return verify(outputDir,options);
}
async function serve() {
  const ajv=new Ajv();
  const conversation=createMarketConversation();
  const wrap=(name,description,inputSchema,execute)=>{
    const validate=ajv.compile(inputSchema);
    return {name,description,inputSchema,async execute(args,execution){if(!validate(args))throw new Error(ajv.errorsText(validate.errors));const result=await execute(args,execution);return{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}};
  };
  const source={type:'string',description:'本機 DSH 插件資料夾或公開 GitHub 來源'};
  await serveMcp({name:'dsh-to-codex',tools:[
    wrap('inspect_dsh_plugin','檢查插件結構；不初始化來源程式。',{type:'object',properties:{source,ref:{type:'string'},sourceEntry:{type:'string'},packageDir:{type:'string'}},required:['source'],additionalProperties:false},a=>inspect(a.source,a)),
    wrap('convert_dsh_plugin','直接轉換本機或公開來源，標示未經 AI 審查並附靜態掃描。',{type:'object',properties:{source,outputDir:{type:'string'},ref:{type:'string'},name:{type:'string'},sourceEntry:{type:'string'},packageDir:{type:'string'},config:{type:'object'},pythonEntry:{type:'string'},allowTools:{type:'array',items:{type:'string'}},engine:{enum:['auto','portable-tools','official-dsh']},workspace:{type:'string'},hooks:{type:'boolean'},installDependencies:{type:'boolean'},lenientOutput:{type:'boolean'},allowUndeclaredOutput:{type:'boolean'},homeMode:{enum:['isolated','real']},passEnv:{type:'array',items:{type:'string',pattern:'^[A-Za-z_][A-Za-z0-9_]*$'}},initializeTimeoutMs:{type:'integer',minimum:1},callTimeoutMs:{type:'integer',minimum:1},cancelGraceMs:{type:'integer',minimum:1},moduleOptions:{type:'object'},stateRoot:{type:'string'},codexSessionQuery:{type:'object',properties:{codexHome:{type:'string'},allowedThreadIds:{type:'array',items:{type:'string'}}},additionalProperties:false}},required:['source','outputDir'],additionalProperties:false},a=>{const {source,...opts}=a;return convertPublic(source,opts);}),
    wrap('verify_codex_plugin','驗證插件結構；明確指定 executeSource 時啟動來源，指定 call 可實際呼叫工具。',{type:'object',properties:{outputDir:{type:'string'},executeSource:{type:'boolean'},server:{type:'string'},call:{type:'string'},args:{type:'object'}},required:['outputDir'],additionalProperties:false},a=>verifyPublic(a.outputDir,a)),
    wrap('open_dsh_market','在目前 Codex 對話右側開啟 DSH 插件市場；直接呼叫即可，不需要捷徑、固定網址或手動啟動服務。開啟不安裝、不執行第三方插件。',{type:'object',properties:{openBrowser:{type:'boolean',description:'預設開啟Codex右側瀏覽器；false只取得網址。'}},additionalProperties:false},(a,execution)=>openPluginMarket(a,{requestMeta:execution?.requestMeta})),
    wrap('review_dsh_plugin','只取得固定來源並依 CC 原規則掃描，回傳完整表格、報告路徑及主對話代表片段；不執行來源、不另開模型、不轉換安裝。',{type:'object',properties:{source:{type:'string',minLength:1,description:'npm:名稱@版本、npm 套件名稱、公開 GitHub 網址或本機資料夾'},packageDir:{type:'string'},aiScope:{enum:['auto','code','all','none']}},required:['source'],additionalProperties:false},a=>conversation.reviewSource(a)),
    wrap('install_reviewed_dsh_plugin','使用者明確同意後，重用 reviewId 簽章紀錄中的固定來源轉換並安裝 Codex 插件；不重新下載新版，不宣稱第三方工具功能已驗證。',{type:'object',properties:{reviewId:{type:'string',pattern:'^[a-f0-9-]{36}$'},consent:{const:true},rewriteId:{type:'string',pattern:'^[a-f0-9-]{36}$',description:'使用者看過補寫報告並同意後，附上已完成檢查的補寫識別。'},forceObfuscated:{type:'boolean',description:'只有使用者明確要求仍轉換混淆來源時設 true，預設 false。'}},required:['reviewId','consent'],additionalProperties:false},a=>conversation.installReviewed(a)),
    wrap('get_dsh_market_reviews','領取市場待審項目，交給目前主對話閱讀；可等待使用者按審查，最多55秒。不另開模型。',{type:'object',properties:{waitMs:{type:'integer',minimum:0,maximum:55000},reviewId:{type:'string'},aiScope:{enum:['auto','code','all','none']}},additionalProperties:false},a=>conversation.pending(a)),
    wrap('complete_dsh_market_review','把主對話的審查摘要與實際覆蓋範圍寫回市場；不啟動模型，不代替使用者同意安裝。',{type:'object',properties:{reviewId:{type:'string'},judgment:reviewSchema},required:['reviewId','judgment'],additionalProperties:false},a=>conversation.complete(a)),
    wrap('rewrite_dsh_plugin','為已審來源檢查及準備不能直接轉換的功能，由目前對話補寫成 Codex 工具、技能或獨立網頁；完成後掃描及固定結果，不另開模型、不安裝。',{type:'object',properties:{action:{enum:['check','prepare','finish']},reviewId:{type:'string',pattern:'^[a-f0-9-]{36}$'},rewriteId:{type:'string',pattern:'^[a-f0-9-]{36}$'},model:{type:'string',maxLength:120},effort:{type:'string',maxLength:40},aiScope:{enum:['auto','code','all','none']}},required:['action'],additionalProperties:false},a=>conversation.rewrite(a)),
  ]});
}
async function main(){
  const [command,...rest]=process.argv.slice(2),o=options(rest);
  if(!command||o.help||command==='help'){process.stdout.write('DSH → Codex 安全市場入口\n\ninspect <本機來源>\nverify <輸出>\ndaemon stop|status <生成插件>\nmigrate-state <舊生成插件> [--dry-run]\nmarket [--open]\nserve\n\nconvert <來源> --out <新資料夾>：直接轉換，附靜態掃描並標示未經 AI 審查。\nsetup <生成插件>：準備 Python。\nverify <生成插件> --execute-source --call <工具> --args <JSON>：實際驗證。\ndaemon start|stop|status <生成插件>：控制背景程序。\n');return;}
  if(command==='serve'){await serve();return;}
  if(command==='capabilities'){output(await(await import('../lib/codex-capabilities.mjs')).capabilitySummary({command:process.env.CODEX_BIN||'codex'}));return;}
  if(command==='market'){output(await(await import('../lib/market-launcher.mjs')).launchMarket({open:Boolean(o.open)}));return;}
  if(command==='daemon'){if(!['start','stop','status'].includes(o._[0]))throw new Error('daemon 支援 start、stop 或 status');if(!o._[1])throw new Error('需要 daemon start|stop|status <輸出>');output(await controlDaemon(o._[1],o._[0]));return;}
  const input=o._[0];if(!input)throw new Error('缺少來源或輸出資料夾');
  if(['rewrite-check','rewrite-prepare','rewrite-finish'].includes(command)){const action=command.slice(8);output(await createMarketConversation(o['data-root']?{dataRoot:path.resolve(o['data-root'])}:{}).rewrite({action,...(action==='finish'?{rewriteId:input}:{reviewId:input}),...(o.model?{model:o.model}:{}),...(o.effort?{effort:o.effort}:{})}));return;}
  if(command==='inspect')output(await inspect(input,{ref:o.ref,sourceEntry:o.entry,packageDir:o['package-dir']}));
  else if(command==='convert')output(await convertPublic(input,{outputDir:o.out,name:o.name,ref:o.ref,sourceEntry:o.entry,packageDir:o['package-dir'],workspace:o.workspace,config:o.config?await readJson(o.config):{},allowTools:o.allowTools??[],pythonEntry:o['python-entry'],installDependencies:!o['no-install-dependencies'],hooks:!o['no-hooks'],lenientOutput:Boolean(o['lenient-output']),allowUndeclaredOutput:Boolean(o['allow-undeclared-output'])}));
  else if(command==='verify') {const result=await verifyPublic(input,{executeSource:o['execute-source']??false,server:o.server,...(Object.hasOwn(o,'call')?{call:o.call,args:o.args?JSON.parse(o.args):{}}:{})});output(result);if(!result.structure.valid||result.servers.some(s=>s.status==='failed'||s.status==='call-error'))process.exitCode=2;}
  else if(command==='setup')output(await setupGenerated(input,{python:o.python}));
  else if(command==='migrate-state'){const root=path.resolve(input);output(await migrateLegacyState({root,options:await readJson(path.join(root,'runtime/settings.json')),dryRun:Boolean(o['dry-run'])}));}
  else throw new Error(`未知命令：${command}`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(error=>{process.stderr.write(JSON.stringify({error:error.message,code:error.code??'ERROR'})+'\n');process.exitCode=1;});
