import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {hostExecutionOptions} from '../lib/host-server.mjs';

test('host options preserve plugin-owned executable settings and never write a private state file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'state-runtime-'));try{
  const stateDir=path.join(root,'state');await fs.mkdir(stateDir);const file=path.join(stateDir,'config.json');
  const original=JSON.stringify({dshBin:'user-chosen-dsh',pythonPath:'user-chosen-python',enabled:true});await fs.writeFile(file,original);
  const config={dshBin:'plugin-default',pythonPath:'python'};
  const resolved=hostExecutionOptions({root,stateDir,options:{config,runtimeBindings:{dshBin:'dsh-codex-cli.mjs',pythonPath:process.execPath,stateConfigFile:'config.json',stateSubdir:'.'}},executionPolicy:null});
  assert.deepEqual(resolved.config,config);assert.equal(await fs.readFile(file,'utf8'),original);assert.deepEqual(await fs.readdir(stateDir),['config.json']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('source Node allowlists include package state and workspace under both native policies',()=>{
  const root=path.resolve('package'),stateDir=path.resolve('state'),cwd=path.resolve('project');
  const options={workerPermissions:{readRoots:[root],writeRoots:[stateDir]},config:{enabled:true}};
  for(const fullAccess of [false,true]){
    const resolved=hostExecutionOptions({root,stateDir,options,executionPolicy:{mode:'codex-host',cwd,fullAccess}});
    assert.deepEqual(resolved.workerPermissions,{readRoots:[root,stateDir,cwd],writeRoots:[stateDir,cwd],allowDirectSpawn:false});assert.equal(resolved.workspace,cwd);assert.equal(options.workerPermissions.writeRoots[0],stateDir);
  }
  const fallback=hostExecutionOptions({root,stateDir,options,executionPolicy:{mode:'restricted-state'}});
  assert.deepEqual(fallback.workerPermissions,{readRoots:[root,stateDir,process.cwd()],writeRoots:[stateDir,process.cwd()],allowDirectSpawn:false});
});

test('task capability reaches the source worker without forwarding login credentials',()=>{
  const value=hostExecutionOptions({root:'.',stateDir:'.',options:{},executionPolicy:null,endpoint:'http://127.0.0.1:31337/scoped-token'});
  assert.deepEqual(Object.keys(value.env),['DSH_CODEX_TASK_ENDPOINT']);assert.equal(typeof value.bridgeRequest,'function');
  assert.throws(()=>hostExecutionOptions({options:{},endpoint:'https://example.com/token'}),/trusted task/);
});
