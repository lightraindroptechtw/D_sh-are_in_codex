import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMarketOperations } from '../lib/market-operations.mjs';
import { createCCMarketInstalled } from '../lib/cc-market-installed.mjs';

const packageName = 'synthetic-downloaded-plugin', catalogName = 'synthetic-catalog-name';
const plugin = { name: packageName, catalogName, versions: ['1.0.0', '1.1.0'].map(version => ({ version, source: { type: 'npm' } })) };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'market-downloads-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'market');
  const options = {
    dataRoot, reviewer: {},
    runImpl: () => { throw Error('No CLI or model should run'); },
    convertImpl: () => { throw Error('No conversion should run'); },
    acquireImpl: async (item, selected, { sourcesRoot }) => {
      const root = path.join(sourcesRoot, randomUUID());
      await fs.mkdir(root);
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: item.name, version: selected.version }));
      await fs.writeFile(path.join(root, 'entry.mjs'), "throw Error('SOURCE MUST NOT RUN');");
      return { root, provenance: { type: 'npm', version: selected.version } };
    },
  };
  const operations = await createMarketOperations(options);
  const management = createCCMarketInstalled({ operations, dataRoot, getEntries: () => [{ name: catalogName, versions: plugin.versions.toReversed() }] });
  t.after(() => management.close());
  return { root, dataRoot, options, operations, management };
}

test('downloads survive restart, expose catalog version/update, and delete all recorded uninstalled source copies', async t => {
  const f = await fixture(t), first = await f.operations.download(plugin, { version: '1.0.0' });
  const reopened = await createMarketOperations(f.options);
  assert.equal((await reopened.downloads()).items[0].root, first.root);
  assert.deepEqual((await f.management.installed(true)).downloads[catalogName], { version: '1.0.0', update: '1.1.0' });
  const second = await reopened.download(plugin, { version: '1.0.0' });
  const protectedFiles = ['states/plugin/secret.txt', 'packages/keep.txt', 'local-market-receipt-key'];
  await fs.mkdir(path.join(f.dataRoot, 'states', 'plugin'), { recursive: true });
  await fs.writeFile(path.join(f.dataRoot, protectedFiles[0]), 'keep state');
  await fs.writeFile(path.join(f.dataRoot, protectedFiles[1]), 'keep package');
  const before = await Promise.all(protectedFiles.map(file => fs.readFile(path.join(f.dataRoot, file))));
  const result = await f.management.manage({ action: 'delete', name: catalogName });
  assert.equal(result.ok, true, result.text);
  assert.deepEqual(Object.keys(result.installed.downloads), []);
  await assert.rejects(fs.access(first.root), { code: 'ENOENT' });
  await assert.rejects(fs.access(second.root), { code: 'ENOENT' });
  assert.deepEqual(await Promise.all(protectedFiles.map(file => fs.readFile(path.join(f.dataRoot, file)))), before);
});

test('an installed package is hidden from downloads and cannot be deleted directly', async t => {
  const f = await fixture(t), downloaded = await f.operations.download(plugin, { version: '1.0.0' });
  await fs.writeFile(path.join(f.dataRoot, 'installed.json'), JSON.stringify([{ installed: true, name: packageName, version: '1.0.0' }]));
  assert.deepEqual((await f.operations.downloads()).items, []);
  await assert.rejects(f.operations.deleteDownloaded(catalogName), /已安裝/);
  await assert.rejects(f.management.manage({ action: 'delete', name: catalogName }), error => error.status === 404);
  await fs.access(downloaded.root);
});

test('a modified signed download record blocks deletion instead of trusting its replacement path', async t => {
  const f = await fixture(t), downloaded = await f.operations.download(plugin, { version: '1.0.0' });
  const record = path.join(f.dataRoot, 'downloaded-sources', (await fs.readdir(path.join(f.dataRoot, 'downloaded-sources')))[0]);
  const value = JSON.parse(await fs.readFile(record, 'utf8'));
  value.root = path.join(f.dataRoot, 'states');
  await fs.writeFile(record, JSON.stringify(value));
  await assert.rejects(f.operations.deleteDownloaded(catalogName), /簽章/);
  await fs.access(downloaded.root);
  await fs.access(path.join(f.dataRoot, 'states'));
});

test('changed source contents fail integrity verification before any deletion', async t => {
  const f = await fixture(t), downloaded = await f.operations.download(plugin, { version: '1.0.0' });
  await fs.appendFile(path.join(downloaded.root, 'entry.mjs'), '\n// changed');
  const result = await f.management.manage({ action: 'delete', name: catalogName });
  assert.equal(result.ok, false);
  assert.match(result.text, /完整性/);
  await fs.access(downloaded.root);
});

test('a recorded source replaced by a directory link cannot delete the external target', async t => {
  const f = await fixture(t), downloaded = await f.operations.download(plugin, { version: '1.0.0' });
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'outside must survive');
  // This checked fixture path is inside its dedicated temporary market/sources.
  assert.equal(path.dirname(downloaded.root), path.join(f.dataRoot, 'sources'));
  await fs.rm(downloaded.root, { recursive: true });
  await fs.symlink(outside, downloaded.root, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.operations.deleteDownloaded(catalogName), /路徑已變更/);
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'outside must survive');
});

test('unrecorded names and filesystem paths never become deletion targets', async t => {
  const f = await fixture(t), downloaded = await f.operations.download(plugin, { version: '1.0.0' });
  for (const name of ['../states', f.dataRoot, downloaded.root, 'not-recorded']) await assert.rejects(f.operations.deleteDownloaded(name), /沒有下載/);
  await fs.access(downloaded.root);
});

test('actual enabled, disabled or unknown managed inventory prevents source deletion', async t => {
  const f = await fixture(t), deleted = [];
  const prepared = { manifestName: 'dsh-synthetic', pluginId: 'dsh-synthetic@dsh-community-converted', packageName, version: '1.0.0', catalogName, packageRoot: '/synthetic' };
  for (const enabled of [true, false, undefined]) {
    const operations = {
      managedPackages: async () => ({ items: [prepared] }), installed: async () => [],
      pluginCommand: async () => enabled === undefined ? { code: 1 } : { code: 0, stdout: JSON.stringify({ installed: [{ pluginId: prepared.pluginId, enabled }] }) },
      downloads: async () => ({ items: [{ catalogName, packageName, version: '1.0.0' }] }),
      deleteDownloaded: async name => deleted.push(name),
    };
    const management = createCCMarketInstalled({ operations, dataRoot: f.dataRoot, getEntries: () => [{ name: catalogName, versions: plugin.versions }] });
    if (enabled === undefined) assert.equal((await management.manage({ action: 'delete', name: catalogName })).ok, false);
    else await assert.rejects(management.manage({ action: 'delete', name: catalogName }), error => error.status === 404);
  }
  assert.deepEqual(deleted, []);
});
