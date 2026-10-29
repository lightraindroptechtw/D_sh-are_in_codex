import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { writeCodexPackage } from '../lib/codex-package.mjs';

// Explicit opt-in: launches the installed Codex binary, but never starts a model
// turn, installs a plugin, or uses the user's Codex home / credentials.
for (const format of ['compatibility', 'portable']) test(`Codex app-server parses a local ${format} package and discovers its skill`, { skip: process.env.CODEX_INTEGRATION !== '1', timeout: 30000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex parser with spaces '));
  const home = path.join(root, 'isolated home');
  const marketplacePath = path.join(root, '.agents', 'plugins', 'marketplace.json');
  await mkdir(home, { recursive: true });
  await mkdir(path.dirname(marketplacePath), { recursive: true });
  await mkdir(path.join(root, '.git'));
  const pluginRoot = path.join(root, 'plugins', 'sample-plugin');
  await writeCodexPackage({ outputDir: pluginRoot, name: 'sample-plugin', description: 'Discover a packaged test skill.', skillText: 'Return a test result.' });
  if (format === 'portable') await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'sample-plugin', version: '0.1.0', description: 'Discover a packaged test skill.' }));
  await writeFile(marketplacePath, JSON.stringify({ name: 'isolated-test', plugins: [{ name: 'sample-plugin', source: { source: 'local', path: './plugins/sample-plugin' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }));
  const child = spawn(process.env.CODEX_BIN || 'codex', ['app-server', '--stdio', '-c', 'features.plugins=true'], { cwd: root, env: { ...process.env, CODEX_HOME: home, HOME: root, USERPROFILE: root }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let stderr = '', sequence = 0;
  child.stderr.on('data', data => { stderr += data; });
  const pending = new Map();
  child.on('error', error => { for (const p of pending.values()) p.reject(error); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let response; try { response = JSON.parse(line); } catch { return; }
    const p = pending.get(response.id);
    if (!p) return;
    clearTimeout(p.timer); pending.delete(response.id);
    response.error ? p.reject(new Error(JSON.stringify(response.error))) : p.resolve(response.result);
  });
  t.after(async () => {
    for (const p of pending.values()) clearTimeout(p.timer);
    child.kill(); await closed.catch(() => {}); lines.close();
    await rm(root, { recursive: true, force: true });
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr.slice(-1500)}`)); }, 12000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const initialized = await request('initialize', { clientInfo: { name: 'dsh-package-test', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const result = await request('plugin/read', { marketplacePath, pluginName: 'sample-plugin' });
  assert.equal(result.plugin.summary.name, 'sample-plugin');
  assert.ok(result.plugin.skills.some(skill => skill.name.endsWith('sample-plugin') && skill.description === 'Discover a packaged test skill.'), JSON.stringify(result));
  if (process.env.CODEX_TEST_EVIDENCE) await writeFile(format === 'portable' ? process.env.CODEX_TEST_EVIDENCE.replace(/\.json$/, '-portable.json') : process.env.CODEX_TEST_EVIDENCE, JSON.stringify({ format, initialize: initialized, pluginRead: result, note: 'Only initialize/plugin/read; no install, model turn, or MCP launch.' }, null, 2));
});
