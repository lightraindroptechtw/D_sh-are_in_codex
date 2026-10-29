import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {precompileSource} from '../lib/precompile-source.mjs';
import {loadDshHost} from '../lib/dsh-host.mjs';

test('precompile refuses absolute JSON imports outside the package before loading synthetic credentials',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-precompile-containment-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const packageRoot=path.join(root,'package'),source=path.join(packageRoot,'source'),outside=path.join(root,'synthetic-key.json');
  await fs.mkdir(source,{recursive:true});
  await fs.writeFile(outside,JSON.stringify({key:'SYNTHETIC_CREDENTIAL_MUST_NOT_ENTER_BUNDLE'}));
  await fs.writeFile(path.join(source,'entry.js'),`import key from ${JSON.stringify(outside.replaceAll('\\','/'))};export function apply(){return key;}`);
  await assert.rejects(precompileSource({packageRoot,settings:{entry:'entry.js'}}),error=>{
    assert.match(error.message,/預編譯拒絕讀取插件產物以外的檔案/);
    assert.ok(!error.message.includes('SYNTHETIC_CREDENTIAL_MUST_NOT_ENTER_BUNDLE'));
    return true;
  });
  await assert.rejects(fs.access(path.join(packageRoot,'runtime','precompiled-source.mjs')));
});

for(const extension of ['js','ts'])test(`precompile ${extension} does not initialize source and worker reads relocated resources without running esbuild`,async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-precompiled-'));
  let host;
  t.after(async()=>{await host?.dispose();await fs.rm(root,{recursive:true,force:true});});
  const packageRoot=path.join(root,'original package'),source=path.join(packageRoot,'source'),runtime=path.join(packageRoot,'runtime','host-env');
  await fs.mkdir(path.join(source,'nested'),{recursive:true});await fs.mkdir(runtime,{recursive:true});
  await fs.writeFile(path.join(runtime,'package.json'),'{}');
  await fs.symlink(path.resolve(import.meta.dirname,'../node_modules'),path.join(runtime,'node_modules'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(source,'package.json'),'{}');await fs.writeFile(path.join(source,'resource.json'),'{"value":42}');
  await fs.writeFile(path.join(source,'nested','text.txt'),'relocated asset');
  await fs.writeFile(path.join(source,'nested','asset.'+extension),`import fs from 'node:fs';export function asset(){return {text:fs.readFileSync(new URL('./text.txt',import.meta.url),'utf8'),url:import.meta.url};}`);
  await fs.writeFile(path.join(source,'entry.'+extension),`import fs from 'node:fs';import {defineTool} from '@deepseek-ai/dsh-tools';import {asset} from './nested/asset.${extension}';fs.writeFileSync(new URL('./executed',import.meta.url),'yes');const resource${extension==='ts'?': string':''}='./resource.json';export const inject=['tools'];export function apply(ctx${extension==='ts'?': any':''}){ctx.tools.register(defineTool({name:'resources',description:'Synthetic relocated resources',parameters:{},output:{schema:{type:'json'},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async()=>({...asset(),value:require(resource).value})}));}`);
  const settings={entry:'entry.'+extension,sourceNodePaths:[]};
  const compiled=await precompileSource({packageRoot,settings});
  assert.equal(compiled.file,'precompiled-source.mjs');
  await assert.rejects(fs.access(path.join(source,'executed')));
  const prepared=await fs.readFile(path.join(packageRoot,'runtime',compiled.file),'utf8');
  assert.ok(prepared.includes(JSON.stringify(compiled.marker)));assert.match(prepared,/@deepseek-ai\/dsh-tools/);
  const moved=path.join(root,'moved package');await fs.rename(packageRoot,moved);
  const movedSource=path.join(moved,'source');
  host=await loadDshHost({entry:path.join(movedSource,settings.entry),sourceRoot:movedSource,runtimeRoot:path.join(moved,'runtime','host-env'),stateDir:path.join(root,'state'),services:[],modules:[],codexCapabilities:{codexVersion:'0.160.0',mcp:true,skills:true},precompiledSource:compiled.file,precompiledSourceMarker:compiled.marker});
  const result=await host.tools.find(tool=>tool.name==='resources').execute();
  assert.notEqual(result.isError,true,JSON.stringify(result));
  assert.equal(result.structuredContent.text,'relocated asset');assert.equal(result.structuredContent.value,42);
  assert.equal(result.structuredContent.url,pathToFileURL(path.join(movedSource,'nested','asset.'+extension)).href);
  assert.equal(await fs.readFile(path.join(movedSource,'executed'),'utf8'),'yes');
  const materialized=await fs.readFile(path.join(root,'state','compiled','plugin.mjs'),'utf8');
  assert.ok(!materialized.includes(JSON.stringify(compiled.marker)));assert.ok(materialized.includes(JSON.stringify(pathToFileURL(movedSource+path.sep).href)));
  await host.dispose();
});
