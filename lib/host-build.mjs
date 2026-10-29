import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {copyHostEnvironment} from './host-files.mjs';
import {hookManifest,GENERATED_HOOK_EVENTS} from './codex-events.mjs';
import {createHash} from 'node:crypto';
import {stablePluginId} from './state-paths.mjs';

// Only immutable generated JS bytes are shared. Every destination keeps its
// own dependency files, state and settings, and remains relocatable.
const templateCache=new Map();
async function templates(converterRoot,{hooks=true}={}){
  const hash=createHash('sha256').update(path.resolve(converterRoot));
  // An opt-out also omits compilation. Cache the two artifact sets separately
  // so a no-hook build never becomes a hook-enabled build's template.
  hash.update(hooks?'hooks:enabled':'hooks:disabled');
  const lib=path.join(converterRoot,'lib');
  const scan=async(dir,prefix='')=>{for(const row of(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=prefix+row.name;if(row.isDirectory())await scan(path.join(dir,row.name),name+'/');else if(name.endsWith('.mjs'))hash.update(name).update(await fs.readFile(path.join(dir,row.name)));}};await scan(lib);
  // Transport codecs are shared with the browser; their bytes also invalidate
  // the bundled host template when converting twice in one market process.
  await scan(path.join(converterRoot,'ui'),'ui/');
  hash.update(await fs.readFile(path.join(converterRoot,'package-lock.json')));
  const key=hash.digest('hex'),cacheHit=templateCache.has(key);
  if(!cacheHit){
    const compile=async(contents,sourcefile)=>{
      const result=await build({stdin:{contents,sourcefile,resolveDir:lib},write:false,bundle:true,platform:'node',format:'esm',target:'node22',packages:'bundle',external:['esbuild'],banner:{js:"import {createRequire as __runtimeCreateRequire} from 'node:module';const require=__runtimeCreateRequire(import.meta.url);"},logLevel:'silent'});
      return result.outputFiles[0].contents;
    };
    const promise=(async()=>({
      server:await compile(`import path from 'node:path';import fs from 'node:fs/promises';import{fileURLToPath}from'node:url';import{serveDshHost}from './host-server.mjs';const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');try{await serveDshHost({root,options:JSON.parse(await fs.readFile(path.join(root,'runtime/settings.json'),'utf8'))});}catch(e){console.error(JSON.stringify({error:e.message,code:e.code,diagnostics:e.diagnostics,unsupported:e.unsupported}));process.exitCode=1;}`,'host-entry.mjs'),
      worker:await compile(`import './dsh-host-worker.mjs';`,'worker-entry.mjs'),
      hook:hooks?await compile(`import path from'node:path';import fs from'node:fs/promises';import{fileURLToPath}from'node:url';import{recordCodexHook}from './codex-events.mjs';import{resolvePluginState}from'./state-paths.mjs';import{runNativeHook}from'./hook-broker.mjs';const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const options=JSON.parse(await fs.readFile(path.join(root,'runtime/settings.json'),'utf8'));let raw='';for await(const part of process.stdin){raw+=part;if(Buffer.byteLength(raw)>1048576)throw new Error('Hook input exceeds 1 MiB');}const input=JSON.parse(raw),dataDir=resolvePluginState({root,options});const result=await recordCodexHook({dataDir,input});const native=await runNativeHook({stateDir:dataDir,input,enabled:options.interception===true});process.stdout.write(JSON.stringify({...result.output,...native})+'\\n');`,'hook-entry.mjs'):null,
      daemon:await compile(`import path from'node:path';import fs from'node:fs/promises';import{fileURLToPath}from'node:url';import{runDshDaemon}from'./host-server.mjs';const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');try{await runDshDaemon({root,options:JSON.parse(await fs.readFile(path.join(root,'runtime/settings.json'),'utf8'))});}catch(e){console.error(JSON.stringify({error:e.message,code:e.code,diagnostics:e.diagnostics}));process.exitCode=1;}`,'daemon-entry.mjs'),
    }))();
    templateCache.set(key,promise);
    if(templateCache.size>4)templateCache.delete(templateCache.keys().next().value);
    promise.catch(()=>templateCache.delete(key));
  }
  return {...await templateCache.get(key),cacheHit,hash:key};
}

/** Generate a relocatable host without importing or initializing any source code. */
export async function buildOfficialHost({converterRoot,outputDir,plan,config,allowTools,workspace,codexSessionQuery,hooks=true,options={}}){
  const runtime=path.join(outputDir,'runtime');await fs.mkdir(runtime,{recursive:true});
  const environment=await copyHostEnvironment({fromRoot:converterRoot,toRoot:path.join(runtime,'host-env')});
  const stateId=options.stateId??stablePluginId({origin:plan.source?.origin??plan.origin??plan.source?.path??plan.name,packageDir:plan.packageDir??'.',name:plan.name});
  const interception=options.interception??/tools\/(pre-execute|post-execute|result)/.test(JSON.stringify(plan.hostRuntime??plan.host??{}));
  const settings={...options,stateId,name:plan.name,entry:plan.entry,...(plan.entries?.length?{entries:plan.entries}:{}),packageDir:plan.packageDir??'.',config:{...plan.defaultConfig,...config},allowTools,controlPrefix:'dsh_host',mcpServerName:options.mcpServerName??plan.name,interception,plan:{hostRuntime:plan.hostRuntime,host:plan.host,capabilities:plan.capabilities},...(workspace?{workspace:path.resolve(workspace)}:{}),...(codexSessionQuery?{codexSessionQuery}: {})};
  if(options.entryId===undefined&&plan.entryId!==undefined)settings.entryId=plan.entryId;
  settings.versionAliases=plan.runtimeCompatibility?.versionAliases??[];
  await fs.writeFile(path.join(runtime,'settings.json'),JSON.stringify(settings,null,2)+'\n');
  const compiled=await templates(converterRoot,{hooks});
  await fs.writeFile(path.join(runtime,'server.mjs'),compiled.server);
  await fs.writeFile(path.join(runtime,'dsh-host-worker.mjs'),compiled.worker);
  await fs.writeFile(path.join(runtime,'background.mjs'),compiled.daemon);
  if(hooks){
    await fs.writeFile(path.join(runtime,'codex-hook.mjs'),compiled.hook);
    await fs.mkdir(path.join(outputDir,'hooks'),{recursive:true});
    await fs.writeFile(path.join(outputDir,'hooks/hooks.json'),JSON.stringify(hookManifest('node "${PLUGIN_ROOT}/runtime/codex-hook.mjs"'),null,2)+'\n');
  }
  return {environment,settings,hooksGenerated:hooks,hookEvents:{generated:hooks?GENERATED_HOOK_EVENTS:[],unsupported:[{event:'Notification',reason:'Codex 0.160.0 hooks/list ignores this event'}]},hooksTrusted:false,background:{generated:true,started:false,entry:'runtime/background.mjs'},sourceExecuted:false,runtimeTemplate:{cacheHit:compiled.cacheHit,hash:compiled.hash}};
}
