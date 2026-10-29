#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMarketConversation} from '../lib/market-conversation.mjs';

/** Fallback for an already connected MCP instance whose tool list predates scan/install. */
export async function runPluginCommand(argv,{createConversation=createMarketConversation}={}){
 const [command,...args]=argv,options={},positional=[];
 const allowed=new Set(['package-dir','ai-scope','data-root','review-id','judgment','rewrite-id','model','effort']);
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(arg==='--consent'){options.consent=true;continue;}if(arg==='--force-obfuscated'){options.forceObfuscated=true;continue;}
  if(arg.startsWith('--')){const key=arg.slice(2);if(!allowed.has(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('未知參數或缺少值：'+arg);options[key]=args[++i];}else positional.push(arg);
 }
 if(positional.length>1)throw Error('來源或審查識別只能提供一個');
 if(!['scan','install','pending','complete','rewrite-check','rewrite-prepare','rewrite-finish'].includes(command))throw Error('用法：scan <來源>；install <reviewId> --consent [--rewrite-id ID]；pending；complete <reviewId> --judgment <JSON檔>；rewrite-check 或 rewrite-prepare <reviewId>；rewrite-finish <rewriteId>；皆可加 --data-root <資料夾>');
 const client=createConversation(options['data-root']?{dataRoot:path.resolve(options['data-root'])}:{});
 if(command==='scan'){if(!positional[0])throw Error('scan 需要來源');return client.reviewSource({source:positional[0],packageDir:options['package-dir'],aiScope:options['ai-scope']??'auto'});}
 if(command==='install'){if(!positional[0]||options.consent!==true)throw Error('install 需要 reviewId 與 --consent；請先取得使用者明確同意');return client.installReviewed({reviewId:positional[0],consent:true,forceObfuscated:options.forceObfuscated===true,...(options['rewrite-id']?{rewriteId:options['rewrite-id']}:{})});}
 if(command.startsWith('rewrite-')){if(!positional[0])throw Error('需要審查或補寫識別');const action=command.slice(8);return client.rewrite({action,...(action==='finish'?{rewriteId:positional[0]}:{reviewId:positional[0]}),...(options.model?{model:options.model}:{}),...(options.effort?{effort:options.effort}:{}),...(options['ai-scope']?{aiScope:options['ai-scope']}:{})});}
 if(command==='pending')return client.pending({reviewId:options['review-id'],aiScope:options['ai-scope']??'auto'});
 if(!positional[0]||!options.judgment)throw Error('complete 需要 reviewId 與 --judgment JSON 檔路徑');
 return client.complete({reviewId:positional[0],judgment:JSON.parse(await fs.readFile(options.judgment,'utf8'))});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runPluginCommand(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({error:error.message,code:error.code??'ERROR'})+'\n');process.exitCode=1;});
