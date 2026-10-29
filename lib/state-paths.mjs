import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export function stablePluginId({origin,packageDir='.',name}){
  if(typeof origin!=='string'||!origin||typeof name!=='string'||!name)throw new TypeError('State identity requires source origin and plugin name');
  const label=name.replace(/^@[^/]+\//,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'plugin';
  return label+'-'+createHash('sha256').update(origin+'\0'+packageDir+'\0'+name).digest('hex').slice(0,16);
}

/** Cache/version directories never own persistent state. No user files are read here. */
export function resolvePluginState({root,options={},env=process.env,home=os.homedir()}){
  if(options.stateMode==='package')return path.resolve(root,'.state');
  if(!options.stateId)return path.resolve(root,'.state'); // Existing generated 0.3.x packages remain readable.
  if(!/^[a-z0-9][a-z0-9-]{0,100}$/.test(options.stateId))throw new TypeError('Invalid stable plugin state identity');
  const base=options.stateRoot??env.DSH_CODEX_STATE_ROOT??path.join(env.CODEX_HOME||path.join(home,'.codex'),'dsh-to-codex-state');
  if(typeof base!=='string'||!path.isAbsolute(base))throw new TypeError('Persistent state root must be an absolute path');
  return path.join(base,options.stateId);
}

/** Explicit copy-only migration. Never overwrites or removes either state tree. */
export async function migrateLegacyState({root,options,env,home,dryRun=false}){
  const from=path.resolve(root,'.state'),to=resolvePluginState({root,options,env,home});
  if(from===to)return {status:'not-needed',from,to};
  try{if(!(await fs.stat(from)).isDirectory())throw new Error('Legacy state is not a directory');}catch(error){if(error.code==='ENOENT')return {status:'no-legacy-state',from,to};throw error;}
  try{await fs.access(to);throw new Error('Destination state already exists; refusing overwrite');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(dryRun)return {status:'planned',from,to,sourceRetained:true};
  const base=path.dirname(to);await fs.mkdir(base,{recursive:true});
  const temporary=path.join(base,'.migration-'+randomUUID());
  try{
    await fs.cp(from,temporary,{recursive:true,errorOnExist:true,force:false,filter:async file=>{const info=await fs.lstat(file);if(info.isSymbolicLink())throw new Error('State migration refuses symbolic links');return true;}});
    await fs.rename(temporary,to);
    return {status:'copied',from,to,sourceRetained:true};
  }catch(error){const checked=path.resolve(temporary),relative=path.relative(path.resolve(base),checked);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))await fs.rm(checked,{recursive:true,force:true});throw error;}
}
