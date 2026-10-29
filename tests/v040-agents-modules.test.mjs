import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {createAgentService,install as installAgents,descriptor as agentsDescriptor} from '../lib/modules/agents.mjs';
import {install as installSessions} from '../lib/modules/sessions.mjs';
import {install as installCredentials} from '../lib/modules/credentials.mjs';
import {install as installLlm,CODEX_LLM_REASON} from '../lib/modules/llm.mjs';
import {createCodexControl,moduleUnavailable,probeCodexVersion} from '../lib/codex-control.mjs';

const capabilities={codexVersion:'0.160.0',appServer:true};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function transport(extra={}){
  const calls=[],listeners=new Set(),closers=new Set();let turns=0;
  return {calls,async request(method,params){calls.push({method,params});
    if(extra[method])return extra[method](params);
    if(method==='model/list')return {data:[{id:'catalog-id',model:'gpt-6.1-sol'}]};
    if(method==='thread/start')return {thread:{id:'owned-thread'},model:params.model,modelProvider:'openai'};
    if(method==='thread/resume')return {thread:{id:params.threadId},model:params.model,modelProvider:'openai'};
    if(method==='turn/start')return {turn:{id:`turn-${++turns}`}};
    if(method==='turn/interrupt')queueMicrotask(()=>{for(const fn of listeners)fn({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});});
    return {};
  },onNotification(fn){listeners.add(fn);return ()=>listeners.delete(fn);},onClose(fn){closers.add(fn);return ()=>closers.delete(fn);},notify(method,params){for(const fn of listeners)fn({method,params});},close(){for(const fn of closers)fn();}};
}
const options={allowModelCalls:true,model:'gpt-6.1-sol'};

test('agents explicit model setting denies creation and submission before transport I/O',async()=>{
  const control=transport(),runtime=createAgentService({control,options:{allowModelCalls:false}});
  await assert.rejects(runtime.service.create({sessionId:'a'}),{module:'agents',method:'create',code:'DSH_MODEL_CALLS_DISABLED'});
  assert.equal(control.calls.length,0);assert.deepEqual(runtime.service.list(),[]);
  assert.throws(()=>runtime.service.setFactory(),{module:'agents',method:'setFactory'});
  await runtime.dispose();
});

test('module version and missing app-server capability disable only agents',async()=>{
  assert.match(moduleUnavailable(agentsDescriptor,{codexVersion:'0.159.0',appServer:true}),/Requires Codex/);
  const disabled=await installAgents({options,capabilities:{codexVersion:'0.160.0',appServer:false}});
  assert.equal(disabled.diagnostics[0].status,'disabled');assert.throws(()=>disabled.services.agents.create(),/capability is unavailable/);
  const credentials=await installCredentials({capabilities,options:{envMapping:{KEY:'SYNTHETIC_KEY'},environment:{SYNTHETIC_KEY:'test'}}});
  assert.equal((await credentials.services.credentials.describe('KEY')).configured,true);
});

test('source provider requests map to Codex while unavailable explicit Codex models remain unavailable',async()=>{
  const control=transport(),runtime=createAgentService({control,options});
  await runtime.service.create({agentOptions:{provider:'deepseek',model:'deepseek-chat'}});
  assert.equal(control.calls.find(c=>c.method==='thread/start').params.model,'gpt-6.1-sol');
  await assert.rejects(runtime.service.create({agentOptions:{model:'unavailable-model'}}),/not in Codex model\/list/);
  assert.equal(control.calls.filter(c=>c.method==='thread/start').length,1);await runtime.dispose();
});

test('agents rejects server model/provider substitution before submitting a model turn',async()=>{
  const control=transport({'thread/start':()=>({thread:{id:'owned-thread'},model:'different-model',modelProvider:'openai'})}),runtime=createAgentService({control,options});
  await assert.rejects(runtime.service.create({sessionId:'no-fallback'}),/different model\/provider/);
  assert.equal(control.calls.some(c=>c.method==='turn/start'),false);await runtime.dispose();
});

