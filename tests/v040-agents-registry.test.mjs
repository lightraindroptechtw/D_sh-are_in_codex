import test from 'node:test';
import assert from 'node:assert/strict';
import {registry,selectModules,installModules} from '../lib/modules/index.mjs';

function root(values={}){
  const map=new Map(Object.entries(values)),provided=[];
  return {provided,get:name=>map.get(name),provide(name,value){if(map.has(name))throw new Error('duplicate service');map.set(name,value);provided.push(name);return ()=>map.delete(name);}};
}

test('registry descriptors use the shared contract and static service aliases',()=>{
  for(const [id,module]of registry){assert.equal(module.descriptor.id,id);assert.ok(Array.isArray(module.descriptor.services));assert.equal(typeof module.install,'function');assert.ok(module.descriptor.requires);assert.ok(module.descriptor.methods);assert.ok(Array.isArray(module.descriptor.requirements));}
  const selected=selectModules({host:{services:['timer','webServer','agents','tools','sessionQuery']}});
  assert.deepEqual(selected.map(row=>row.id),['timer','webServer','approval','systemPrompt','agents','background']);
  assert.equal(selected.find(row=>row.id==='agents').available,false);
  assert.equal(selected.find(row=>row.id==='timer').available,true);
  assert.deepEqual(selectModules({},{modules:['credentials']},{codexVersion:'0.160.0'}).map(row=>row.id),['credentials']);
});

test('selection handles nested hook capabilities and explicit interception',()=>{
  const caps={codexVersion:'0.160.0',hooks:{SessionStart:true,UserPromptSubmit:true,PreToolUse:true,PostToolUse:true}};
  const selected=selectModules({events:['tools/pre-execute']},{},caps);
  assert.equal(selected.find(row=>row.id==='systemPrompt').available,true);assert.equal(selected.find(row=>row.id==='interception').available,true);
  assert.equal(selectModules({},{modules:['systemPrompt'],disabledModules:['systemPrompt']},caps)[0].available,false);
});

test('installation preserves host-owned official services and disables only missing projections',async()=>{
  const originals=Object.fromEntries(['timer','fs','settings','webServer','skills','systemPrompt'].map(name=>[name,{identity:name}]));
  const ctx=root(originals),selected=selectModules({},{modules:[...Object.keys(originals),'agents']},{});
  const runtime=await installModules({root:ctx,selected,capabilities:{}});
  for(const [name,value]of Object.entries(originals))assert.equal(ctx.get(name),value);
  assert.deepEqual(ctx.provided,['agents']);assert.throws(()=>ctx.get('agents').create(),{module:'agents',method:'create'});
  assert.ok(runtime.diagnostics.some(row=>row.module==='agents'&&row.status==='disabled'));await runtime.dispose();
});

test('disabled Codex command projection still guards the existing official execute method',async()=>{
  const commands={list(){return ['registered-command'];},execute(){return 'should never execute';}},ctx=root({commands});
  const runtime=await installModules({root:ctx,selected:selectModules({},{modules:['commands']},{}),capabilities:{}});
  assert.deepEqual(commands.list(),['registered-command']);assert.throws(()=>commands.execute(),{module:'commands',method:'execute'});
  assert.equal(runtime.modules[0].status,'disabled');await runtime.dispose();assert.equal(commands.execute(),'should never execute');
});

test('registry gives each module its own options and contains install and cleanup failures',async()=>{
  const seen=[],ctx=root();
  const descriptor=id=>({id,displayName:id,services:[id],requires:{minimumCodexVersion:null,capabilities:[]},methods:{},requirements:[]});
  registry.set('test-broken',{descriptor:descriptor('test-broken'),async install(){throw Object.assign(new Error('synthetic-secret-do-not-log'),{code:'SYNTHETIC'});}});
  registry.set('test-first',{descriptor:descriptor('test-first'),async install({options}){seen.push(options);return {services:{'test-first':{ready:true}},async dispose(){seen.push('first-disposed');throw new Error('synthetic-secret-cleanup');}};}});
  registry.set('test-last',{descriptor:descriptor('test-last'),async install(){return {services:{'test-last':{ready:true}},async dispose(){seen.push('last-disposed');}};}});
  try{
    const runtime=await installModules({root:ctx,selected:selectModules({},{modules:['test-broken','test-first','test-last']}),options:{'test-first':{local:true}}});
    assert.deepEqual(seen,[{local:true}]);assert.throws(()=>ctx.get('test-broken').call(),{module:'test-broken'});
    assert.equal(ctx.get('test-last').ready,true);assert.doesNotMatch(JSON.stringify(runtime.diagnostics),/synthetic-secret/);
    await runtime.dispose();assert.deepEqual(seen,[{local:true},'last-disposed','first-disposed']);assert.equal(ctx.get('test-last'),undefined);
  }finally{for(const name of ['test-broken','test-first','test-last'])registry.delete(name);}
});

test('unknown service receives an explicit module error and never replaces core context APIs',async()=>{
  const ctx=root(),selected=selectModules({},{modules:['unknownService','constructor','tools']});
  assert.deepEqual(selected.map(row=>row.id),['unknownService']);const runtime=await installModules({root:ctx,selected});
  assert.throws(()=>ctx.get('unknownService').run(),{module:'unknownService',method:'run'});await runtime.dispose();
});
