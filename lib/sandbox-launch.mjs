// This trusted bootstrap never imports source code outside the native Codex sandbox.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {assertExecutionPolicy,resolveExecutionPolicy} from './execution-policy.mjs';
import {servePermissionBroker} from './permission-broker.mjs';

const launchEnvironment=(extra={})=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL|AUTHORIZATION|COOKIE/i.test(name)&&!/^NODE_|^DSH_/i.test(name)));
  return {...env,...extra,NODE_OPTIONS:undefined,NODE_PATH:undefined};
};
export function sandboxArgs({stateDir,denyRead=[],readRoots=[],executionPolicy,cwd}){
  if(executionPolicy?.mode==='codex-host'){
    assertExecutionPolicy(executionPolicy);
    return ['sandbox','--sandbox-state-json',JSON.stringify(executionPolicy.sandboxState),...readRoots.flatMap(root=>['--sandbox-state-readable-root',path.resolve(root)]),'--'];
  }
  const filesystem={':root':'read',[path.resolve(stateDir).replaceAll('\\','/') ]:'write'};
  for(const file of denyRead)filesystem[path.resolve(file).replaceAll('\\','/')]='deny';
  for(const file of readRoots)filesystem[path.resolve(file).replaceAll('\\','/')]='read';
  const literal=value=>JSON.stringify(value);
  const table='{'+Object.entries(filesystem).map(([k,v])=>literal(k)+'='+literal(v)).join(',')+'}';
  return ['-c',`permissions.dsh_market_guard={filesystem=${table},network={enabled=true}}`,'sandbox','-P','dsh_market_guard','-C',path.resolve(stateDir),'--'];
}
export async function runGuarded({stateDir,command,args=[],denyRead=[],readRoots=[],stdio='inherit',probeOnly=false,codexCommand=process.env.CODEX_BIN||'codex',executionPolicy,cwd,environment={},sourceNode=false,detached=false}){
  if(executionPolicy)assertExecutionPolicy(executionPolicy);

  await fs.mkdir(stateDir,{recursive:true});
  if(executionPolicy?.mode==='codex-host'&&!sourceNode){
    // Codex's own CLI consumes the exact policy emitted for this call. In
    // particular, a disabled sandbox stays disabled; no state-only Node flags
    // or extra credential deny list silently contradict full access.
    const helperEnv=launchEnvironment(environment);
    const child=spawn(codexCommand,[...sandboxArgs({stateDir,readRoots,executionPolicy,cwd}),command,...args],{cwd:cwd??executionPolicy.cwd,env:helperEnv,windowsHide:true,stdio,detached});
    if(!probeOnly)return child;
    return new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve({enforced:true,filesystem:executionPolicy.filesystemUnrestricted?'codex-unrestricted':'codex-call-policy',policySource:executionPolicy.origin,credentialProtection:'minimal environment; full filesystem access can read credential files',codeExecution:true}):reject(Object.assign(Error('Codex 呼叫權限執行失敗'),{code:'SECURITY_SANDBOX_UNAVAILABLE'})));});
  }
  // Missing native metadata is an explicitly disclosed fallback. Node's source
  // permission flags are supplied by the broker/worker; do not impose an
  // unrelated OS network restriction or reject every launch.
  if(probeOnly)return {enforced:false,filesystem:'node-source-allowlist',network:'unrestricted-by-plugin',policySource:'configured-fallback',nativePolicyUnavailable:true};
  return spawn(command,args,{cwd:cwd??executionPolicy?.cwd??stateDir,env:launchEnvironment(environment),windowsHide:true,stdio,detached});
}
export async function launchInstalled(index){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const policy=JSON.parse(await fs.readFile(path.join(root,'runtime/security-policy.json'),'utf8'));
  if(!Number.isInteger(index)||!policy.targets[index]||![1,2,3].includes(policy.schemaVersion))throw Error('無效的受限插件入口');
  return servePermissionBroker({root,target:policy.targets[index],policy,runGuarded});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))launchInstalled(Number(process.argv[2])).catch(cause=>{console.error(JSON.stringify({error:`發生什麼：插件未能啟動。\n原因：${cause.message}\n在哪裡設定：插件安全設定與來源入口設定。\n影響：這次工具無法執行，修正上述原因後可重試。`,code:cause.code??'PLUGIN_STARTUP_FAILED'}));process.exitCode=1;});
