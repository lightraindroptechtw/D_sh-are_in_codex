import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {copyHostEnvironment} from '../lib/host-files.mjs';
import {createRequire} from 'node:module';
test('host dependency copying keeps nested versions and licenses without running package scripts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'host packages '));t.after(()=>fs.rm(root,{recursive:true,force:true}));const fromRoot=path.join(root,'installed'),toRoot=path.join(root,'portable');
  const put=async(file,text)=>{const target=path.join(fromRoot,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text);};
  await put('package.json',JSON.stringify({dependencies:{'@deepseek-ai/alpha':'1','@deepseek-ai/beta':'1'}}));
  for(const name of ['alpha','beta'])await put(`node_modules/@deepseek-ai/${name}/package.json`,JSON.stringify({name:'@deepseek-ai/'+name,version:'1.0.0',dependencies:{shared:name==='alpha'?'1':'2'},scripts:{postinstall:'MUST NOT RUN'}}));
  await put('node_modules/@deepseek-ai/alpha/node_modules/shared/package.json',JSON.stringify({name:'shared',version:'1.0.0'}));await put('node_modules/shared/package.json',JSON.stringify({name:'shared',version:'2.0.0'}));await put('node_modules/@deepseek-ai/alpha/LICENSE','License alpha');
  const result=await copyHostEnvironment({fromRoot,toRoot});assert.equal(result.packages.length,4);assert.equal(result.installScriptsExecuted,false);assert.equal(JSON.parse(await fs.readFile(path.join(toRoot,'node_modules/@deepseek-ai/alpha/node_modules/shared/package.json'),'utf8')).version,'1.0.0');assert.equal(JSON.parse(await fs.readFile(path.join(toRoot,'node_modules/shared/package.json'),'utf8')).version,'2.0.0');assert.equal(await fs.readFile(path.join(toRoot,'node_modules/@deepseek-ai/alpha/LICENSE'),'utf8'),'License alpha');
});

test('portable Host copies the TypeScript parser needed for source Remote invocation',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'portable typert parser '));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const fromRoot=path.join(root,'converter'),toRoot=path.join(root,'portable');
  for(const [name,version]of [['@deepseek-ai/dsh-typert-registry','0.2.1-rc.2'],['typescript','5.9.3']]){
    const dir=path.join(fromRoot,'node_modules',name);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name,version,main:'index.js'}));await fs.writeFile(path.join(dir,'index.js'),'module.exports={portable:true};');
  }
  await fs.writeFile(path.join(fromRoot,'package.json'),JSON.stringify({dependencies:{'@deepseek-ai/dsh-typert-registry':'0.2.1-rc.2',typescript:'5.9.3'}}));
  const result=await copyHostEnvironment({fromRoot,toRoot});assert.ok(result.packages.some(row=>row.name==='typescript'&&row.version==='5.9.3'));
  await fs.rm(fromRoot,{recursive:true});const require=createRequire(path.join(toRoot,'package.json'));assert.equal(require('typescript').portable,true);
});
