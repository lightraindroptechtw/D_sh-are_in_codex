import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {secureGeneratedPackage} from '../lib/security-package.mjs';
import {sandboxArgs} from '../lib/sandbox-launch.mjs';

test('generated policy uses declared settings outside source without adding an undisclosed file blacklist',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-package-policy-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const codexHome=path.join(root,'custom-codex-home'),dataRoot=path.join(root,'market'),converterRoot=path.join(root,'converter');
  const stateDir=path.join(dataRoot,'states','fixture'),packageRoot=path.join(dataRoot,'packages','fixture');
  const present=[path.join(codexHome,'auth.json'),path.join(codexHome,'config.toml'),path.join(dataRoot,'reviews','local-review-key'),path.join(dataRoot,'server.json'),path.join(converterRoot,'runtime','settings.json')];
  for(const file of present){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'synthetic fixture');}
  await fs.mkdir(path.join(packageRoot,'runtime'),{recursive:true});
  await fs.mkdir(path.join(dataRoot,'sources'),{recursive:true});
  await fs.writeFile(path.join(packageRoot,'.mcp.json'),JSON.stringify({mcpServers:{fixture:{command:'node',args:['./runtime/server.mjs']}}}));
  await fs.writeFile(path.join(packageRoot,'runtime','settings.json'),'{}');
  await fs.writeFile(path.join(packageRoot,'runtime','server.mjs'),'// synthetic trusted entry');
  const stopped=Error('stop before launching any Codex process');
  await assert.rejects(secureGeneratedPackage(packageRoot,{stateDir,report:{conversion:{components:[{kind:'dsh-host'}]}},codexHome,dataRoot,converterRoot,onProgress:()=>{throw stopped;}}),error=>error===stopped);
  const policy=JSON.parse(await fs.readFile(path.join(packageRoot,'runtime','security-policy.json'),'utf8'));
  assert.deepEqual(policy.denyRead,[]);
  assert.equal(policy.schemaVersion,3);assert.equal(policy.followHost,true);
  assert.equal(policy.securityDataRoot,path.join(dataRoot,'plugin-security'));
  assert.equal(policy.codexHome,codexHome);assert.equal(policy.stateDir,stateDir);
  assert.ok(!policy.securityDataRoot.startsWith(packageRoot));
});
