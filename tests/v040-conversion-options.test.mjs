import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {convert,verify} from '../lib/converter.mjs';
import {writeCodexPackage,validateCodexPackage} from '../lib/codex-package.mjs';
import {stablePluginId} from '../lib/state-paths.mjs';

async function fixture(t,pkg={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'v040-convert-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'synthetic-options',type:'module',main:'index.mjs',...pkg}));await fs.writeFile(path.join(source,'index.mjs'),`throw Error('MUST NOT INITIALIZE');export const inject=['tools','systemPrompt'];export function apply(context){process.env.NAMED_SECRET;process.env['SECOND_SECRET'];context.tools.register({name:'synthetic',execute(){return 1}});context.systemPrompt.section({name:'guide',text:'synthetic'});}`);return {root,source,outputDir:path.join(root,'out')};}

test('conversion forwards variable names/options and stable identity, generates hooks by default without executing source',async t=>{
  const f=await fixture(t);const secret='ambient-value-must-never-be-written';const prior=process.env.NAMED_SECRET;process.env.NAMED_SECRET=secret;t.after(()=>prior===undefined?delete process.env.NAMED_SECRET:process.env.NAMED_SECRET=prior);
  const report=await convert(f.source,{outputDir:f.outputDir,installDependencies:false,homeMode:'real',passEnv:['EXPLICIT_ENV'],moduleOptions:{credentials:{envMapping:{example:'CREDENTIAL_SECRET'}},llm:{allowedApiRoutes:[{provider:'synthetic',model:'synthetic',credentialEnv:'MODEL_SECRET'}]}},initializeTimeoutMs:90000,callTimeoutMs:45000,cancelGraceMs:750,lenientOutput:true});
  assert.equal(report.conversion.sourceDependencies.status,'disabled');assert.equal(report.conversion.validation.valid,true);assert.ok(!JSON.stringify(report).includes(secret));
  const servers=JSON.parse(await fs.readFile(path.join(f.outputDir,'.mcp.json'))).mcpServers;const server=Object.values(servers)[0];for(const name of ['EXPLICIT_ENV','CREDENTIAL_SECRET','MODEL_SECRET'])assert.ok(server.env_vars.includes(name),name);for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','NAMED_SECRET','SECOND_SECRET'])assert.ok(!server.env_vars.includes(name),name);assert.equal(server.tool_timeout_sec,45.75);assert.equal(server.startup_timeout_sec,90);
  const settings=JSON.parse(await fs.readFile(path.join(f.outputDir,'runtime/settings.json')));assert.equal(settings.homeMode,'real');assert.equal(settings.lenientOutput,true);assert.equal(settings.initializeTimeoutMs,90000);assert.equal(settings.stateId,stablePluginId({origin:f.source,packageDir:'.',name:'synthetic-options'}));assert.ok(!settings.passEnv.includes('NAMED_SECRET'));assert.ok(report.environment.requestedEnvNames.includes('NAMED_SECRET'));await fs.access(path.join(f.outputDir,'hooks/hooks.json'));
});

test('conversion persists dependency plan before npm and reports install failure without child secrets',async t=>{
  const f=await fixture(t,{dependencies:{probe:'1.0.0'}});let calls=0;const report=await convert(f.source,{outputDir:f.outputDir,hooks:false,dependencyRunner:async()=>{calls++;const current=JSON.parse(await fs.readFile(path.join(f.outputDir,'conversion-report.json')));assert.equal(current.conversion.sourceDependencies.status,'planned');assert.deepEqual(current.conversion.sourceDependencies.packages,[{name:'probe',requested:'1.0.0'}]);return {code:1,stderr:'https://user:SECRET@example.invalid TOKEN=SECRET'};}});
  assert.equal(calls,1);assert.equal(report.conversion.sourceDependencies.status,'failed');assert.ok(report.conversion.omitted.some(x=>x.code==='SOURCE_DEPENDENCIES_FAILED'));assert.ok(!JSON.stringify(report).includes('TOKEN=SECRET'));assert.equal(report.conversion.sourceDependencies.sourceFilesUnchanged,true);await assert.rejects(fs.access(path.join(f.source,'node_modules')),{code:'ENOENT'});await assert.rejects(fs.access(path.join(f.outputDir,'hooks/hooks.json')),{code:'ENOENT'});
});

test('Codex package writer and validator reject malformed env_vars',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v040-env-vars-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const base={outputDir:root,name:'synthetic',description:'Synthetic',skillText:'---\nname: synthetic\ndescription: Synthetic\n---\nSynthetic'};
  await assert.rejects(writeCodexPackage({...base,mcpServers:{probe:{command:'node',env_vars:['TOKEN=value']}}}),/env_vars/);
  await writeCodexPackage({...base,mcpServers:{probe:{command:'node',env_vars:['TOKEN']}}});await fs.writeFile(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{probe:{command:'node',env_vars:['TOKEN','TOKEN']}}}));assert.equal((await validateCodexPackage(root)).valid,false);
});

