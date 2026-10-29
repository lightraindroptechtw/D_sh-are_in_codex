import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {convert} from '../lib/converter.mjs';
import {McpClient} from '../lib/protocol.mjs';
import {withSourceLoaderNames} from '../lib/compat/loader-context.mjs';

test('frontend-only package converts without executing source and opens after relocation',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh ui relocation '));let client;
  t.after(async()=>{await client?.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const source=path.join(root,'original'),output=path.join(root,'generated');await fs.mkdir(source);
  const original=`globalThis.__ModuleLoader__.load({id:'real-ui-fixture',factory:()=>({inject:['slots'],apply(ctx){ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'page'},()=>null));}})});`;
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'ui-without-backend',version:'1.0.0',exports:{'./client':'./client.js'},dsh:{client:{platform:'web'}}}));
  await fs.writeFile(path.join(source,'client.js'),original);
  const report=await convert(source,{outputDir:output,installDependencies:false,hooks:false});
  assert.ok(report.conversion.components.some(row=>row.kind==='dsh-ui-server'),JSON.stringify(report.conversion.omitted));
  const relocated=path.join(root,'moved package');await fs.rename(output,relocated);await fs.rm(source,{recursive:true});
  const config=JSON.parse(await fs.readFile(path.join(relocated,'.mcp.json'),'utf8'));
  client=new McpClient({...Object.values(config.mcpServers)[0],cwd:relocated},{cwd:relocated,timeout:20000});await client.start();
  const tools=await client.listTools();assert.ok(tools.some(row=>row.name==='dsh_host_ui_open'));
  const result=await client.request('tools/call',{name:'dsh_host_ui_open',arguments:{}});assert.equal(result.isError,undefined);
  const url=result.structuredContent.url;assert.equal(new URL(url).hostname,'127.0.0.1');
  assert.match(await(await fetch(url)).text(),/browser.js/);
  const manifest=await(await fetch(new URL('/__dsh_ui/manifest',url))).json();
  assert.equal(await(await fetch(new URL(manifest.clients[0].url,url))).text(),original);
  const context=await(await fetch(new URL('/__dsh_ui/context',url))).json();assert.equal(context.host.uiOnly,true);
  await client.close();client=undefined;await assert.rejects(fetch(url));
});
test('source sees original loader package names and live fibers without changing boot rows',()=>{
  const fiber={},entry={options:{id:'original',name:'cordis:target0'},fiber},loader={entries:()=>[entry]};
  const context={loader,fiber,get:name=>name==='loader'?loader:undefined};
  const view=withSourceLoaderNames(context,new Map([['cordis:target0','original-package']]));
  const own=view.loader.entries().find(row=>row.options.name==='original-package'&&row.fiber===view.fiber);
  assert.equal(own.options.id,'original');assert.equal(entry.options.name,'cordis:target0');assert.equal(view.get('loader'),view.loader);
  entry.options.id='changed';assert.equal(own.options.id,'changed');
});
