import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectJs,inspectSource} from '../lib/inspect.mjs';
import {isPureNativeUi,modelBehaviors} from '../lib/converter.mjs';

test('static inspection identifies provider, model, tool and agent hooks with source lines',()=>{
 const source=[
  `export function apply(ctx) {`,
  `ctx.web.registerSearchProvider({});`,
  `ctx.web.registerFetchProvider({});`,
  `ctx.llm.registerAdapter({});`,
  `ctx.llm.registerProvider({});`,
  `ctx.on('llm/stream', () => {});`,
  `ctx.once('tools/pre-execute', () => {});`,
  `ctx.serial('tools/post-execute', () => {});`,
  `ctx.parallel('tools/result', () => {});`,
  `ctx.bail('agent/pre-step', () => {});`,
  `ctx.waterfall('prompt/before', () => {});`,
  `ctx.llm.resolveModelInfo = () => ({});`,
  `patch(ctx.llm, 'streamWithRegistration', () => {});`,
  `ctx.llm.adapterStream = () => ({});`,
  `ctx.systemPrompt.section('notice', 'Read the source');`,
  `}`,
 ].join('\n');
 const result=inspectJs(source);
 assert.deepEqual(result.behaviors.map(item=>[item.kind,item.name,item.line]),[
  ['web-provider','registerSearchProvider',2],['web-provider','registerFetchProvider',3],
  ['llm-provider','registerAdapter',4],['llm-provider','registerProvider',5],
  ['llm-hook','llm/stream',6],['tool-hook','tools/pre-execute',7],['tool-hook','tools/post-execute',8],
  ['tool-hook','tools/result',9],['agent-hook','agent/pre-step',10],['agent-hook','prompt/before',11],
  ['llm-hook','resolveModelInfo',12],['llm-hook','streamWithRegistration',13],['llm-hook','adapterStream',14],
  ['prompt-section','systemPrompt.section',15],
 ]);
 const plan={host:{client:true,behaviors:result.behaviors}};
 assert.equal(isPureNativeUi(plan),false);assert.equal(modelBehaviors(plan).length,13);
 assert.equal(plan.host.behaviors.length,14);
});

test('chat events remain separate evidence and unrelated names do not imply model hooks',()=>{
 const source=[
  `ctx.on('session/event', () => {});`,
  `ctx.once('agent/created', () => {});`,
  `ctx.serial('agent/disposed', () => {});`,
  `ctx.parallel('agent/status', () => {});`,
  `agent.followup({});`,
  `ctx.on('ui/changed', () => {});`,
  `ctx.on(dynamicName, () => {});`,
  `ctx.on('agent/ready', () => {});`,
  `const label = 'adapterStream';`,
  `const example = 'ctx.on("llm/stream", callback)';`,
  `// ctx.on('tools/result', () => {});`,
  `ctx.mysystem.section('notice');`,
 ].join('\n');
 const result=inspectJs(source);
 assert.deepEqual(result.chatEvents.map(item=>[item.name,item.line]),[
  ['session/event',1],['agent/created',2],['agent/disposed',3],['agent/status',4],['agent.followup',5],
 ]);
 assert.deepEqual(result.behaviors,[]);
 assert.equal(isPureNativeUi({host:{client:true,chatEvents:result.chatEvents,behaviors:[]}}),true);
});

test('pure native UI classification preserves upstream capability and prompt-only boundaries',()=>{
 assert.equal(isPureNativeUi({}),false);
 assert.equal(isPureNativeUi({host:{client:false}}),false);
 assert.equal(isPureNativeUi({issues:[{code:'NATIVE_UI'}]}),true);
 const ui={host:{client:true,services:['webServer','timer'],behaviors:[{kind:'prompt-section',name:'systemPrompt.section'}]}};
 assert.equal(isPureNativeUi(ui),true);assert.deepEqual(modelBehaviors(ui),[]);
 for(const capabilities of [
  {toolRuntime:{registrations:1}},
  {skills:[{name:'skill'}]},
  {commands:{definitions:[{name:'command'}]}},
  {commands:{dynamicRegistrations:[{line:1}]}},
  {mcpServers:{remote:{url:'https://example.invalid'}}},
  {pythonServers:[{path:'server.py'}]},
 ])assert.equal(isPureNativeUi({...ui,capabilities}),false,JSON.stringify(capabilities));
 for(const kind of ['web-provider','llm-provider','llm-hook','tool-hook','agent-hook'])
  assert.equal(isPureNativeUi({host:{client:true,behaviors:[{kind}]}}),false,kind);
});

test('source-level behavior evidence follows reachable runtime imports without executing source',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ui-classification-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const files={
  'package.json':JSON.stringify({name:'classification-fixture',main:'index.ts',dsh:{client:true}}),
  'index.ts':`import './active.js'; import type {Unused} from './unused.js';\nimport fs from 'node:fs'; fs.writeFileSync(new URL('./SOURCE_EXECUTED',import.meta.url),'never');\nthrow new Error('SOURCE MUST NOT EXECUTE');`,
  'active.ts':`export function apply(ctx) {\n ctx.on('tools/result', () => {});\n ctx.on('session/event', () => {});\n}`,
  'unused.ts':`export type Unused = {};\nctx.on('llm/unused', () => {});\nctx.on('agent/status', () => {});`,
 };
 for(const [name,text] of Object.entries(files))await fs.writeFile(path.join(root,name),text);
 const report=await inspectSource({root,origin:'local-classification-fixture'});
 assert.deepEqual(report.host.behaviors,[{path:'active.ts',kind:'tool-hook',name:'tools/result',line:2}]);
 assert.deepEqual(report.host.chatEvents,[{path:'active.ts',name:'session/event',line:3}]);
 assert.equal(isPureNativeUi(report),false);
 await assert.rejects(fs.access(path.join(root,'SOURCE_EXECUTED')),error=>error.code==='ENOENT');
 await fs.writeFile(path.join(root,'index.ts'),`import type {Unused} from './unused.js'; export function apply(ctx) { ctx.webServer.route('/ui'); }`);
 const pure=await inspectSource({root,origin:'local-classification-fixture'});
 assert.deepEqual(pure.host.behaviors,[]);assert.deepEqual(pure.host.chatEvents,[]);assert.equal(isPureNativeUi(pure),true);
});
