import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SANDBOX_STATE_META='codex/sandbox-state-meta';
const policies=new WeakSet();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>Object.assign(Error('Codex 傳入的執行權限資料不完整或尚未支援，已拒絕本次執行'),{code:'SECURITY_HOST_POLICY_INVALID'});
function localPath(value){
  if(typeof value!=='string'||!value||value.includes('\0'))throw invalid();
  if(value.startsWith('file:')){try{return fileURLToPath(value);}catch{throw invalid();}}
  if(!path.isAbsolute(value))throw invalid();
  return value;
}
function validateState(state){
  if(!object(state)||!object(state.permissionProfile))throw invalid();
  localPath(state.sandboxCwd);
  const profile=state.permissionProfile;
  if(profile.type==='external')throw Object.assign(invalid(),{code:'SECURITY_EXTERNAL_SANDBOX_UNAVAILABLE'});
  if(profile.type!=='disabled'&&profile.type!=='managed')throw invalid();
  if(profile.type==='managed'){
    if(!['restricted','enabled'].includes(profile.network)||!object(profile.file_system))throw invalid();
    if(!['restricted','unrestricted'].includes(profile.file_system.type))throw invalid();
    if(profile.file_system.type==='restricted'){
      if(!Array.isArray(profile.file_system.entries)||profile.file_system.entries.length>10000)throw invalid();
      for(const entry of profile.file_system.entries){
        if(!object(entry)||!['read','write','deny'].includes(entry.access)||!object(entry.path))throw invalid();
        const p=entry.path;
        if(p.type==='path')localPath(p.path);
        else if(p.type==='glob_pattern'){if(entry.access!=='deny'||typeof p.pattern!=='string')throw invalid();}
        else if(p.type==='special'){if(!object(p.value)||!['root','minimal','project_roots','current_working_directory','tmpdir','slash_tmp'].includes(p.value.kind))throw invalid();}
        else throw invalid();
      }
    }
  }
  // Round-trip discards caller prototypes; keep the complete native policy, including
  // missing-path and glob behavior, instead of rebuilding a broader approximation.
  return JSON.parse(JSON.stringify(state));
}
/** Only pass transport metadata from the trusted MCP client, never tool arguments,
 * source manifests, source environment values, or an independently loaded CLI config. */
export function resolveExecutionPolicy({requestMeta,workspace=process.cwd(),fallbackMode="workspace"}={}){
  let policy;
  if(!object(requestMeta)||!Object.hasOwn(requestMeta,SANDBOX_STATE_META)){
    policy={mode:fallbackMode==='state-only'?'restricted-state':'workspace-fallback',origin:'missing-host-metadata',fullAccess:false,liveSynchronized:false,cwd:path.resolve(workspace),fallbackMode};
  }else{
    const sandboxState=validateState(requestMeta[SANDBOX_STATE_META]);
    const profile=sandboxState.permissionProfile;
    policy={mode:'codex-host',origin:'codex-tool-call-metadata',fullAccess:profile.type==='disabled',filesystemUnrestricted:profile.type==='disabled'||profile.file_system?.type==='unrestricted',sandboxState,cwd:localPath(sandboxState.sandboxCwd),liveSynchronized:true};
  }
  Object.freeze(policy);policies.add(policy);return policy;
}
export function assertExecutionPolicy(policy){if(!policies.has(policy))throw Object.assign(Error('執行權限必須由可信 Codex 工具呼叫解析'),{code:'SECURITY_HOST_POLICY_UNTRUSTED'});return policy;}
export function executionPolicyKey(policy){assertExecutionPolicy(policy);return JSON.stringify(policy);}
