import {spawn, execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import semver from 'semver';

const METHODS = new Set(['model/list', 'thread/start', 'thread/resume', 'thread/read', 'thread/turns/list', 'thread/items/list', 'turn/start', 'turn/steer', 'turn/interrupt','command/exec']);
const MUTATIONS = new Set(['thread/start', 'thread/resume', 'turn/start', 'turn/steer']);
export function moduleError(module, method, reason, code='DSH_MODULE_UNSUPPORTED') {
  return Object.assign(new Error(`${module}.${method}: ${reason}`), {code, module, method, reason});
}
export function moduleUnavailable(descriptor, capabilities={}) {
  const minimum=descriptor.requires.minimumCodexVersion,version=semver.coerce(capabilities.codexVersion ?? capabilities.version ?? '');
  if(minimum&&(!version || semver.lt(version,minimum))) return `Requires Codex >= ${minimum}; detected version is unavailable or older`;
  for(const name of descriptor.requires.capabilities) if(capabilities[name]!==true && capabilities.flags?.[name]!==true&&name.split('.').reduce((value,key)=>value?.[key],capabilities)!==true) return `Codex capability is unavailable: ${name}`;
  return null;
}
export function unsupportedService(module, methods, reason) {
  const target={};
  for(const method of methods) target[method]=()=>{throw moduleError(module, method, reason);};
  return guardService(target,module,reason);
}
export function guardService(target,module,reason='This method is not mapped by the Codex module') {
  return new Proxy(target,{get(value,key,receiver){
    if(typeof key==='symbol'||key==='then'||Reflect.has(value,key))return Reflect.get(value,key,receiver);
    return ()=>{throw moduleError(module,String(key),reason);};
  }});
}
export async function probeCodexVersion(command='codex') {
  return new Promise(resolve=>execFile(command, ['--version'], {windowsHide:true,timeout:10000}, (error,stdout)=>resolve(error ? null : semver.coerce(stdout)?.version ?? null)));
}

/** Local app-server carrier. No desktop library enumeration or model fallback. */
export async function createCodexControl(options={}) {
  const useChatgpt=options.authentication==='chatgpt';
  const ownedHome=!options.codexHome&&!useChatgpt;
  const home=options.codexHome ? path.resolve(options.codexHome) : useChatgpt?path.resolve(process.env.CODEX_HOME??path.join(homedir(),'.codex')):await mkdtemp(path.join(tmpdir(),'dsh-codex-control-'));
  const allowed=new Set(options.allowedThreadIds ?? []), owned=new Set();
  const listeners=new Set(), closeListeners=new Set(),requestListeners=new Set(), pending=new Map();
  let child, lines, starting, closed=false, sequence=0;
  const timeoutMs=options.timeoutMs ?? 30000;
  const failAll=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();};
  const raw=(method,params)=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(moduleError('codex-control',method,'App-server request timed out','CODEX_CONTROL_TIMEOUT'));},timeoutMs);
    pending.set(id,{resolve,reject,timer,method});
    child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){pending.delete(id);clearTimeout(timer);reject(moduleError('codex-control',method,'App-server input closed','CODEX_CONTROL_CLOSED'));}});
  });
  const start=()=>starting??=(async()=>{
    if(closed) throw moduleError('codex-control','start','Control is closed');
    const version=await probeCodexVersion(options.command);
    if(!version || semver.lt(version,'0.160.0')) throw moduleError('codex-control','start','Codex >= 0.160.0 is required','DSH_MODULE_DISABLED');
    if(closed)throw moduleError('codex-control','start','Control closed before process startup','CODEX_CONTROL_CLOSED');
    const env={};
    for(const [name,value] of Object.entries(process.env)) if(/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LANG|LC_ALL)$/i.test(name)) env[name]=value;
    Object.assign(env,{CODEX_HOME:home,HOME:home,USERPROFILE:home});
    const args=['app-server','--stdio','--disable','plugins','--disable','apps',...(options.serverArgs??[])];
    child=spawn(options.command ?? 'codex',args,{cwd:options.controlWorkspace??home,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
    child.on('error',()=>failAll(moduleError('codex-control','start','App-server could not start','CODEX_CONTROL_CLOSED')));
    child.on('close',()=>{
      const error=moduleError('codex-control','request','App-server exited','CODEX_CONTROL_CLOSED');
      failAll(error); for(const fn of closeListeners){try{fn(error);}catch{}}
    });
    lines=createInterface({input:child.stdout});
    lines.on('line',line=>{
      if(Buffer.byteLength(line)>(options.maxResponseBytes ?? 32*1024*1024)){failAll(moduleError('codex-control','request','Response size limit exceeded'));child.kill();return;}
      let message;try{message=JSON.parse(line);}catch{return;}
      if(message.method && message.id!==undefined){
        // Only tools explicitly attached to an owned thread are dispatchable.
        // Approval requests remain with the trusted caller's native policy.
        void (async()=>{
          try{
            let result;
            if(message.method==='item/tool/call'&&owned.has(message.params?.threadId)){
              for(const handler of requestListeners){result=await handler(message);if(result!==undefined)break;}
            }else if(options.onApprovalRequest&&owned.has(message.params?.threadId))result=await options.onApprovalRequest(message);
            child.stdin.write(JSON.stringify(result===undefined?{id:message.id,error:{code:-32601,message:'No trusted handler is configured for this request'}}:{id:message.id,result})+'\n');
          }catch{child.stdin.write(JSON.stringify({id:message.id,error:{code:-32603,message:'Trusted request handler failed'}})+'\n');}
        })();return;
      }
      if(message.method){for(const fn of listeners){try{fn(message);}catch{}}return;}
      const item=pending.get(message.id);if(!item)return;
      pending.delete(message.id);clearTimeout(item.timer);
      if(message.error)item.reject(moduleError('codex-control',item.method,`App-server returned error ${message.error.code}`,message.error.code===-32601?'DSH_MODULE_DISABLED':'CODEX_CONTROL_RPC'));
      else item.resolve(message.result);
    });
    await raw('initialize',{clientInfo:{name:'dsh-to-codex-control',version:'0.10.0'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    if(useChatgpt){
      const account=await raw('account/read',{refreshToken:false});
      if(account.account?.type!=='chatgpt'){child.kill();throw moduleError('codex-control','authentication','Existing ChatGPT Codex login is required; API-key authentication is refused','CODEX_CHATGPT_REQUIRED');}
    }
  })();
  return {
    codexHome:home,
    onNotification(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
    onRequest(fn){requestListeners.add(fn);return ()=>requestListeners.delete(fn);},
    onClose(fn){closeListeners.add(fn);return ()=>closeListeners.delete(fn);},
    async readRateLimits(){if(closed)throw Error('Codex 連線已關閉');await start();return raw('account/rateLimits/read',{});},
    async request(method,params={}){
      if(closed)throw moduleError('codex-control',method,'Control is closed','CODEX_CONTROL_CLOSED');
      if(!METHODS.has(method))throw moduleError('codex-control',method,'Method is outside the explicit control contract');
      if(MUTATIONS.has(method) && options.allowModelCalls===false)throw moduleError('codex-control',method,'allowModelCalls must be explicitly true','DSH_MODEL_CALLS_DISABLED');
      if(method!=='model/list' && method!=='thread/start' && !owned.has(params.threadId) && !allowed.has(params.threadId))throw moduleError('codex-control',method,'Thread is outside the owned or explicitly allowed scope','CODEX_CONTROL_SCOPE');
      await start();
      const result=await raw(method,params);
      if(method==='thread/start' && typeof result?.thread?.id==='string')owned.add(result.thread.id);
      if(method==='thread/resume' && result?.thread?.id!==params.threadId)throw moduleError('codex-control',method,'Server returned a different thread','CODEX_CONTROL_SHAPE');
      return result;
    },
    async close(){
      if(closed)return;closed=true;
      failAll(moduleError('codex-control','close','Control is closed','CODEX_CONTROL_CLOSED'));
      for(const fn of closeListeners){try{fn(moduleError('codex-control','close','Control closed','CODEX_CONTROL_CLOSED'));}catch{}}
      listeners.clear();closeListeners.clear();requestListeners.clear();lines?.close();
      if(child&&!child.killed){const done=new Promise(resolve=>child.once('close',resolve));child.kill();await Promise.race([done,new Promise(resolve=>{const timer=setTimeout(resolve,1000);timer.unref();})]);}
      if(ownedHome)await rm(home,{recursive:true,force:true});
    },
  };
}
