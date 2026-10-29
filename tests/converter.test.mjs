import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {convert,verify} from '../lib/converter.mjs';
import {McpClient} from '../lib/protocol.mjs';
import {planMcpTargets} from '../lib/mcp-targets.mjs';

async function fixture(t,files){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh conversion '));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source');await fs.mkdir(source);for(const [name,text]of Object.entries(files)){const file=path.join(source,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);}return {root,source,out:path.join(root,'output')};}
const packageJson=JSON.stringify({name:'sample',type:'module',main:'index.js'});
test('conversion never executes source and verification actually calls the relocated tool',async t=>{
  const f=await fixture(t,{'package.json':packageJson,'index.js':`import fs from 'node:fs';import{defineTool}from'@deepseek-ai/dsh-tools';fs.writeFileSync(new URL('./executed',import.meta.url),'yes');export function apply(ctx){ctx.tools.register(defineTool({name:'sum',description:'Sum',parameters:{a:{type:'number',required:true},b:{type:'number',default:2}},output:{schema:{type:'number'},render:(_,v)=>[{type:'text',text:String(v)}]},execute:async v=>v.a+(v.b??2)}))}`});
  const report=await convert(f.source,{outputDir:f.out,stateRoot:path.join(f.root,'state'),engine:'portable-tools'});assert.equal(report.conversion.modelCalls,0);await assert.rejects(fs.access(path.join(f.source,'executed')));await assert.rejects(fs.access(path.join(f.out,'source','executed')));
  const moved=path.join(f.root,'moved output');await fs.rename(f.out,moved);await fs.rm(f.source,{recursive:true});
  const result=await verify(moved,{executeSource:true,call:'sum',args:{a:3}});assert.equal(result.servers[0].status,'tool-called',JSON.stringify(result));assert.equal(result.servers[0].call.result.content[0].text,'5');
  const updated=JSON.parse(await fs.readFile(path.join(moved,'conversion-report.json'),'utf8'));assert.deepEqual(updated.conversion.verification.toolsCalled,['sum']);
  await assert.rejects(verify(moved,{call:'sum'}),/executeSource/);
});
test('vendored Python is discovery only; explicit extraction requires a nonempty tool list',async t=>{
  const f=await fixture(t,{'package.json':packageJson,'index.js':'export function apply(){}','vendor/service.py':`from mcp.server.stdio import stdio_server`, 'pyproject.toml':'[project]\nrequires-python=">=3.11"\ndependencies=["synthetic"]'});
  const r=await convert(f.source,{outputDir:f.out,stateRoot:path.join(f.root,'state')});assert.equal(r.conversion.status,'unsupported');assert.equal(r.capabilities.pythonServers[0].status,'candidate-not-enabled');await assert.rejects(fs.access(path.join(f.out,'.mcp.json')));
  await assert.rejects(convert(f.source,{outputDir:path.join(f.root,'explicit'),pythonEntry:'vendor/service.py'}),/allowTools/);
  const extracted=await convert(f.source,{outputDir:path.join(f.root,'selected'),pythonEntry:'vendor/service.py',allowTools:['read'],installDependencies:false});const component=extracted.conversion.components.find(c=>c.kind==='python-mcp');assert.equal(component.entrySource,'user-selected-candidate');assert.deepEqual(component.allowTools,['read']);assert.match(JSON.parse(await fs.readFile(path.join(f.root,'selected','.mcp.json'),'utf8')).mcpServers[component.name].args[0],/runtime/);
});
test('multiple generated plugins and a same-named declared server cannot shadow each other',async t=>{
  const code=`export function apply(ctx){ctx.tools.register({name:'local_tool',description:'Local',parameters:{type:'object'},execute:async()=>({value:1})})}`;
  const files={'package.json':packageJson,'index.js':code,'.mcp.json':JSON.stringify({mcpServers:{dsh:{url:'https://example.invalid/mcp'}}})};
  const a=await fixture(t,files),b=await fixture(t,files);const ra=await convert(a.source,{outputDir:a.out,stateRoot:path.join(a.root,'state'),engine:'portable-tools'}),rb=await convert(b.source,{outputDir:b.out,stateRoot:path.join(b.root,'state'),engine:'portable-tools'});
  const ca=JSON.parse(await fs.readFile(path.join(a.out,'.mcp.json'),'utf8')),cb=JSON.parse(await fs.readFile(path.join(b.out,'.mcp.json'),'utf8'));assert.equal(Object.keys(ca.mcpServers).length,2);assert.ok(Object.keys(ca.mcpServers).every(k=>!Object.hasOwn(cb.mcpServers,k)));
  const component=ra.conversion.components.find(c=>c.kind==='dsh-tools');assert.notEqual(component.name,ra.conversion.serverNames.dsh);const result=await verify(a.out,{executeSource:true,server:component.name,call:'local_tool'});assert.equal(result.servers[0].status,'tool-called');assert.equal(rb.conversion.modelCalls,0);
});
test('source skill with same package name is never overwritten; relative resources and licenses survive',async t=>{
  const text='---\nname: sample\ndescription: Original useful skill\n---\nRead [notice](../../NOTICE.md).\n';
  const f=await fixture(t,{'package.json':packageJson,'skills/sample/SKILL.md':text,'NOTICE.md':'Original notice','skills/sample/data.json':'{"a":1}'});
  const r=await convert(f.source,{outputDir:f.out,stateRoot:path.join(f.root,'state')});assert.notEqual(r.conversion.status,'unsupported');assert.equal(await fs.readFile(path.join(f.out,'source/skills/sample/SKILL.md'),'utf8'),text);assert.equal(await fs.readFile(path.join(f.out,'source/NOTICE.md'),'utf8'),'Original notice');
  const manifest=JSON.parse(await fs.readFile(path.join(f.out,'.codex-plugin/plugin.json'),'utf8'));assert.ok(manifest.skills.includes('./source/skills/sample'));assert.ok((await fs.readFile(path.join(f.out,'skills/conversion-guide/SKILL.md'),'utf8')).includes('source/'));
});
test('declared stdio local script keeps source-relative cwd and works after relocation',async t=>{
  const f=await fixture(t,{'package.json':'{"name":"declared"}','.mcp.json':JSON.stringify({mcpServers:{local:{command:'node',args:['./server.mjs'],cwd:'sub'}}}),'sub/server.mjs':`import{createInterface}from'node:readline';for await(const l of createInterface({input:process.stdin})){const m=JSON.parse(l);if(m.id!==undefined)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{tools:[]}}));}`});
  await convert(f.source,{outputDir:f.out,stateRoot:path.join(f.root,'state')});const moved=path.join(f.root,'moved');await fs.rename(f.out,moved);await fs.rm(f.source,{recursive:true});const r=await verify(moved,{executeSource:true});assert.equal(r.servers[0].status,'tools-listed');
});
test('declared Python MCP commands and arguments are preserved without dependency inference',async t=>{
  const mcpServers={local:{command:'python3',args:['server.py','extra'],cwd:'sub'},module:{command:'python',args:['-m','server']},external:{command:'uv',args:['run','server.py']}};
  const f=await fixture(t,{'package.json':'{"name":"declared"}', '.mcp.json':JSON.stringify({mcpServers}), 'sub/server.py':'raise RuntimeError("must not execute")', 'sub/requirements.txt':'demo>=1','pyproject.toml':'[project]\ndependencies=["demo"]'});
  const r=await convert(f.source,{outputDir:f.out,installDependencies:false});
  const config=JSON.parse(await fs.readFile(path.join(f.out,'.mcp.json'),'utf8'));
  for(const [name,original] of Object.entries(mcpServers)){const component=r.conversion.components.find(c=>c.sourceName===name);assert.equal(component.language,undefined);assert.equal(component.dependencyFiles,undefined);const actual=config.mcpServers[component.name];assert.equal(actual.command,original.command);assert.deepEqual(actual.args,original.args);}
  const planned=await planMcpTargets(f.out,{config,report:r});const local=r.conversion.components.find(c=>c.sourceName==='local');assert.deepEqual(planned.config.mcpServers[local.name],config.mcpServers[local.name]);assert.equal(planned.omitted.length,0);
});
test('DSH MCP client declaration preserves Python command and arguments',async t=>{
  const f=await fixture(t,{'package.json':JSON.stringify({name:'declared',dsh:{bundle:{patch:'patch.yml'}}}), 'patch.yml':`- insert:\n    - id: local\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        command: python\n        args: [server.py]\n        cwd: sub\n`, 'sub/server.py':'pass', 'sub/pyproject.toml':'[project]\nname="demo"'});
  const r=await convert(f.source,{outputDir:f.out,installDependencies:false});const local=r.conversion.components.find(c=>c.sourceName==='local');assert.equal(local.language,undefined);const config=JSON.parse(await fs.readFile(path.join(f.out,'.mcp.json'),'utf8'));assert.equal(config.mcpServers[local.name].command,'python');assert.deepEqual(config.mcpServers[local.name].args,['server.py']);
});
test('converter plugin exposes its source review and conversion operations through a real stdio MCP connection',async()=>{
  const root=path.resolve(import.meta.dirname,'..');const client=new McpClient({command:process.execPath,args:['./bin/dsh-to-codex.mjs','serve'],cwd:root},{cwd:root});
  try{await client.start();const tools=await client.listTools();assert.deepEqual(tools.map(t=>t.name),['inspect_dsh_plugin','convert_dsh_plugin','verify_codex_plugin','open_dsh_market','review_dsh_plugin','install_reviewed_dsh_plugin','get_dsh_market_reviews','complete_dsh_market_review','rewrite_dsh_plugin']);const invalid=await client.request('tools/call',{name:'inspect_dsh_plugin',arguments:{source:3}});assert.equal(invalid.isError,true);}finally{await client.close();}
});
test('optional environment header survives the full generated HTTP-to-stdio pipeline without requiring a key',async t=>{
  const requests=[];const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;if(req.method==='DELETE'){res.writeHead(204);res.end();return;}const m=JSON.parse(text);requests.push({method:m.method,key:req.headers['x-test-optional']});if(m.id===undefined){res.writeHead(202);res.end();return;}const result=m.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'local',version:'1'}}:m.method==='tools/list'?{tools:[{name:'echo',description:'Echo',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]}:{content:[{type:'text',text:m.params.arguments.text}]};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const envName='DSH_CONVERTER_TEST_UNSET_HEADER';assert.equal(process.env[envName],undefined);
  const f=await fixture(t,{'package.json':JSON.stringify({name:'remote',dsh:{bundle:{patch:'patch.yml'}}}),'patch.yml':`- insert:\n    - id: remote\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: remote\n        transport: streamable-http\n        url: http://127.0.0.1:${server.address().port}/mcp\n        headers: !!js 'process.env.${envName} ? { "x-test-optional": process.env.${envName} } : {}'\n        toolCallTimeoutMs: 180000\n`});
  await convert(f.source,{outputDir:f.out,stateRoot:path.join(f.root,'state')});const result=await verify(f.out,{executeSource:true,call:'echo',args:{text:'繁體中文'}});assert.equal(result.servers[0].status,'tool-called',JSON.stringify(result));assert.equal(result.servers[0].call.result.content[0].text,'繁體中文');assert.ok(requests.some(r=>r.method==='tools/call'));assert.ok(requests.every(r=>r.key===undefined));
});


