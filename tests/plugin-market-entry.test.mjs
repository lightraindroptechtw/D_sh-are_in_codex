import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openPluginMarket} from '../lib/plugin-market-entry.mjs';
import {createDesktopConversation} from '../lib/codex-desktop-conversation.mjs';

test('installed plugin entry opens the current Codex browser without a desktop shortcut or OS browser',async()=>{
 const url='http://127.0.0.1:1234/#access='+'a'.repeat(64),context={threadId:'current',pipePath:'pipe'},calls=[];
 const result=await openPluginMarket({conversationContext:context},{launch:async options=>{calls.push(options);return {url,version:'test'};},desktopFactory:options=>({async openMarket(input){calls.push({options,input});return {status:'queued'};},async close(){calls.push('closed');}})});
 assert.equal(calls[0].open,false);assert.deepEqual(calls[0].conversationContext,context);assert.deepEqual(calls[1],{options:{context},input:{url}});assert.equal(result.display.status,'queued');assert.match(result.message,/切回/);assert.equal(calls.at(-1),'closed');
});

test('headless requests do not open a browser and host failure is not reported as success',async()=>{
 const launch=async()=>({url:'http://127.0.0.1:1234/'});
 const headless=await openPluginMarket({openBrowser:false},{launch,desktopFactory:()=>{throw Error('must not open');}});assert.equal(headless.display.status,'not-requested');
 let closed=false;const failed=await openPluginMarket({},{launch,desktopFactory:()=>({async openMarket(){throw Error('host unavailable');},async close(){closed=true;}})});assert.equal(failed.display.status,'needs-host-open');assert.equal(failed.display.reason,'host unavailable');assert.equal(closed,true);assert.match(failed.message,/尚未在畫面開啟/);
});

test('desktop browser submission uses real acknowledgement and refuses arbitrary destinations',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-desktop-open-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'1'));await fs.writeFile(path.join(root,'1/server.mjs'),'');
 const calls=[];let status='queued';const channel=createDesktopConversation({context:{threadId:'current',pipePath:'pipe'},builtinRoot:root,env:{},clientFactory:()=>({async start(){},async listTools(){return [{name:'send_message_to_thread'},{name:'open_in_codex'}];},async request(method,params){calls.push(params);return params.name==='read_thread'?{content:[]}:{content:[{type:'text',text:JSON.stringify({status})}]};},async close(){}})});t.after(()=>channel.close());
 const url='http://127.0.0.1:1234/#access='+'b'.repeat(64);assert.equal((await channel.openMarket({url})).status,'queued');assert.deepEqual(calls.at(-1).arguments,{target:{type:'browser',url}});assert.equal(calls.at(-1)._meta['openai/threadId'],'current');
 status='unexpected';await assert.rejects(channel.openMarket({url}),/沒有回報/);
 for(const bad of ['https://example.com/','http://127.0.0.1/?key=a','http://127.0.0.1/#access=bad'])await assert.rejects(channel.openMarket({url:bad}),/只開啟/);
});

test('opening skill is included in the plugin and has a packaged fallback',async()=>{
 const text=await fs.readFile(new URL('../skills/dsh-market/SKILL.md',import.meta.url),'utf8');assert.match(text,/name: dsh-market/);assert.equal((text.match(/^---$/gm)??[]).length,2);assert.equal((text.match(/^name: dsh-market$/gm)??[]).length,1);assert.match(text,/open_dsh_market/);assert.match(text,/\.\.\/\.\.\/bin\/dsh-market\.mjs/);await fs.access(new URL('../bin/dsh-market.mjs',import.meta.url));
});
