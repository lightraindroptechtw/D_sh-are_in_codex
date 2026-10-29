import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

/** Trusted market-only setting writer. Source plugins never receive this transport. */
export async function writeManagedPluginEnabled({pluginId,enabled,codexHome,command='codex',spawnImpl=spawn,timeoutMs=15000}){
  if(typeof pluginId!=='string'||!/^dsh-[a-z0-9-]+-[a-f0-9]{10}@dsh-community-converted$/.test(pluginId)||typeof enabled!=='boolean'||typeof codexHome!=='string'||!codexHome)throw new Error('只接受受管插件的啟用設定');
  const env={};for(const [key,value]of Object.entries(process.env))if(/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LANG|LC_ALL)$/i.test(key))env[key]=value;
  Object.assign(env,{CODEX_HOME:codexHome,HOME:codexHome,USERPROFILE:codexHome});
  const child=spawnImpl(command,['app-server','--stdio','--disable','plugins','--disable','apps'],{cwd:codexHome,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let sequence=0;const pending=new Map(),lines=createInterface({input:child.stdout});
  const rejectAll=cause=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(cause);}pending.clear();};
  child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
  child.on('error',rejectAll);child.on('close',()=>rejectAll(new Error('Codex 設定程序已結束')));
  lines.on('line',line=>{
    if(Buffer.byteLength(line)>1024*1024){rejectAll(new Error('Codex 設定回應過大'));child.kill();return;}
    let message;try{message=JSON.parse(line);}catch{return;}
    if(message.method&&message.id!==undefined){child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'No requests accepted'}})+'\n');return;}
    const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);
    message.error?entry.reject(new Error(`Codex 設定失敗：${String(message.error.message??message.error.code).slice(0,600)}`)):entry.resolve(message.result);
  });
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Codex 設定逾時'));},timeoutMs);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n',cause=>{if(cause){pending.delete(id);clearTimeout(timer);reject(cause);}});});
  try{
    await request('initialize',{clientInfo:{name:'dsh-market-plugin-settings',version:'1'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const result=await request('config/value/write',{keyPath:`plugins.${JSON.stringify(pluginId)}.enabled`,value:enabled,mergeStrategy:'replace'});
    if(result?.status!=='ok')throw new Error('Codex 未確認插件啟用設定已儲存');
    return {ok:true};
  }finally{rejectAll(new Error('Codex 設定連線已關閉'));lines.close();child.stdin.end();if(!child.killed)child.kill();}
}
