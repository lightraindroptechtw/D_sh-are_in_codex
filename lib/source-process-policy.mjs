import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
let installed=false;
export function installSourceProcessPolicy({approvedEnvironment={},taskEndpoint,runtimeRoot,trustedRuntimeHashes={},trustedNodeOptions}){
if(installed)return;installed=true;
// Direct processes are optional. When enabled, their default environment must
// not implicitly inherit the source's credentials or broker endpoint.
const secretName=/KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL|AUTHORIZATION|COOKIE/i;
const hashes=trustedRuntimeHashes;
const trustedRuntimes=new Map();
for(const name of ['dsh-host-worker.mjs','dsh-codex-cli.mjs']){
  if(typeof hashes[name]!=='string'||!(/^[a-f0-9]{64}$/.test(hashes[name])))continue;
  const file=path.join(runtimeRoot,name);try{if(createHash('sha256').update(readFileSync(file)).digest('hex')===hashes[name])trustedRuntimes.set(name,file);}catch{}
}
const trustedEndpointFor=(method,parameters)=>{
  const program=parameters[0],argv=Array.isArray(parameters[1])?parameters[1]:[];
  return method==='fork'&&trustedRuntimes.has('dsh-host-worker.mjs')&&program===trustedRuntimes.get('dsh-host-worker.mjs')||trustedRuntimes.has('dsh-codex-cli.mjs')&&program===process.execPath&&argv[0]===trustedRuntimes.get('dsh-codex-cli.mjs');
};
const scrubOptions=(options,keepEndpoint=false,nodeChild=false)=>{
  options=options&&typeof options==='object'?options:{};
  const env={};for(const [name,value]of Object.entries(options.env??process.env))if(!secretName.test(name)&&!/^DSH_CODEX_/i.test(name)&&!/^NODE_/i.test(name)&&!/^CODEX_APP_TOOLS_/i.test(name))env[name]=value;
  for(const name of options.providedSecrets??[])if(typeof approvedEnvironment?.[name]==='string')env[name]=approvedEnvironment[name];
  if(keepEndpoint&&taskEndpoint)env.DSH_CODEX_TASK_ENDPOINT=taskEndpoint;
  if(nodeChild&&typeof trustedNodeOptions==='string')env.NODE_OPTIONS=trustedNodeOptions;
  const {providedSecrets,...remaining}=options;return {...remaining,env,windowsHide:true};
};
for(const name of ['spawn','spawnSync','execFile','execFileSync','fork']){
  const original=childProcess[name];childProcess[name]=function(...parameters){
    // A bare DSH command is routed to the verified local CLI before Node's
    // executable lookup. This also works for Windows spawn without a shell.
    const shim=trustedRuntimes.get('dsh-codex-cli.mjs');
    const direct=name!=='fork'&&typeof parameters[0]==='string'&&/^(?:dsh|dsh\.cmd|dsh\.exe)$/i.test(parameters[0]);
    const optionIndex=Array.isArray(parameters[1])?2:1;
    const options=parameters[optionIndex];
    if(direct&&shim&&taskEndpoint&&!(options&&typeof options==='object'&&options.shell)){
      if(!Array.isArray(parameters[1]))parameters.splice(1,0,[]);
      parameters[0]=process.execPath;
      parameters[1]=[shim,...parameters[1]];
    }
    const index=Array.isArray(parameters[1])?2:1;
    const nodeChild=name==='fork'||typeof parameters[0]==='string'&&/^(?:node|node\.exe)$/i.test(path.basename(parameters[0]));
    if(typeof parameters[index]==='function')parameters.splice(index,0,scrubOptions(undefined,trustedEndpointFor(name,parameters),nodeChild));
    else parameters[index]=scrubOptions(parameters[index],trustedEndpointFor(name,parameters),nodeChild);
    return original.apply(this,parameters);
  };
}
for(const name of ['exec','execSync']){
  const original=childProcess[name];childProcess[name]=function(command,options,callback){
    if(typeof options==='function')return original.call(this,command,scrubOptions(),options);
    return original.call(this,command,scrubOptions(options),callback);
  };
}
// Node's exec/execFile custom promisifier returns {stdout,stderr}; preserving
// only the callback signature would silently change trusted helper contracts.
for(const name of ['exec','execFile']){
  const wrapped=childProcess[name];
  wrapped[promisify.custom]=(...parameters)=>{
    let child;
    const result=new Promise((resolve,reject)=>{child=wrapped(...parameters,(error,stdout,stderr)=>{if(error){Object.assign(error,{stdout,stderr});reject(error);}else resolve({stdout,stderr});});});
    result.child=child;return result;
  };
}
syncBuiltinESMExports();

}
