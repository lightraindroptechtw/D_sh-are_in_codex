import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {convert} from '../lib/converter.mjs';
import {inspectSource} from '../lib/inspect.mjs';
import {precompileSource} from '../lib/precompile-source.mjs';
import {loadDshHost} from '../lib/dsh-host.mjs';
import {resolveConfigExpressions} from '../lib/compat/dsh-expression.mjs';

test('multiple declared subpath entries survive inspection, conversion and precompilation, then both original tools execute',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-runtime-parity '));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150}));
 const source=path.join(root,'source'),output=path.join(root,'converted');await fs.mkdir(source);
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'synthetic-multi',version:'1',type:'module',dependencies:{'@deepseek-ai/dsh-tools':'0.2.1-alpha.2'},exports:{'./first':'./first.ts','./second':'./second.ts'},dsh:{bundle:{patch:'cordis.patch.yml'}}}));
 await fs.writeFile(path.join(source,'cordis.patch.yml'),`- insert:\n  - id: first\n    name: synthetic-multi/first\n    config:\n      label: retained\n      key: !!js process.env.SYNTHETIC_PLUGIN_KEY\n  - id: second\n    name: synthetic-multi/second\n    config:\n      count: 42\n`);
 const header=`import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';const localRequire=createRequire(import.meta.url);import {defineTool} from '@deepseek-ai/dsh-tools'; import {CallId,deepFreeze,assertNever} from '@deepseek-ai/dsh-llm';`;
 await fs.writeFile(path.join(source,'first.ts'),header+`export function apply(ctx,config){ctx.tools.register(defineTool({name:'first',description:'first',parameters:{},output:{schema:{type:'json'},render:(_,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async()=>{const value={label:config.label,hasKey:config.key==='explicit-synthetic-key',id:CallId('legacy')};deepFreeze(value);return value;}}));return {api:true,dispose(){}};}`);
 await fs.writeFile(path.join(source,'second.ts'),header+`export const inject=['tools','commands'];export function apply(ctx,config){ctx.tools.register(defineTool({name:'second',description:'second',parameters:{},output:{schema:{type:'json'},render:(_,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async()=>({count:config.count})}));ctx.commands.register({name:'hello',description:'hello',handler:({rawInput})=>({kind:'success',text:'hello'+rawInput})});ctx.commands.register({name:'version',description:'version',handler:()=>({kind:'success',text:JSON.parse(readFileSync(localRequire.resolve('@deepseek-ai/dsh-tools/package.json'),'utf8')).version})});}`);
 const plan=await inspectSource(source);assert.equal(plan.entries.length,2);assert.deepEqual(plan.environment.requiredNames,['SYNTHETIC_PLUGIN_KEY']);assert.deepEqual(plan.capabilities.toolRuntime.tools.map(tool=>tool.name),['first','second']);
 const report=await convert(source,{outputDir:output,installDependencies:false,hooks:false});assert.ok(report.conversion.components.some(row=>row.kind==='dsh-host'));
 const settings=JSON.parse(await fs.readFile(path.join(output,'runtime/settings.json'),'utf8'));assert.equal(settings.entries.length,2);
 const compiled=await precompileSource({packageRoot:output,settings});assert.equal(compiled.entries.length,2);
 const host=await loadDshHost({...settings,entry:path.join(output,'source',settings.entry),sourceRoot:path.join(output,'source'),stateDir:path.join(root,'state'),runtimeRoot:path.join(output,'runtime/host-env'),precompiledEntries:compiled.entries,initializeTimeoutMs:10000,callTimeoutMs:3000,env:{SYNTHETIC_PLUGIN_KEY:'explicit-synthetic-key'}});t.after(()=>host.dispose());
 try{
 const first=await host.tools.find(tool=>tool.name==='first').execute();assert.equal(first.isError,false,JSON.stringify(first));assert.deepEqual(first.structuredContent,{label:'retained',hasKey:true,id:'legacy'});
 const second=await host.tools.find(tool=>tool.name==='second').execute();assert.deepEqual(second.structuredContent,{count:42});
 assert.equal((await host.request('commands.run',{name:'hello',args:'world'})).text,'hello world');
 assert.equal((await host.request('commands.run',{name:'version'})).text,'0.2.1-alpha.2');
 assert.ok((await host.describe()).compat.some(row=>row.id==='version-alias'&&row.reports==='0.2.1-alpha.2'));
 assert.ok((await host.describe()).compat.some(row=>row.id==='apply-return-value'));
 const disk=await fs.readFile(path.join(root,'state/profiles/codex-bridge/node_modules/codex-host-bundle/cordis.patch.yml'),'utf8');assert.ok(!disk.includes('explicit-synthetic-key'));
 }finally{await host.dispose();}
});

test('unsupported expression drops only that field while static configuration remains',()=>{
 const notes=[],resolved=resolveConfigExpressions({label:'keep',bad:{$dshExpression:'require("fs")'},key:{$dshExpression:'process.env.KEY ?? "fallback"'}},{env:{},onUnsupported:text=>notes.push(text)});
 assert.deepEqual(resolved,{label:'keep',key:'fallback'});assert.equal(notes.length,1);
});
