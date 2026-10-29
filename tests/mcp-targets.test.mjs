import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {planMcpTargets} from '../lib/mcp-targets.mjs';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-mcp-targets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'source/sub'),{recursive:true});await fs.mkdir(path.join(root,'runtime'));await fs.writeFile(path.join(root,'source/sub/service.mjs'),'throw Error("must never execute during planning")');await fs.writeFile(path.join(root,'source/service.py'),'raise RuntimeError("must never execute during planning")');return root;}
test('known reviewed local Node entries and arguments become guarded targets, remote stays native',async t=>{
 const root=await fixture(t),remote={url:'https://example.invalid/mcp',http_headers:{'X-Public':'value'}};
 const result=await planMcpTargets(root,{config:{mcpServers:{local:{command:'node',args:['./service.mjs','--port','42'],cwd:'source/sub',env:{TOKEN:'untrusted'},env_vars:['TOKEN']},remote}},report:{conversion:{components:[{kind:'declared-mcp',name:'local'}]}}});
 assert.deepEqual(result.targets,[{type:'node',entry:'source/sub/service.mjs',args:['--port','42'],cwd:'source/sub'}]);assert.deepEqual(result.config.mcpServers.remote,remote);assert.deepEqual(result.config.mcpServers.local.args,['./runtime/security-launch.mjs','0']);assert.equal(result.config.mcpServers.local.env,undefined);assert.deepEqual(result.config.mcpServers.local.env_vars,[]);
});
test('external commands stay native with notices; unsupported local entries are omitted without breaking the package',async t=>{
 const root=await fixture(t);
 for(const server of [{command:'npx',args:['example@latest']},{command:'uvx',args:['server']},{command:'powershell',args:['service.ps1']}]){const result=await planMcpTargets(root,{config:{mcpServers:{local:server}}});assert.deepEqual(result.config.mcpServers.local,server);assert.equal(result.notices.length,1);}
 for(const server of [{command:'node',args:['--eval','1']},{command:'node',args:['../../outside.js']},{command:'node',args:['./missing.js']},{command:'node',args:['service.mjs'],cwd:'../outside'}]){const result=await planMcpTargets(root,{config:{mcpServers:{local:server}}});assert.equal(result.config.mcpServers.local,undefined);assert.equal(result.omitted.length,1);}
});

test('declared Python module launch stays native without guessing a package source entry',async t=>{
  const root=await fixture(t),server={command:'python',args:['-m','arbitrary_service','--stdio'],cwd:'source',env:{PUBLIC_OPTION:'value'}};
  const result=await planMcpTargets(root,{config:{mcpServers:{module:server}},report:{conversion:{components:[{kind:'declared-mcp',name:'module'}]}}});
  assert.deepEqual(result.config.mcpServers.module,server);assert.deepEqual(result.targets,[]);assert.deepEqual(result.omitted,[]);assert.match(result.notices[0].message,/沒有猜測/);
});
test('declared Python script stays native without prepared Python dependencies',async t=>{
 const root=await fixture(t),server={command:'python3',args:['service.py','extra'],cwd:'source'};
 const result=await planMcpTargets(root,{config:{mcpServers:{local:server}},report:{conversion:{components:[{kind:'declared-mcp',name:'local'}]}}});
 assert.deepEqual(result.config.mcpServers.local,server);assert.deepEqual(result.targets,[]);assert.deepEqual(result.omitted,[]);assert.equal(result.notices.length,1);
});
test('Python extraction preserves allow-list in the target and needs explicit reviewed runtime',async t=>{
 const root=await fixture(t);await fs.writeFile(path.join(root,'runtime/python-1.json'),JSON.stringify({allow:['read'],server:{command:'python',args:['./source/service.py']}}));
 const config={mcpServers:{python:{command:'node',args:['./runtime/python-1.mjs'],cwd:'.'}}},report={conversion:{components:[{kind:'python-mcp',name:'python',runtimeId:'python-1',entry:'service.py',allowTools:['read']}]}};
 const missing=await planMcpTargets(root,{config,report});assert.equal(missing.targets.length,0);assert.match(missing.omitted[0].message,/本機 Python/);
 const result=await planMcpTargets(root,{config,report,pythonRuntime:{command:process.execPath,pythonPaths:['runtime/python-environment/site-packages']}});
 assert.deepEqual(result.targets[0],{type:'python',entry:'source/service.py',command:process.execPath,args:[],cwd:'.',allowTools:['read'],pythonPaths:['runtime/python-environment/site-packages']});
 await fs.writeFile(path.join(root,'runtime/python-1.json'),JSON.stringify({allow:['write']}));await assert.rejects(planMcpTargets(root,{config,report,pythonRuntime:{command:process.execPath}}),error=>error.code==='SECURITY_INTEGRITY_MISMATCH');
});
