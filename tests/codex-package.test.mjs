import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeCodexPackage, validateCodexPackage } from '../lib/codex-package.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex package with spaces '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const base = { name: 'sample-plugin', description: '測試本機技能', skillText: 'Use the bundled tools.' };

test('writes a valid skills package, adding frontmatter and interface', async t => {
  const root = await fixture(t);
  const result = await writeCodexPackage({ ...base, outputDir: root, metadata: { interface: { displayName: '範例插件' }, skills: './evil/' } });
  assert.equal(result.manifest.interface.displayName, '範例插件');
  assert.equal(result.manifest.skills, './skills/');
  assert.equal(result.mcpPath, null);
  assert.equal((await validateCodexPackage(root)).valid, true);
});

test('keeps valid supplied skill frontmatter and its own directory name', async t => {
  const root = await fixture(t);
  const skillText = '---\nname: another-skill\ndescription: "Find data: safely"\n---\n\nRead it.\n';
  const result = await writeCodexPackage({ ...base, outputDir: root, skillText });
  assert.equal(await readFile(result.skillPath, 'utf8'), skillText);
  assert.equal((await validateCodexPackage(root)).valid, true);
});

test('root marker becomes a relative argument with plugin-relative cwd', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'bin'));
  await writeFile(path.join(root, 'bin', 'server.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  const result = await writeCodexPackage({ ...base, outputDir: root, mcpServers: { sample: { command: process.execPath, args: ['${CODEX_PLUGIN_ROOT}/bin/server.mjs', 'argument with spaces'] } } });
  const server = JSON.parse(await readFile(result.mcpPath, 'utf8')).mcpServers.sample;
  assert.deepEqual(server.args, ['./bin/server.mjs', 'argument with spaces']);
  assert.equal(server.cwd, '.');
  // This verifies real Node argument handling in a directory containing spaces.
  // It intentionally does not claim to be a Codex MCP initialization test.
  const actual = spawnSync(server.command, server.args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(actual.status, 0, actual.stderr);
  assert.deepEqual(JSON.parse(actual.stdout), ['argument with spaces']);
  assert.equal((await validateCodexPackage(root)).valid, true);
});

test('rejects root traversal before writing configuration', async t => {
  const root = await fixture(t);
  await assert.rejects(writeCodexPackage({ ...base, outputDir: root, mcpServers: { sample: { command: 'node', args: ['${CODEX_PLUGIN_ROOT}/../outside.mjs'] } } }), /escapes/);
  await assert.rejects(writeCodexPackage({ ...base, name: '../evil', outputDir: root }), /kebab-case/);
});

test('reports missing entry point and invalid MCP argument types', async t => {
  const root = await fixture(t);
  const result = await writeCodexPackage({ ...base, outputDir: root, mcpServers: { sample: { command: 'node', args: ['./missing.mjs'] } } });
  let check = await validateCodexPackage(root);
  assert.equal(check.valid, false);
  assert.match(check.errors.join('\n'), /entry point does not exist/);
  await writeFile(result.mcpPath, JSON.stringify({ mcpServers: { sample: { command: 'node', args: [12] } } }));
  check = await validateCodexPackage(root);
  assert.match(check.errors.join('\n'), /args must be a string array/);
});

test('reports manifest path traversal and malformed JSON', async t => {
  const root = await fixture(t);
  const result = await writeCodexPackage({ ...base, outputDir: root });
  result.manifest.skills = './../outside';
  await writeFile(result.manifestPath, JSON.stringify(result.manifest));
  assert.match((await validateCodexPackage(root)).errors.join('\n'), /inside the package/);
  await writeFile(result.manifestPath, '{');
  assert.equal((await validateCodexPackage(root)).valid, false);
});

test('detects missing skill description instead of claiming successful loading', async t => {
  const root = await fixture(t);
  await writeCodexPackage({ ...base, outputDir: root, skillText: '---\nname: sample-plugin\n---\nIncomplete.' });
  const result = await validateCodexPackage(root);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /frontmatter description/);
  assert.match(result.warnings.join('\n'), /structural checks only/);
});

test('imported skill may use a declared name different from its resource directory',async t=>{
  const root=await fixture(t);
  const result=await writeCodexPackage({...base,outputDir:root});
  const resourceDir=path.join(root,'source','skill');await mkdir(resourceDir,{recursive:true});
  const original='---\nname: actual-skill\ndescription: Read sibling resource\n---\nRead ./reference.txt.\n';
  await writeFile(path.join(resourceDir,'SKILL.md'),original);
  await writeFile(path.join(resourceDir,'reference.txt'),'Original sibling resource');
  result.manifest.skills=['./skills/','./source/skill'];
  await writeFile(result.manifestPath,JSON.stringify(result.manifest));
  const checked=await validateCodexPackage(root);
  assert.equal(checked.valid,true,checked.errors.join('\n'));
  assert.match(checked.warnings.join('\n'),/differs from its resource directory/);
  assert.equal(await readFile(path.join(resourceDir,'SKILL.md'),'utf8'),original);
  assert.equal(await readFile(path.join(resourceDir,'reference.txt'),'utf8'),'Original sibling resource');
  await writeFile(path.join(resourceDir,'SKILL.md'),'---\nname: ../escape\ndescription: Invalid\n---\n');
  assert.equal((await validateCodexPackage(root)).valid,false);
});
