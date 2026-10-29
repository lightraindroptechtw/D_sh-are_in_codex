import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const failure=message=>Object.assign(new Error(message),{code:'SECURITY_INTEGRITY_FAILED'});
export async function snapshotSource(sourceRoot,{fileCount=Infinity,totalBytes=Infinity,fileBytes=Infinity}={}){
  sourceRoot=await fs.realpath(sourceRoot);const files=[];let bytes=0;
  async function visit(dir){for(const item of(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
    if(item.name==='.git')continue;
    const absolute=path.join(dir,item.name),relative=path.relative(sourceRoot,absolute).split(path.sep).join('/'),stat=await fs.lstat(absolute);
    if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())throw failure('來源含連結或特殊檔案，無法建立完整性快照：'+relative);
    if(stat.isDirectory()){await visit(absolute);continue;}
    bytes+=stat.size;if(stat.size>fileBytes||bytes>totalBytes||files.length>=fileCount)throw failure('來源超過快照大小上限，未截斷或略過檔案');
    const content=await fs.readFile(absolute);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(content);if(text.includes('\0'))throw Error();}catch{}
    files.push({path:relative,sha256:hash(content),bytes:content.length,...(text===undefined?{kind:'static-asset',mediaType:/\.(woff2?|ttf|otf)$/i.test(relative)?'font':/\.(png|jpe?g|gif|webp|ico)$/i.test(relative)?'image':'binary',content:'[非文字資產：已綁定完整位元組雜湊，未逐行審查。]'}:{kind:'text',content:text})});
  }}
  await visit(sourceRoot);return {sourceRoot,files,bytes,digest:hash(JSON.stringify(files.map(({path,sha256,bytes})=>({path,sha256,bytes}))))};
}
export const reviewSchema={type:'object',additionalProperties:false,required:['verdict','risk','summary','findings','sourceDigest','coveredFiles'],properties:{verdict:{enum:['approve','reject','manual_review']},risk:{enum:['low','medium','high','critical']},summary:{type:'string'},sourceDigest:{type:'string'},coveredFiles:{type:'array',items:{type:'string'}},findings:{type:'array',items:{type:'object',additionalProperties:false,required:['severity','file','reason'],properties:{severity:{enum:['info','low','medium','high','critical']},file:{type:'string'},reason:{type:'string'}}}}}};
export {createSecurityReviewer} from './security-review-engine.mjs';
