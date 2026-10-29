import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {rewriteCheck,prepareRewrite,finishRewrite,applyRewrite,hashRewriteSource,RESULT_FILE,BASELINE_FILE} from '../lib/rewrite.mjs';
import {writeCodexPackage} from '../lib/codex-package.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
async function fixture(t,{license='MIT'}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'codex rewrite '));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'package.json'),json({name:'native-page',version:'1.0.0',main:'index.mjs',type:'module',dsh:{client:'./client.js'},...(license===null?{}:{license})}));
  await fs.writeFile(path.join(source,'index.mjs'),"throw new Error('source must never execute'); export function apply(){}\n");
  await fs.writeFile(path.join(source,'client.js'),"__ModuleLoader__.load({id:'native-page',apply(){throw new Error('client must never execute')}});\n");
  await fs.writeFile(path.join(source,'LICENSE'),'MIT original author license text\n');
  return {root,source,workDir:path.join(root,'rewrite work'),destination:path.join(root,'uninstalled')};
}
async function authored(prepared,{mcp=false,hooks=false}={}){
  const skill=path.join(prepared.pluginDir,'skills','rewrite');await fs.mkdir(skill,{recursive:true});
  await fs.writeFile(path.join(skill,'SKILL.md'),'---\nname: rewrite\ndescription: 測試補寫功能。\n---\n\n讀取補寫結果，不自動啟動程式。\n');
  if(mcp){const runtime=path.join(prepared.pluginDir,'runtime','rewrite');await fs.mkdir(runtime,{recursive:true});await fs.writeFile(path.join(runtime,'server.mjs'),"throw new Error('generated must never execute');\n");}
  if(hooks){const directory=path.join(prepared.pluginDir,'hooks','rewrite');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'hook.mjs'),'throw new Error("hook must never execute")');}
  const result={schemaVersion:1,conclusion:'partial',implemented:['提供明確的補寫技能。'],limitations:['只有靜態驗證。'],mcpServers:mcp?{rewrite:{command:'node',args:['./runtime/rewrite/server.mjs'],cwd:'.'}}:{},verification:{rewrittenCodeExecuted:false}};
  await fs.writeFile(path.join(prepared.pluginDir,RESULT_FILE),json(result));return result;
}
const binding=(prepared,sealed)=>({expectedPreparationHash:prepared.preparationHash,expectedSourceHash:prepared.sourceHash,expectedArtifactHash:sealed.artifactHash});

test('pure UI source can be prepared, statically reviewed and applied without executing source or new MCP; preserves identity/license',async t=>{
  const f=await fixture(t),check=await rewriteCheck(f.source);
  assert.ok(check.targets.some(row=>row.kind==='native-ui'));assert.equal(check.sourceHash,await hashRewriteSource(f.source));
  const prepared=await prepareRewrite(f.source,{workDir:f.workDir,expectedSourceHash:check.sourceHash});
  const task=JSON.parse(await fs.readFile(prepared.taskPath,'utf8'));assert.ok(task.writable.includes('skills/rewrite/'));
  // The task is deliberately editable, while the separate baseline is bound.
  task.notes='使用者補充';await fs.writeFile(prepared.taskPath,json(task));
  await authored(prepared,{mcp:true,hooks:true});
  const sealed=await finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash});
  assert.equal(sealed.sourceExecuted,false);assert.equal(sealed.rewrittenCodeExecuted,false);assert.ok(sealed.abilitySummary.hookResourcesOnly);assert.ok((await fs.stat(sealed.scanPath)).isFile());
  await writeCodexPackage({outputDir:f.destination,name:'market-picked-name',description:'Existing identity',skillText:'---\nname: existing\ndescription: Existing skill\n---\nContent\n'});
  const applied=await applyRewrite(f.workDir,{pluginDir:f.destination,...binding(prepared,sealed)});
  assert.equal(applied.wired,true);assert.equal(applied.installed,false);assert.equal(applied.rewrittenCodeExecuted,false);
  const manifest=JSON.parse(await fs.readFile(path.join(f.destination,'.codex-plugin/plugin.json'),'utf8'));
  assert.equal(manifest.name,'market-picked-name');
  assert.equal(await fs.readFile(path.join(f.destination,'source/LICENSE'),'utf8'),'MIT original author license text\n');
  const mcp=JSON.parse(await fs.readFile(path.join(f.destination,'.mcp.json'),'utf8'));assert.equal(mcp.mcpServers.rewrite.args[0],'./runtime/rewrite/server.mjs');
  await assert.rejects(fs.access(path.join(f.destination,'hooks/hooks.json'))); // resources are not secretly hooked.
});

