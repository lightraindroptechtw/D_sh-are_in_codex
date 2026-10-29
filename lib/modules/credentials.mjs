import {guardService,moduleError,moduleUnavailable,unsupportedService} from '../codex-control.mjs';

export const descriptor={id:'credentials',displayName:'憑證模組',services:['credentials'],requires:{minimumCodexVersion:'0.160.0',capabilities:[]},methods:{
  resolve:{support:'partial',reason:'優先讀取此插件保存的金鑰，再讀明確映射的環境變數；不讀其他插件的儲存區。'},
  describe:{support:'partial',reason:'只回報是否已設定、來源與可否寫入，不回傳秘密值。'},
  set:{support:'partial',reason:'接上主程序時，保存在插件資料夾外、僅本人可讀的檔案。'},unset:{support:'partial',reason:'移除插件自行保存的值，不修改環境變數。'},
  readRecord:{support:'partial',reason:'讀取此插件自己的憑證紀錄。'},describeRecord:{support:'partial',reason:'只回報此插件紀錄的種類與是否存在。'},listRecords:{support:'partial',reason:'列舉此插件保存的紀錄名稱與種類。'},modifyRecord:{support:'partial',reason:'以版本比對與儲存鎖防止同時修改互相覆蓋；保留原授權資料。'},deleteRecord:{support:'partial',reason:'刪除此插件自己的憑證紀錄。'},
},requirements:['Explicit envMapping containing credential reference names and environment variable names only','Forward mapped environment variable names through passEnv; never place secret values in configuration or reports']};

export async function install({options={},capabilities={},requestHost,emit=()=>{}}={}){
  const unavailable=moduleUnavailable(descriptor,capabilities);
  if(unavailable)return {services:{credentials:unsupportedService('credentials',Object.keys(descriptor.methods),unavailable)},dispose:async()=>{},diagnostics:[{module:'credentials',level:'warning',status:'disabled',reason:unavailable}]};
  const mapping=options.envMapping??{},env=options.environment??process.env;
  if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.entries(mapping).some(([ref,name])=>!valid(ref)||!validEnv(name)))throw moduleError('credentials','install','envMapping must map valid credential reference names to environment variable names, not secret values');
  function lookup(ref,method){
    if(!valid(ref)||!Object.hasOwn(mapping,ref))throw moduleError('credentials',method,`缺少敏感欄位「${ref}」的對應設定；請在插件安全設定的敏感欄位填寫，使用這個金鑰的功能目前無法使用。`,'DSH_CREDENTIAL_MISSING');
    const value=env[mapping[ref]];return typeof value==='string'&&value.length>0?{value,source:'env'}:undefined;
  }
  const stored=typeof requestHost==='function'?(method,args)=>requestHost('codex.credentials.'+method,args):null;
  const checkRef=ref=>{if(!validEnv(ref))throw moduleError('credentials','reference','金鑰欄位名稱不合法');return ref;};
  const changed=(event,key)=>{try{const result=emit(event,key);result?.catch?.(()=>{});}catch{}};
  let mutations=Promise.resolve();
  const methods={async resolve(ref){
    if(stored){const value=await stored('read',{ref:checkRef(ref)});if(value)return {value,source:'file'};if(!Object.hasOwn(mapping,ref))return undefined;}
    return lookup(ref,'resolve');
  },async describe(ref){const result=await methods.resolve(ref);return {configured:!!result,...(result?{source:result.source}:{}),writable:!!stored};}};
  if(stored)Object.assign(methods,{
    async set(ref,value){checkRef(ref);if(typeof value!=='string'||!value)throw moduleError('credentials','set','金鑰不得為空；請用移除功能清除。');await stored('set',{ref,value});changed('credentials/reference-updated',ref);},
    async unset(ref){await stored('unset',{ref:checkRef(ref)});changed('credentials/reference-updated',ref);},
    async readRecord(key){return (await stored('readRecord',{key})).record;},
    async describeRecord(key){const record=await methods.readRecord(key);return {configured:!!record,...(record?{kind:record.kind}:{}),writable:true};},
    async listRecords(){return stored('listRecords',{});},
    modifyRecord(key,modify){
      const pending=mutations.then(async()=>{for(;;){const current=await stored('readRecord',{key});const next=await modify(current.record);const answer=await stored('writeRecord',{key,record:next,revision:current.revision});if(!answer?.conflict){changed('credentials/record-updated',key);return next;}}});
      mutations=pending.catch(()=>{});return pending;
    },
    async deleteRecord(key){await methods.modifyRecord(key,()=>undefined);},
  });
  const service=guardService(methods,'credentials','此執行環境尚未連接可寫入的金鑰儲存區。');
  return {services:{credentials:service},dispose:async()=>{},diagnostics:[{module:'credentials',level:'info',reason:stored?'金鑰由主程序保存在插件目錄外；畫面只能查詢是否已設定，不能讀回金鑰。':'Environment mappings resolve per call in memory. Secret values are never included in module diagnostics.'}]};
}
function valid(value){return typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value);}
function validEnv(value){return typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value);}
