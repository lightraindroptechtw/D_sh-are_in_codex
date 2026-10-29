import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { linkDirectory } from '../lib/directory-link.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-directory-link-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'target'), link = path.join(root, 'link');
  await fs.mkdir(target);
  return { root, target, link };
}

test('concurrent startup keeps a directory link to the same target', async t => {
  const { target, link } = await fixture(t);
  // All calls race from the missing state, just like overlapping host starts.
  await Promise.all(Array.from({ length: 32 }, () => linkDirectory(target, link)));
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  assert.equal(await fs.realpath(link), await fs.realpath(target));
  // A later start is idempotent as well.
  await linkDirectory(target, link);
});

test('an existing link to a different directory is not accepted or replaced', async t => {
  const { root, target, link } = await fixture(t);
  const other = path.join(root, 'other');
  await fs.mkdir(other);
  await linkDirectory(other, link);
  await assert.rejects(linkDirectory(target, link), { code: 'EEXIST' });
  assert.equal(await fs.realpath(link), await fs.realpath(other));
});

test('an ordinary occupied directory or file remains an error', async t => {
  const { root, target, link } = await fixture(t);
  await fs.mkdir(link);
  await assert.rejects(linkDirectory(target, link), { code: 'EEXIST' });
  const file = path.join(root, 'file');
  await fs.writeFile(file, 'keep');
  await assert.rejects(linkDirectory(target, file), { code: 'EEXIST' });
  assert.equal((await fs.lstat(link)).isSymbolicLink(), false);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep');
});

test('a dangling existing link cannot be mistaken for a verified target', async t => {
  const { target, link } = await fixture(t);
  await linkDirectory(target, link);
  await fs.rmdir(target);
  await assert.rejects(linkDirectory(target, link), { code: 'EEXIST' });
});
