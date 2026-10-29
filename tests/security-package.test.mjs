import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {secureGeneratedPackage} from '../lib/security-package.mjs';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-security-package-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const packageRoot=path.join(root,'package');await fs.mkdir(packageRoot);return {root,packageRoot,stateDir:path.join(root,'state'),report:{conversion:{components:[{kind:'skill'}]}}};}

test('a generated skills-only package has no code execution entry to isolate',async t=>{
  const f=await fixture(t);assert.deepEqual(await secureGeneratedPackage(f.packageRoot,f),{enforced:true,codeExecution:false});
});

test('externally declared remote MCP stays native without executing a local program',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.packageRoot,'.mcp.json'),JSON.stringify({mcpServers:{remote:{url:'https://example.invalid/mcp'}}}));
  const stopped=Error('inspect prepared remote');
  await assert.rejects(secureGeneratedPackage(f.packageRoot,{...f,report:{conversion:{components:[{kind:'declared-mcp',name:'remote'}]}},onProgress:()=>{throw stopped;}}),cause=>cause===stopped);
  const config=JSON.parse(await fs.readFile(path.join(f.packageRoot,'.mcp.json'),'utf8'));assert.deepEqual(config.mcpServers.remote,{url:'https://example.invalid/mcp'});
});

test('unsupported entries are reported per component without refusing the remaining package',async t=>{
  const f=await fixture(t);for(const server of [{command:'node',args:['--eval','extra']},{command:'node',args:['../outside.mjs']},{command:'node',args:['./runtime/../../outside.mjs']}]){
    await fs.writeFile(path.join(f.packageRoot,'.mcp.json'),JSON.stringify({mcpServers:{synthetic:server}}));const result=await secureGeneratedPackage(f.packageRoot,f);assert.equal(result.omitted.length,1);assert.equal(result.codeExecution,false);
  }
});

test('a missing OS isolation helper gives a limitation notice without executing source or refusing preparation',async t=>{
  const f=await fixture(t),marker=path.join(f.root,'source-executed'),runtime=path.join(f.packageRoot,'runtime');await fs.mkdir(runtime);
  await fs.writeFile(path.join(runtime,'server.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'should never execute');`);
  await fs.writeFile(path.join(f.packageRoot,'.mcp.json'),JSON.stringify({mcpServers:{synthetic:{command:'node',args:['./runtime/server.mjs']}}}));
  const previous=process.env.CODEX_BIN;process.env.CODEX_BIN=path.join(f.root,'nonexistent-codex-helper.exe');
  try{const result=await secureGeneratedPackage(f.packageRoot,f);assert.equal(result.enforced,false);assert.equal(result.nativePolicyUnavailable,true);}finally{if(previous===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=previous;}
  await assert.rejects(fs.access(marker),{code:'ENOENT'});
  const wrapped=JSON.parse(await fs.readFile(path.join(f.packageRoot,'.mcp.json'),'utf8'));assert.deepEqual(wrapped.mcpServers.synthetic.args,['./runtime/security-launch.mjs','0']);
});

test('secret-like configuration is moved outside code before packaging and produces a sensitive-field binding',async t=>{
  const f=await fixture(t),runtime=path.join(f.packageRoot,'runtime'),secret='synthetic-private-value-73';await fs.mkdir(runtime);
  await fs.writeFile(path.join(f.packageRoot,'.mcp.json'),JSON.stringify({mcpServers:{remote:{url:'https://example.invalid/mcp'}}}));
  await fs.writeFile(path.join(runtime,'settings.json'),JSON.stringify({config:{apiKey:secret,otherToken:'',ordinary:'kept'}}));
  await secureGeneratedPackage(f.packageRoot,{...f,dataRoot:path.join(f.root,'market'),report:{name:'fixture',conversion:{components:[{kind:'declared-mcp',name:'remote'}]}}});
  const text=await fs.readFile(path.join(runtime,'settings.json'),'utf8'),settings=JSON.parse(text),policy=JSON.parse(await fs.readFile(path.join(runtime,'security-policy.json'),'utf8'));
  assert.equal(text.includes(secret),false);assert.equal(settings.config.apiKey,'');assert.equal(settings.config.ordinary,'kept');
  assert.deepEqual(settings.runtimeBindings.sensitiveConfigFields[0].path,['apiKey']);assert.ok(policy.declaredSecrets.some(field=>field.name==='config:apiKey'));
  assert.ok(policy.declaredSecrets.some(field=>field.name==='config:otherToken'));assert.ok(settings.runtimeBindings.sensitiveConfigFields.some(field=>field.path[0]==='otherToken'));
  const outside=JSON.parse(await fs.readFile(path.join(f.root,'market/plugin-security/fixture/secrets.json'),'utf8'));assert.equal(outside['config:apiKey'],secret);
});

test('packaging never guesses executable fields, private state configuration or temporary Python overlays',async t=>{
  const f=await fixture(t),runtime=path.join(f.packageRoot,'runtime'),source=path.join(f.packageRoot,'source');await fs.mkdir(runtime);await fs.mkdir(source);
  const config={dshBin:'plugin-command',pythonPath:'plugin-python',ordinary:true};
  await fs.writeFile(path.join(runtime,'settings.json'),JSON.stringify({config}));
  await fs.writeFile(path.join(source,'index.js'),`const configFile=join(stateDir,'config.json');const settings={dshBin:'dsh',pythonPath:'python'};const text='serverName: copied-private-server';`);
  await fs.writeFile(path.join(f.packageRoot,'.mcp.json'),JSON.stringify({mcpServers:{remote:{url:'https://example.invalid/mcp'}}}));
  await fs.mkdir(path.join(f.stateDir,'bili-duty'),{recursive:true});const privateFile=path.join(f.stateDir,'bili-duty/config.json');const original=JSON.stringify({dshBin:'custom',pythonPath:'custom-python'});await fs.writeFile(privateFile,original);
  await secureGeneratedPackage(f.packageRoot,{...f,dataRoot:path.join(f.root,'market'),pythonRuntime:{command:process.execPath},report:{name:'any-name',entry:'index.js',defaultConfig:config,capabilities:{pythonServers:[{path:'server.py'}]},conversion:{components:[{kind:'declared-mcp',name:'remote'}]}}});
  const settings=JSON.parse(await fs.readFile(path.join(runtime,'settings.json'),'utf8')),policy=JSON.parse(await fs.readFile(path.join(runtime,'security-policy.json'),'utf8'));
  assert.deepEqual(settings.config,config);assert.deepEqual(settings.runtimeBindings,{});assert.equal(Object.hasOwn(policy,'approvedOverlayServers'),false);
  assert.equal(await fs.readFile(privateFile,'utf8'),original);assert.deepEqual(await fs.readdir(path.dirname(privateFile)),['config.json']);
  await fs.access(path.join(runtime,'dsh-codex-cli.mjs'));await fs.access(path.join(runtime,'dsh-codex-task.mjs'));
});
