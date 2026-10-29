import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCodexTaskBroker,requestCodexTaskEndpoint} from '../lib/dsh-codex-task.mjs';
import {createRemoteSubprocessService} from '../lib/modules/subprocess.mjs';
const noopControl={onNotification:()=>()=>{},onClose:()=>()=>{},onRequest:()=>()=>{},request:async()=>({data:[{id:'synthetic-model'}]})};
async function fixture(t,{approve=true,secret}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-process-'));
  const security={approvals:[],async load(){return {settings:{}};},async notify(){},async requestApproval(input){this.approvals.push(input);return approve;},commandEnvironment(env){return {...env,...(secret?{SYNTHETIC_API_KEY:secret}:{})};},redact(value){return typeof value==='string'&&secret?value.split(secret).join('[masked]'):value;}};
  const broker=await createCodexTaskBroker({control:noopControl,workspace:root,codexHome:root,options:{security,stateDir:root}});
  const server=await broker.startServer({stateRoots:[root]});
  // The real loopback JSON transport, never a fake subprocess handle.
  const runtime=createRemoteSubprocessService({requestHost:(method,input)=>requestCodexTaskEndpoint(server.endpoint,method,JSON.parse(JSON.stringify(input)))});
  t.after(async()=>{await runtime.dispose();await broker.close();await fs.rm(root,{recursive:true,force:true});});
  const spec=(code,extra={})=>({argv:[process.execPath,'-e',code],cwd:root,graceMs:100,stdio:{stdin:'ignore',stdout:'pipe',stderr:'pipe'},...extra});
  return {root,security,broker,runtime,spec};
}
const consume=stream=>{let text='';stream?.on('data',chunk=>text+=chunk);return ()=>text;};
test('subprocess real JSON session streams stdout/stderr and returns exit status',async t=>{
  const f=await fixture(t),h=f.runtime.service.spawn(f.spec('process.stdout.write("out");process.stderr.write("err");process.exitCode=7;'));
  const out=consume(h.stdout),err=consume(h.stderr);assert.equal((await h.done).exitCode,7);assert.equal(out(),'out');assert.equal(err(),'err');assert.equal(f.security.approvals.length,1);
  assert.equal(await h.waitForExit(),true);
  assert.equal(await f.runtime.service.resolveExecutable(process.execPath),process.execPath);
  assert.deepEqual(await f.broker.dispatch('codex.models'),{data:[{id:'synthetic-model'}]});
});
test('stdin is writable before approval and output arrives before process completion',async t=>{
  const f=await fixture(t),h=f.runtime.service.spawn(f.spec('process.stdin.on("data",data=>process.stdout.write(data));process.stdin.on("end",()=>process.stderr.write("end"));',{stdio:{stdin:'pipe',stdout:'pipe',stderr:{maxBytes:16}}}));
  const out=consume(h.stdout);h.stdin.write('first');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('no live output')),5000);h.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
  h.stdin.end('最後');assert.equal((await h.done).exitCode,0);assert.equal(out(),'first最後');assert.equal(h.collected.stderr.text,'end');
});
test('collected tails have byte offsets, input data and errors survive JSON transport',async t=>{
  const f=await fixture(t),h=f.runtime.service.spawn(f.spec('process.stdin.pipe(process.stdout)',{stdio:{stdin:{data:'abcdef'},stdout:{maxBytes:3},stderr:{maxBytes:3}}}));
  await h.done;assert.deepEqual(h.collected.stdout.readFrom(0),{text:'def',nextOffset:6,lossy:true});assert.equal(h.collected.stdout.truncated,true);
  const bad=f.runtime.service.spawn({...f.spec(''),argv:[path.join(f.root,'missing-program')]});await assert.rejects(bad.done,{code:'ENOENT'});
});
test('cancel terminates live process and pending approval cannot start it later',async t=>{
  const f=await fixture(t),h=f.runtime.service.spawn(f.spec('process.stdout.write("ready");setInterval(()=>{},1000)'));
  const output=consume(h.stdout);await new Promise(resolve=>h.stdout.once('data',resolve));h.terminate();await h.done;assert.equal(output(),'ready');
  let release;f.security.requestApproval=()=>new Promise(resolve=>{release=resolve;});
  const marker=path.join(f.root,'forbidden-marker'),pending=f.runtime.service.spawn(f.spec(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`));
  while(!release)await new Promise(resolve=>setTimeout(resolve,5));pending.terminate();await new Promise(resolve=>setTimeout(resolve,20));release(true);await assert.rejects(pending.done,{code:'ABORT_ERR'});await assert.rejects(fs.access(marker));
});
test('timeout stops a real process and reports timeout',async t=>{
  const f=await fixture(t),h=f.runtime.service.spawn(f.spec('setInterval(()=>{},1000)',{timeoutMs:150}));consume(h.stdout);consume(h.stderr);assert.equal((await h.done).timedOut,true);
});
test('declared secret split across output chunks stays masked',async t=>{
  const secret='synthetic-secret-value',f=await fixture(t,{secret}),h=f.runtime.service.spawn(f.spec('process.stdout.write(process.env.SYNTHETIC_API_KEY.slice(0,8));setTimeout(()=>process.stdout.write(process.env.SYNTHETIC_API_KEY.slice(8)),80)'));
  const out=consume(h.stdout);consume(h.stderr);await h.done;assert.equal(out(),'[masked]');
});
test('denied approval rejects done and never starts the command',async t=>{
  const f=await fixture(t,{approve:false}),marker=path.join(f.root,'marker'),h=f.runtime.service.spawn(f.spec(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`));
  await assert.rejects(h.done,{code:'DSH_SHELL_REJECTED'});await assert.rejects(fs.access(marker));assert.equal(f.security.approvals.length,1);
});
test('subprocess uses the same visible allow and forbidden rules before process launch',async t=>{
  const f=await fixture(t),rules=path.join(f.root,'rules');await fs.mkdir(rules);
  const allowed=f.spec('process.stdout.write("allowed")');
  await fs.writeFile(path.join(rules,'synthetic.rules'),`prefix_rule(pattern = ${JSON.stringify(allowed.argv)}, decision = "allow")`);
  const h=f.runtime.service.spawn(allowed),out=consume(h.stdout);consume(h.stderr);await h.done;assert.equal(out(),'allowed');assert.equal(f.security.approvals.length,0);
  const marker=path.join(f.root,'deny-marker'),denied=f.spec(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`);
  await fs.writeFile(path.join(rules,'synthetic.rules'),`prefix_rule(pattern = ${JSON.stringify(denied.argv)}, decision = "forbidden")`);
  await assert.rejects(f.runtime.service.spawn(denied).done,{code:'DSH_SHELL_FORBIDDEN'});assert.equal(f.security.approvals.length,0);await assert.rejects(fs.access(marker));
});
test('terminate stops the descendant process tree, verified by a real child heartbeat',async t=>{
  const f=await fixture(t),marker=path.join(f.root,'heartbeat');
  const childCode=`setInterval(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},String(Date.now())),40)`;
  const parentCode=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore',windowsHide:true});setInterval(()=>{},1000);process.stdout.write('ready')`;
  const h=f.runtime.service.spawn(f.spec(parentCode));consume(h.stdout);consume(h.stderr);
  for(let i=0;i<100;i++){try{await fs.access(marker);break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
  await fs.access(marker);h.terminate();await h.done;await new Promise(resolve=>setTimeout(resolve,200));
  const content=await fs.readFile(marker,'utf8');await new Promise(resolve=>setTimeout(resolve,250));assert.equal(await fs.readFile(marker,'utf8'),content);
});
test('binary stdin/stdout round trips all byte values through JSON without UTF-8 corruption',async t=>{
  const f=await fixture(t),h=f.runtime.service.spawn(f.spec('process.stdin.pipe(process.stdout)',{stdio:{stdin:'pipe',stdout:'pipe',stderr:'pipe'}}));
  const chunks=[];h.stdout.on('data',chunk=>chunks.push(chunk));consume(h.stderr);const bytes=Buffer.from(Array.from({length:256},(_,i)=>i));h.stdin.end(bytes);await h.done;assert.deepEqual(Buffer.concat(chunks),bytes);
});
test('AbortSignal terminates a running process and waitForExit can be cancelled independently',async t=>{
  const f=await fixture(t),controller=new AbortController(),h=f.runtime.service.spawn(f.spec('process.stdout.write("ready");setInterval(()=>{},1000)',{signal:controller.signal}));
  consume(h.stdout);consume(h.stderr);await new Promise(resolve=>h.stdout.once('data',resolve));
  const waiting=new AbortController(),wait=h.waitForExit(waiting.signal);waiting.abort();assert.equal(await wait,false);controller.abort();await h.done;assert.equal(await h.waitForExit(),true);
  assert.throws(()=>f.runtime.service.spawn(f.spec('',{signal:controller.signal})),{code:'ABORT_ERR'});
});


test('unacknowledged output pauses its source and poll resumes more than 4 MiB without loss',async t=>{
  const f=await fixture(t),size=8*1024*1024,marker=path.join(f.root,'all-output-written');
  const code=`process.stdout.write(Buffer.alloc(${size},165),()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'done'))`;
  const {id}=await f.broker.dispatch('codex.process.spawn',{argv:[process.execPath,'-e',code],cwd:f.root,stdin:'ignore',graceMs:100});
  // No consumer acknowledges events during the initial producer burst.
  await new Promise(resolve=>setTimeout(resolve,300));await assert.rejects(fs.access(marker));
  let after=0,exit;const chunks=[];
  while(!exit){const batch=await f.broker.dispatch('codex.process.poll',{id,after,waitMs:5000});for(const event of batch.events){after=event.seq;if(event.type==='stdout')chunks.push(Buffer.from(event.data,'base64'));if(event.type==='error')assert.fail(JSON.stringify(event));if(event.type==='exit')exit=event;}}
  assert.equal(exit.exitCode,0);assert.equal(exit.error,undefined);assert.deepEqual(Buffer.concat(chunks),Buffer.alloc(size,165));await fs.access(marker);await f.broker.dispatch('codex.process.release',{id});
});

test('a slow consumer reads a binary stream larger than 4 MiB completely',async t=>{
  const f=await fixture(t),size=6*1024*1024,h=f.runtime.service.spawn(f.spec(`process.stdout.write(Buffer.alloc(${size},165))`));consume(h.stderr);
  const chunks=[];const reading=(async()=>{for await(const chunk of h.stdout){chunks.push(chunk);await new Promise(resolve=>setTimeout(resolve,2));}})();
  assert.equal((await h.done).exitCode,0);await reading;assert.deepEqual(Buffer.concat(chunks),Buffer.alloc(size,165));
});

test('an unread pipe follows stream backpressure and remains cancellable while a descendant runs',async t=>{
  const f=await fixture(t),marker=path.join(f.root,'unread-heartbeat');
  const childCode=`setInterval(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},String(Date.now())),40)`;
  const code=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore',windowsHide:true});process.stdout.write(Buffer.alloc(12*1024*1024,165));setInterval(()=>{},1000)`;
  const h=f.runtime.service.spawn(f.spec(code));consume(h.stderr);
  for(let i=0;i<100;i++){try{await fs.access(marker);if(h.stdout.readableLength)break;}catch{}await new Promise(resolve=>setTimeout(resolve,20));}
  await fs.access(marker);assert.ok(h.stdout.readableLength>0);let completed=false;h.done.finally(()=>{completed=true;}).catch(()=>{});await new Promise(resolve=>setTimeout(resolve,100));assert.equal(completed,false);
  h.terminate();await assert.rejects(h.done,{code:'ABORT_ERR'});await new Promise(resolve=>setTimeout(resolve,200));const last=await fs.readFile(marker,'utf8');await new Promise(resolve=>setTimeout(resolve,250));assert.equal(await fs.readFile(marker,'utf8'),last);h.stdout.destroy();
});

test('more than 64 pending sessions are accepted and can all be released without launching',async t=>{
  const f=await fixture(t);f.security.requestApproval=()=>new Promise(()=>{});const ids=[];
  for(let i=0;i<65;i++){const {id}=await f.broker.dispatch('codex.process.spawn',{argv:[process.execPath,'-e',''],cwd:f.root,stdin:'ignore',graceMs:100});ids.push(id);}
  assert.equal(ids.length,65);await Promise.all(ids.map(id=>f.broker.dispatch('codex.process.release',{id})));
});
