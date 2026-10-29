import {randomUUID} from 'node:crypto';

const text=value=>typeof value==='string'?value:'';
const reason=decision=>text(decision.reason)||text(decision.message)||'DSH 插件攔截規則拒絕這次工具操作';
const deny=message=>({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:message}});
export {deny as denyNativeTool};

/** Project only the public Codex hook fields. Never execute the pending tool. */
export async function evaluateNativeToolHook({ctx,input,options={},scopeTarget,createAgent}){
  if(options.nativeToolHooks!==true)return {};
  if(!['PreToolUse','PostToolUse'].includes(input?.hook_event_name))throw new Error('Unsupported native tool hook');
  if(typeof input.tool_name!=='string'||!input.tool_name)throw new Error('Hook requires tool_name');
  // This server's MCP tools already traverse the official policy pipeline.
  if(options.mcpServerName&&input.tool_name.startsWith(`mcp__${options.mcpServerName}__`))return {};
  // Clone input so source hooks cannot rewrite the native pending operation.
  input=structuredClone(input);
  const agent=createAgent?.({root:ctx,callId:input.tool_use_id??randomUUID(),requestId:null,args:input.tool_input??{},clientCapabilities:{},sessionId:input.session_id,workspace:input.cwd??options.workspace});
  const exec={name:input.tool_name,callId:input.tool_use_id??randomUUID(),arguments:input.tool_input??{},agent,cwd:input.cwd??options.workspace,sessionId:input.session_id,signal:AbortSignal.timeout(20000),origin:'codex-hook',codexSessionId:input.session_id};
  const carrier=scopeTarget(ctx.tools,agent);
  if(input.hook_event_name==='PreToolUse'){
    const gate=await ctx.waterfall(carrier,'tools/pre-execute',exec,()=>Promise.resolve({kind:'allow'}));
    if(gate.kind==='deny')return deny(reason(gate));
    if(gate.kind==='ask')return deny('此 Codex PreToolUse 掛鉤不支援確認詢問；請透過已連接的 MCP 工具取得單次核准。');
    if(gate.kind!=='allow')return deny('DSH 前置規則回傳未知結果，已拒絕操作');
    return {}; // Never grant broader Codex permissions with an allow override.
  }
  const value=input.tool_response??input.tool_output??null;
  const result={content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],value,isError:false,origin:'codex-hook'};
  const decision=await ctx.waterfall(carrier,'tools/post-execute',exec,result,()=>Promise.resolve({kind:'accept'}));
  await ctx.parallel(carrier,'tools/result',exec,result);
  if(decision.kind==='block')return {decision:'block',reason:(decision.feedback??[]).map(item=>item.text??'').join('\n')||reason(decision)};
  if(decision.kind!=='accept'||Object.hasOwn(decision,'value')||Object.hasOwn(decision,'content'))return {decision:'block',reason:'此插件要求替換工具結果，但 Codex 掛鉤不支援此操作。'};
  return {};
}
