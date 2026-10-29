import {spawn} from 'node:child_process';
import readline from 'node:readline';

const error=(message,code=-32603)=>Object.assign(new Error(message),{code});
const canceled=()=>error('Request canceled',-32800);
function mayRequest(c,method,p) {
  if(method==='elicitation/create') {
    const e=c?.elicitation;if(!e||typeof e!=='object')return false;
    return p?.mode==='url'?Boolean(e.url):!Object.hasOwn(e,'url')&&!Object.hasOwn(e,'form')||Boolean(e.form);
  }
  if(method==='sampling/createMessage')return Boolean(c?.sampling);
  if(method==='roots/list')return Boolean(c?.roots);
  return method==='ping';
}
export class McpClient {
  constructor(config,{cwd,timeout=20000,capabilities={},requestHandlers={},launchProcess,redact=value=>value}={}) {Object.assign(this,{config,cwd,timeout,capabilities,requestHandlers,launchProcess,redact});this.pending=new Map();this.incoming=new Map();this.id=0;this.stderr='';}
  async start() {
    if(this.child)return;
    const c=this.config;if(!c.command)throw new Error('遠端 MCP 連線請由 Codex 啟動；本機探測僅支援 stdio');
    this.child=this.launchProcess?await this.launchProcess():spawn(c.command,c.args??[],{cwd:c.cwd??this.cwd,env:{...process.env,...c.env},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    const rejectAll=e=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.removeAbort?.();p.reject(e);}this.pending.clear();for(const controller of this.incoming.values())controller.abort();this.incoming.clear();};
    this.child.on('error',rejectAll);this.child.stdin.on('error',rejectAll);this.child.on('exit',()=>rejectAll(new Error(`MCP 程序結束：${this.stderr.slice(-1500)}`)));
    this.child.stderr.on('data',c=>{this.stderr=this.redact(this.stderr+c.toString()).slice(-16000);});
    this.lines=readline.createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.method){if(m.id!==undefined)void this.handleRequest(m);else if(m.method==='notifications/cancelled')this.incoming.get(m.params?.requestId)?.abort();return;}const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);p.removeAbort?.();m.error?p.reject(error(m.error.message??JSON.stringify(m.error),m.error.code)):p.resolve(m.result);});
    try{await this.request('initialize',{protocolVersion:'2025-06-18',capabilities:this.capabilities,clientInfo:{name:'dsh-to-codex',version:'0.10.0'}});this.notify('notifications/initialized',{});}catch(e){await this.close();throw e;}
  }
  write(m){if(!this.child?.stdin.writable)throw new Error('MCP connection is closed');this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');}
  async handleRequest(m){const controller=new AbortController();this.incoming.set(m.id,controller);try{if(!mayRequest(this.capabilities,m.method,m.params))throw error('Client capability was not declared',-32601);const handler=this.requestHandlers[m.method];if(typeof handler!=='function')throw error('Client request handler is unavailable',-32601);const result=await handler(m.params??{},{signal:controller.signal,requestId:m.id});if(controller.signal.aborted)throw canceled();this.write({id:m.id,result});}catch(e){try{this.write({id:m.id,error:{code:e.code??-32603,message:e.message}});}catch{}}finally{this.incoming.delete(m.id);}}
  notify(method,params){this.write({method,params});}
  cancel(id,reason='Client canceled request'){if(this.pending.has(id))this.notify('notifications/cancelled',{requestId:id,reason});}
  request(method,params={},execution={}) {
    const id=++this.id;
    const promise=new Promise((resolve,reject)=>{if(execution.signal?.aborted){reject(canceled());return;}const slot={resolve,reject};slot.timer=setTimeout(()=>{this.cancel(id,'Client request timed out');this.pending.delete(id);slot.removeAbort?.();reject(new Error(`MCP ${method} 超時`));},execution.timeout??this.timeout);if(execution.signal){const abort=()=>this.cancel(id);execution.signal.addEventListener('abort',abort,{once:true});slot.removeAbort=()=>execution.signal.removeEventListener('abort',abort);}this.pending.set(id,slot);try{this.write({id,method,params});}catch(e){clearTimeout(slot.timer);this.pending.delete(id);slot.removeAbort?.();reject(e);}});
    promise.requestId=id;return promise;
  }
  async listTools(){let cursor;const all=[];do{const r=await this.request('tools/list',cursor?{cursor}:{});all.push(...(r.tools??[]));cursor=r.nextCursor;if(all.length>10000)throw new Error('工具數量超過上限');}while(cursor);return all;}
  async close(){for(const id of this.pending.keys())try{this.cancel(id,'Client closed');}catch{}this.lines?.close();if(this.child){const child=this.child;await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},1000);child.once('exit',()=>{clearTimeout(timer);resolve();});if(child.exitCode!==null){clearTimeout(timer);resolve();}else child.stdin.end();});this.child=null;}}
}
export async function serveMcp({name,tools=[],getTools=()=>tools,onToolsChanged,dispose=async()=>{},clientRequestTimeoutMs=120000}) {
  const rl=readline.createInterface({input:process.stdin});let initialized=false,closed=false,clientCapabilities={},sequence=0;
  const pending=new Map(),outgoing=new Map();
  const send=m=>{if(!closed)process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');};
  const currentTools=()=>{const all=getTools();if(!Array.isArray(all))throw new Error('Tool provider must return an array');if(new Set(all.map(t=>t.name)).size!==all.length)throw new Error('Duplicate MCP tool names');return all;};
  const unsubscribe=onToolsChanged?.(()=>{if(initialized)send({method:'notifications/tools/list_changed'});});
  const requestClient=(method,params={},execution={})=>{
    if(closed)return Promise.reject(error('MCP connection is closed'));
    if(!mayRequest(clientCapabilities,method,params))return Promise.reject(error(`Client did not declare capability for ${method}`,-32601));
    if(execution.signal?.aborted)return Promise.reject(canceled());
    const id=`dsh-client-${++sequence}`;
    return new Promise((resolve,reject)=>{
      const finish=(e,result)=>{const slot=outgoing.get(id);if(!slot)return;outgoing.delete(id);clearTimeout(slot.timer);execution.signal?.removeEventListener('abort',abort);e?reject(e):resolve(result);};
      const abort=()=>{send({method:'notifications/cancelled',params:{requestId:id,reason:'Originating request canceled'}});finish(canceled());};
      const timer=setTimeout(()=>{send({method:'notifications/cancelled',params:{requestId:id,reason:'Client response timed out'}});finish(error('Client request timed out'));},execution.timeoutMs??clientRequestTimeoutMs);
      outgoing.set(id,{finish,timer});execution.signal?.addEventListener('abort',abort,{once:true});send({id,method,params});
    });
  };
  async function dispatch(req,controller){
    try{
      let result;
      if(req.method==='initialize'){initialized=true;clientCapabilities=req.params?.capabilities??{};result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18'].includes(req.params?.protocolVersion)?req.params.protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:Boolean(onToolsChanged)},experimental:{["codex/sandbox-state-meta"]:{}}},serverInfo:{name,version:'0.10.0'}};}
      else if(!initialized)throw error('Initialize required',-32002);
      else if(req.method==='ping')result={};
      else if(req.method==='tools/list')result={tools:currentTools().map(({name,description,inputSchema,annotations})=>({name,description,inputSchema,...(annotations?{annotations}:{})}))};
      else if(req.method==='tools/call'){
        const tool=currentTools().find(t=>t.name===req.params?.name);if(!tool)throw error('Unknown tool',-32602);
        try{result=await tool.execute(req.params.arguments??{},{signal:controller.signal,callId:String(req.id),requestMeta:req.params?._meta,clientCapabilities,requestClient:(method,params,execution={})=>requestClient(method,params,{...execution,signal:execution.signal??controller.signal})});}catch(e){result={isError:true,content:[{type:'text',text:e.message}]};}
      }else throw error('Method not found',-32601);
      if(controller.signal.aborted)throw canceled();send({id:req.id,result});
    }catch(e){if(!controller.signal.aborted)send({id:req.id,error:{code:e.code??-32603,message:e.message}});}finally{if(pending.get(req.id)?.controller===controller)pending.delete(req.id);}
  }
  try{
    for await(const line of rl){
      if(Buffer.byteLength(line)>4*1024*1024)continue;
      let req;try{req=JSON.parse(line);}catch{send({id:null,error:{code:-32700,message:'Invalid JSON'}});continue;}
      if(!req||typeof req!=='object'||Array.isArray(req)){send({id:null,error:{code:-32600,message:'Invalid Request'}});continue;}
      if(!req.method&&req.id!==undefined){const slot=outgoing.get(req.id);if(slot)slot.finish(req.error?error(req.error.message,req.error.code):null,req.result);continue;}
      if(req.method==='notifications/cancelled'){const id=req.params?.requestId,slot=pending.get(id);if(slot){slot.controller.abort();pending.delete(id);send({id,error:{code:-32800,message:'Request canceled'}});}continue;}
      if(req.id===undefined)continue;
      if(pending.has(req.id)){send({id:req.id,error:{code:-32600,message:'Duplicate request id'}});continue;}
      const controller=new AbortController(),slot={controller};pending.set(req.id,slot);slot.task=dispatch(req,controller);
    }
  }finally{
    for(const slot of pending.values())slot.controller.abort();for(const slot of [...outgoing.values()])slot.finish(canceled());
    closed=true;unsubscribe?.();await dispose();pending.clear();rl.close();
  }
}

