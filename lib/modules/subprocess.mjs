import {PassThrough,Writable} from 'node:stream';
import {guardService,moduleError} from '../codex-control.mjs';

const fail=(message,code='DSH_SUBPROCESS_BAD_SPEC')=>moduleError('subprocess','spawn',message,code);
export class TailCollector{
  constructor(maxBytes){this.max=Math.floor(maxBytes);this.tail=Buffer.alloc(0);this.total=0;}
  push(chunk){const data=Buffer.from(chunk);this.total+=data.length;this.tail=Buffer.concat([this.tail,data]);if(this.tail.length>this.max)this.tail=this.tail.subarray(this.tail.length-this.max);}
  readFrom(fromByte=0){const start=this.total-this.tail.length;return {text:this.tail.subarray(Math.max(0,fromByte-start)).toString('utf8'),nextOffset:this.total,lossy:fromByte<start};}
  get text(){return this.tail.toString('utf8');}
  get truncated(){return this.total>this.tail.length;}
}
export function createRemoteSubprocessService({requestHost}={}){
  const live=new Set();let disposed=false;
  const request=(method,input)=>{if(typeof requestHost!=='function')throw fail('沒有可信本機程序通道','DSH_EXEC_APPROVAL_UNAVAILABLE');return requestHost('codex.process.'+method,input);};
  function spawn(spec){
    if(disposed)throw fail('模組已關閉','DSH_MODULE_DISPOSED');
    if(!spec||!Array.isArray(spec.argv)||!spec.argv.length||spec.argv.some(x=>typeof x!=='string')||!spec.argv[0])throw fail('argv 必須是非空字串陣列');
    if(typeof spec.cwd!=='string'||!spec.cwd)throw fail('cwd 必須是非空字串');
    if(!Number.isFinite(spec.graceMs)||spec.graceMs<=0||spec.graceMs>2147483647)throw fail('graceMs 必須是有效正毫秒數');
    const stdio=spec.stdio;
    if(!stdio||stdio.control!==undefined)throw fail('必須指定 stdio；不支援 control 通道');
    for(const key of ['stdout','stderr'])if(!['pipe','inherit'].includes(stdio[key])&&!(typeof stdio[key]==='object'&&Number.isFinite(stdio[key]?.maxBytes)&&stdio[key].maxBytes>0))throw fail(`無效的 stdio.${key}`);
    if(!['ignore','pipe'].includes(stdio.stdin)&&!(typeof stdio.stdin==='object'&&typeof stdio.stdin?.data==='string'))throw fail('無效的 stdio.stdin');
    if(spec.timeoutMs!==undefined&&(!Number.isFinite(spec.timeoutMs)||spec.timeoutMs<=0||spec.timeoutMs>2147483647))throw fail('timeoutMs 必須是有效正毫秒數');
    if(spec.signal?.aborted)throw fail('啟動已取消','ABORT_ERR');
    const stdout=stdio.stdout==='pipe'?new PassThrough():undefined,stderr=stdio.stderr==='pipe'?new PassThrough():undefined,collected={};
    for(const key of ['stdout','stderr'])if(typeof stdio[key]==='object')collected[key]=new TailCollector(stdio[key].maxBytes);
    let id,stopped=false,settled=false,startedResolve,startedReject;
    // Unread pipes retain normal stream semantics. Termination must also unblock drain waits.
    const pressure=new AbortController();
    const waitForDrain=output=>new Promise((resolve,reject)=>{
      const cleanup=()=>{output.off('drain',drain);output.off('error',error);output.off('close',close);pressure.signal.removeEventListener('abort',abort);};
      const drain=()=>{cleanup();resolve();},error=cause=>{cleanup();reject(cause);},close=()=>error(fail('輸出串流已關閉','ERR_STREAM_DESTROYED')),abort=()=>error(fail('串流等待已取消','ABORT_ERR'));
      output.once('drain',drain);output.once('error',error);output.once('close',close);pressure.signal.addEventListener('abort',abort,{once:true});
      if(pressure.signal.aborted)abort();else if(output.destroyed)close();
    });
    const started=new Promise((resolve,reject)=>{startedResolve=resolve;startedReject=reject;});started.catch(()=>{});
    const send=async(input,end=false)=>{await started;const data=Buffer.from(input);for(let i=0;i<data.length;i+=32768)await request('write',{id,data:data.subarray(i,i+32768).toString('base64'),encoding:'base64',end:false});if(end)await request('write',{id,data:'',end:true});};
    const stdin=stdio.stdin==='pipe'?new Writable({write(chunk,encoding,callback){send(chunk).then(()=>callback(),callback);},final(callback){send('',true).then(()=>callback(),callback);}}):undefined;
    // Consumers may use only done after a child closes stdin early.
    stdin?.on('error',()=>{});
    const terminate=()=>{if(settled)return;stopped=true;pressure.abort();if(id)void request('stop',{id}).catch(()=>{});};
    spec.signal?.addEventListener('abort',terminate,{once:true});
    const handle={stdin,stdout,stderr,control:undefined,collected,terminate,done:null,async waitForExit(signal){if(signal?.aborted)return false;let abort;try{return await Promise.race([handle.done.then(()=>true,()=>true),new Promise(resolve=>{abort=()=>resolve(false);signal?.addEventListener('abort',abort,{once:true});})]);}finally{signal?.removeEventListener('abort',abort);}}};
    live.add(handle);
    handle.done=(async()=>{
      try{
        ({id}=await request('spawn',{argv:spec.argv,cwd:spec.cwd,env:spec.env,providedSecrets:spec.providedSecrets,stdin:stdio.stdin==='ignore'?'ignore':'pipe',graceMs:spec.graceMs,timeoutMs:spec.timeoutMs}));
        if(stopped)await request('stop',{id});
        let after=0;
        while(true){
          const batch=await request('poll',{id,after,waitMs:25000});
          for(const event of batch.events){
            if(event.seq<=after)continue;after=event.seq;
            if(event.type==='started'){startedResolve();if(typeof stdio.stdin==='object')void send(stdio.stdin.data,true).catch(()=>{});}
            if(event.type==='error'){const error=fail(event.error.message,event.error.code);startedReject(error);throw error;}
            if(event.type==='stdout'||event.type==='stderr'){
              const output=event.type==='stdout'?stdout:stderr;
              const data=event.encoding==='base64'?Buffer.from(event.data,'base64'):Buffer.from(event.data);
              if(output&&!output.write(data))await waitForDrain(output);
              collected[event.type]?.push(data);
              // inherit must never write into the worker's JSON protocol stdout.
              if(stdio[event.type]==='inherit'&&!process.stderr.write(data))await waitForDrain(process.stderr);
            }
            if(event.type==='exit'){if(event.error)throw fail(event.error.message,event.error.code);return {exitCode:event.exitCode,signal:event.signal,...(event.timedOut?{timedOut:true}:{})};}
          }
          if(batch.done&&batch.events.length===0)throw fail('程序事件結束但沒有完成結果','DSH_PROCESS_PROTOCOL_ERROR');
        }
      }catch(error){startedReject(error);throw error;}
      finally{settled=true;live.delete(handle);spec.signal?.removeEventListener('abort',terminate);stdout?.end();stderr?.end();stdin?.destroy();if(id)await request('release',{id}).catch(()=>{});}
    })();
    handle.done.catch(()=>{});return handle;
  }
  return {service:guardService({spawn,async resolveExecutable(command,env,signal){if(signal?.aborted)throw fail('已取消','ABORT_ERR');const result=await request('resolve',{command,env});if(!result.path){const error=fail('找不到可執行檔','DSH_EXECUTABLE_NOT_FOUND');error.name='SubprocessExecutableNotFoundError';throw error;}return result.path;},async terminalEnvironment(){return {platform:process.platform==='win32'?'windows':'posix',defaultShell:process.platform==='win32'?'powershell.exe':process.env.SHELL||'/bin/sh'};}},'subprocess'),async dispose(){disposed=true;for(const handle of live)handle.terminate();await Promise.allSettled([...live].map(handle=>handle.done));}};
}
