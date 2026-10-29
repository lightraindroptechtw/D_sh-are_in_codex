import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {scanSecurity as scanSecurityCC,classifyOutbound,redactSnippet} from './cc-security-scan.mjs';
export {obfuscationMetrics,judgeObfuscation} from './cc-security-scan.mjs';

export {renderCCScanOverview} from './cc-scan-markdown.mjs';

const rules=[
  ['posting-candidate','可能的外部寫入（需看用途）',/\b(?:sendMessage|sendMail|postMessage|publish|upload|createPost|webhook|smtp|method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)|\.post\s*\()/i],
  ['model','模型呼叫',/\b(?:generateText|generateObject|chatCompletion|completions|callModel|invokeModel|llm|modelProvider|modelClient)\b/i],
  ['agent','代理與子代理',/\b(?:agent|agents|subagent|createAgent|spawnAgent|delegate)\b/i],
  ['obfuscation','混淆或動態解碼',/\b(?:eval\s*\(|new\s+Function\s*\(|atob\s*\(|fromCharCode|marshal\.loads|base64\.b64decode|exec\s*\(\s*(?:decode|base64))|(?:\\x[0-9a-f]{2}){12}/i],
];
const languages={'.py':'Python（Python 語言）','.sh':'Shell（殼層腳本）','.ps1':'PowerShell（PowerShell 腳本）','.bat':'Batch（批次檔）','.cmd':'Batch（批次檔）','.go':'Go（Go 語言）','.rs':'Rust（Rust 語言）','.java':'Java（Java 語言）','.rb':'Ruby（Ruby 語言）','.php':'PHP（PHP 語言）','.c':'C（C 語言）','.cpp':'C++（C++ 語言）'};
const programExtensions=new Set(['.js','.mjs','.cjs','.ts','.mts','.cts','.jsx','.tsx',...Object.keys(languages),'.psm1','.bash','.zsh','.fish','.pyw','.pl','.lua','.cs','.swift','.kt','.cc']);
export const isProgramFile=file=>programExtensions.has(path.extname(file).toLowerCase())&&!/\.d\.[cm]?ts$/i.test(file);
const knownKey=/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{30,})\b/g;
const assignedKey=/(?<![\w.-])(?:["']?(?:[\w.-]{0,80}(?:api[_-]?key|access[_-]?token|password|secret|private[_-]?key))["']?)\s*[:=]\s*["']([^"'\s]{16,})["']/gi;
const instructionText=/(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|rules)|(?:AI|security)\s+reviewer\s*:\s*(?:skip|ignore|approve)|忽略.{0,12}(?:先前|之前|以上).{0,8}(?:指示|指令|規則)|(?:請|必须|務必).{0,12}(?:回報沒有風險|回報安全|不要回報風險|略過安全審查))/i;
function secretLine(line){let found=false;const redacted=line.replace(knownKey,()=>{found=true;return '[已遮蔽金鑰]';}).replace(assignedKey,(all,value)=>{if(/^(?:YOUR_|EXAMPLE|PLACEHOLDER|CHANGE_ME|process\.env|\$|<)/i.test(value))return all;found=true;return all.replace(value,'[已遮蔽金鑰]');});return {found,redacted};}
function jsBehaviorLines(content,file){
  const tree=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true),hits=new Map();
  const add=(node,category)=>{const line=tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;const set=hits.get(line)??new Set();set.add(category);hits.set(line,set);};
  const visit=node=>{
    if(ts.isCallExpression(node)||ts.isNewExpression(node)){
      const expression=node.expression.getText(tree);
      for(const [category,,pattern]of rules)if(pattern.test(expression+'('))add(node,category);
    }
    if(ts.isPropertyAssignment(node)&&node.name.getText(tree).replace(/["']/g,'')==='method'&&ts.isStringLiteralLike(node.initializer)&&/^(?:POST|PUT|PATCH|DELETE)$/i.test(node.initializer.text))add(node,'posting-candidate');
    ts.forEachChild(node,visit);
  };visit(tree);return hits;
}

/** Adapt CC's unchanged static scan to the signed review's typed inventory.
 * Documents retain the existing secret/instruction checks. Supplemental model,
 * agent and decode locations are advisory review hints, not CC scan counts.
 */
export async function scanSecurity(sourceRoot,{snapshot}={}){
  const ccScan=await scanSecurityCC(sourceRoot);
  let entries=snapshot?.files;
  if(!entries){
    entries=[];
    async function visit(directory){for(const item of(await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(item.name==='.git')continue;
      const absolute=path.join(directory,item.name),relative=path.relative(sourceRoot,absolute).split(path.sep).join('/');
      if(item.isDirectory())await visit(absolute);
      else if(item.isFile()){
        const bytes=await fs.readFile(absolute);let content;
        try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(content.includes('\0'))content=undefined;}catch{}
        entries.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),content,kind:content===undefined?'static-asset':'text'});
      }
    }}
    await visit(sourceRoot);
  }
  const files=[],assets=[],findings=[],postingTools=[];
  const mapped=[['process','程序啟動',ccScan.processes],['filesystem','檔案操作',ccScan.fileAccess],['network','網路連線',ccScan.network],['environment','環境與憑證',[...ccScan.environment,...ccScan.wholeEnvironment,...ccScan.homeReferences,...ccScan.secrets.credentialRefs]],['hardcoded-secret','可能寫死的金鑰（值未記錄）',ccScan.secrets.hardcoded],['obfuscation','具體程式混淆特徵',ccScan.obfuscation.files],['other-language','其他語言或格式',ccScan.otherLanguages]];
  for(const item of entries){
    if(item.kind==='static-asset'||typeof item.content!=='string'){
      assets.push({file:item.path,bytes:item.bytes,sha256:item.sha256,mediaType:item.mediaType??'binary',reviewedLineByLine:false});
      files.push({file:item.path,bytes:item.bytes,sha256:item.sha256,lines:0,kind:'asset',reviewedLineByLine:false});continue;
    }
    const lines=item.content.split(/\r?\n/),program=isProgramFile(item.path),fileType=program?'program':'document-data';
    files.push({file:item.path,bytes:item.bytes,sha256:item.sha256,lines:lines.length,kind:'text',fileType});
    const add=(category,label,line,excerpt,extra={})=>{const clean=secretLine(redactSnippet(excerpt??'')).redacted;findings.push({category,label,file:item.path,fileType,line,endLine:line,excerpt:clean.slice(0,2000),...(clean.length>2000?{excerptTruncated:true}:{}),...extra});};
    if(!program){
      for(let index=0;index<lines.length;index++){const line=lines[index],secret=secretLine(line);if(secret.found)add('hardcoded-secret','可能寫死的金鑰（值已遮蔽）',index+1,secret.redacted);if(instructionText.test(line))add('prompt-instruction','文件中的指示語句（可能是說明範例，不代表插件會執行）',index+1,line);}
      continue;
    }
    for(const [category,label,rows]of mapped)for(const row of rows)if(row.path===item.path){
      const line=row.line??1;
      add(category,label,line,row.code??(category==='obfuscation'?row.reasons.join('；'):lines[line-1]),{context:row.context,...(category==='obfuscation'?{unreadable:row.context!=='test',reasons:row.reasons,metrics:row.metrics}:{}),...(row.language?{language:row.language}:{})});
    }
    const js=/\.[cm]?[jt]sx?$/i.test(item.path);
    if(js){
      const behavior=jsBehaviorLines(item.content,item.path);
      for(const [index,categories]of behavior)for(const category of categories)if(['model','agent','posting-candidate','obfuscation'].includes(category))add(category,rules.find(rule=>rule[0]===category)[1],index+1,lines[index]);
    }else for(let index=0;index<lines.length;index++)if(rules.find(rule=>rule[0]==='obfuscation')[2].test(lines[index]))add('obfuscation','混淆或動態解碼（審查提示）',index+1,lines[index]);
  }
  const entriesByPath=new Map(entries.map(item=>[item.path,item]));
  function posting(tool){
    if(!tool.outbound||!entriesByPath.has(tool.path)||!isProgramFile(tool.path))return;
    const descriptor={name:tool.name,toolName:tool.name,file:tool.path,line:tool.line??1,destinationFields:tool.targetFields??[],contentFields:tool.textFields??[]};
    if(postingTools.some(item=>item.name===descriptor.name&&item.file===descriptor.file))return;
    postingTools.push(descriptor);
    const excerpt=entriesByPath.get(tool.path).content?.split(/\r?\n/)[descriptor.line-1]??'';
    findings.push({category:'posting',label:'已命名的發文或傳送工具',file:tool.path,fileType:'program',line:descriptor.line,endLine:descriptor.line,excerpt:secretLine(redactSnippet(excerpt)).redacted.slice(0,2000),toolName:tool.name,postingTool:descriptor});
  }
  for(const tool of [...ccScan.tools,...ccScan.internalTools])posting(tool);
  // Keep standalone official defineTool metadata for the existing runtime's
  // per-publication confirmation. It does not alter the CC report or counts.
  for(const item of entries)if(isProgramFile(item.path)&&typeof item.content==='string'&&/\.[cm]?[jt]sx?$/i.test(item.path)){
    const tree=ts.createSourceFile(item.path,item.content,ts.ScriptTarget.Latest,true);
    const property=(object,name)=>object.properties.find(prop=>prop.name?.getText(tree).replace(/["']/g,'')===name)?.initializer;
    const visit=node=>{
      if(ts.isCallExpression(node)&&node.expression.getText(tree)==='defineTool'&&ts.isObjectLiteralExpression(node.arguments[0])){
        const object=node.arguments[0],name=property(object,'name'),description=property(object,'description');
        if(name&&ts.isStringLiteralLike(name)){
          let parameters=property(object,'parameters')??property(object,'inputSchema');
          if(parameters&&ts.isObjectLiteralExpression(parameters))parameters=property(parameters,'properties')??parameters;
          const names=parameters&&ts.isObjectLiteralExpression(parameters)?parameters.properties.map(prop=>prop.name?.getText(tree).replace(/["']/g,'')).filter(Boolean):[];
          posting({name:name.text,path:item.path,line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,...classifyOutbound({name:name.text,description:description&&ts.isStringLiteralLike(description)?description.text:'',parameters:names})});
        }
      }
      ts.forEachChild(node,visit);
    };visit(tree);
  }
  return {ruleVersion:3,engine:'fixed-rules',modelCalls:0,sourceExecuted:false,ccScan,files,findings,assets,obfuscated:ccScan.summary.obfuscated,postingTools,summary:{textFiles:files.length-assets.length,programFiles:files.filter(file=>file.fileType==='program').length,documentDataFiles:files.filter(file=>file.fileType==='document-data').length,documentDataBytes:files.filter(file=>file.fileType==='document-data').reduce((sum,file)=>sum+file.bytes,0),assetFiles:assets.length,totalLines:files.reduce((sum,item)=>sum+item.lines,0),findings:findings.length},notice:'程式行為使用 CC 固定規則；文件與資料只檢查寫死金鑰及明確指示語句。CC 原始結果與數量在 ccScan；findings 供既有代表片段審查與工具確認使用。'};
}
