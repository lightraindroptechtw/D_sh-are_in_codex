import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from '../lib/modules/llm.mjs';
import {createAgentService} from '../lib/modules/agents.mjs';
import {codexModelRoute} from '../lib/model-routing.mjs';

test('Claude aliases use configured Codex model without changing explicit Codex models',()=>{
 for(const model of ['haiku','sonnet','opus','claude-sonnet-4-6','claude-opus-4-6'])assert.equal(codexModelRoute({provider:'claude-code',model}).model,'gpt-6.1-sol');
 assert.equal(codexModelRoute({provider:'codex',model:'gpt-6-luna'}).model,'gpt-6-luna');
 assert.equal(codexModelRoute({provider:'deepseek',model:'deepseek-chat'}).model,'gpt-6.1-sol');
 assert.equal(codexModelRoute({provider:'anthropic',model:'sonnet',modelMap:{'anthropic/sonnet':'chosen-model'}}).model,'chosen-model');
});

test('CC compatible complete accepts text and reports unsupported sampling controls without rejecting call',async()=>{
 const calls=[],installed=await install({capabilities:{codexVersion:'0.160.0'},requestHost:async(method,input)=>{calls.push({method,input});return {text:'合成回答'};}});
 const result=await installed.services.llm.complete({provider:'claude-code',model:'sonnet',temperature:0,maxTokens:20,messages:[{role:'user',content:'問題'}]});
 assert.equal(result.text,'合成回答');assert.deepEqual(calls[0].input.agentOptions,{provider:'codex',model:'gpt-6.1-sol',reasoningEffort:'medium'});assert.deepEqual(result.ignoredParameters.sort(),['maxTokens','temperature']);assert.deepEqual(installed.services.llm.listProviders(),['codex']);
 const controller=new AbortController();controller.abort();await assert.rejects(installed.services.llm.complete({signal:controller.signal}),{code:'ABORT_ERR'});assert.equal(calls.length,1);
});

test('model enumeration uses host catalog and creates no model task',async()=>{
 const calls=[],installed=await install({capabilities:{codexVersion:'0.160.0'},requestHost:async method=>{calls.push(method);return {data:[{id:'native-id',model:'gpt-6.1-sol',displayName:'Sol',inputModalities:['text']}]};}});
 const models=await installed.services.llm.listModels('codex');assert.equal(models[0].id,'gpt-6.1-sol');assert.deepEqual(calls,['codex.models']);assert.equal((await installed.services.llm.resolveModelInfo('claude-code','sonnet')).model,'gpt-6.1-sol');
});

test('agent creation maps Claude alias and uses medium while preserving explicit model options',async()=>{
 const calls=[],control={async request(method,params){calls.push({method,params});if(method==='model/list')return {data:[{model:'gpt-6.1-sol'}]};if(method==='thread/start')return {thread:{id:'synthetic'},model:params.model,modelProvider:'openai'};return {};},onNotification:()=>()=>{},onClose:()=>()=>{}};
 const runtime=createAgentService({control});try{await runtime.service.create({agentOptions:{provider:'claude-code',model:'opus',maxTokens:20}});const started=calls.find(row=>row.method==='thread/start');assert.equal(started.params.model,'gpt-6.1-sol');assert.equal(calls.some(row=>row.method==='turn/start'),false);}finally{await runtime.dispose();}
});
