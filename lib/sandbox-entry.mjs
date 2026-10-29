// Runs inside the OS sandbox, before any untrusted module can initialize.
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {installSourceProcessPolicy} from './source-process-policy.mjs';
const [entryOrTarget,stateDir,executionPolicyJson,taskEndpoint]=process.argv.slice(2);
const originalLaunchSpawn=spawn;
const target=entryOrTarget.startsWith('{')?JSON.parse(entryOrTarget):{type:'node',entry:entryOrTarget,args:[]};
const keep=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','LANG','LC_ALL']);
for(const key of Object.keys(process.env))if(!keep.has(key.toUpperCase()))delete process.env[key];
Object.assign(process.env,{HOME:stateDir,USERPROFILE:stateDir,APPDATA:path.join(stateDir,'appdata'),LOCALAPPDATA:path.join(stateDir,'localappdata'),TEMP:path.join(stateDir,'tmp'),TMP:path.join(stateDir,'tmp'),DSH_CODEX_STATE_ROOT:stateDir,DSH_TELEMETRY_DISABLED:'1'});
if(executionPolicyJson)process.env.DSH_CODEX_EXECUTION_POLICY=executionPolicyJson;
if(taskEndpoint)process.env.DSH_CODEX_TASK_ENDPOINT=taskEndpoint;
// This descriptor is supplied by the trusted broker after matching reviewed
// per-server environment rules. It never expands host environment references.
for(const [key,value] of Object.entries(target.approvedEnvironment??{})){
  if(!/^[A-Z_][A-Z0-9_]*$/.test(key)||typeof value!=='string'||/^(NODE_|DSH_CODEX_|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$|PATH$|PYTHONPATH$|PYTHONHOME$)/i.test(key))throw Error('來源環境參數未通過可信啟動器檢查');
  process.env[key]=value;
}
installSourceProcessPolicy({approvedEnvironment:target.approvedEnvironment??{},taskEndpoint,runtimeRoot:path.dirname(fileURLToPath(import.meta.url)),trustedRuntimeHashes:JSON.parse(executionPolicyJson??'{}').trustedRuntimeHashes??{}});
if(target.type==='python'){
  // These values come only from the reviewed, signed target descriptor. Arbitrary
  // credential and proxy variables are never inherited from the host or source.
  if(target.environment?.PYTHONUTF8==='1')process.env.PYTHONUTF8='1';
  const pythonPaths=[path.dirname(target.entry),...(target.pythonPaths??[])];
  const bootstrap=`import sys,runpy,json;sys.path[:0]=json.loads(${JSON.stringify(JSON.stringify(pythonPaths))});sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')`;
  const child=originalLaunchSpawn(target.command,['-I','-B','-c',bootstrap,target.entry,...(target.args??[])],{cwd:target.cwd??stateDir,env:process.env,stdio:'inherit',windowsHide:true});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  child.once('error',()=>{process.exitCode=1;});child.once('close',code=>{process.exitCode=code??1;});
}else{
  process.chdir(target.cwd??stateDir);
  process.argv=[process.execPath,target.entry,...(target.args??[])];
  await import(pathToFileURL(target.entry).href);
}