test('explicit portable engine uses persistent state and lenient output while disclosing unused official options',async t=>{
  const f=await fixture(t);const stateRoot=path.join(f.root,'persistent-state');
  await fs.writeFile(path.join(f.source,'index.mjs'),`export function apply(host){host.tools.register({name:'state_probe',description:'Synthetic state/output probe',parameters:{type:'object',properties:{}},output:{schema:{type:'object',properties:{baseDir:{type:'string'}},required:['baseDir'],additionalProperties:false},render:(_,value)=>[{type:'text',text:value.baseDir}]},execute:()=>({baseDir:host.baseDir,missing:undefined})});}`);
  const report=await convert(f.source,{outputDir:f.outputDir,engine:'portable-tools',lenientOutput:true,stateRoot,installDependencies:false});assert.ok(report.conversion.omitted.some(x=>x.code==='PORTABLE_RUNTIME_LIMITATIONS'));assert.ok(report.conversion.modules.every(x=>x.status==='not-applied-portable'));
  const settings=JSON.parse(await fs.readFile(path.join(f.outputDir,'runtime/settings.json')));const expected=path.join(stateRoot,settings.stateId);const result=await verify(f.outputDir,{executeSource:true,call:'state_probe'});assert.equal(result.servers[0].status,'tool-called',JSON.stringify(result));assert.equal(result.servers[0].call.result.content[0].text,expected);
});

test('outer MCP deadline includes declared static tool timeout and cancellation grace; dynamic declarations are reported',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.source,'index.mjs'),`export const inject=['tools'];export function apply(ctx){ctx.tools.register({name:'long',description:'Long synthetic tool',timeoutMs:180000,execute(){return 1}});ctx.tools.register({name:'dynamic',description:'Dynamic synthetic tool',timeoutMs:config.timeout,execute(){return 1}});}`);
  const report=await convert(f.source,{outputDir:f.outputDir,installDependencies:false,callTimeoutMs:60000,cancelGraceMs:1000});const servers=JSON.parse(await fs.readFile(path.join(f.outputDir,'.mcp.json'))).mcpServers;assert.equal(Object.values(servers)[0].tool_timeout_sec,181);assert.ok(report.conversion.omitted.some(x=>x.code==='DYNAMIC_TOOL_TIMEOUT'));
});

test('reports redact committed secret configuration while preserving ordinary source defaults',async t=>{
  const f=await fixture(t,{exports:null,dsh:{bundle:{patch:'patch.json'}}});await fs.writeFile(path.join(f.source,'patch.json'),JSON.stringify([{insert:[{id:'self',name:'synthetic-options',config:{apiKey:'committed-key-example',nested:{password:'committed-password-example'},normal:'retained'}}]}]));await fs.mkdir(path.join(f.source,'skills/probe'),{recursive:true});await fs.writeFile(path.join(f.source,'skills/probe/SKILL.md'),'---\nname: probe\ndescription: Synthetic probe\n---\nRead.');
  const report=await convert(f.source,{outputDir:f.outputDir,installDependencies:false});assert.equal(report.defaultConfig.apiKey,'[redacted]');assert.equal(report.defaultConfig.nested.password,'[redacted]');assert.equal(report.defaultConfig.normal,'retained');assert.ok(!JSON.stringify(report).includes('committed-key-example'));
});
