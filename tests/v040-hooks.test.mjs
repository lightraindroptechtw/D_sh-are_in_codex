import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {evaluateNativeToolHook} from '../lib/native-tool-hooks.mjs';
import {startHookBroker,runNativeHook,queryBroker} from '../lib/hook-broker.mjs';
import {CODEX_HOOK_EVENTS,hookManifest,recordCodexHook} from '../lib/codex-events.mjs';

test('native hooks map pre deny/ask, post block and refuse output replacement',async()=>{
  let gate={kind:'deny',reason:'blocked'},post={kind:'accept'},observed=0;
  const ctx={tools:{},waterfall:async(_carrier,event)=>event==='tools/pre-execute'?gate:post,parallel:async()=>{observed++;}};
  const evaluate=input=>evaluateNativeToolHook({ctx,input,options:{nativeToolHooks:true},scopeTarget:s=>s});
  const input={hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'synthetic'}};
  assert.equal((await evaluate(input)).hookSpecificOutput.permissionDecision,'deny');
  assert.deepEqual(await evaluateNativeToolHook({ctx,input,scopeTarget:s=>s}),{});
  gate={kind:'ask'};assert.equal((await evaluate(input)).hookSpecificOutput.permissionDecision,'deny');
  gate={kind:'allow'};assert.deepEqual(await evaluate(input),{});
  post={kind:'block',feedback:[{type:'text',text:'review'}]};assert.deepEqual(await evaluate({...input,hook_event_name:'PostToolUse'}),{decision:'block',reason:'review'});
  post={kind:'accept',value:{x:1}};assert.equal((await evaluate({...input,hook_event_name:'PostToolUse'})).decision,'block');assert.equal(observed,2);
});
test('authenticated loopback hook broker and unavailable fail closed',async t=>{
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'v040-broker-'));t.after(()=>fs.rm(stateDir,{recursive:true,force:true}));
  const broker=await startHookBroker({stateDir,evaluate:async()=>({decision:'block',reason:'fixture'})});t.after(()=>broker.close());
  assert.equal((await queryBroker(stateDir,'status',{})).running,true);
  assert.equal((await runNativeHook({stateDir,input:{hook_event_name:'PostToolUse'},enabled:true})).decision,'block');
  assert.equal((await fetch(broker.endpoint.origin+'/hook',{method:'POST',body:'{}'})).status,403);
  await assert.rejects(startHookBroker({stateDir,evaluate:async()=>({})}),/already/);
  assert.equal((await runNativeHook({stateDir:path.join(stateDir,'absent'),input:{hook_event_name:'PreToolUse'},enabled:true})).hookSpecificOutput.permissionDecision,'deny');
});
test('eleven events audited; ten supported hooks generated without raw argument storage',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'v040-events-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  assert.equal(CODEX_HOOK_EVENTS.length,11);assert.equal(Object.keys(hookManifest('fixture').hooks).length,10);assert.equal(hookManifest('fixture').hooks.Notification,undefined);assert.equal(hookManifest('node fixture').hooks.Interrupt[0].hooks[0].timeout,3);
  await recordCodexHook({dataDir,input:{hook_event_name:'PreToolUse',session_id:'fixture',tool_input:{secret:'DO_NOT_PERSIST'}}});
  const files=await fs.readdir(path.join(dataDir,'codex-events'));assert.doesNotMatch(await fs.readFile(path.join(dataDir,'codex-events',files[0]),'utf8'),/DO_NOT_PERSIST/);
});
