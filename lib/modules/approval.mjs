import {guardService,moduleUnavailable,unsupportedService} from '../codex-control.mjs';

export const descriptor={
  id:'approval',displayName:'核准模組',services:['approval'],
  requires:{minimumCodexVersion:'0.160.0',capabilities:[]},
  methods:{request:{support:'partial',reason:'Per-call MCP form elicitation grants one execution only; no persistent DSH approval policy or native agent lifecycle is created.'}},
  requirements:['Client must advertise form elicitation for this call','Only an accepted response with approve=true allows the operation'],
};
const sensitive=/token|password|passwd|secret|credential|authorization|api[_-]?key|private[_-]?key|access[_-]?key|cookie/i;
const secretsByAgent=new WeakMap();
function argumentSummary(value,depth=0) {
  if(depth>3)return '[nested]';
  if(Array.isArray(value))return value.slice(0,8).map(v=>argumentSummary(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,20).map(([key,v])=>[key,sensitive.test(key)?'[redacted]':argumentSummary(v,depth+1)]));
  // Values can contain credentials under innocuous names. Only expose types and lengths.
  if(typeof value==='string')return `[string, ${value.length} characters]`;
  if(value===null)return null;
  return `[${typeof value}]`;
}
function secretValues(value,result=[]) {
  if(!value||typeof value!=='object')return result;
  for(const [key,v]of Object.entries(value)) {
    if(sensitive.test(key)&&typeof v==='string'&&v)result.push(v);
    else if(v&&typeof v==='object')secretValues(v,result);
  }
  return result;
}
function redactReason(reason,secrets) {
  let text=typeof reason==='string'?reason:'此工具要求單次核准。';
  for(const secret of secrets)text=text.split(secret).join('[redacted]');
  return text.replace(/\bBearer\s+\S+/gi,'Bearer [redacted]').replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]').slice(0,600);
}
function formSupported(capabilities){const e=capabilities?.elicitation;return Boolean(e&&typeof e==='object'&&(!Object.hasOwn(e,'url')&&!Object.hasOwn(e,'form')||e.form&&typeof e.form==='object'));}

/** Identity carrier for one MCP call, explicitly not a running DSH Agent. */
export function createBridgeAgent({root,callId,requestId,args={},clientCapabilities={},sessionId,workspace,appendPluginEvent}={}) {
  const id=typeof sessionId==='string'&&sessionId?sessionId:`codex-mcp-call:${String(callId??requestId??'unassigned')}`;
  const projectedId=typeof sessionId==='string'&&sessionId?sessionId:id;
  const header=Object.freeze({id:projectedId,...(typeof workspace==='string'&&workspace?{cwd:workspace}:{})});
  const session=guardService(Object.freeze({id:projectedId,header,...(typeof appendPluginEvent==='function'?{append:appendPluginEvent}:{}),projection:Object.freeze({source:'mcp-connection',nativeDshSession:false,pluginJournal:typeof appendPluginEvent==='function'})}),'approval.bridgeAgent.session');
  const agent=guardService(Object.freeze({id,sessionId:projectedId,callId,ctx:root,session,options:Object.freeze({}),bridgeRequestId:requestId,bridgeClientCapabilities:structuredClone(clientCapabilities),bridgeArgumentSummary:argumentSummary(args),projection:Object.freeze({source:'mcp-connection',nativeDshAgent:false})}),'approval.bridgeAgent','The MCP call identity does not implement the native DSH agent lifecycle');
  secretsByAgent.set(agent,secretValues(args));
  return agent;
}

export function createApprovalService({requestHost,unavailable}={}) {
  const active=new Set();let disposed=false;
  return {
    service:guardService({async request(input={}) {
      if(disposed||unavailable||!input.agent||!formSupported(input.agent.bridgeClientCapabilities)||typeof requestHost!=='function')return 'unavailable';
      if(input.signal?.aborted)return 'cancelled';
      const controller=new AbortController();active.add(controller);
      const abort=()=>controller.abort();input.signal?.addEventListener('abort',abort,{once:true});
      let stop;
      const cancelled=new Promise(resolve=>{stop=()=>resolve({action:'cancel'});controller.signal.addEventListener('abort',stop,{once:true});});
      try {
        const agent=input.agent;
        const message=`工具：${input.toolName??'未知'}\n原因：${redactReason(input.displayReason??input.reason,secretsByAgent.get(agent)??[])}\n參數摘要（隱藏值）：${JSON.stringify(agent.bridgeArgumentSummary??{}).slice(0,1200)}`;
        const response=await Promise.race([Promise.resolve().then(()=>requestHost('elicitation/create',{
          message,requestedSchema:{type:'object',properties:{approve:{type:'boolean',title:'允許這一次操作'}},required:['approve'],additionalProperties:false},
        },{signal:controller.signal,requestId:agent.bridgeRequestId})),cancelled]);
        if(controller.signal.aborted||response?.action==='cancel')return 'cancelled';
        if(response?.action==='accept')return response.content?.approve===true?'allowed-once':'rejected';
        return response?.action==='decline'?'rejected':'unavailable';
      } catch {return controller.signal.aborted?'cancelled':'unavailable';}
      finally {input.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop);active.delete(controller);}
    }},'approval'),
    async dispose(){disposed=true;for(const controller of active)controller.abort();active.clear();},
  };
}
export async function install({capabilities={},requestHost}={}) {
  const unavailable=moduleUnavailable(descriptor,capabilities);
  if(unavailable)return {services:{approval:unsupportedService('approval',['request'],unavailable)},diagnostics:[{module:'approval',status:'disabled',level:'warning',reason:unavailable}],dispose:async()=>{}};
  const runtime=createApprovalService({requestHost});
  return {services:{approval:runtime.service},dispose:()=>runtime.dispose(),diagnostics:[{module:'approval',status:'partial',level:'info',reason:'Interactive approval requires the client capabilities negotiated for each MCP call; native DSH agent lifecycle is unsupported.'}]};
}