test('setup projects static prompt and detects unsupported operations even if callback catches them',async()=>{
  const control=transport(),diagnostics=[],runtime=createAgentService({control,options,diagnostics});
  await assert.rejects(runtime.service.create({sessionId:'bad',setup(ctx){try{ctx.get('tools');}catch{}}}),{module:'agents',method:'setup'});
  await assert.rejects(runtime.service.create({sessionId:'bad2',setup(ctx){try{ctx.systemPrompt.variable('x',()=>1);}catch{}}}),{module:'agents',method:'setup'});
  assert.equal(control.calls.filter(c=>c.method==='thread/start').length,0);
  const handle=await runtime.service.create({sessionId:'good',setup(ctx){ctx.systemPrompt.section({name:'instruction',order:10,text:'Synthetic instruction',interpolate:false});}});
  assert.equal(control.calls.find(c=>c.method==='thread/start').params.developerInstructions,'Synthetic instruction');
  assert.ok(diagnostics.some(d=>d.code==='SETUP_PROMPT_PROJECTION'));await handle.dispose();await runtime.dispose();
});

test('send preserves void submission, correlates final events, and whenIdle waits for completion',async()=>{
  const control=transport(),published=[],runtime=createAgentService({control,options,emit:(...args)=>published.push(args)});
  const handle=await runtime.service.create({sessionId:'dsh-id'}),agent=handle.agent;
  assert.equal(agent.id,'dsh-id');assert.equal(agent.codexThreadId,'owned-thread');
  assert.equal(agent.send({content:[{type:'text',text:'Synthetic input'}]},'next-turn',true),undefined);
  assert.equal(agent.status,'running');await tick();
  control.notify('turn/completed',{threadId:'another-thread',turn:{id:'turn-1',status:'completed'}});
  assert.equal(agent.status,'running');
  control.notify('item/completed',{threadId:'owned-thread',turnId:'other-turn',item:{id:'x',type:'agentMessage',phase:'final_answer',text:'Wrong turn'}});
  control.notify('item/completed',{threadId:'owned-thread',turnId:'turn-1',item:{id:'y',type:'agentMessage',phase:'commentary',text:'Progress only'}});
  control.notify('item/completed',{threadId:'owned-thread',turnId:'turn-1',item:{id:'z',type:'agentMessage',phase:'final_answer',text:'Synthetic answer'}});
  control.notify('turn/completed',{threadId:'owned-thread',turn:{id:'turn-1',status:'completed'}});
  await agent.whenIdle();assert.equal(agent.status,'idle');
  assert.deepEqual(agent.session.snapshotEvents().filter(e=>e.type==='assistant/message').map(e=>e.data.message.content[0].text),['Synthetic answer']);
  assert.ok(published.some(([name])=>name==='agent/created'));assert.ok(published.some(([name])=>name==='session/event'));
  assert.throws(()=>agent.inject({content:[]}),{module:'agents',method:'agent.inject'});
  assert.throws(()=>agent.session.append('custom/event',{}),{module:'agents',method:'session.append'});
  await handle.dispose();assert.equal(runtime.service.get('dsh-id'),undefined);await runtime.dispose();
});

test('active steering supplies expectedTurnId and cancel requests interruption',async()=>{
  const control=transport(),runtime=createAgentService({control,options});
  const {agent,dispose}=await runtime.service.create({sessionId:'steer'});
  agent.send('first');await tick();agent.send('steering','next-step',true);await tick();
  assert.deepEqual(control.calls.find(c=>c.method==='turn/steer').params,{threadId:'owned-thread',expectedTurnId:'turn-1',input:[{type:'text',text:'steering'}]});
  agent.cancel({kind:'user'});await tick();assert.deepEqual(control.calls.find(c=>c.method==='turn/interrupt').params,{threadId:'owned-thread',turnId:'turn-1'});
  control.notify('turn/completed',{threadId:'owned-thread',turn:{id:'turn-1',status:'interrupted'}});
  await assert.rejects(agent.whenIdle(),{code:'ABORT_ERR'});await dispose();await runtime.dispose();
});

test('disposing while turn/start is pending waits for acceptance and interrupts resulting turn',async()=>{
  let accept;const control=transport({'turn/start':()=>new Promise(resolve=>{accept=resolve;})}),runtime=createAgentService({control,options});
  const handle=await runtime.service.create({sessionId:'pending'});handle.agent.send('synthetic');
  const disposing=handle.dispose();await tick();assert.equal(control.calls.some(c=>c.method==='turn/interrupt'),false);
  accept({turn:{id:'late-turn'}});await disposing;
  assert.equal(control.calls.find(c=>c.method==='turn/interrupt').params.turnId,'late-turn');await runtime.dispose();
});

