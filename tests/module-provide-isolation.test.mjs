import test from 'node:test';
import assert from 'node:assert/strict';
import {installModules,registry} from '../lib/modules/index.mjs';

test('a failed service registration does not stop other modules or expose its error',async()=>{
  const mounted=new Map(),secret='synthetic-secret-value';
  const root={get:name=>mounted.get(name),provide(name,value){
    if(name==='fixtureFailure')throw new Error(`provider error ${secret}`);
    mounted.set(name,value);return ()=>mounted.delete(name);
  }};
  const modules=['fixtureFailure','fixtureSuccess'].map(id=>({
    descriptor:{id,services:[id]},
    async install(){return {services:{[id]:{id}}};},
  }));
  for(const module of modules)registry.set(module.descriptor.id,module);
  try{
    const selected=modules.map(({descriptor})=>({id:descriptor.id,descriptor,available:true}));
    const result=await installModules({root,selected});
    assert.equal(mounted.get('fixtureSuccess')?.id,'fixtureSuccess');
    assert.equal(result.services.fixtureSuccess.id,'fixtureSuccess');
    assert.ok(result.diagnostics.some(row=>row.code==='SERVICE_PROVIDE_FAILED'&&row.reason.includes('fixtureFailure')));
    assert.equal(JSON.stringify(result.diagnostics).includes(secret),false);
    await result.dispose();
  }finally{
    for(const module of modules)registry.delete(module.descriptor.id);
  }
});
