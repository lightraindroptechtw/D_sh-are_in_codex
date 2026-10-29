import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {preparePythonDependencies,resolveLocalPython,runPythonSetup} from '../lib/python-deps.mjs';

async function fixture(t,text='synthetic>=1,<2'){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-python-deps-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'source'));await fs.writeFile(path.join(root,'source/requirements.txt'),text);return root;}
const components=[{kind:'python-mcp',requirements:'requirements.txt'}];
test('Python requirement downloader, local files and build flags are rejected before resolution',async t=>{
 for(const input of ['-r other.txt','--index-url https://evil.invalid','https://evil.invalid/a.whl','package @ https://evil.invalid/a.whl','./source-project','-e project']){
  const root=await fixture(t,input);let calls=0;
  const runner=async()=>{calls++;return {code:0,stdout:JSON.stringify({executable:process.execPath,version:[3,12,1]})};};
  await assert.rejects(preparePythonDependencies(root,{components,runner}),/僅接受 PyPI/);assert.equal(calls,1);
 }
});
test('wheel bytes must match the resolved SHA256 before extraction or approval',async t=>{
 const root=await fixture(t);let extract=false;
 const runner=async(command,args)=>{
  if(args.includes('--report')){await fs.writeFile(args[args.indexOf('--report')+1],JSON.stringify({install:[{metadata:{name:'synthetic',version:'1.0'},download_info:{url:'https://files.pythonhosted.org/packages/synthetic-1.0-py3-none-any.whl',archive_info:{hashes:{sha256:'a'.repeat(64)}}}}]}));return {code:0};}
  if(args.includes('-c')&&args[args.indexOf('-c')+1].includes('zipfile'))extract=true;
  return {code:0,stdout:JSON.stringify({executable:process.execPath,version:[3,12,1]})};
 };
 await assert.rejects(preparePythonDependencies(root,{components,runner,fetchImpl:async()=>new Response('bad wheel')}),/SHA256 不符/);assert.equal(extract,false);
});
test('synthetic wheel is safely unpacked, provenance pinned and binary/text review distinguished',async t=>{
 let python;try{python=await resolveLocalPython();}catch{t.skip('local Python 3.10+ unavailable');return;}
 const root=await fixture(t),wheel=path.join(root,'synthetic.whl');
 const created=await runPythonSetup(python.command,['-I','-c',`import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('synthetic/__init__.py','raise RuntimeError("must not import")')\n z.writestr('synthetic/native.pyd',bytes([0,255,1]))\n`,wheel]);assert.equal(created.code,0);
 const bytes=await fs.readFile(wheel),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const runner=async(command,args,options)=>{
  if(args.includes('--report')){assert.ok(args.includes('--only-binary=:all:'));assert.ok(args.includes('--dry-run'));await fs.writeFile(args[args.indexOf('--report')+1],JSON.stringify({install:[{metadata:{name:'synthetic',version:'1.0'},download_info:{url:'https://files.pythonhosted.org/packages/synthetic-1.0-py3-none-any.whl',archive_info:{hashes:{sha256:hash}}}}]}));return {code:0};}
  return runPythonSetup(command,args,options);
 };
 const result=await preparePythonDependencies(root,{components,python:python.command,runner,fetchImpl:async()=>new Response(bytes)});
 assert.equal(result.status,'needs-review');assert.equal(result.sourceBuildExecuted,false);assert.equal(result.artifacts[0].sha256,hash);assert.equal(result.binaryFiles,1);assert.equal(result.textFiles,1);assert.match(await fs.readFile(path.join(result.textReviewRoot,'synthetic/__init__.py'),'utf8'),/must not import/);await assert.rejects(fs.access(path.join(result.textReviewRoot,'synthetic/native.pyd')),{code:'ENOENT'});
});
test('pyproject metadata is not accepted as a requirements file',async t=>{
 const root=await fixture(t);await fs.writeFile(path.join(root,'source/pyproject.toml'),'[project]\ndependencies=["synthetic>=1"]');let resolutions=0;
 const runner=async(_command,args)=>{if(args.includes('--report'))resolutions++;return {code:0,stdout:JSON.stringify({executable:process.execPath,version:[3,10,0]})};};
 await assert.rejects(preparePythonDependencies(root,{components:[{kind:'python-mcp',dependencyFiles:['pyproject.toml']}],runner}),/不支援的 Python/);assert.equal(resolutions,0);
});
