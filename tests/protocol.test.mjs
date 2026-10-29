import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {McpClient} from '../lib/protocol.mjs';
test('MCP refreshes tools after registry changes and disposes subscriptions before exit',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'MCP registry events '));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const entry=path.join(root,'server.mjs'),marker=path.join(root,'disposed');const protocol=path.resolve(import.meta.dirname,'../lib/protocol.mjs');
  await fs.writeFile(entry,`import{serveMcp}from ${JSON.stringify(new URL('file:///'+protocol.replaceAll('\\','/')).href)};import fs from'node:fs/promises';let listener;let tools=[{name:'switch',description:'Switch registry',inputSchema:{type:'object'},execute:async()=>{tools=[{name:'new_tool',description:'New',inputSchema:{type:'object'},execute:async()=>({content:[{type:'text',text:'changed'}]})}];listener();return{content:[{type:'text',text:'ok'}]}}}];await serveMcp({name:'dynamic',getTools:()=>tools,onToolsChanged:f=>{listener=f;return()=>fs.writeFile(${JSON.stringify(marker)},'yes')},dispose:async()=>{await new Promise(r=>setTimeout(r,10));}});`);
  const client=new McpClient({command:process.execPath,args:[entry],cwd:root},{cwd:root});await client.start();assert.equal((await client.listTools())[0].name,'switch');await client.request('tools/call',{name:'switch'});assert.equal((await client.listTools())[0].name,'new_tool');assert.equal((await client.request('tools/call',{name:'new_tool'})).content[0].text,'changed');await client.close();assert.equal(await fs.readFile(marker,'utf8'),'yes');
});
test('MCP negotiates Codex sandbox metadata and passes transport metadata separately from source arguments',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'MCP sandbox metadata '));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const entry=path.join(root,'server.mjs'),protocol=new URL('../lib/protocol.mjs',import.meta.url).href;
  await fs.writeFile(entry,`import{serveMcp}from ${JSON.stringify(protocol)};await serveMcp({name:'metadata',tools:[{name:'probe',inputSchema:{type:'object'},execute:async(args,execution)=>({content:[{type:'text',text:JSON.stringify({args,requestMeta:execution.requestMeta})}]})}]});`);
  const client=new McpClient({command:process.execPath,args:[entry],cwd:root});
  try{
    await client.start();
    const initialized=await client.request('initialize',{protocolVersion:'2025-06-18',capabilities:{}});assert.ok(Object.hasOwn(initialized.capabilities.experimental,'codex/sandbox-state-meta'));
    const transport={'codex/sandbox-state-meta':{permissionProfile:{type:'disabled'}}},fake={fullAccess:true};
    const result=JSON.parse((await client.request('tools/call',{name:'probe',arguments:{_meta:fake},_meta:transport})).content[0].text);
    assert.deepEqual(result.requestMeta,transport);assert.deepEqual(result.args,{_meta:fake});
  }finally{await client.close();}
});