test('unknown and custom licenses remain advisory and do not prohibit preparation',async t=>{
  for(const license of [null,'LicenseRef-Author-Decision']){
    const f=await fixture(t,{license}),check=await rewriteCheck(f.source);assert.equal(check.license.requiresUserDecision,true);
    const prepared=await prepareRewrite(f.source,{workDir:f.workDir});assert.ok(prepared.preparationHash);
  }
});

test('finish requires an externally retained baseline hash, and rejects baseline or protected source edits',async t=>{
  const f=await fixture(t),prepared=await prepareRewrite(f.source,{workDir:f.workDir});await authored(prepared);
  await assert.rejects(finishRewrite(f.workDir),/基準/);
  const baselineFile=path.join(f.workDir,BASELINE_FILE),baseline=await fs.readFile(baselineFile,'utf8');
  await fs.writeFile(baselineFile,baseline+' ');await assert.rejects(finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash}),/基準/);
  await fs.writeFile(baselineFile,baseline);
  await fs.writeFile(path.join(prepared.pluginDir,'source','index.mjs'),'modified protected source');
  await assert.rejects(finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash}),error=>error.code==='REWRITE_OUTSIDE_ALLOWED');
});

test('source drift and fixed source-copy drift are caught before finish',async t=>{
  const f=await fixture(t),prepared=await prepareRewrite(f.source,{workDir:f.workDir});await authored(prepared);
  const original=await fs.readFile(path.join(f.source,'index.mjs'),'utf8');await fs.writeFile(path.join(f.source,'index.mjs'),'source changed');
  await assert.rejects(finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash}),/原始來源/);
  await fs.writeFile(path.join(f.source,'index.mjs'),original);await fs.writeFile(path.join(f.workDir,'source-snapshot','index.mjs'),'pinned copy changed');
  await assert.rejects(finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash}),/固定來源/);
});

test('artifact changes after review cannot be applied with the earlier hash',async t=>{
  const f=await fixture(t),prepared=await prepareRewrite(f.source,{workDir:f.workDir});await authored(prepared);
  const sealed=await finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash});
  await fs.appendFile(path.join(prepared.pluginDir,'skills/rewrite/SKILL.md'),'new instructions after review');
  await assert.rejects(applyRewrite(f.workDir,{pluginDir:f.destination,...binding(prepared,sealed)}),/已審查補寫產物/);
  await assert.rejects(fs.access(f.destination));
});

test('only named rewrite MCP servers can be introduced, and existing servers cannot be replaced',async t=>{
  const f=await fixture(t),prepared=await prepareRewrite(f.source,{workDir:f.workDir});const result=await authored(prepared,{mcp:true});
  result.mcpServers.other=result.mcpServers.rewrite;await fs.writeFile(path.join(prepared.pluginDir,RESULT_FILE),json(result));
  await assert.rejects(finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash}),error=>error.code==='REWRITE_MCP_NOT_ALLOWED');
  delete result.mcpServers.other;await fs.writeFile(path.join(prepared.pluginDir,RESULT_FILE),json(result));
  const sealed=await finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash});
  await writeCodexPackage({outputDir:f.destination,name:'existing',description:'Original plugin',skillText:'---\nname: existing\ndescription: Existing\n---\nOriginal\n',mcpServers:{rewrite:{url:'https://example.invalid/mcp'}}});
  await assert.rejects(applyRewrite(f.workDir,{pluginDir:f.destination,...binding(prepared,sealed)}),error=>error.code==='REWRITE_MCP_COLLISION');
  await assert.rejects(fs.access(path.join(f.destination,'source')));
});

test('pure UI application to a destination with only a conversion report produces a real Codex package',async t=>{
  const f=await fixture(t),prepared=await prepareRewrite(f.source,{workDir:f.workDir});await authored(prepared);
  const sealed=await finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash});await fs.mkdir(f.destination);
  await fs.writeFile(path.join(f.destination,'conversion-report.json'),'{}');
  const applied=await applyRewrite(f.workDir,{pluginDir:f.destination,name:'pure-ui-market-name',...binding(prepared,sealed)});
  assert.equal(applied.validation.valid,true);
  const manifest=JSON.parse(await fs.readFile(path.join(f.destination,'.codex-plugin/plugin.json'),'utf8'));assert.equal(manifest.name,'pure-ui-market-name');
});

test('claims with no implementation cannot turn an empty preview into a completed rewrite',async t=>{
  const f=await fixture(t),prepared=await prepareRewrite(f.source,{workDir:f.workDir});
  const result={conclusion:'done',implemented:[],limitations:[],mcpServers:{}};await fs.writeFile(path.join(prepared.pluginDir,RESULT_FILE),json(result));
  await assert.rejects(finishRewrite(f.workDir,{expectedPreparationHash:prepared.preparationHash}),/done 必須/);
});
