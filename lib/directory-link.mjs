import { lstat, realpath, symlink } from 'node:fs/promises';

/** Concurrent starts may both prepare the same managed directory link. Keep a
 * winning link only when it already resolves to the requested target; an
 * occupied path or a link to anything else remains an error. */
export async function linkDirectory(target, link) {
  try {
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    let same = false;
    try {
      same = (await lstat(link)).isSymbolicLink()
        && await realpath(link) === await realpath(target);
    } catch {}
    if (!same) throw cause;
  }
}
