#!/usr/bin/env node
/** Independent forward validation. Never installs dependencies or starts external services. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {convert,verify} from '../lib/converter.mjs';
import {inspectSource} from '../lib/inspect.mjs';
import {acquireSource,filesIn,run} from '../lib/source.mjs';

const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const converterRoot=path.resolve(scriptDir,'..');
const workspace=path.resolve(converterRoot,'../..');
const additionalCommit='43dd8780a7cc3676389f0526a6a80e9a10cffeee';
const additionalId='dsh-plugin-development';
const jsonRead=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const jsonWrite=async(file,data)=>fs.writeFile(file,JSON.stringify(data,null,2)+'\n','utf8');
const exists=async file=>{try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const slash=value=>value.split(path.sep).join('/');
const digest=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const errorData=error=>({name:error.name,message:error.message,code:error.code??null});
const issueCodes=report=>(report?.conversion?.omitted??report?.issues??[]).map(item=>item.code);

function options(argv){
  const result={catalog:path.join(workspace,'work/dsh-converter-corpus/catalog.json'),additionalSource:path.join(workspace,'work/dsh-independent-qa/additional-source',additionalId)};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(key==='--help'){result.help=true;continue;}
    if(!['--out','--catalog','--additional-source'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error(`未知參數或缺少參數值：${key}`);
    const value=path.resolve(argv[++i]);
    result[key==='--additional-source'?'additionalSource':key.slice(2)]=value;
  }
  if(!result.help&&!result.out)throw new Error('請用 --out 指定全新的驗證輸出資料夾；腳本不覆寫已有結果');
  return result;
}

function check(row,name,actual,expected){
  try{assert.deepStrictEqual(actual,expected);row.checks.push({name,passed:true});return true;}
  catch(error){row.checks.push({name,passed:false,actual,expected,message:error.message});return false;}
}
function truth(row,name,value){return check(row,name,Boolean(value),true);}

function canonical(result){
  if(result?.structuredContent!==undefined)return result.structuredContent;
  const blocks=result?.content??[];
  const texts=blocks.filter(block=>block.type==='text').map(block=>block.text);
  if(texts.length!==1)throw new Error('測試工具沒有唯一可解析的文字或 structuredContent 結果');
  try{return JSON.parse(texts[0]);}catch{return texts[0];}
}

const pureCases={
  'dsh-pace-calc':{tool:'pace_calc',args:{dist:5,min:30,sec:0},check(row,result){
    const value=canonical(result);check(row,'實際配速公里數',value.output?.distanceKm,5);check(row,'實際配速',value.output?.pace,'6′00″/km');check(row,'實際時速',value.output?.speedKmh,10);
  }},
  'dsh-rf-toolkit':{tool:'rf_shannon_capacity',args:{bandwidthHz:1000000,snrDb:0},check(row,result){
    const value=canonical(result);check(row,'實際 Shannon 容量',value.capacityBps,1000000);check(row,'實際頻譜效率',value.spectralEfficiencyBpsHz,1);check(row,'六個工具均列舉',row.verify.servers.find(server=>server.name===row.verifyServerName)?.toolCount,6);
  }},
  'dsh-tool-encoding':{tool:'encoding',args:{action:'base64_encode',input:'hello'},check(row,result){check(row,'實際 Base64 編碼',canonical(result),'aGVsbG8=');}},
};

async function verifyPure(row,outputDir,spec,suffix='verify'){
  // The fixed allow-list above contains only reviewed local numeric/string calculations.
  // Resolve the qualified name from this output's report, including after relocation.
  // Selecting only the mapped native bridge prevents starting external MCP components.
  const report=await jsonRead(path.join(outputDir,'conversion-report.json'));
  const serverName=report.conversion.serverNames?.dsh;
  if(typeof serverName!=='string'||!serverName)throw new Error('轉換報告缺少 dsh 伺服器名稱對應');
  row.verifyServerName=serverName;
  const result=await verify(outputDir,{executeSource:true,server:serverName,call:spec.tool,args:spec.args});
  await jsonWrite(path.join(row.evidenceDir,`${suffix}.json`),result);
  row.verify=result;
  truth(row,`${suffix} 結構合法`,result.structure?.valid);
  const server=result.servers.find(item=>item.name===serverName);
  check(row,`${suffix} 實際呼叫成功`,server?.status,'tool-called');
  if(server?.status==='tool-called'){truth(row,`${suffix} 無工具錯誤`,!server.call.result.isError);spec.check(row,server.call.result);row.actuallyCalled=true;}
  return result;
}

async function retainedResources(row,source,plan,report,outputDir){
  row.skills=[];
  if(!report.conversion.sourceCopy){
    check(row,'沒有來源技能被靜默放棄',plan.capabilities.skills.length,0);return;
  }
  const excluded=new Set((report.conversion.sourceCopy.excluded??[]).map(value=>value.replaceAll('\\','/')));
  let checked=0,missing=[],changed=[];
  for(const file of await filesIn(source.root)){
    const rel=slash(path.relative(source.root,file));if(excluded.has(rel))continue;
    const target=path.join(outputDir,'source',rel);
    if(!(await exists(target))){missing.push(rel);continue;}
    if(await digest(file)!==await digest(target))changed.push(rel);
    checked++;
  }
  row.resources={checkedFiles:checked,excluded:[...excluded],missing,changed};
  check(row,'所有未排除來源與資源均保留',missing,[]);
  check(row,'來源與資源位元組未改變',changed,[]);
  const manifestPath=path.join(outputDir,'.codex-plugin/plugin.json');
  const manifest=await exists(manifestPath)?await jsonRead(manifestPath):null;
  const declared=manifest?(Array.isArray(manifest.skills)?manifest.skills:[manifest.skills]):[];
  for(const skill of plan.capabilities.skills){
    const original=path.join(source.root,skill.path),target=path.join(outputDir,'source',skill.path);
    const originalHash=await digest(original),outputHash=await exists(target)?await digest(target):null;
    row.skills.push({name:skill.name,path:skill.path,originalHash,outputHash});
    check(row,`原技能未被覆寫：${skill.name}`,outputHash,originalHash);
    const expected='./source/'+slash(path.dirname(skill.path));
    truth(row,`原技能位置已宣告：${skill.name}`,declared.includes(expected));
  }
  await jsonWrite(path.join(row.evidenceDir,'resources.json'),{...row.resources,skills:row.skills});
}

async function regressionChecks(row,plan,report,outputDir){
  const mcpPath=path.join(outputDir,'.mcp.json');
  const servers=await exists(mcpPath)?(await jsonRead(mcpPath)).mcpServers??{}:{};
  const names=report.conversion.serverNames??{};
  row.serverNames=names;
  const codes=issueCodes(report);
  if(row.id==='dsh-bili-scroll'){
    truth(row,'B 站內附 Python 未自動公開',!report.conversion.components.some(c=>c.kind==='python-mcp'));
    truth(row,'B 站產物未包含 Python 啟動設定',!Object.values(servers).some(s=>s.command==='python'||s.args?.some(a=>/python-\d|mcp_server\.py/.test(a))));
    truth(row,'B 站保留僅候選警示',codes.includes('PYTHON_CANDIDATE_ONLY'));
  }
  if(row.id==='dsh-windows-mcp-lite'){
    const server=servers[names.windows];
    check(row,'Windows MCP 保留 120 秒逾時',server?.tool_timeout_sec,120);
    truth(row,'Windows MCP 啟動失敗差異有警示',codes.includes('MCP_STARTUP_SEMANTICS_OMITTED'));
    const cfg=plan.capabilities.mcpServers.windows;
    check(row,'Windows MCP 原參數與排除工具保留',server?.args,cfg?.args);
    check(row,'Windows MCP 環境值保留',server?.env,cfg?.env);
  }
  if(row.id==='dsh-exa-mcp'){
    const server=servers[names.exa];
    check(row,'Exa 保留 180 秒逾時',server?.tool_timeout_sec,180);
    truth(row,'Exa 保留 optional header 警示',codes.includes('OPTIONAL_ENV_HEADER'));
    truth(row,'Exa 不改成必填 EXA_API_KEY',!server?.env_http_headers||!Object.values(server.env_http_headers).includes('EXA_API_KEY'));
    truth(row,'Exa 已產生未啟動的本機代理',server?.command==='node'&&Array.isArray(server.args));
    const runtimeFiles=await exists(path.join(outputDir,'runtime'))?await filesIn(path.join(outputDir,'runtime')):[];
    const text=[];
    for(const file of runtimeFiles)if(/\.(?:mjs|json)$/.test(file))text.push(await fs.readFile(file,'utf8'));
    truth(row,'Exa 代理有保留上游與選填金鑰來源',text.some(t=>t.includes('https://mcp.exa.ai/mcp')&&t.includes('EXA_API_KEY')));
    if(server?.args?.[0]){
      const cwd=path.resolve(outputDir,server.cwd??'.');
      truth(row,'Exa 代理入口檔存在',await exists(path.resolve(cwd,server.args[0])));
    }
    row.externalStarted=false;
  }
  if(row.id==='agent-useful-skills'){
    const original=await jsonRead(path.join(row.sourceRoot,'skills.manifest.json'));
    check(row,'技能選取與 manifest.default 一致',plan.capabilities.skills.map(s=>s.name).sort(),[...original.default].sort());
    check(row,'預設技能數量',plan.capabilities.skills.length,13);
  }
  if(row.id===additionalId){
    check(row,'同名插件唯一技能仍存在',plan.capabilities.skills.map(s=>s.name),[additionalId]);
    const guide=path.join(outputDir,'skills/conversion-guide/SKILL.md');
    truth(row,'轉換說明與原技能分開',await exists(guide));
  }
}

async function sourceFor(entry,catalogFile,opts){
  let local=entry.localPath;
  if(!local||!(await exists(local)))local=path.join(path.dirname(catalogFile),entry.id);
  if(entry.id===additionalId&&!(await exists(local)))return acquireSource('https://github.com/gezi-wen/dsh-plugin-development',{cacheDir:path.join(opts.out,'source-cache'),ref:additionalCommit});
  return acquireSource(local);
}

async function one(entry,opts){
  const evidenceDir=path.join(opts.out,'evidence',entry.id),outputDir=path.join(opts.out,'generated',entry.id);
  await fs.mkdir(evidenceDir,{recursive:true});
  const row={id:entry.id,expectedCommit:entry.commit??null,evidenceDir,outputDir,checks:[],actuallyCalled:false,externalStarted:false};
  try{
    const source=await sourceFor(entry,opts.catalog,opts);row.sourceRoot=source.root;row.commit=source.commit;
    if(entry.commit)check(row,'來源固定提交一致',source.commit,entry.commit);
    const clean=await run('git',['-C',source.root,'-c','core.longpaths=true','status','--porcelain']);
    truth(row,'來源 Git 狀態乾淨',clean.code===0&&!clean.stdout.trim());
    const plan=await inspectSource(source);await jsonWrite(path.join(evidenceDir,'inspect.json'),plan);
    row.inspectStatus=plan.status;
    const report=await convert(source.root,{outputDir});await jsonWrite(path.join(evidenceDir,'convert.json'),report);
    row.conversionStatus=report.conversion.status;row.components=report.conversion.components;row.omitted=report.conversion.omitted;
    check(row,'轉換沒有呼叫模型',report.conversion.modelCalls,0);
    truth(row,'轉換報告寫入產物',await exists(path.join(outputDir,'conversion-report.json')));
    const generated=report.conversion.status!=='unsupported';row.generated=generated;
    if(generated){
      const structural=await verify(outputDir);await jsonWrite(path.join(evidenceDir,'static-verify.json'),structural);
      truth(row,'產物結構合法',structural.structure.valid);check(row,'靜態檢查未執行來源',structural.executed,false);
    }else{
      truth(row,'不支援時沒有可啟動插件宣告',!(await exists(path.join(outputDir,'.codex-plugin/plugin.json'))));
      truth(row,'不支援時保留可審查原因',(report.conversion.omitted??[]).length>0||plan.status==='unsupported');
    }
    await retainedResources(row,source,plan,report,outputDir);
    await regressionChecks(row,plan,report,outputDir);
    if(pureCases[entry.id]){
      truth(row,'純工具應產生 dsh 橋接',report.conversion.components.some(c=>c.kind==='dsh-tools'));
      if(report.conversion.components.some(c=>c.kind==='dsh-tools'))await verifyPure(row,outputDir,pureCases[entry.id]);
    }
    if(entry.id==='dsh-pace-calc'&&row.actuallyCalled){
      const relocated=path.join(opts.out,'moved packages','pace copy');
      await fs.mkdir(path.dirname(relocated),{recursive:true});await fs.cp(outputDir,relocated,{recursive:true});
      const before=row.checks.length;await verifyPure(row,relocated,pureCases[entry.id],'relocated-verify');
      row.relocation={path:relocated,passed:row.checks.slice(before).every(c=>c.passed)};
    }
  }catch(error){row.error=errorData(error);row.checks.push({name:'流程未拋出未處理錯誤',passed:false,...errorData(error)});await jsonWrite(path.join(evidenceDir,'error.json'),errorData(error));}
  row.passed=row.checks.every(item=>item.passed);
  await jsonWrite(path.join(evidenceDir,'result.json'),row);
  process.stdout.write(`${row.passed?'通過':'失敗'} ${row.id}：${row.conversionStatus??'錯誤'}；${row.actuallyCalled?'已實際呼叫純工具':'未啟動來源'}\n`);
  return row;
}

function markdown(data){
  const esc=value=>String(value??'—').replaceAll('|','\\|').replaceAll('\n',' ');
  const lines=['# DSH 真實語料驗證','',`本輪 ${data.summary.cases} 個真實插件：${data.summary.passed} 通過、${data.summary.failed} 失敗。`,
    '',`產生時間：${data.generatedAt}。語料清單：${data.catalog}。`,
    '', '「可生成」只指產物結構合法；「部分生成」仍有列出的差異。「不支援」是有效的誠實拒絕，不算測試失敗。只有配速、射頻計算、字串編碼三個預先審查的純工具允許啟動與呼叫；配速另驗證搬至含空格目錄。其他來源、Python、Windows MCP 與 Exa 都未啟動。沒有安裝上游依賴、登入或發送外部訊息。',
    '', '| 來源 | 固定提交 | 生成結果 | 實際執行 | 技能與資源 | 驗證 |', '|---|---|---|---|---|---|'];
  for(const row of data.entries){
    const label={converted:'可生成',partial:'部分生成',unsupported:'不支援'}[row.conversionStatus]??'流程錯誤';
    const execution=row.actuallyCalled?'純工具已列舉並實際呼叫'+(row.relocation?'；搬移重測'+(row.relocation.passed?'通過':'失敗'):''):'未啟動；僅靜態檢查';
    const resources=row.resources?`${row.skills.length} 個技能原檔比對；${row.resources.checkedFiles} 檔案雜湊比對`:'無生成的來源副本';
    lines.push(`| ${esc(row.id)} | ${esc(row.commit?.slice(0,12))} | ${label} | ${execution} | ${resources} | ${row.passed?'通過':'失敗'} |`);
  }
  lines.push('','## 限制與未支援項目','');
  for(const row of data.entries){
    const warnings=[...new Set((row.omitted??[]).map(item=>`${item.code}：${item.message}`))];
    if(warnings.length)lines.push(`- ${row.id}：${warnings.join('；')}`);
  }
  lines.push('','## 失敗項目','');
  let failures=0;
  for(const row of data.entries)for(const item of row.checks.filter(c=>!c.passed)){failures++;lines.push(`- ${row.id} / ${item.name}：${item.message??JSON.stringify(item.actual)}`);}
  if(!failures)lines.push('沒有失敗項目。');
  lines.push('','每個案例的 inspect、convert、靜態結構檢查、資源雜湊，以及允許的純工具呼叫結果保存在 evidence/<來源>/。matrix.json 是本表的完整機器可讀資料。',
    '', '這不是官方 DSH 宿主或 Codex 官方載入器的端到端驗證。實際呼叫由轉換器的 MCP 驗證路徑完成；外部服務的相容性、認證、網路與完整技能流程都未測試。','');
  return lines.join('\n');
}

async function main(){
  const opts=options(process.argv.slice(2));
  if(opts.help){process.stdout.write('用法：node scripts/validate-corpus.mjs --out 全新輸出資料夾 [--catalog catalog.json] [--additional-source 第15份來源資料夾]\n');return;}
  if(await exists(opts.out))throw new Error('輸出 root 已存在，請指定全新路徑；不覆寫、不刪除既有驗證資料');
  const catalog=await jsonRead(opts.catalog),entries=[...catalog.entries];
  if(!entries.some(entry=>entry.id===additionalId))entries.push({id:additionalId,localPath:opts.additionalSource,commit:additionalCommit,repoUrl:'https://github.com/gezi-wen/dsh-plugin-development'});
  const ids=entries.map(entry=>entry.id);
  if(ids.length!==new Set(ids).size)throw new Error('catalog 的 id 重複');
  if(ids.some(id=>typeof id!=='string'||!/^[a-z0-9-]+$/.test(id)))throw new Error('catalog id 只能包含小寫英數與連字號');
  await fs.mkdir(opts.out,{recursive:true});
  const hashes={};for(const file of await filesIn(path.join(converterRoot,'lib')))hashes[slash(path.relative(converterRoot,file))]=await digest(file);
  await jsonWrite(path.join(opts.out,'implementation-hashes.json'),hashes);
  const rows=[];for(const entry of entries)rows.push(await one(entry,opts));
  const summary={cases:rows.length,passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,generated:rows.filter(r=>r.generated).length,unsupported:rows.filter(r=>r.conversionStatus==='unsupported').length,pureToolsCalled:rows.filter(r=>r.actuallyCalled).length,externalServicesStarted:0,modelCalls:0};
  const data={schemaVersion:1,generatedAt:new Date().toISOString(),catalog:opts.catalog,outputRoot:opts.out,summary,entries:rows};
  await jsonWrite(path.join(opts.out,'matrix.json'),data);await fs.writeFile(path.join(opts.out,'VALIDATION.md'),markdown(data),'utf8');
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
  if(summary.failed)process.exitCode=1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(error=>{process.stderr.write(JSON.stringify(errorData(error))+'\n');process.exitCode=1;});
