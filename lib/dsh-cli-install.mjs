import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// The caller must also bundle dsh-codex-task.mjs beside this entry. The source
// process policy only routes a bare dsh command when this file's hash matches.
export async function installDshCli(packageRoot){
  const runtime=path.join(packageRoot,'runtime');
  await fs.mkdir(runtime,{recursive:true});
  const source=fileURLToPath(new URL('./dsh-codex-cli.mjs',import.meta.url));
  const contents=await fs.readFile(source);
  await fs.writeFile(path.join(runtime,'dsh-codex-cli.mjs'),contents);
  return {name:'dsh-codex-cli.mjs',sha256:createHash('sha256').update(contents).digest('hex')};
}
