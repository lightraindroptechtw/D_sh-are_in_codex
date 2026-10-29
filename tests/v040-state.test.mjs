import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stablePluginId,resolvePluginState,migrateLegacyState} from '../lib/state-paths.mjs';

test('persistent state survives package cache/version relocation',()=>{
 const stateId=stablePluginId({origin:'https://github.com/example/plugin',name:'example-plugin'});
 const options={stateId},env={CODEX_HOME:path.join(os.tmpdir(),'isolated-codex')};
 assert.equal(resolvePluginState({root:'/cache/0.3.1',options,env}),resolvePluginState({root:'/cache/0.4.0',options,env}));
 assert.notEqual(stateId,stablePluginId({origin:'https://github.com/example/plugin',name:'example-plugin',packageDir:'other'}));
 assert.throws(()=>resolvePluginState({root:'/cache',options:{stateId:'../escape'},env}),/Invalid/);
});

test('explicit migration copies legacy settings once and refuses overwrite',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'dsh state migration '));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const root=path.join(base,'package');await fs.mkdir(path.join(root,'.state'),{recursive:true});await fs.writeFile(path.join(root,'.state','settings.json'),'{"count":7}');
 const options={stateId:'example-123',stateRoot:path.join(base,'persistent')};
 assert.equal((await migrateLegacyState({root,options,dryRun:true})).status,'planned');
 const migrated=await migrateLegacyState({root,options});assert.equal(migrated.sourceRetained,true);
 assert.equal(await fs.readFile(path.join(migrated.to,'settings.json'),'utf8'),'{"count":7}');
 assert.equal(await fs.readFile(path.join(root,'.state/settings.json'),'utf8'),'{"count":7}');
 await assert.rejects(migrateLegacyState({root,options}),/refusing overwrite/);
});
