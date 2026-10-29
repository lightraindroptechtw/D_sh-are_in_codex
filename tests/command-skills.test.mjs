import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import YAML from 'yaml';

test('scan and install are separate packaged Codex skills with useful UI names',async()=>{
 for(const name of ['scan','install']){
  const skill=await fs.readFile(new URL(`../skills/${name}/SKILL.md`,import.meta.url),'utf8');
  assert.match(skill,new RegExp('^---\\r?\\nname: '+name+'\\r?\\n'));
  assert.equal((skill.match(/^---$/gm)??[]).length,2);
  const metadata=YAML.parse(await fs.readFile(new URL(`../skills/${name}/agents/openai.yaml`,import.meta.url),'utf8'));
  assert.match(metadata.interface.display_name,/DSH 插件/);
  assert.match(skill,/reviewId/);assert.match(skill,/\.\.\/\.\.\/bin\/dsh-plugin\.mjs/);
 }
 const scan=await fs.readFile(new URL('../skills/scan/SKILL.md',import.meta.url),'utf8'),install=await fs.readFile(new URL('../skills/install/SKILL.md',import.meta.url),'utf8');
 assert.match(scan,/review_dsh_plugin/);assert.doesNotMatch(scan,/呼叫 `install_reviewed_dsh_plugin`/);
 assert.match(install,/install_reviewed_dsh_plugin/);assert.match(install,/consent:true/);assert.match(install,/forceObfuscated:true/);
});
