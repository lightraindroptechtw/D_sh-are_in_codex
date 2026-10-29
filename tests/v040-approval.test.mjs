import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime,{defineTool} from '@deepseek-ai/dsh-tools';
import {createBridgeAgent,createApprovalService,install,descriptor} from '../lib/modules/approval.mjs';
async function official(t){const root=new Context();await root.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false}).await();await root.plugin(ToolRuntime,{mode:'native'}).await();t.after(()=>root.fiber.dispose());return root;}
const definition=execute=>defineTool({name:'approval_probe',description:'Synthetic policy probe',parameters:{token:{type:'string'},text:{type:'string'}},output:{schema:{type:'json'},render:(_,v)=>[{type:'text',text:String(v)}]},execute});
test('v040 approval runs real DSH pre-execute ask pipeline and grants once only on explicit true',async t=>{
  const root=await official(t);let response={action:'accept',content:{approve:true}},calls=0,observed;
  const runtime=createApprovalService({requestHost:async(method,params,execution)=>{observed={method,params,execution};return response;}});root.provide('approval',runtime.service);
  root.on('tools/pre-execute',()=>({kind:'ask',reason:'Confirm token=synthetic-secret'}));root.tools.register(definition(async()=>++calls));
  const agent=createBridgeAgent({root,callId:'mcp1',requestId:7,args:{token:'synthetic-secret',text:'hidden-too'},clientCapabilities:{elicitation:{form:{}}}});
  const execute=()=>root.tools.execute({name:'approval_probe',callId:'mcp1',agent,arguments:{token:'synthetic-secret'},signal:new AbortController().signal});
  assert.equal((await execute()).isError,false);assert.equal(calls,1);assert.equal(observed.method,'elicitation/create');assert.equal(observed.execution.requestId,7);assert.equal(observed.params.requestedSchema.properties.approve.type,'boolean');assert.equal(JSON.stringify(observed.params).includes('synthetic-secret'),false);assert.equal(JSON.stringify(observed.params).includes('hidden-too'),false);
  response={action:'accept',content:{approve:false}};assert.equal((await execute()).isError,true);response={action:'accept',content:{}};assert.equal((await execute()).isError,true);response={action:'decline'};assert.equal((await execute()).isError,true);response={action:'cancel'};assert.equal((await execute()).isError,true);assert.equal(calls,1);await runtime.dispose();
});
test('v040 approval refuses missing and URL-only form capabilities and missing transport',async t=>{
  const root=await official(t);let called=false;const runtime=createApprovalService({requestHost:async()=>{called=true;return{action:'accept',content:{approve:true}};}});root.provide('approval',runtime.service);root.on('tools/pre-execute',()=>({kind:'ask'}));let calls=0;root.tools.register(definition(async()=>++calls));
  for(const clientCapabilities of [{},{elicitation:{url:{}}}]){const agent=createBridgeAgent({root,requestId:1,clientCapabilities});const result=await root.tools.execute({name:'approval_probe',callId:'x',agent,arguments:{},signal:new AbortController().signal});assert.equal(result.isError,true);assert.match(result.content[0].text,/no approval channel/);}
  assert.equal(called,false);assert.equal(calls,0);assert.equal(await createApprovalService().service.request({agent:createBridgeAgent({clientCapabilities:{elicitation:{}}})}),'unavailable');
});
test('v040 approval cancellation and dispose unblock an inquiry even when transport ignores cancellation',async()=>{
  let enteredResolve;const entered=new Promise(r=>enteredResolve=r);const runtime=createApprovalService({requestHost:async()=>{enteredResolve();return new Promise(()=>{});}});const agent=createBridgeAgent({requestId:1,clientCapabilities:{elicitation:{}}});const controller=new AbortController();const promise=runtime.service.request({agent,signal:controller.signal});await entered;controller.abort();assert.equal(await promise,'cancelled');const other=runtime.service.request({agent});await Promise.resolve();await runtime.dispose();assert.equal(await other,'cancelled');assert.equal(await runtime.service.request({agent}),'unavailable');
});
test('v040 approval reports old Codex as disabled and bridge identity refuses native lifecycle',async()=>{
  assert.equal(descriptor.id,'approval');const disabled=await install({capabilities:{codexVersion:'0.159.0'}});assert.equal(disabled.diagnostics[0].status,'disabled');assert.throws(()=>disabled.services.approval.request(),{code:'DSH_MODULE_UNSUPPORTED'});
  const agent=createBridgeAgent({callId:'synthetic'});assert.equal(agent.projection.nativeDshAgent,false);assert.throws(()=>agent.send('no model'),/approval.bridgeAgent.send/);assert.throws(()=>agent.session.append('anything'),/approval.bridgeAgent.session.append/);
  const enabled=await install({capabilities:{codexVersion:'0.160.0',elicitation:false}});assert.equal(await enabled.services.approval.request({agent}),'unavailable');await enabled.dispose();
});
