import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {protocolCapabilities,summarizeProtocolSchema} from '../lib/codex-capabilities.mjs';

const schema={definitions:{TurnParams:{properties:{threadId:{},input:{}}}},oneOf:[{properties:{method:{enum:['turn/start']},params:{$ref:'#/definitions/TurnParams'}}},{properties:{method:{const:'thread/read'},params:{properties:{threadId:{}}}}}]};
test('installed schema is reduced to names and parameter names, without entire definitions',()=>{
  assert.deepEqual(summarizeProtocolSchema(schema),[{name:'thread/read',parameters:['threadId']},{name:'turn/start',parameters:['threadId','input'],ref:'#/definitions/TurnParams'}]);
});
test('schema generation is a local CLI call cached by executable/version; failure is advisory',async t=>{
  const dataRoot=await fs.mkdtemp(path.join(os.tmpdir(),'codex schema '));t.after(()=>fs.rm(dataRoot,{recursive:true,force:true}));let calls=0;
  const runner=async(command,args)=>{calls++;assert.equal(command,'synthetic-cli');assert.deepEqual(args.slice(0,3),['app-server','generate-json-schema','--out']);const output=args[3];await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'ClientRequest.json'),JSON.stringify(schema));return {stdout:''};};
  const a=await protocolCapabilities({command:'synthetic-cli',codexVersion:'0.160.0',dataRoot,runner});
  const b=await protocolCapabilities({command:'synthetic-cli',codexVersion:'0.160.0',dataRoot,runner});
  assert.equal(a.found,true);assert.equal(a.modelCalls,0);assert.equal(a.methodCount,2);assert.deepEqual(a,b);assert.equal(calls,1);
  assert.ok((await fs.stat(a.path)).size<2000);
  await protocolCapabilities({command:'synthetic-cli',codexVersion:'0.161.0',dataRoot,runner});assert.equal(calls,2);
  const failed=await protocolCapabilities({command:'unavailable-cli',codexVersion:'0.160.0',dataRoot,runner:async()=>{throw Error('not installed');}});
  assert.equal(failed.found,false);assert.equal(failed.modelCalls,0);assert.match(failed.reason,/不作為安裝門檻/);
});
