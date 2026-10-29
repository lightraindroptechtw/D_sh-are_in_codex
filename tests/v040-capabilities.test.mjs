import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeCodexCapabilities,moduleAvailability} from '../lib/codex-capabilities.mjs';
test('missing/old Codex disables dependent modules without affecting native services',async()=>{
 const missing=await probeCodexCapabilities({runner:async()=>{throw new Error('absent');}});
 assert.equal(missing.appServer,false);
 assert.equal(moduleAvailability({requires:{minimumCodexVersion:'0.160.0',capabilities:['appServer']}},missing).enabled,false);
 assert.equal(moduleAvailability({requires:{minimumCodexVersion:null,capabilities:[]}},missing).enabled,true);
 const old=await probeCodexCapabilities({runner:async(_,args)=>({stdout:args[0]==='--version'?'codex-cli 0.159.0':'--stdio'})});
 assert.equal(old.hooks.PreToolUse,false);
 const current=await probeCodexCapabilities({runner:async(_,args)=>({stdout:args[0]==='--version'?'codex-cli 0.160.0':'--stdio'})});
 assert.equal(current.appServer,true);assert.equal(current.hooks.PreToolUse,true);assert.equal(current.elicitation,'negotiated');
});