test('resume and sessions expose owned or explicitly allowed ids without thread/list',async()=>{
  const control=transport(),runtime=createAgentService({control,options:{...options,allowedThreadIds:['explicit-thread']}});
  await assert.rejects(runtime.service.resume({resumeSessionId:'someone-else'}),{code:'CODEX_CONTROL_SCOPE'});
  const handle=await runtime.service.resume({resumeSessionId:'explicit-thread'});
  const query={async readSession(id){if(id!=='explicit-thread')throw new Error('scope');return {projection:{replayValidated:false}};},async listSessions(){return ['explicit-thread'];}};
  const sessions=await installSessions({options:{agents:runtime.service},capabilities,sessionQuery:query});
  assert.equal(sessions.services.sessions.list()[0],handle.agent.session);assert.equal(sessions.services.sessions.get('someone-else'),undefined);
  assert.equal((await sessions.services.sessions.readSession('explicit-thread')).projection.replayValidated,false);
  await assert.rejects(sessions.services.sessions.readSession('someone-else'),/scope/);
  assert.throws(()=>sessions.services.sessions.fork(),{module:'sessions',method:'fork'});
  assert.equal(control.calls.some(c=>c.method==='thread/list'),false);await runtime.dispose();
});

test('never policy translates to Codex and appears in diagnostics',async()=>{
  const control=transport(),diagnostics=[],runtime=createAgentService({control,options,diagnostics});
  const handle=await runtime.service.create({sessionId:'approval'});handle.agent.session.append('approval/policy',{policy:'never'});
  handle.agent.send('synthetic');await tick();assert.equal(control.calls.find(c=>c.method==='turn/start').params.approvalPolicy,'never');
  assert.ok(diagnostics.some(d=>d.code==='APPROVAL_NEVER'));await handle.dispose();await runtime.dispose();
});

test('credentials rereads explicit environment mappings and never reports secret values',async()=>{
  const env={EXPLICIT_KEY:'synthetic-secret-one'},installed=await installCredentials({capabilities,options:{envMapping:{API_KEY:'EXPLICIT_KEY'},environment:env}}),credentials=installed.services.credentials;
  assert.deepEqual(await credentials.resolve('API_KEY'),{value:'synthetic-secret-one',source:'env'});
  env.EXPLICIT_KEY='synthetic-secret-two';assert.equal((await credentials.resolve('API_KEY')).value,'synthetic-secret-two');
  assert.deepEqual(await credentials.describe('API_KEY'),{configured:true,source:'env',writable:false});
  env.EXPLICIT_KEY='';assert.equal(await credentials.resolve('API_KEY'),undefined);
  await assert.rejects(credentials.resolve('UNMAPPED'),{module:'credentials',method:'resolve'});
  assert.throws(()=>credentials.readRecord('owner/key'),{module:'credentials',method:'readRecord'});
  assert.throws(()=>credentials.set('API_KEY','x'),{module:'credentials',method:'set'});
  assert.doesNotMatch(JSON.stringify(installed.diagnostics),/synthetic-secret/);
});

test('llm defaults fail closed, Codex backend explains missing no-tools contract',async()=>{
  const disabled=await installLlm({capabilities});assert.throws(()=>disabled.services.llm.stream({}),{module:'llm',method:'stream'});
  const codex=await installLlm({capabilities,options:{backend:'codex',allowModelCalls:true}});
  assert.equal(codex.diagnostics[0].reason,CODEX_LLM_REASON);assert.throws(()=>codex.services.llm.stream({}),/no general tool_choice/);
  const missing=await installLlm({capabilities:{codexVersion:'0.150.0'}});assert.equal(missing.diagnostics[0].status,'disabled');
});

