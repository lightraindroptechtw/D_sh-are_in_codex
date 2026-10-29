import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {McpClient} from '../lib/protocol.mjs';
import {writeCodexPackage} from '../lib/codex-package.mjs';
const root=path.resolve(import.meta.dirname,'..'),entry=path.join(root,'bin/dsh-to-codex.mjs');
const cli=(...args)=>spawnSync(process.execPath,[entry,...args],{cwd:root,encoding:'utf8',timeout:45000,windowsHide:true});
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-public-standard-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source'),output=path.join(dir,'output');await fs.mkdir(source);
 await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'local-unreviewed',version:'1.0.0',type:'module',main:'main.mjs'}));
 await fs.writeFile(path.join(source,'main.mjs'),`export function apply(ctx){ctx.tools.register({name:'echo',description:'echo',parameters:{text:{type:'string',required:true}},output:{type:'object',properties:{text:{type:'string'}},required:['text']},execute:args=>({text:args.text}),render:r=>r.text});}`);
 await writeCodexPackage({outputDir:output,name:'readonly-fixture',description:'Read only fixture',skillText:'Read local information.'});
 return {dir,source,output};
}
test('CLI direct local conversion creates a package and labels its scan unreviewed',async t=>{
 const f=await fixture(t),out=path.join(f.dir,'converted');const result=cli('convert',f.source,'--out',out,'--no-install-dependencies','--no-hooks');
 assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.securityReview.status,'unreviewed');
 assert.ok(Array.isArray(JSON.parse(await fs.readFile(path.join(out,'security-scan.json'),'utf8')).findings));
 assert.equal(report.conversion.verification.toolsListed,false);
});
test('CLI inspection, structural verification and explicit source validation are available',async t=>{
 const f=await fixture(t);assert.equal(cli('inspect',f.source).status,0);const check=cli('verify',f.output,'--execute-source');
 assert.equal(check.status,0,check.stderr);assert.equal(JSON.parse(check.stdout).structure.valid,true);
 const absent=cli('setup',path.join(f.dir,'missing'));assert.notEqual(absent.status,0);assert.doesNotMatch(absent.stderr,/SECURITY_MARKET_REQUIRED|已封鎖/);
});
test('public MCP exposes direct conversion and reports unreviewed scan instead of a market refusal',async t=>{
 const f=await fixture(t),client=new McpClient({command:process.execPath,args:[entry,'serve'],cwd:root},{cwd:root,timeout:45000});t.after(()=>client.close());await client.start();
 const tools=await client.listTools();assert.doesNotMatch(tools.find(t=>t.name==='convert_dsh_plugin').description,/暫停/);
 const converted=await client.request('tools/call',{name:'convert_dsh_plugin',arguments:{source:f.source,outputDir:path.join(f.dir,'converted'),installDependencies:false,hooks:false}});
 assert.notEqual(converted.isError,true,JSON.stringify(converted));assert.equal(converted.structuredContent.securityReview.status,'unreviewed');
 const verified=await client.request('tools/call',{name:'verify_codex_plugin',arguments:{outputDir:f.output,executeSource:true}});assert.notEqual(verified.isError,true,JSON.stringify(verified));
});
