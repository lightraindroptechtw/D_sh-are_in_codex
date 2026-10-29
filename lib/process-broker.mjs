/** Trusted process sessions. JSON messages carry IDs and ordered, acknowledged events. */
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {statSync} from 'node:fs';
import path from 'node:path';
import {isUtf8} from 'node:buffer';
import {runGuarded} from './sandbox-launch.mjs';
import {moduleError} from './codex-control.mjs';

export const PROCESS_METHODS=['codex.process.spawn','codex.process.poll','codex.process.write','codex.process.stop','codex.process.release','codex.process.resolve'];
const fail=(message,code='DSH_SUBPROCESS_BAD_SPEC')=>moduleError('subprocess','spawn',message,code);
export function killProcessTree(child,graceMs=500){
  if(!child?.pid)return;
  if(process.platform==='win32'){
    if(child.exitCode!==null||child.signalCode)return;
    spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{try{child.kill();}catch{}});
  }else{
    const kill=signal=>{try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{}}};
    kill('SIGTERM');const timer=setTimeout(()=>kill('SIGKILL'),graceMs);timer.unref();
  }
}
export function findExecutable(command,env=process.env){
  if(typeof command!=='string'||!command)return null;
  if(!path.isAbsolute(command)&&/[\\/]/.test(command))return null;
  const exts=process.platform==='win32'?['',...String(env.PATHEXT??env.Pathext??'.EXE;.CMD;.BAT;.COM').split(';')]:[''];
  const bases=path.isAbsolute(command)?[command]:String(env.PATH??env.Path??'').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,command));
  for(const base of bases)for(const ext of exts)try{if(statSync(base+ext).isFile())return base+ext;}catch{}
  return null;
}
export function createProcessBroker({options={},authorizeCommand}){
  const sessions=new Map();let closed=false;
  const redact=value=>options.security?.redact(value)??value;
  function get(id){const slot=sessions.get(id);if(!slot)throw fail('找不到程序工作階段','CODEX_CONTROL_SCOPE');return slot;}
  function push(slot,event){
    if(slot.released)return;
    const item={...event,seq:++slot.seq};slot.events.push(item);slot.bytes+=Buffer.byteLength(JSON.stringify(item));
    for(const wake of slot.waiters)wake();slot.waiters.clear();
    // Bound queued events with producer backpressure; never drop output or kill a producer for volume.
    if(slot.bytes>=4*1024*1024&&!slot.stopped){slot.paused=true;slot.child?.stdout.pause();slot.child?.stderr.pause();}
  }
  function resume(slot){if(slot.paused){slot.paused=false;slot.child?.stdout.resume();slot.child?.stderr.resume();}}
  function stop(slot){slot.stopped=true;slot.cancel?.();resume(slot);killProcessTree(slot.child,slot.graceMs);}
  async function launch(slot,input){
    let timer;
    try{
      const cancelled=new Promise((resolve,reject)=>{slot.cancel=()=>reject(fail('啟動已取消','ABORT_ERR'));});
      const {cwd,env}=await Promise.race([authorizeCommand({...input,command:input.argv}),cancelled]);
      if(slot.stopped||closed)throw fail('啟動已取消','ABORT_ERR');
      // Only explicitly supplied credential values are kept as a partial suffix,
      // so a secret split across OS data chunks is never published unmasked.
      const secrets=Object.values(env).filter(v=>typeof v==='string'&&v&&redact(v)!==v).sort((a,b)=>b.length-a.length);
      slot.child=await runGuarded({stateDir:options.stateDir??cwd,command:input.argv[0],args:input.argv.slice(1),cwd,executionPolicy:options.nativePolicy,codexCommand:options.command,environment:env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
      const child=slot.child;
      const drain=(source,type)=>{
        let pending=Buffer.alloc(0);
        const send=final=>{
          for(const secret of secrets){const token=Buffer.from(secret),replacement=Buffer.from(redact(secret));let offset;
            while((offset=pending.indexOf(token))!==-1)pending=Buffer.concat([pending.subarray(0,offset),replacement,pending.subarray(offset+token.length)]);
          }
          let keep=0;
          if(!final)for(const secret of secrets){const token=Buffer.from(secret);for(let n=1;n<token.length&&n<=pending.length;n++)if(pending.subarray(pending.length-n).equals(token.subarray(0,n)))keep=Math.max(keep,n);}
          let data=pending.subarray(0,pending.length-keep);pending=pending.subarray(pending.length-keep);
          if(data.length){if(isUtf8(data))data=Buffer.from(redact(data.toString('utf8')));push(slot,{type,data:data.toString('base64'),encoding:'base64'});}
        };
        source.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);send(false);});
        source.on('end',()=>send(true));
      };
      drain(child.stdout,'stdout');drain(child.stderr,'stderr');child.stdin.on('error',()=>{});
      push(slot,{type:'started'});
      if(input.stdin==='ignore')child.stdin.end();
      if(slot.stopped)stop(slot);
      if(input.timeoutMs)timer=setTimeout(()=>{slot.timedOut=true;stop(slot);},input.timeoutMs);
      const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});
      push(slot,{type:'exit',...result,...(slot.timedOut?{timedOut:true}:{})});
    }catch(error){push(slot,{type:'error',error:{code:error.code??'DSH_EXEC_SPAWN_FAILED',message:redact(error.message)}});}
    finally{clearTimeout(timer);slot.done=true;if(!slot.released){slot.expiry=setTimeout(()=>{stop(slot);sessions.delete(slot.id);},60000);slot.expiry.unref();}}
  }
  return {
    async dispatch(method,input={}){
      if(closed)throw fail('程序服務已關閉','DSH_MODULE_DISPOSED');
      if(method==='codex.process.resolve')return {path:findExecutable(input.command,{...process.env,...input.env})};
      if(method==='codex.process.spawn'){
        if(!Array.isArray(input.argv)||!input.argv.length||input.argv.some(x=>typeof x!=='string')||!input.argv[0])throw fail('argv 必須是完整字串陣列');
        if(input.timeoutMs!==undefined&&(!Number.isFinite(input.timeoutMs)||input.timeoutMs<=0||input.timeoutMs>2147483647))throw fail('timeoutMs 必須是有效正毫秒數');
        const slot={id:randomUUID(),seq:0,events:[],bytes:0,waiters:new Set(),graceMs:Math.min(2147483647,Math.max(1,Number(input.graceMs)||500))};sessions.set(slot.id,slot);slot.task=launch(slot,input);return {id:slot.id};
      }
      const slot=get(input.id);
      if(method==='codex.process.poll'){
        const after=input.after??0;if(!Number.isInteger(after)||after<0||after>slot.seq)throw fail('無效事件游標');
        slot.events=slot.events.filter(event=>event.seq>after);slot.bytes=slot.events.reduce((sum,event)=>sum+Buffer.byteLength(JSON.stringify(event)),0);
        // Acknowledgement releases old events; hysteresis avoids repeated pause/resume at the boundary.
        if(slot.bytes<2*1024*1024)resume(slot);
        if(!slot.events.length&&!slot.done)await new Promise(resolve=>{let timer;const wake=()=>{clearTimeout(timer);slot.waiters.delete(wake);resolve();};slot.waiters.add(wake);timer=setTimeout(wake,Math.min(25000,Math.max(1,input.waitMs??25000)));});
        return {events:slot.events.slice(0,128),done:slot.done};
      }
      if(method==='codex.process.write'){
        if(!slot.child||slot.done||slot.stopped)throw fail('程序目前不能寫入','DSH_PROCESS_NOT_WRITABLE');
        if(typeof input.data!=='string'||Buffer.byteLength(input.data)>256*1024)throw fail('stdin 資料必須是小於 256 KiB 的字串');
        const data=input.encoding==='base64'?Buffer.from(input.data,'base64'):input.data;
        await new Promise((resolve,reject)=>{const callback=error=>error?reject(error):resolve();input.end?slot.child.stdin.end(data,callback):slot.child.stdin.write(data,callback);});return {accepted:true};
      }
      if(method==='codex.process.stop'){stop(slot);return {accepted:true};}
      if(method==='codex.process.release'){stop(slot);slot.released=true;clearTimeout(slot.expiry);sessions.delete(slot.id);for(const wake of slot.waiters)wake();return {released:true};}
      throw fail('未知程序方法');
    },
    async close(){closed=true;for(const slot of sessions.values()){stop(slot);slot.released=true;clearTimeout(slot.expiry);for(const wake of slot.waiters)wake();}sessions.clear();},
  };
}
