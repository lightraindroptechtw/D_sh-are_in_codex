import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAgentService} from '../lib/modules/agents.mjs';
import {install as installLlm} from '../lib/modules/llm.mjs';
import {parseDshTaskArguments,readDshTaskOverlays,createCodexTaskBroker,createRemoteAgentService} from '../lib/dsh-codex-task.mjs';
import {createMcpTaskResolver} from '../lib/codex-task-mcp.mjs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createPluginSecurity} from '../lib/plugin-security.mjs';

function transport(){
  const calls=[],listeners=new Set(),requests=new Set();let threads=0,turns=0;
  return {calls,request:async(method,params)=>{
    calls.push({method,params});
    if(method==='model/list')return {data:[{model:'gpt-6.1-sol',isDefault:true}]};
    if(method==='thread/start')return {thread:{id:`thread-${++threads}`},model:params.model,modelProvider:'openai'};
    if(method==='turn/start'){
      const id=`turn-${++turns}`;setImmediate(()=>{
        for(const fn of listeners)fn({method:'item/completed',params:{threadId:params.threadId,turnId:id,item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'synthetic answer'}}});
        for(const fn of listeners)fn({method:'turn/completed',params:{threadId:params.threadId,turn:{id,status:'completed'}}});
      });return {turn:{id}};
    }
    return {};
  },onNotification(fn){listeners.add(fn);return ()=>listeners.delete(fn);},onRequest(fn){requests.add(fn);return ()=>requests.delete(fn);},async tool(params){for(const fn of requests){const result=await fn({method:'item/tool/call',params});if(result!==undefined)return result;}},onClose(){return ()=>{};}};
}

test('headless task arguments reject install commands and unknown flags',()=>{
  assert.deepEqual(parseDshTaskArguments(['--profile','headless','--patch','overlay.yml','synthetic task']),{profile:'headless',patches:['overlay.yml'],prompt:'synthetic task'});
  for(const argv of [[],['plugin','add','bad'],['--allow-all','task'],['--profile'],['--profile','headless','--profile','web','task']])assert.throws(()=>parseDshTaskArguments(argv));
});

