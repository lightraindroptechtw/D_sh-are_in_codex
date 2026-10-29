import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {protectOwnerOnly} from './plugin-security.mjs';

const fail=message=>Object.assign(new Error(message),{code:'DSH_CREDENTIAL_STORE'});
export function credentialStoreRoot({root,stateId,home=process.env.CODEX_HOME??path.join(os.homedir(),'.codex')}){
  const id=createHash('sha256').update(stateId??path.resolve(root)).digest('hex');
  return path.join(home,'dsh-to-codex-credentials',id);
}
export function createCredentialStore({directory,onSecrets=()=>{},protect=protectOwnerOnly}){
  const file=path.join(directory,'credentials.json');let tail=Promise.resolve();
  const ref=name=>{if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw fail('金鑰欄位名稱不合法。');return name;};
  const recordKey=key=>{if(typeof key!=='string'||!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(key))throw fail('憑證紀錄需要插件名稱與紀錄名稱。');return key;};
  const remember=data=>{
    const values=Object.values(data.refs);const visit=value=>{if(typeof value==='string')values.push(value);else if(value&&typeof value==='object')for(const child of Object.values(value))visit(child);};
    for(const record of Object.values(data.records)){if(record.kind==='api-key'){if(record.key)values.push(record.key);visit(record.env);}else visit(record.payload);}
    onSecrets(values);
  };
  async function read(){
    let data;try{data=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;data={refs:{},records:{},revision:0};}
    remember(data);return data;
  }
  async function save(data){
    await fs.mkdir(directory,{recursive:true,mode:0o700});await protect(directory,{directory:true});
    const temporary=file+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify(data),{mode:0o600,flag:'wx'});await protect(temporary);await fs.rename(temporary,file);await protect(file);}catch(error){await fs.rm(temporary,{force:true});throw error;}
    remember(data);
  }
  async function dispatch(method,args={}){
    const data=await read();let result,changed=false;
    switch(method){
      case 'read': result=Object.hasOwn(data.refs,ref(args.ref))?data.refs[args.ref]:undefined;break;
      case 'set': if(typeof args.value!=='string'||!args.value)throw fail('金鑰不得為空，清除請使用移除功能。');Object.defineProperty(data.refs,ref(args.ref),{value:args.value,enumerable:true,configurable:true,writable:true});changed=true;break;
      case 'unset': delete data.refs[ref(args.ref)];changed=true;break;
      case 'readRecord': result={record:data.records[recordKey(args.key)],revision:data.revision};break;
      case 'listRecords': result=Object.entries(data.records).map(([key,record])=>({key,kind:record.kind}));break;
      case 'writeRecord': {
        const key=recordKey(args.key);
        if(args.revision!==data.revision)return {conflict:true};
        const record=args.record;
        if(record!==undefined&&record!==null&&(!['api-key','grant'].includes(record.kind)))throw fail('憑證紀錄格式不正確。');
        if(record==null)delete data.records[key];else data.records[key]=JSON.parse(JSON.stringify(record));
        changed=true;break;
      }
      default: throw fail('這項憑證操作尚未提供。');
    }
    if(changed){data.revision++;await save(data);}return result??null;
  }
  async function locked(callback){
    await fs.mkdir(directory,{recursive:true,mode:0o700});await protect(directory,{directory:true});
    const lock=file+'.lock',started=Date.now();let handle;
    while(!handle){try{handle=await fs.open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid}));}
      catch(error){if(error.code!=='EEXIST')throw error;
        try{const {pid}=JSON.parse(await fs.readFile(lock,'utf8'));try{process.kill(pid,0);}catch(cause){if(cause.code==='ESRCH'){await fs.unlink(lock).catch(()=>{});continue;}}}catch{}
        if(Date.now()-started>30000)throw fail('另一個對話正在儲存金鑰，請稍後重試。');
        await new Promise(resolve=>setTimeout(resolve,20));}}
    try{return await callback();}finally{await handle.close();await fs.unlink(lock).catch(()=>{});}
  }
  return {file,load:read,request(method,args){const pending=tail.then(()=>['set','unset','writeRecord'].includes(method)?locked(()=>dispatch(method,args)):dispatch(method,args));tail=pending.catch(()=>{});return pending;}};
}
