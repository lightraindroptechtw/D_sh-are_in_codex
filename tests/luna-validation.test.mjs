import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convert, verify } from '../lib/converter.mjs';
import { McpClient } from '../lib/protocol.mjs';

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-luna-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(source, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return { root, source, out: path.join(root, 'generated') };
}

const entry = `import {defineTool} from '@deepseek-ai/dsh-tools';
export function apply(ctx){
  ctx.tools.register(defineTool({name:'allowed',description:'Allowed',parameters:{},execute:async()=> 'allowed'}));
  ctx.tools.register(defineTool({name:'blocked',description:'Blocked',parameters:{},execute:async()=> 'blocked'}));
}`;

test('nested plugin root and explicit nested entry stay scoped to the selected source', async t => {
  const f = await fixture(t, {
    'package.json': '{"name":"decoy","main":"index.js"}',
    'index.js': `export function apply(){throw new Error('decoy must not run')}`,
    'plugins/real/package.json': '{"name":"nested-real"}',
    'plugins/real/src/main.ts': entry,
  });
  const out = path.join(f.root, 'nested-output');
  const selected = path.join(f.source, 'plugins/real');
  const report = await convert(selected, { outputDir: out, sourceEntry: 'src/main.ts', engine:'portable-tools',stateRoot:path.join(f.root,'state') });
  assert.equal(report.entry, 'src/main.ts');
  assert.equal(report.conversion.components.some(c => c.kind === 'dsh-tools'), true);
  assert.equal((await verify(out, { executeSource: true, call: 'allowed' })).servers[0].status, 'tool-called');
  await assert.rejects(convert(selected, { outputDir: path.join(f.root, 'escape-output'), sourceEntry: '../index.js' }), /必須存在於來源資料夾內/);
});

test('portable tool allow-list is enforced at the served MCP boundary', async t => {
  const f = await fixture(t, { 'package.json': '{"name":"allowlist","main":"index.js","type":"module"}', 'index.js': entry });
  const report = await convert(f.source, { outputDir: f.out, stateRoot:path.join(f.root,'state'), engine: 'portable-tools', allowTools: ['allowed'] });
  const server = report.conversion.components.find(c => c.kind === 'dsh-tools').name;
  const listed = await verify(f.out, { executeSource: true, server });
  assert.deepEqual(listed.servers[0].tools.map(tool => tool.name), ['allowed']);
  assert.equal((await verify(f.out, { executeSource: true, server, call: 'allowed' })).servers[0].status, 'tool-called');
  assert.equal((await verify(f.out, { executeSource: true, server, call: 'blocked' })).servers[0].status, 'failed');
});

test('startup failure after an effect runs cleanup in the generated package', async t => {
  const f = await fixture(t, {
    'package.json': '{"name":"cleanup-probe","main":"index.js","type":"module"}',
    'index.js': `import {writeFileSync} from 'node:fs';export function apply(ctx){ctx.effect(()=>()=>writeFileSync(new URL('./cleaned',import.meta.url),'yes'));ctx.tools.register({name:'never',description:'Never reached',parameters:{type:'object'},execute:async()=>1});throw new Error('synthetic startup failure')}`,
  });
  await convert(f.source, { outputDir: f.out, stateRoot:path.join(f.root,'state'), engine: 'portable-tools' });
  await assert.rejects(fs.access(path.join(f.source, 'cleaned')));
  const result = await verify(f.out, { executeSource: true });
  assert.equal(result.servers[0].status, 'failed');
  assert.equal(await fs.readFile(path.join(f.out, 'source/cleaned'), 'utf8'), 'yes');
});