test('overlay projection accepts data-only MCP/model declarations and confines real paths',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'codex-task-test-'));
  try{
    const file=path.join(dir,'overlay.yml');await fs.writeFile(file,JSON.stringify([{id:'credentials',disabled:false},{id:'agent-default-model',config:{provider:'deepseek',model:'buddy'}},{insert:[{id:'mcp-example',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'example',transport:'stdio',command:'python',args:['server.py'],env:{TOOLS:'read'}}}]}]));
    const parsed=await readDshTaskOverlays(parseDshTaskArguments(['--patch',file,'task']),{stateRoots:[dir],cwd:dir});
    assert.equal(parsed.modelSelection.model,'buddy');assert.deepEqual(parsed.ignoredServices,['credentials']);assert.equal(parsed.mcpServers[0].serverName,'example');
    await assert.rejects(readDshTaskOverlays(parseDshTaskArguments(['--patch',file,'task']),{stateRoots:[],cwd:dir}),/outside/);
    await fs.writeFile(file,'- id: unknown\n  disabled: false');await assert.rejects(readDshTaskOverlays(parseDshTaskArguments(['--patch',file,'task']),{stateRoots:[dir]}),/Unsupported/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('broker uses available Codex default, projects explicit DSH mapping and runs owned task',async()=>{
  const control=transport(),broker=await createCodexTaskBroker({control,options:{allowModelCalls:true,mapUnrecognizedModelsToDefault:true}});
  try{
    const result=await broker.run({prompt:'synthetic task',agentOptions:{provider:'deepseek-account',model:'buddy'}});
    assert.equal(result.text,'synthetic answer');assert.equal(result.model,'gpt-6.1-sol');
    assert.equal(control.calls.find(c=>c.method==='thread/start').params.model,'gpt-6.1-sol');
    await assert.rejects(broker.dispatch('codex.agent.wait',{id:'other-thread'}),{code:'CODEX_CONTROL_SCOPE'});
  }finally{await broker.close();}
});

test('dynamic tool call is routed only to the active owned thread and validates schema',async()=>{
  const control=transport(),runtime=createAgentService({control,options:{allowModelCalls:true}});let executions=0;
  const handle=await runtime.service.create({tools:[{name:'echo',description:'synthetic',inputSchema:{type:'object',properties:{n:{type:'integer'}},required:['n'],additionalProperties:false},execute(args){executions++;return {n:args.n};}}]});
  try{
    handle.agent.send('task');await Promise.resolve();await Promise.resolve();
    const base={threadId:handle.agent.codexThreadId,turnId:'turn-1',callId:'call-1',tool:'echo'};
    assert.equal((await control.tool({...base,arguments:{n:'bad'}})).success,false);
    assert.equal((await control.tool({...base,arguments:{n:7}})).success,true);
    assert.equal(executions,1);assert.equal(await control.tool({...base,threadId:'other',arguments:{n:7}}),undefined);
    await handle.agent.whenIdle();assert.equal((await control.tool({...base,arguments:{n:7}})).success,false);
  }finally{await runtime.dispose();}
});

test('source agent proxy carries only data through trusted host RPC',async()=>{
  const control=transport(),broker=await createCodexTaskBroker({control,options:{allowModelCalls:true}}),methods=[];
  const remote=createRemoteAgentService({options:{allowModelCalls:true},requestHost:(method,params)=>{methods.push(method);return broker.dispatch(method,params);}});
  try{
    const {agent}=await remote.service.create({sessionId:'source-agent'});assert.equal(agent.send('synthetic task'),undefined);await agent.whenIdle();
    assert.equal(agent.session.snapshotEvents().find(e=>e.type==='assistant/message').data.message.content[0].text,'synthetic answer');
    assert.deepEqual(methods,['codex.agent.create','codex.agent.send','codex.agent.wait']);
  }finally{await remote.dispose();await broker.close();}
});

test('LLM broker path returns DSH completed-text chunks without API credentials',async()=>{
  const calls=[],installed=await installLlm({capabilities:{codexVersion:'0.160.0'},options:{backend:'codex-broker',allowModelCalls:true},requestHost:async(method,params)=>{calls.push({method,params});return {text:'synthetic text'};}});
  const chunks=[];for await(const chunk of installed.services.llm.stream({provider:'codex',messages:[{role:'user',content:[{type:'text',text:'question'}]}]}))chunks.push(chunk);
  assert.equal(chunks.at(-1).reason.kind,'stop');assert.equal(chunks[1].text,'synthetic text');assert.deepEqual(calls[0].params.toolNames,[]);
  assert.throws(()=>installed.services.llm.stream({messages:[],tools:[{name:'tool'}]}),/agents interface/);
});

test('model and agent settings are independent and the text model channel cannot attach source tools',async()=>{
  const control=transport(),settings={allowModelCalls:true,allowAgents:false},notices=[];
  const security={async load(){return {settings};},async notify(notice){notices.push(notice);}};
  const broker=await createCodexTaskBroker({control,options:{allowModelCalls:true,allowAgents:false,security}});
  try{
    assert.equal((await broker.dispatch('codex.task',{prompt:'synthetic model input'})).text,'synthetic answer');
    assert.deepEqual(notices.map(row=>row.kind),['model-call']);
    await assert.rejects(broker.dispatch('codex.agent.create',{}),{code:'DSH_MODEL_CALLS_DISABLED'});
    await assert.rejects(broker.dispatch('codex.task',{prompt:'input',toolNames:['source_tool']}),/只接受文字/);
    settings.allowModelCalls=false;settings.allowAgents=true;
    const previousTurns=control.calls.filter(row=>row.method==='turn/start').length;
    await assert.rejects(broker.dispatch('codex.task',{prompt:'input'}),{code:'DSH_MODEL_CALLS_DISABLED'});
    await assert.rejects(broker.dispatch('codex.agent.create',{}),{code:'DSH_MODEL_CALLS_DISABLED'});
    assert.equal(control.calls.filter(row=>row.method==='turn/start').length,previousTurns);
  }finally{await broker.close();}
});

test('MCP resolver refuses changed source command and tools before any subprocess',async()=>{
  let launches=0;
  const spec={serverName:'example',transport:'stdio',command:'python',args:['reviewed.py'],env:{TOOLS:'read'},allowedTools:['read']};
  const resolve=createMcpTaskResolver({approvedServers:[spec],spawnServer(){launches++;throw Error('must not launch');}});
  await assert.rejects(resolve([{...spec,args:['other.py']}]),{code:'DSH_TASK_MCP_POLICY'});assert.equal(launches,0);await resolve.close();
});

test('unmapped temporary MCP overlays notify and continue without guessing a Python launch',async()=>{
 const control=transport(),notices=[],broker=await createCodexTaskBroker({control,workspace:os.tmpdir(),executionPolicy:{allowModelCalls:true},options:{security:{load:async()=>({settings:{allowModelCalls:true,allowAgents:true}}),notify:async notice=>notices.push(notice)}}});
 try{
  const result=await broker.run({prompt:'synthetic only',overlay:{mcpServers:[{serverName:'arbitrary-name',transport:'stdio',command:'python',args:['private-state/copied.py'],env:{UNRELATED:'value'}}]}});
  assert.equal(result.text,'synthetic answer');assert.equal(result.warnings[0].code,'DSH_TASK_MCP_NOT_ATTACHED');
  assert.match(result.warnings[0].what,/arbitrary-name/);assert.ok(notices.some(notice=>notice.code==='DSH_TASK_MCP_NOT_ATTACHED'));
  const start=control.calls.find(row=>row.method==='thread/start');assert.ok(start);
  assert.match(JSON.stringify(start.params),/只有這些服務提供的工具無法使用/);
  assert.doesNotMatch(JSON.stringify(control.calls),/private-state\/copied.py|UNRELATED/);
 }finally{await broker.close();}
});
test('task endpoint limits cwd, overlays and concurrent work, returns finished text',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'codex-task-http-')),control=transport(),broker=await createCodexTaskBroker({control,workspace:dir,executionPolicy:{allowModelCalls:true,stateRoots:[dir]}});
  try{
    const server=await broker.startServer();const response=await fetch(server.endpoint,{method:'POST',body:JSON.stringify({cwd:dir,argv:['--profile','headless','synthetic task']})});
    assert.equal(response.status,200);assert.equal((await response.json()).text,'synthetic answer');
    const wrong=await fetch(server.endpoint,{method:'POST',body:JSON.stringify({cwd:path.dirname(dir),argv:['task']})});assert.equal(wrong.status,400);
  }finally{await broker.close();await fs.rm(dir,{recursive:true,force:true});}
});