test('API-key llm mounts official runtime with exact route and environment gates; no provider request',async()=>{
  const root=new Context(),environment={SYNTHETIC_API_KEY:'synthetic-secret'};
  const installed=await installLlm({root,capabilities,options:{backend:'api-key',allowModelCalls:true,allowedApiRoutes:[{provider:'test-provider',model:'exact-model',credentialEnv:'SYNTHETIC_API_KEY'}],environment}});
  const service=installed.services.llm;root.provide('llm',service);
  assert.deepEqual(service.listProviders(),[]);
  assert.throws(()=>service.stream({provider:'test-provider',model:'different-model',messages:[]}),{module:'llm',method:'stream'});
  assert.throws(()=>service.registerAdapter(['not-explicit'],{}),{module:'llm',method:'registerAdapter'});
  environment.SYNTHETIC_API_KEY='';assert.throws(()=>service.stream({provider:'test-provider',model:'exact-model',messages:[]}),/credential environment variable is empty/);
  assert.throws(()=>service.discoverModels(),{module:'llm',method:'discoverModels'});
  assert.throws(()=>service.unknownMethod(),{module:'llm',method:'unknownMethod'});
  assert.doesNotMatch(JSON.stringify(installed.diagnostics),/synthetic-secret/);await root.fiber.dispose();
});

test('official API runtime dispatches synthetic adapter chunks, prepared calls and cancellation without a network',async()=>{
  const root=new Context(),env={SYNTHETIC_KEY:'synthetic-value'};let dispatches=0;
  const installed=await installLlm({root,capabilities,options:{backend:'api-key',allowModelCalls:true,environment:env,allowedApiRoutes:[{provider:'synthetic',model:'exact',credentialEnv:'SYNTHETIC_KEY'}]}});
  const llm=installed.services.llm;root.provide('llm',llm);
  class SyntheticAdapter extends LlmAdapter{
    async listModels(){return [{id:'exact',name:'Exact',provider:'synthetic'},{id:'other',name:'Other',provider:'synthetic'}];}
    async *stream(request){dispatches++;request.signal?.throwIfAborted();yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'synthetic'};yield {type:'block-end',index:0,block:{type:'text',text:'synthetic'}};yield {type:'finish',reason:'stop'};}
  }
  const registration=llm.registerAdapter(['synthetic'],new SyntheticAdapter());
  assert.throws(()=>registration.replace(['another']),{module:'llm',method:'registerAdapter.replace'});
  assert.deepEqual((await llm.listModels('synthetic')).map(model=>model.id),['exact']);
  const input={provider:'synthetic',model:'exact',messages:[{role:'user',content:[{type:'text',text:'fixture'}]}]};
  const chunks=[];for await(const chunk of llm.stream(input))chunks.push(chunk);
  assert.equal(chunks.find(c=>c.type==='text-delta').text,'synthetic');
  const prepared=await llm.prepareCall({provider:'synthetic',model:'exact'});
  const second=[];for await(const chunk of prepared.stream(input))second.push(chunk);
  assert.equal(second.at(-1).type,'finish');assert.equal(dispatches,2);
  const abort=new AbortController();abort.abort();assert.throws(()=>llm.stream({...input,signal:abort.signal}),{module:'llm',code:'ABORT_ERR'});
  assert.throws(()=>llm.streamWithRegistration(input,{}),{module:'llm',method:'streamWithRegistration'});
  registration();await root.fiber.dispose();
});

test('all standalone services report missing Codex version as disabled',async()=>{
  for(const install of [installAgents,installSessions,installCredentials,installLlm]){
    const result=await install({capabilities:{}});assert.equal(result.diagnostics[0].status,'disabled');await result.dispose();
  }
});

test('control refuses unscoped and unsupported methods before launching Codex',async()=>{
  const control=await createCodexControl({allowModelCalls:false});
  try{
    await assert.rejects(control.request('thread/start'),{code:'DSH_MODEL_CALLS_DISABLED'});
    await assert.rejects(control.request('thread/list'),{module:'codex-control',method:'thread/list'});
    await assert.rejects(control.request('thread/read',{threadId:'not-allowed'}),{code:'CODEX_CONTROL_SCOPE'});
  }finally{await control.close();}
});

test('real Codex isolated home creates a thread without any model turn',{skip:process.env.CODEX_INTEGRATION!=='1',timeout:30000},async()=>{
  assert.ok(await probeCodexVersion());const control=await createCodexControl({allowModelCalls:true,timeoutMs:15000});
  try{
    const result=await control.request('thread/start',{model:'gpt-6.1-sol',ephemeral:true,approvalPolicy:'never',sandbox:'read-only',allowProviderModelFallback:false});
    assert.equal(typeof result.thread.id,'string');
    await assert.rejects(control.request('thread/read',{threadId:'another-thread'}),{code:'CODEX_CONTROL_SCOPE'});
  }finally{await control.close();}
});