test('setTimeout selects the official host and exposes a delayed tool on the same MCP connection', async t => {
  const f = await fixture(t, {
    'package.json': '{"name":"late-registration","main":"index.js","type":"module"}',
    'index.js': `export const inject=['tools'];export function apply(ctx){const tool=name=>({name,description:name,parameters:{type:'object'},output:{schema:{type:'number'},render:(_,v)=>[{type:'text',text:String(v)}]},execute:async()=>name==='late'?2:1});ctx.tools.register(tool('initial'));setTimeout(()=>ctx.tools.register(tool('late')),40)}`,
  });
  const report = await convert(f.source, { outputDir: f.out, stateRoot:path.join(f.root,'state') });
  assert.ok(report.issues.some(issue => issue.code === 'SCHEDULER'));
  assert.equal(report.conversion.components.some(c => c.kind === 'dsh-host'), true);
  const config = JSON.parse(await fs.readFile(path.join(f.out, '.mcp.json'), 'utf8'));
  const [serverName, server] = Object.entries(config.mcpServers)[0];
  const client = new McpClient({ ...server, cwd: path.resolve(f.out, server.cwd ?? '.') }, { cwd: f.out, timeout: 5000 });
  try {
    await client.start();
    const deadline = Date.now() + 3000;
    let names = [];
    while (Date.now() < deadline) {
      names = (await client.listTools()).map(tool => tool.name);
      if (names.includes('late')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(names.includes('late'), `dynamic tool missing from ${serverName}: ${names.join(', ')}; stderr=${client.stderr}`);
    const called = await client.request('tools/call', { name: 'late', arguments: {} });
    assert.equal(called.content[0].text, '2');
  } finally { await client.close(); }
});

test('unknown allow-list names are reported and fail closed at portable startup', async t => {
  const f = await fixture(t, { 'package.json': '{"name":"bad-allowlist","main":"index.js","type":"module"}', 'index.js': entry });
  const report = await convert(f.source, { outputDir: f.out, stateRoot:path.join(f.root,'state'), engine: 'portable-tools', allowTools: ['typo'] });
  assert.equal(report.conversion.status, 'partial');
  assert.ok(report.conversion.omitted.some(issue => issue.code === 'TOOL_ALLOWLIST_UNCONFIRMED'));
  assert.deepEqual(report.conversion.toolSelection.notStaticallyConfirmed, ['typo']);
  const checked = await verify(f.out, { executeSource: true });
  assert.equal(checked.servers[0].status, 'failed');
  assert.match(checked.servers[0].error, /Requested source tools are not registered: typo/);
  assert.doesNotMatch(checked.servers[0].error, /blocked/);
});

test('official host reports missing allow-list names and exposes only allowed source tools', async t => {
  const f = await fixture(t, {
    'package.json': '{"name":"official-allowlist","main":"index.ts","type":"module"}',
    'index.ts': `export const inject=['tools','systemPrompt'];const tool=name=>({name,description:name,parameters:{type:'object'},output:{schema:{type:'number'},render:(_,v)=>[{type:'text',text:String(v)}]},execute:async()=>name==='kept'?1:2});export function apply(ctx){ctx.tools.register(tool('kept'));ctx.tools.register(tool('hidden'));ctx.systemPrompt.section({name:'probe',order:1,text:'probe'})}`,
  });
  const report = await convert(f.source, { outputDir: f.out, stateRoot:path.join(f.root,'state'), allowTools: ['kept', 'missing'] });
  assert.ok(report.conversion.omitted.some(issue => issue.code === 'TOOL_ALLOWLIST_UNCONFIRMED'));
  const component = report.conversion.components.find(item => item.kind === 'dsh-host');
  const listed = await verify(f.out, { executeSource: true, server: component.name });
  assert.equal(listed.servers[0].status, 'tools-listed', JSON.stringify(listed));
  assert.deepEqual(listed.servers[0].tools.map(tool => tool.name).filter(name => !name.startsWith('dsh_host_')), ['kept']);
  const status = await verify(f.out, { executeSource: true, server: component.name, call: 'dsh_host_status' });
  assert.deepEqual(status.servers[0].call.result.structuredContent.toolSelection.missing, ['missing']);
});

test('packageDir converts a monorepo subpackage and carries a referenced repository-root asset', async t => {
  const f = await fixture(t, {
    'package.json': '{"name":"monorepo-root"}',
    'shared/message.txt': 'root-level asset',
    'packages/plugin/package.json': '{"name":"nested-plugin","main":"src/index.ts","type":"module"}',
    'packages/plugin/src/index.ts': `import {readFile} from 'node:fs/promises';import{defineTool}from'@deepseek-ai/dsh-tools';export function apply(ctx){ctx.tools.register(defineTool({name:'root_asset',description:'Read root asset',parameters:{},output:{schema:{type:'string'},render:(_,v)=>[{type:'text',text:v}]},execute:async()=>readFile(new URL('../../../shared/message.txt',import.meta.url),'utf8')}))}`,
  });
  const report = await convert(f.source, { outputDir: f.out, stateRoot:path.join(f.root,'state'), packageDir: 'packages/plugin', engine:'portable-tools',stateRoot:path.join(f.root,'state') });
  assert.equal(report.packageDir, 'packages/plugin');
  assert.ok(report.conversion.components.some(component => component.kind === 'dsh-tools'));
  assert.equal(await fs.readFile(path.join(f.out, 'source/shared/message.txt'), 'utf8'), 'root-level asset');
  const called = await verify(f.out, { executeSource: true, call: 'root_asset' });
  assert.equal(called.servers[0].status, 'tool-called', JSON.stringify(called));
  assert.equal(called.servers[0].call.result.content[0].text, 'root-level asset');
});
