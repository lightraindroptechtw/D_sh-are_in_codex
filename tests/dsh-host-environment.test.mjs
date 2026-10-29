import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadDshHost} from '../lib/dsh-host.mjs';
import {createPluginSecurity} from '../lib/plugin-security.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-host-environment-')),workerPath=path.join(root,'worker.mjs');
  const hosts=[];
  t.after(async()=>{for(const host of hosts)await host.dispose();await fs.rm(root,{recursive:true,force:true});});
  await fs.writeFile(workerPath,`process.on('message',m=>{
    if(m.method==='initialize')process.send({id:m.id,result:{tools:[{name:'environment'}],metadata:{unsupported:[]}}});
    else if(m.method==='execute')process.send({id:m.id,result:Object.fromEntries(m.params.args.names.map(name=>[name,process.env[name]??null]))});
    else if(m.method==='dispose')process.send({id:m.id,result:{disposed:true}});
  });`);
  const options={entry:path.join(root,'unused.mjs'),stateDir:path.join(root,'state'),workerPath};
  return {root,options,async load(extra){const host=await loadDshHost({...options,...extra});hosts.push(host);return host;}};
}

test('Windows names with parentheses and spaces reach the worker after secret filtering',async t=>{
  const f=await fixture(t),security=createPluginSecurity({pluginId:'environment-fixture',dataRoot:path.join(f.root,'security')});
  t.after(()=>security.close());await security.load();
  const ordinary={'CommonProgramFiles(x86)':'synthetic-common','ProgramFiles(x86)':'synthetic-programs','IntelliJ IDEA':'synthetic-ide'};
  const env=security.sourceEnvironment({...ordinary,UNDECLARED_API_KEY:'synthetic-must-not-leak',NODE_OPTIONS:'--invalid',HOME:'synthetic-home'});
  const host=await f.load({env,passEnv:Object.keys(ordinary)});
  assert.deepEqual(await host.tools[0].execute({names:[...Object.keys(ordinary),'UNDECLARED_API_KEY','NODE_OPTIONS','HOME']}),{
    ...ordinary,UNDECLARED_API_KEY:null,NODE_OPTIONS:null,HOME:f.options.stateDir,
  });
});

test('invalid OS environment names and NUL values are rejected before spawning the worker',async t=>{
  const f=await fixture(t);
  for(const name of ['', 'BAD=NAME', 'BAD\0NAME']){
    await assert.rejects(f.load({env:{[name]:'synthetic'}}),TypeError);
    await assert.rejects(f.load({passEnv:[name]}),TypeError);
  }
  for(const value of [null,1,'synthetic\0value'])await assert.rejects(f.load({env:{ORDINARY:value}}),TypeError);
});
