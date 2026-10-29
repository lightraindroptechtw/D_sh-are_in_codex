import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Persistent download inventory. Receipts live outside source trees and use the
 * same local signature as preparation receipts. No supplied path is a deletion
 * target: only a verified recorded direct child of the market's sources folder. */
export function createMarketDownloads({ dataRoot, sourcesRoot, saveSigned, readSigned, sourceDigest, installed }) {
  const recordsRoot = path.join(dataRoot, 'downloaded-sources');
  let queue = Promise.resolve();
  const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  async function sourcePath(root) {
    const lexical = path.resolve(root), relative = path.relative(sourcesRoot, lexical);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.includes(path.sep)) throw new Error('拒絕刪除市場來源資料夾以外的路徑');
    const parent = await fs.lstat(sourcesRoot), info = await fs.lstat(lexical);
    if (!parent.isDirectory() || parent.isSymbolicLink() || !info.isDirectory() || info.isSymbolicLink()
      || await fs.realpath(sourcesRoot) !== path.resolve(sourcesRoot) || await fs.realpath(lexical) !== lexical) throw new Error('市場來源路徑已變更，沒有刪除資料夾');
    return lexical;
  }
  async function rows() {
    let names;
    try { names = await fs.readdir(recordsRoot); } catch (cause) { if (cause.code === 'ENOENT') return []; throw cause; }
    const items = [];
    for (const name of names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).sort()) {
      const file = path.join(recordsRoot, name), record = await readSigned(file);
      if (record.schemaVersion !== 1 || typeof record.catalogName !== 'string' || typeof record.packageName !== 'string' || typeof record.version !== 'string' || typeof record.sourceDigest !== 'string' || typeof record.root !== 'string') throw new Error('下載紀錄格式錯誤');
      try { await sourcePath(record.root); } catch (cause) { if (cause.code === 'ENOENT') continue; throw cause; }
      items.push({ ...record, recordFile: file });
    }
    return items;
  }
  const blockedNames = async () => new Set((await installed()).filter(item => item.installed !== false).flatMap(item => [item.name, item.packageName, item.catalogName].filter(Boolean)));
  function record({ plugin, acquired }) {
    return serial(async () => {
      const root = await sourcePath(acquired.root), catalogName = plugin.catalogName ?? plugin.name;
      if (typeof catalogName !== 'string' || !catalogName || catalogName.length > 300) throw new Error('下載紀錄缺少清單名稱');
      await saveSigned(path.join(recordsRoot, randomUUID() + '.json'), {
        schemaVersion: 1, catalogName, packageName: plugin.name, version: acquired.version,
        root, packageDir: acquired.packageDir ?? '.', provenance: acquired.provenance ?? null,
        sourceDigest: await sourceDigest(root), downloadedAt: new Date().toISOString(),
      });
    });
  }
  async function list() {
    await queue;
    const blocked = await blockedNames();
    return { items: (await rows()).filter(item => !blocked.has(item.packageName) && !blocked.has(item.catalogName)).map(({ recordFile, ...item }) => item) };
  }
  function remove(name) {
    return serial(async () => {
      if (typeof name !== 'string' || !name || name.length > 300) throw new Error('下載插件名稱不合法');
      const selected = (await rows()).filter(item => item.catalogName === name || item.packageName === name);
      if (!selected.length) throw new Error('這個插件沒有下載過，或來源資料夾已不存在');
      const blocked = await blockedNames();
      if (selected.some(item => blocked.has(item.packageName) || blocked.has(item.catalogName))) throw new Error('這個插件已安裝，沒有刪除來源');
      // Resolve and verify every target before the first recursive deletion.
      const targets = new Set();
      for (const item of selected) {
        const root = await sourcePath(item.root);
        if (await sourceDigest(root) !== item.sourceDigest) throw new Error('下載來源已變更，完整性核對不符，沒有刪除');
        targets.add(root);
      }
      for (const root of targets) { await sourcePath(root); await fs.rm(root, { recursive: true, force: false }); }
      for (const item of selected) await fs.unlink(item.recordFile);
      return { removed: targets.size };
    });
  }
  return { record, list, remove };
}
