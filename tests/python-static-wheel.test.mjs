import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {prepareStaticSourceWheel} from '../lib/python-static-wheel.mjs';
import {resolveLocalPython,runPythonSetup} from '../lib/python-deps.mjs';

async function fixture(t,files){let python;try{python=await resolveLocalPython();}catch{t.skip('local Python 3.10+ unavailable');return null;}const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-static-wheel-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const archive=path.join(root,'source.tar.gz');const created=await runPythonSetup(python.command,['-I','-c',`import sys,json,tarfile,io\nfiles=json.loads(sys.argv[2])\nwith tarfile.open(sys.argv[1],'w:gz') as tar:\n for name,text in files.items():\n  data=text.encode();member=tarfile.TarInfo(name);member.size=len(data);tar.addfile(member,io.BytesIO(data))\n`,archive,JSON.stringify(files)]);assert.equal(created.code,0);const bytes=await fs.readFile(archive),hash=crypto.createHash('sha256').update(bytes).digest('hex');const fetchImpl=async url=>url.startsWith('https://pypi.org/')?Response.json({info:{version:'1.0'},urls:[{packagetype:'sdist',filename:'synthetic-1.0.tar.gz',url:'https://files.pythonhosted.org/packages/synthetic-1.0.tar.gz',digests:{sha256:hash}}]}):new Response(bytes);return {root,python:python.command,runner:runPythonSetup,fetchImpl};}
test('static repack never executes setup.py and preserves pinned source provenance',async t=>{
 const f=await fixture(t,{'synthetic-1.0/setup.py':`from setuptools import setup\nraise RuntimeError('setup must never execute')\nsetup(name='synthetic',version='1.0',packages=['synthetic'],install_requires=['other>=1'])`,'synthetic-1.0/synthetic/__init__.py':`raise RuntimeError('package must never import')`});if(!f)return;
 const result=await prepareStaticSourceWheel('synthetic',f);assert.equal(result.version,'1.0');assert.equal(result.method,'static-literal-setup-repack');assert.match(result.wheelSha256,/^[a-f0-9]{64}$/);assert.ok((await fs.stat(result.wheel)).size>0);
});
test('source archive traversal fails before writing outside its isolated directory',async t=>{
 const f=await fixture(t,{'../../outside.py':'malicious'});if(!f)return;await assert.rejects(prepareStaticSourceWheel('synthetic',f),/無法靜態確認/);await assert.rejects(fs.access(path.join(f.root,'outside.py')),{code:'ENOENT'});
});
test('dynamic setup metadata and custom builds do not enter static repack',async t=>{
 for(const metadata of [`name=unknown()`,`name='synthetic',ext_modules=['native']`]){
  const f=await fixture(t,{'synthetic-1.0/setup.py':`from setuptools import setup\nsetup(${metadata},version='1.0',packages=['synthetic'])`,'synthetic-1.0/synthetic/__init__.py':''});if(!f)return;await assert.rejects(prepareStaticSourceWheel('synthetic',f),/無法靜態確認/);
 }
});
