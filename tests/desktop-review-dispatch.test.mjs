import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createDesktopConversation,desktopConversationContext} from '../lib/codex-desktop-conversation.mjs';
import {createCCMarketAdapter} from '../lib/cc-market-adapter.mjs';

test('desktop caller identity comes from executor metadata or inherited host context',()=>{
 assert.equal(desktopConversationContext({},{}),null);
 assert.deepEqual(desktopConversationContext({'x-codex-turn-metadata':'{"thread_id":"actual"}'},{CODEX_APP_TOOLS_PIPE_PATH:'local-pipe',CODEX_THREAD_ID:'fallback'}),{threadId:'actual',pipePath:'local-pipe'});
});

test('button submission uses bundled desktop dispatcher and the same thread, without model overrides',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'desktop-market-dispatch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'1'),{recursive:true});await fs.writeFile(path.join(root,'1/server.mjs'),'');
 const calls=[];let closed=0;
 const channel=createDesktopConversation({context:{threadId:'actual-main',pipePath:'local-pipe'},builtinRoot:root,env:{},clientFactory:()=>({async start(){},async listTools(){return [{name:'send_message_to_thread'}];},async request(method,params){calls.push({method,params});return {content:[],isError:false};},async close(){closed++;}})});
 const result=await channel.sendReview({reviewId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'});
 assert.equal(result.submitted,true);assert.equal(calls[0].params.name,'read_thread');
 const sent=calls[1].params;assert.equal(sent.name,'send_message_to_thread');assert.equal(sent.arguments.threadId,'actual-main');assert.equal(sent._meta['openai/threadId'],'actual-main');
 assert.match(sent.arguments.prompt,/請審查.*DSH 插件市場/);assert.ok(sent.arguments.prompt.length<60);
 assert.doesNotMatch(sent.arguments.prompt,/get_dsh_market_reviews|complete_dsh_market_review|aaaaaaaa-bbbb|sourceDigest|reviewId/);
 assert.equal(sent.arguments.model,undefined);assert.equal(sent.arguments.thinking,undefined);assert.equal(sent._meta['openai/toolCallId'],undefined);
 await assert.rejects(channel.sendReview({reviewId:'arbitrary source instructions'}),/識別碼/);
 await channel.close();assert.equal(closed,1);
 const absent=createDesktopConversation({context:null});assert.equal((await absent.probe()).available,false);
});

test('market review only reports submission after desktop acknowledgement and keeps source execution disabled',async()=>{
 for(const success of [true,false]){
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',sent=[];
  const adapter=createCCMarketAdapter({dataRoot:'.',fetchText:async url=>url.endsWith('catalog.json')?JSON.stringify({items:[]}):JSON.stringify({format:1,plugins:[{name:'dispatch-probe',title:'Probe',versions:[{version:'1.0.0',source:{type:'npm'}}]}]}),operations:{review:async()=>({path:'/synthetic/source',reviewId:id,sourceReview:{sourceDigest:'fixed',summary:'fixed scan'},scan:{findings:[]}})},dispatchReview:async request=>{sent.push(request);if(!success)throw Error('desktop not connected');return {submitted:true,transport:'bundled-codex-app-tools'};}});
  await adapter.handle('GET','/catalog',new URLSearchParams());
  const job=await adapter.handle('POST','/jobs',new URLSearchParams(),{action:'review',name:'dispatch-probe',version:'1.0.0'});await adapter.close();
  const result=adapter.jobs.get(job.id);assert.equal(result.phase,'done');assert.deepEqual(sent,[{reviewId:id}]);
  assert.equal(result.handoff.status,success?'submitted-to-main-conversation':'awaiting-main-conversation');
  if(!success)assert.match(result.handoff.deliveryError,/desktop not connected/);
 }
});
