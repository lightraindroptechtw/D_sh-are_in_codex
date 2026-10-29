import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recordCodexHook,readCodexEvents,createCodexActivity,hookManifest} from '../lib/codex-events.mjs';
async function root(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'codex hook bridge '));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('concurrent hook records keep lifecycle metadata and never store conversation contents',async t=>{
  const dataDir=await root(t);await fs.writeFile(path.join(dataDir,'runtime-context.json'),JSON.stringify({text:'Original plugin instructions'}));
  const results=await Promise.all(Array.from({length:12},(_,i)=>recordCodexHook({dataDir,input:{hook_event_name:'UserPromptSubmit',session_id:'session-'+i,turn_id:'turn',cwd:'C:/workspace',prompt:'PRIVATE PROMPT',transcript_path:'PRIVATE PATH',tool_input:{secret:'PRIVATE ARGUMENT'}},now:1000+i})));
  const events=await readCodexEvents(dataDir);assert.equal(events.length,12);assert.ok(!JSON.stringify(events).includes('PRIVATE'));assert.equal(results[0].output.hookSpecificOutput.additionalContext,'Original plugin instructions');
  const projection=createCodexActivity();for(const event of events)projection.apply(event);assert.equal(projection.list().filter(a=>a.status==='running').length,12);assert.equal(projection.describe().backgroundJobsObserved,false);
});
test('activity projection handles parent/subagent completion, interruption, duplicate and old events',()=>{
  const activity=createCodexActivity();const event=(id,event,time,extra={})=>({id,event,time,sessionId:'main',...extra});
  activity.apply(event('1','SessionStart',1));activity.apply(event('2','UserPromptSubmit',2));activity.apply(event('3','SubagentStart',3,{agentId:'child'}));assert.equal(activity.list().filter(a=>a.status==='running').length,2);
  activity.apply(event('4','Stop',4));assert.equal(activity.list().filter(a=>a.status==='running').length,1);assert.equal(activity.apply(event('4','Stop',4)),false);
  activity.apply(event('5','SubagentStop',5,{agentId:'child'}));assert.equal(activity.list().filter(a=>a.status==='running').length,0);activity.apply(event('6','UserPromptSubmit',6));activity.apply(event('7','Interrupt',7));activity.apply(event('old','UserPromptSubmit',3));assert.equal(activity.list().find(a=>a.id==='main').status,'idle');activity.apply(event('8','SessionEnd',8));assert.equal(activity.list().length,0);
});
test('hook manifest includes native tool observations and never grants permission',async t=>{
  const dataDir=await root(t);await assert.rejects(recordCodexHook({dataDir,input:{hook_event_name:'PermissionRequest',session_id:'s'}}));await assert.rejects(recordCodexHook({dataDir,input:{hook_event_name:'SubagentStart',session_id:'s'}}));
  const manifest=hookManifest('node example.mjs');assert.ok(!manifest.hooks.PermissionRequest);assert.ok(manifest.hooks.PreToolUse);const result=await recordCodexHook({dataDir,input:{hook_event_name:'Stop',session_id:'s'}});assert.deepEqual(result.output,{});
});

test('late lifecycle records cannot revive an ended session',()=>{
  const activity=createCodexActivity();activity.apply({id:'end',event:'SessionEnd',time:10,sessionId:'s'});
  assert.equal(activity.apply({id:'old-child',event:'SubagentStart',time:9,sessionId:'s',agentId:'child'}),false);assert.deepEqual(activity.list(),[]);
});
