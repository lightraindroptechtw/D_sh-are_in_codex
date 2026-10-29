import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from '../lib/modules/sandbox-policy.mjs';
import {hostExecutionOptions} from '../lib/host-server.mjs';

test('sandbox policy reports existing scope and cannot grant a requested wider mode',async()=>{
  const {services:{sandboxPolicy:policy}}=await install({workspace:'C:/workspace',filePolicy:{mode:'workspace-write'}});
  assert.deepEqual(policy.resolve(),{mode:'workspace-write',workspaceRoot:'C:/workspace'});
  assert.deepEqual(policy.resolve({session:{id:'chosen',header:{cwd:'C:/chosen'}}}),{mode:'workspace-write',workspaceRoot:'C:/chosen',sessionId:'chosen'});
  assert.equal(policy.overrideOf({}),undefined);
  assert.throws(()=>policy.resolve({mode:'danger-full-access'}),{code:'CODEX_POLICY_READ_ONLY'});
  assert.throws(()=>policy.update('danger-full-access'),{code:'DSH_MODULE_UNSUPPORTED'});
});

test('trusted host derives the file-policy category from its current Node folders',()=>{
  const workspace=process.cwd();
  const sourcePermissions={restrictionsEnabled:true,readRoots:[workspace],writeRoots:[workspace],allowDirectSpawn:false};
  const projected=hostExecutionOptions({root:workspace,stateDir:workspace,options:{workspace},executionPolicy:{cwd:workspace,fullAccess:false,sourcePermissions},endpoint:undefined});
  assert.equal(projected.filePolicy.mode,'workspace-write');
  const restricted=hostExecutionOptions({root:workspace,stateDir:workspace,options:{workspace},executionPolicy:{cwd:workspace,sourcePermissions:{...sourcePermissions,writeRoots:[]}},endpoint:undefined});
  assert.equal(restricted.filePolicy.mode,'read-only');
  const unrestricted=hostExecutionOptions({root:workspace,stateDir:workspace,options:{workspace},executionPolicy:{cwd:workspace,fullAccess:true,sourcePermissions:{restrictionsEnabled:false}},endpoint:undefined});
  assert.equal(unrestricted.filePolicy.mode,'danger-full-access');
});
