/** Private IPC worker: the real Cordis/DSH runtime, never a compatibility stub. */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, lstat, realpath, unlink } from 'node:fs/promises';
import { dirname, extname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createCodexSessionQuery } from './codex-sessions.mjs';
import { createCodexActivity } from './codex-events.mjs';
import { createBridgeAgent } from './modules/approval.mjs';
import { createToolScheduler } from './tool-scheduler.mjs';
import { wrapToolDefinition } from './output-normalization.mjs';
import { registry, selectModules, installModules } from './modules/index.mjs';
import {lazyDependenciesPlugin} from './lazy-dependencies.mjs';
import {createBridgeSessionJournal} from './bridge-session-journal.mjs';
import {installSourceProcessPolicy} from './source-process-policy.mjs';
import {installNativeNodeResolution} from './native-node-resolution.mjs';
import {createConversationBridge} from './conversation-bridge.mjs';
import {linkDirectory} from './directory-link.mjs';
import {officialModulesPlugin} from './compat/compiler.mjs';
import {adaptApplyResult} from './compat/apply-result.mjs';
import {withSourceLoaderNames} from './compat/loader-context.mjs';
import {resolveConfigExpressions,expressionEnvNames} from './compat/dsh-expression.mjs';
import {runCommand} from './modules/commands.mjs';
import {installVersionAliases,removeAliasedScope} from './compat/version-alias.mjs';
import {callConnection,describeConnection} from './modules/connection.mjs';
import {callTypert,openTypert,describeTypert,markUiSourceContext} from './modules/typert.mjs';
import {dispatchOfficialUiCall} from './ui-official-services.mjs';
import {createUiEventJournal} from './ui-event-journal.mjs';
import {encodeConnectionResult} from '../ui/transport.mjs';
import {createRemoteStreamRegistry} from './ui-remote-streams.mjs';
import {dispatchOfficialUiStream} from './ui-conversation-services.mjs';
import {dispatchFileResourceCall,dispatchWorkspaceFilesCall,dispatchWorkspaceFilesStream} from './ui-files.mjs';

let ctx, options, modules, activeState, initialized = false, changes = 0, changedQueued = false;
let sessionQuery, moduleRuntime, scheduler, scopeTarget,pluginEventJournal,nativeNodeResolution,conversation,uiEventJournal,uiStreams;
let bridgeSequence=0;
let conversationQueryRequested=false;
const compatNotes=[];
const addCompat=note=>{if(!compatNotes.some(item=>JSON.stringify(item)===JSON.stringify(note)))compatNotes.push(note);};
const activity = createCodexActivity();
const bridgeSessionId=`codex-mcp-connection:${randomUUID()}`;
const active = new Map(), routeRows = new Map(), bridgePending=new Map();
const send = message => { if (process.connected) process.send(message); };
function error(message, code = 'DSH_HOST_ERROR', unsupported = []) { const e = new Error(message); e.code = code; e.unsupported = unsupported; return e; }
function describePermissionError(cause){if(cause?.resource&&cause.code==='ERR_ACCESS_DENIED')cause.message=`無法${/write/i.test(cause.permission??'')?'寫入':'讀取'}「${cause.resource}」：目前插件的資料夾設定未允許這項操作。`;return cause;}
function schemaTools() { return ctx.tools.schemas().map(({ name, description, parameters }) => {const timeoutMs=ctx.tools.resolveExecution(name,undefined,false)?.timeoutMs;return { name, description, inputSchema: parameters,...(timeoutMs===undefined?{}:{timeoutMs}) };}); }
function requestHost(method,params={},execution={}){
  if(execution.signal?.aborted)return Promise.reject(error('Client request canceled','HOST_CANCELED'));
  const id=`bridge-${++bridgeSequence}`;
  return new Promise((resolve,reject)=>{
    const finish=(cause,result)=>{const slot=bridgePending.get(id);if(!slot)return;bridgePending.delete(id);execution.signal?.removeEventListener('abort',abort);cause?reject(cause):resolve(result);};
    const abort=()=>finish(error('Client request canceled','HOST_CANCELED'));
    bridgePending.set(id,{finish});execution.signal?.addEventListener('abort',abort,{once:true});
    send({event:'bridgeRequest',id,method,params,...(execution.requestId===undefined?{}:{requestId:execution.requestId})});
  });
}
function cancelBridges(){for(const slot of [...bridgePending.values()])slot.finish(error('DSH host disposed','DISPOSED'));}
function toolsChanged() {
  changes++;
  if (changedQueued) return; changedQueued = true;
  queueMicrotask(() => { changedQueued = false; if (initialized && ctx.get('tools')) send({ event: 'toolsChanged', tools: schemaTools(),revision:changes }); });
}
async function compileEntry(entry, outfile, requireFromHost) {
  const esbuild = await import(pathToFileURL(requireFromHost.resolve('esbuild')).href);
  await esbuild.build({
    entryPoints: [entry], outfile, absWorkingDir: options.sourceRoot, nodePaths: [...(options.sourceNodePaths??options.nodePaths??[]).map(path=>resolve(options.sourceRoot,path)),join(options.runtimeRoot,'node_modules')], bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    banner: { js: `import {createRequire as __hostCreateRequire} from 'node:module';const require=__hostCreateRequire(${JSON.stringify(pathToFileURL(entry).href)});` },
    plugins: [{ name: 'real-dsh-host-modules', setup(api) {
      api.onLoad({ filter: /\.(?:[cm]?[jt]sx?)$/ }, async args => {
        const ext = extname(args.path).slice(1), loader = { cjs: 'js', mjs: 'js', mts: 'ts', cts: 'ts' }[ext] ?? ext;
        const transformed = await esbuild.transform(await readFile(args.path, 'utf8'), { loader, target: 'node22', sourcefile: args.path, define: { 'import.meta.url': JSON.stringify(pathToFileURL(args.path).href) } });
        return { contents: transformed.code, loader: 'js', resolveDir: dirname(args.path) };
      });
    } },officialModulesPlugin({esbuild,requireFromHost,versionAliases:options.versionAliases,onCompat:note=>addCompat({id:'package-compat',...note})}),lazyDependenciesPlugin()],
  });
}
async function initialize(input) {
  if (ctx) throw error('DSH host was already initialized', 'HOST_ALREADY_INITIALIZED');
  options = input;
  nativeNodeResolution=await installNativeNodeResolution({stateDir:options.stateDir,runtimeRoot:options.runtimeRoot,sourceNodePaths:options.sourceNodePaths??options.nodePaths??[],versionAliases:options.versionAliases??[]});
  installSourceProcessPolicy({runtimeRoot:resolve(options.runtimeRoot,'..'),trustedRuntimeHashes:options.trustedRuntimeHashes,taskEndpoint:process.env.DSH_CODEX_TASK_ENDPOINT,trustedNodeOptions:process.env.NODE_OPTIONS,approvedEnvironment:Object.fromEntries((options.sourceSecretNames??[]).filter(name=>typeof process.env[name]==='string').map(name=>[name,process.env[name]]))});
  // Native import(variable) and import.meta.resolve cannot use esbuild nodePaths.
  // A managed scope junction exposes the same pinned SDK to compiled modules,
  // without writing into the source or modifying official package files.
  const moduleDir=join(options.stateDir,'compiled','node_modules');await mkdir(moduleDir,{recursive:true});
  const scopeLink=join(moduleDir,'@deepseek-ai'),scopeDirectory=join(options.runtimeRoot,'node_modules','@deepseek-ai');
  if(options.versionAliases?.length){for(const row of await installVersionAliases({scopeLink,scopeDirectory,aliases:options.versionAliases}))addCompat({id:'version-alias',...row});}
  else {
  try{if((await lstat(scopeLink)).isDirectory()&&!(await lstat(scopeLink)).isSymbolicLink())await removeAliasedScope(scopeLink);}catch(cause){if(cause.code!=='ENOENT')throw cause;}
  try{const info=await lstat(scopeLink);if(!info.isSymbolicLink())throw error('Managed SDK resolution path is occupied','HOST_STATE_CONFLICT');let matches=false;try{matches=await realpath(scopeLink)===await realpath(scopeDirectory);}catch{}if(!matches)await unlink(scopeLink);else options.sdkLinkReady=true;}catch(cause){if(cause.code!=='ENOENT')throw cause;}
  if(!options.sdkLinkReady)await linkDirectory(scopeDirectory,scopeLink);
  }
  const hostRequire = createRequire(join(options.runtimeRoot, 'package.json'));
  const load = async name => {
    try { return await import(pathToFileURL(hostRequire.resolve(name)).href); }
    catch (cause) { throw error(`Cannot load pinned official runtime package: ${name} (${cause.code ?? 'import failed'})`, 'HOST_DEPENDENCY_MISSING'); }
  };
  const [cordis, boot, prompt, tools,scope] = await Promise.all(['@deepseek-ai/cordis', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools','@deepseek-ai/dsh-scope'].map(load));
  const sessionLibrary=await load('@deepseek-ai/dsh-session');
  pluginEventJournal=createBridgeSessionJournal({...sessionLibrary,stateDir:options.stateDir,sessionId:bridgeSessionId,workspace:options.workspace});
  scopeTarget=scope.scopeTarget;
  // FiberState is a const enum erased from published JavaScript. In pinned
  // @deepseek-ai/cordis@4.0.5 its published lib/types/fiber.d.ts declares ACTIVE=2.
  activeState = 2; modules = { boot, prompt, cordis };
  class BridgeTools extends tools.default {
    register(definition){
      let wrapped=wrapToolDefinition(definition,options.lenientOutput===true,options.allowUndeclaredOutput===true);
      if(typeof wrapped?.execute==='function'){const descriptors=Object.getOwnPropertyDescriptors(wrapped),original=wrapped.execute;descriptors.execute={...descriptors.execute,value:async function(...args){try{return await Reflect.apply(original,this,args);}catch(cause){throw describePermissionError(cause);}}};wrapped=Object.create(Object.getPrototypeOf(wrapped),descriptors);}
      return super.register(wrapped);
    }
    createExecution(input){const created=super.createExecution(input);created.exec.cwd=input.cwd??options.workspace;created.exec.sessionId=input.sessionId??input.agent?.session?.id;return created;}
  }
  const builtins = { systemPrompt: prompt.default, tools: BridgeTools };
  const plan=options.plan??{};
  const uiServices=['connection','typert','credentials','fs'];
  const requiredServices=[...new Set([...options.services,...uiServices,...(plan.host?.services??[]),...(plan.capabilities?.hostRuntime?.services??[]),...(plan.hostRuntime?.services??[])])];
  conversationQueryRequested=requiredServices.includes('sessionQuery')||requiredServices.includes('sessions');
  const selected=selectModules(plan, {modules:options.modules===undefined?undefined:[...new Set([...options.modules,...uiServices])],services:requiredServices,moduleOptions:options.moduleConfig??options.moduleOptions,disabledModules:options.disabledModules},options.codexCapabilities??{});
  const supported=Object.fromEntries([...registry.values()].filter(m=>m.descriptor.officialPackage).map(m=>[m.descriptor.services[0],m.descriptor.officialPackage]));
  if (!Array.isArray(options.services)) throw error('services must be a list of supported official services', 'INVALID_CONFIGURATION');
  for(const name of options.services)if(!registry.has(name)&&![...registry.values()].some(m=>m.descriptor.services.includes(name)))throw error(`No official service adapter was selected for ${name}`,'HOST_SERVICE_UNSUPPORTED',[{feature:name,reason:'No service composition was selected'}]);
  const services = [...new Set([...options.services.filter(name=>Object.hasOwn(supported,name)),...selected.filter(row=>registry.get(row.id)?.descriptor.officialPackage).flatMap(row=>row.services)])];
  for (const name of services) {
    if (!Object.hasOwn(supported, name)) throw error(`No official service adapter was selected for ${name}`, 'HOST_SERVICE_UNSUPPORTED', [{ feature: name, reason: 'No service composition was selected' }]);
    const module = await load(supported[name]); builtins[name] = module.default;
  }
  if (services.includes('settings')) builtins.configEditor = (await load('@deepseek-ai/dsh-config-editor')).default;
  if (services.includes('webServer')) {
    const OfficialWebServer = builtins.webServer;
    builtins.webServer = class ObservedWebServer extends OfficialWebServer {
      register(route) {
        const dispose = super.register(route), key = `${route.kind}:${route.path}`;
        routeRows.set(key, { kind: route.kind, path: route.path });
        return () => { routeRows.delete(key); return dispose(); };
      }
      registerUpgrade(route) {
        const dispose = super.registerUpgrade(route), key = `upgrade:${route.path}`;
        routeRows.set(key, { kind: 'upgrade', path: route.path });
        return () => { routeRows.delete(key); return dispose(); };
      }
    };
  }
  const home = options.stateDir, dir = join(home, 'profiles', 'codex-bridge');
  await mkdir(join(home, 'compiled'), { recursive: true });
  const targets=[],sourceLoaderNames=new Map();
  const resolveConfig=(value,label,env=process.env)=>resolveConfigExpressions(value,{env,onUnsupported:text=>addCompat({id:'config-expression-unsupported',entry:label,names:expressionEnvNames(text)})});
  const expressionOverlay=(value,label)=>{
    if(!value||typeof value!=='object')return undefined;
    if(Object.hasOwn(value,'$dshExpression')&&Object.keys(value).length===1)return resolveConfig(value,label);
    if(Array.isArray(value))return value.some(item=>expressionOverlay(item,label)!==undefined)?resolveConfig(value,label):undefined;
    const rows=Object.entries(value).map(([key,item])=>[key,expressionOverlay(item,label)]).filter(([,item])=>item!==undefined);return rows.length?Object.fromEntries(rows):undefined;
  };
  const loadTarget=async(def,index)=>{
  const entry=resolve(options.sourceRoot,def.entry),entryRelative=relative(resolve(options.sourceRoot),entry);
  if(entryRelative==='..'||entryRelative.startsWith('..'+sep)||isAbsolute(entryRelative))throw error('Plugin entry escapes source','INVALID_CONFIGURATION');
  const outfile = join(home, 'compiled', options.entries?.length?`plugin-${index}.mjs`:'plugin.mjs');
  const compiledDef=options.entries?.length?options.precompiledEntries?.find(item=>item.id===def.id):options.precompiledSource===undefined?null:{file:options.precompiledSource,marker:options.precompiledSourceMarker};
  if(compiledDef){
    if(typeof compiledDef.file!=='string'||!/^precompiled-source(?:-[a-f0-9]{16})?\.mjs$/.test(compiledDef.file)||typeof compiledDef.marker!=='string'||!/^__DSH_CODEX_SOURCE_ROOT_[a-f0-9]{32}__$/.test(compiledDef.marker))throw error('Invalid precompiled source metadata','INVALID_CONFIGURATION');
    const runtime=resolve(options.runtimeRoot,'..'),precompiled=resolve(runtime,compiledDef.file),rel=relative(runtime,precompiled);
    if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw error('Precompiled source escapes runtime','INVALID_CONFIGURATION');
    const compiled=await readFile(precompiled,'utf8'),literal=JSON.stringify(compiledDef.marker);
    if(!compiled.includes(literal))throw error('Precompiled source marker is missing','INVALID_CONFIGURATION');
    const actual=JSON.stringify(pathToFileURL(resolve(options.sourceRoot)+sep).href);
    await writeFile(outfile,compiled.split(literal).join(actual),{mode:0o600});
  }else await compileEntry(entry, outfile, hostRequire);
  const targetModule = await import(`${pathToFileURL(outfile).href}?host=${randomUUID()}`);
  let typertManifest=targetModule.TYPERT;
  // Published plugins may ship the generated host face as an explicit package
  // export rather than re-exporting it from their main entry.
  if(!typertManifest){
    let packageMetadata;try{packageMetadata=JSON.parse(await readFile(join(options.sourceRoot,'package.json'),'utf8'));}catch(cause){if(cause.code!=='ENOENT')throw cause;}
    const exported=packageMetadata?.exports?.['./typert'],manifestEntry=typeof exported==='string'?exported:exported?.import??exported?.default;
    if(typeof manifestEntry==='string'){
      const absolute=resolve(options.sourceRoot,manifestEntry),rel=relative(resolve(options.sourceRoot),absolute);
      if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw error('Typert export escapes source','INVALID_CONFIGURATION');
      const compiledManifest=join(home,'compiled',`typert-${index}.mjs`);await compileEntry(absolute,compiledManifest,hostRequire);
      typertManifest=(await import(pathToFileURL(compiledManifest).href)).TYPERT;
    }
  }
  const target = targetModule.apply ? targetModule : targetModule.default;
  if (!target || typeof target !== 'function' && typeof target.apply !== 'function') throw error('Plugin needs a Cordis apply export', 'UNSUPPORTED_ENTRY');
  const originalApply=typeof target==='function'?target:target.apply;
  const serviceClass=typeof target==='function'&&target.prototype instanceof cordis.Service;
  const inferred=target.inject===undefined?(plan.host?.services??[]).filter(name=>!['logger','events'].includes(name)):[];
  if(inferred.length)addCompat({id:'inject-inferred',entry:def.id??'target',names:inferred});
  const originalInject=target.inject??inferred;
  const inject=Array.isArray(originalInject)?[...originalInject,'bridgeModulesReady']:{...originalInject,required:[...(originalInject.required??[]),'bridgeModulesReady']};
  const builtin='target'+index;
  sourceLoaderNames.set('cordis:'+builtin,target.name??def.id??options.entryId??'target-plugin');
  const {default:_sourceDefault,...targetExports}=target;
  builtins[builtin]={...targetExports,inject,apply:(context,config)=>{
    markUiSourceContext(context);
    if(typertManifest&&context.get('typert'))context.get('typert').register(typertManifest);
    const sourceContext=withSourceLoaderNames(context,sourceLoaderNames);
    if(serviceClass){Reflect.construct(target,[sourceContext,config]);return;}
    return adaptApplyResult(Reflect.apply(originalApply,target,[sourceContext,config]),note=>addCompat({id:'apply-return-value',entry:def.id??'target',...note}));
  }};
  const sourceName=def.id??options.entryId??target.name??'target-plugin';
  const entryId=def.id??options.entryId??(!options.entries?.length?plan.entryId:undefined)??(/^[A-Za-z0-9_.-]+$/.test(sourceName)?sourceName:'source-'+Buffer.from(sourceName).toString('hex').slice(0,100));
  if (typeof entryId !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(entryId)) throw error('Plugin entry id is invalid', 'INVALID_CONFIGURATION');
  targets.push({entryId,target,inject,builtin,config:def.config??{}});
  };
  if(options.entries?.length){for(const [index,def]of options.entries.entries())await loadTarget({...def,config:{...def.config,...options.config?.[def.id]}},index);}
  else await loadTarget({entry:options.entry,config:options.config},0);
  if(new Set(targets.map(item=>item.entryId)).size!==targets.length)throw error('Plugin entry ids are not unique','INVALID_CONFIGURATION');
  builtins.bridgeModules={inject:['tools',...services],async apply(root){
    moduleRuntime=await installModules({root,selected,options:options.moduleConfig??options.moduleOptions??{},capabilities:options.codexCapabilities??{},workspace:options.workspace,filePolicy:options.filePolicy,requestHost,activity,sessionQuery,conversation,load,emit:(name,...args)=>root.emit(name,...args)});
    scheduler=createToolScheduler(root.tools);root.provide('bridgeModulesReady',true);
  }};
  await writeFile(join(home, 'package.json'), '{"name":"dsh-codex-isolated-installation","private":true}\n', { mode: 0o600 });
  boot.initProfile(dir, ['codex-host-bundle']);
  const bundle = join(dir, 'node_modules', 'codex-host-bundle'); await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'codex-host-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }), { mode: 0o600 });
  const rows = [{ id: 'system-prompt', name: 'cordis:systemPrompt', config: { includeHarnessIdentity: false, includeRuntimeContext: false } }, { id: 'tools', name: 'cordis:tools', config: { mode: 'native' } }];
  for (const name of services) {
    if (name === 'settings') rows.push({ id: 'config-editor', name: 'cordis:configEditor' });
    const config = name === 'fs' ? { cwd: options.workspace } : name === 'webServer' ? { host: '127.0.0.1', port: 0 } : {};
    Object.assign(config, options.serviceConfig[name] ?? {});
    if (name === 'webServer' && config.host !== '127.0.0.1' && config.host !== '::1') throw error('Bridge webServer must bind loopback', 'INVALID_CONFIGURATION');
    rows.push({ id: `host-${name}`, name: `cordis:${name}`, config });
    const descriptor=[...registry.values()].find(m=>m.descriptor.services.includes(name))?.descriptor;
    for(const [index,spec]of (descriptor?.companionPackages??[]).entries()){
      const key=`${name}Companion${index}`,loaded=await load(spec);builtins[key]=loaded.default??loaded;rows.push({id:`host-${name}-companion-${index}`,name:`cordis:${key}`,config:options.serviceConfig[spec]??{}});
    }
  }
  rows.push({id:'bridge-modules',name:'cordis:bridgeModules'});
  for(const {entryId}of targets)if (rows.some(row => row.id === entryId)) throw error('Plugin entry id collides with a bridge service id', 'INVALID_CONFIGURATION');
  const persistedConfig=structuredClone(options.config),secretConfig={};
  for(const field of options.sensitiveConfigFields??[]){
    if(!Array.isArray(field.path)||field.path.some(key=>typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)))throw error('Invalid sensitive configuration mapping','INVALID_CONFIGURATION');
    let actual=options.config,persisted=persistedConfig,secret=secretConfig;
    for(const key of field.path.slice(0,-1)){actual=actual?.[key];persisted=persisted[key]??={};secret=secret[key]??={};}
    const last=field.path.at(-1);if(typeof actual?.[last]==='string'){persisted[last]='';secret[last]=actual[last];}
  }
  for(const item of targets)rows.push({id:item.entryId,name:'cordis:'+item.builtin,config:resolveConfig(options.entries?.length?item.config:persistedConfig,item.entryId,{})});
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]), { mode: 0o600 });
  // Keep persisted user edits; generated base rows are refreshed on each start.
  const rootFile = join(dir, 'cordis.yml'); await writeFile(rootFile, '[]\n', { mode: 0o600 });
  const profile = { name: 'codex-bridge', dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: options.workspace, home, startedBundles: ['codex-host-bundle'], overlays: [], telemetryDisabledEnv: '1' };
  const legacyQuery = await createCodexSessionQuery(options.codexSessionQuery);
  conversation=createConversationBridge({emit:(name,...args)=>ctx.parallel(name,...args),requestHost,workspace:options.workspace});
  // The trusted parent reads persistent Codex history. The current live chat is
  // also discoverable before Codex has persisted it. Neither path runs a model.
  const history=options.conversationHistory?{listSessions:()=>requestHost('codex.conversation.list'),readSession:id=>requestHost('codex.conversation.read',{id})}:legacyQuery;
  sessionQuery={capabilities:{...conversation.query.capabilities,...(options.conversationHistory?{listSessions:'codex-accessible-history-and-current',readSession:true}:{})},async listSessions(){
    if(!options.conversationHistory)return conversation.bound?conversation.query.listSessions():legacyQuery.listSessions();
    const rows=await history.listSessions(),live=await conversation.query.listSessions();
    return [...rows,...live.filter(row=>!rows.some(existing=>existing.header.id===row.header.id))];
  },async readSession(id){
    if(!options.conversationHistory)return conversation.bound?conversation.query.readSession(id):legacyQuery.readSession(id);
    try{return await history.readSession(id);}catch(cause){
      if(id!==conversation.describe().sessionId||!conversation.describe().shared||cause.code==='DSH_CONVERSATION_SHARING_DISABLED')throw cause;
      const snapshot=await conversation.query.readSession(id);snapshot.projection.notes.push(`Codex 儲存的紀錄這次無法讀取：${cause.message}；以下只有插件啟動後收到的目前對話事件。`);return snapshot;
    }
  },close:async()=>{await conversation.dispose();await legacyQuery.close();}};
  const memoryPatches=boot.readProfilePatches('dsh-codex-host', profile);
  // Environment expressions are resolved only in worker memory. Only explicitly
  // supplied environment reaches this process; resolved keys are never persisted.
  const composed=boot.composeEntries([memoryPatches]);
  const mergeConfig=(base,overlay)=>Object.fromEntries([...new Set([...Object.keys(base??{}),...Object.keys(overlay??{})])].map(key=>[key,Object.hasOwn(overlay??{},key)?overlay[key]&&typeof overlay[key]==='object'&&!Array.isArray(overlay[key])?mergeConfig(base?.[key],overlay[key]):overlay[key]:base[key]]));
  for(const item of targets){const resolved=expressionOverlay(item.config,item.entryId),secrets=options.entries?.length?secretConfig[item.entryId]:secretConfig;if(resolved||Object.keys(secrets??{}).length){const current=composed.find(row=>row.id===item.entryId)?.config??{};memoryPatches.push({id:item.entryId,config:mergeConfig(mergeConfig(current,resolved),secrets)});}}
  ctx = await boot.boot('dsh-codex-host', rootFile, memoryPatches, root => {
    ctx = root;
    root.provide('profileContext', profile);
    root.provide('sessionQuery', sessionQuery);
    // Explicit, read-only Codex projections. These do not create a DSH agent loop.
    if(!selected.some(row=>row.id==='agents'))root.provide('agents', Object.freeze({ list: () => [...(conversation.bound?[conversation.agent]:[]),...activity.list()], get:id=>conversation.bound&&id===conversation.agent.id?conversation.agent:activity.list().find(row=>row.id===id) }));
    root.provide('webRuntime', Object.freeze({ trustedHosts: ['127.0.0.1', 'localhost', '[::1]'] }));
    // Actual official events, not a replacement registry or policy pipeline.
    root.on('tools/change', toolsChanged);
    uiEventJournal=createUiEventJournal({context:root});
    Object.assign(root.loader.builtins, builtins);
  });
  for(const {entryId,inject} of targets){
  const targetEntry = [...ctx.loader.entries()].find(e => e.options.id === entryId);
  await targetEntry?.fiber?.await();
  if (targetEntry?.fiber?.state !== activeState) {
    const required = Array.isArray(inject) ? inject : inject.required ?? [];
    const missing = required.filter(name => ctx.get(name) === undefined);
    throw error(`Plugin did not activate in the real DSH host (entry ${entryId}, state ${targetEntry?.fiber?.state ?? 'absent'})`, 'HOST_PLUGIN_INACTIVE', missing.map(name => ({ feature: `service:${name}`, reason: 'Official service is not mounted in this composition' })));
  }
  }
  uiStreams=createRemoteStreamRegistry({open:async(params,signal,uplink)=>{
    if(params.channel!=='/api'||typeof params.endpoint!=='string'||params.endpoint.split('/').length!==2)throw error('這個插件串流通道尚未接上，請使用已登記的遠端方法。','UI_BACKEND_UNSUPPORTED');
    const [namespace,method]=params.endpoint.split('/');
    const files=dispatchWorkspaceFilesStream({ctx,namespace,method,args:params.payload?.args??{},signal,workspace:options.workspace,currentSessionId:conversation.describe().sessionId});if(files!==undefined)return files;
    const official=dispatchOfficialUiStream({ctx,namespace,method,args:params.payload?.args??{},signal});if(official!==undefined)return official;
    return openTypert(ctx.get('typert'),{namespace,method,args:params.payload?.args??{}},signal,uplink,ctx.get('connection')?.browserPeer);
  }});
  initialized = true;
  const toolsAtInitialization=schemaTools(),toolsRevision=changes;
  return { tools: toolsAtInitialization,toolsRevision,metadata: await describe() };
}
async function context() {
  const assembly = await ctx.systemPrompt.assemble();
  return { sections: assembly.sections, contexts: modules.prompt.renderContextSections(assembly), text: modules.prompt.renderPrompt(assembly), contextText: modules.prompt.renderContextSnapshot(assembly) };
}
async function describe() {
  const entries = [...ctx.loader.entries()].map(entry => ({ id: entry.options.id, state: entry.fiber?.state ?? null, active: entry.fiber?.state === activeState }));
  const versions = {};
  const hostRequire = createRequire(join(options.runtimeRoot, 'package.json'));
  for (const spec of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-app-boot']) versions[spec] = JSON.parse(await readFile(hostRequire.resolve(`${spec}/package.json`), 'utf8')).version;
  return {
    host: 'official-dsh-cordis', isolatedProcess: true, versions, entries, services: ['loader', 'profileContext', 'systemPrompt', 'tools', ...new Set([...options.services,...Object.keys(moduleRuntime?.services??{})])],
    modules:moduleRuntime?.modules??[],moduleDiagnostics:moduleRuntime?.diagnostics??[],compat:compatNotes,homeMode:options.homeMode??'isolated',lenientOutput:options.lenientOutput===true,allowUndeclaredOutput:options.allowUndeclaredOutput===true,nativeNodeResolution,
    context: await context(), toolsChanged: changes, contextRole: 'plugin-context-not-codex-system-role',
    codexAdapters: { conversation:{...conversation.describe(),listeners:conversationListeners()},sessionQuery: sessionQuery.capabilities, agents: activity.describe(), webRuntime: 'loopback-trusted-hosts-only',bridgeSession:{id:bridgeSessionId,cwd:options.workspace,nativeDshSession:false,pluginEventRecords:pluginEventJournal?.count??0,journalPath:pluginEventJournal?.file??null} },
    webServer: ctx.get('webServer') ? { origin: ctx.webServer.getOrigin(), routes: [...routeRows.values()] } : null,
    unsupported: [
      { feature: 'DSH chat UI', reason: 'No DSH frontend is mounted in Codex' },
      { feature: 'DSH internal agent loop steps', reason: 'Main chat events are translated; DSH reasoning and loop steps are not exposed by Codex' },
      { feature: 'DSH native command lifecycle', reason: 'Global command handlers can run through commands.run; native Agent lifecycle is not implemented' },
    ],
  };
}
function conversationListeners(){return {sessionEvent:(ctx.events?._hooks?.['session/event']??[]).length,agentCreated:(ctx.events?._hooks?.['agent/created']??[]).length,sessionQuery:conversationQueryRequested};}
async function dispatch(method, params, requestId) {
  if (method === 'initialize') return initialize(params);
  if (!initialized && method !== 'dispose') throw error('DSH host is not initialized', 'HOST_NOT_INITIALIZED');
  if (method === 'getTools') return schemaTools();
  if (method === 'describe') return describe();
  if (method === 'context') return context();
  if(method==='ui.events.poll')return uiEventJournal.poll(params);
  if(method==='ui.conversation.describe')return {capabilities:sessionQuery.capabilities,...conversation.describe()};
  if(method==='ui.conversation.list')return sessionQuery.listSessions();
  if(method==='ui.conversation.read')return sessionQuery.readSession(params.sessionId??params.id);
  if(method==='ui.resources.file'){
    const controller=new AbortController();active.set(requestId,controller);
    try{return encodeConnectionResult(await dispatchFileResourceCall({ctx,params,signal:controller.signal,workspace:options.workspace,currentSessionId:conversation.describe().sessionId}));}finally{active.delete(requestId);}
  }
  if(/^ui\.stream\.(open|read|send|end|cancel)$/.test(method)){
    const controller=new AbortController();active.set(requestId,controller);
    try{return await uiStreams.request(method,params,controller.signal);}finally{active.delete(requestId);}
  }
  if(method==='ui.backend.describe')return {connection:describeConnection(ctx.get('connection')),typert:describeTypert(ctx.get('typert'))};
  if(method==='ui.connection.call'||method==='ui.typert.call'){
    const controller=new AbortController();active.set(requestId,controller);
    try{
      const official=async({namespace,method,args})=>await dispatchWorkspaceFilesCall({ctx,namespace,method,args,signal:controller.signal,workspace:options.workspace,currentSessionId:conversation.describe().sessionId})??await dispatchOfficialUiCall({ctx,namespace,method,args,requestId,signal:controller.signal,requestHost,workspace:options.workspace,sessionId:bridgeSessionId,appendPluginEvent:pluginEventJournal.append});
      if(method==='ui.typert.call')return encodeConnectionResult(await official(params)??await callTypert(ctx.get('typert'),params,controller.signal));
      if(params.channel==='/api'){
        const endpoint=typeof params.endpoint==='string'?params.endpoint.split('/'):[];
        if(endpoint.length===2){
          const invocation={namespace:endpoint[0],method:endpoint[1],args:params.payload?.args??{}};
          const supported=await official(invocation);if(supported!==undefined)return encodeConnectionResult(supported);
          try{return encodeConnectionResult(await callConnection(ctx.get('connection'),params,controller.signal));}
          catch(cause){if(cause.code!=='UI_BACKEND_NOT_REGISTERED')throw cause;}
          return encodeConnectionResult(await callTypert(ctx.get('typert'),invocation,controller.signal));
        }
      }
      return encodeConnectionResult(await callConnection(ctx.get('connection'),params,controller.signal));
    }
    finally{active.delete(requestId);}
  }
  if (method === 'conversation.event') return {...await conversation.event(params),listeners:conversationListeners()};
  if (method === 'hook.evaluate') {const {evaluateNativeToolHook}=await import('./native-tool-hooks.mjs');return evaluateNativeToolHook({ctx,input:params.input??params,options,scopeTarget,createAgent:createBridgeAgent});}
  if (method === 'routes') return ctx.get('webServer') ? { origin: ctx.webServer.getOrigin(), routes: [...routeRows.values()] } : null;
  if (method === 'settings.describe') {
    if (!ctx.get('settings')) throw error('Official settings service is not mounted', 'HOST_SERVICE_UNAVAILABLE');
    return ctx.settings.describe({ redactSecrets: true });
  }
  if (method === 'settings.update') {
    if (!ctx.get('settings')) throw error('Official settings service is not mounted', 'HOST_SERVICE_UNAVAILABLE');
    await ctx.settings.update(params.namespace, params.values, params.expectedRevision); return { applied: true };
  }
  if (method === 'commands.list') {
    if (!ctx.get('commands')) throw error('Official commands service is not mounted', 'HOST_SERVICE_UNAVAILABLE');
    return ctx.commands.list(undefined);
  }
  if(method==='commands.run'){
    const controller=new AbortController();active.set(requestId,controller);
    try{return await runCommand(ctx,{...params,signal:controller.signal,agent:createBridgeAgent({root:ctx,callId:'command-'+params.name,requestId,args:{args:params.args},clientCapabilities:params.clientCapabilities??{},sessionId:bridgeSessionId,workspace:options.workspace,appendPluginEvent:pluginEventJournal.append})});}
    finally{active.delete(requestId);}
  }
  if (method === 'skills.list' || method === 'skills.get') {
    if (!ctx.get('skills')) throw error('Official skill registry is not mounted', 'HOST_SERVICE_UNAVAILABLE');
    const lookup = { cwd: options.workspace };
    if (method === 'skills.list') return (await ctx.skills.list(lookup)).filter(skill => skill.invocation.modelInvocable);
    if (typeof params.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(params.name)) throw error('Invalid skill name', 'INVALID_CONFIGURATION');
    const skill = await ctx.skills.get(params.name, lookup);
    if (!skill || !skill.invocation.modelInvocable) throw error('Skill is absent or not model-invocable', 'HOST_SKILL_UNAVAILABLE');
    return skill;
  }
  if (method === 'dispatchEvent') {
    if (typeof params.name !== 'string' || !/^(codex|bridge)\/[A-Za-z0-9_./-]+$/.test(params.name) || !Array.isArray(params.args)) throw error('Only explicitly namespaced codex/* or bridge/* events can be forwarded without native DSH lifecycle objects', 'HOST_EVENT_UNSUPPORTED');
    if (/^codex\/(?:SessionStart|UserPromptSubmit|SubagentStart|SubagentStop|Stop|Interrupt|SessionEnd)$/.test(params.name)) activity.apply(params.args[0]);
    await ctx.parallel(params.name, ...params.args); return { dispatched: true, name: params.name, origin: 'codex-bridge' };
  }
  if (method === 'execute') {
    const controller = new AbortController(); active.set(requestId, controller);
    try {
      const callId=params.callId??randomUUID();
      const agent=createBridgeAgent({root:ctx,callId,requestId,args:params.args,clientCapabilities:params.clientCapabilities??{},sessionId:bridgeSessionId,workspace:options.workspace,appendPluginEvent:pluginEventJournal.append});
      const exec={callId,name:params.name,arguments:params.args,agent,cwd:options.workspace,sessionId:bridgeSessionId,signal:controller.signal};
      const result = await scheduler.run(exec,scheduled=>ctx.tools.execute(scheduled),{signal:controller.signal});
      return {
        content: result.content, isError: result.isError,
        ...(result.isError ? {} : result.value && typeof result.value === 'object' && !Array.isArray(result.value) ? { structuredContent: result.value } : {}),
        ...(result.meta === undefined ? {} : { _meta: { dsh: result.meta } }),
        // Additional contexts are real DSH data; expose them as explicit metadata,
        // never silently claim they were injected into a Codex conversation.
        ...(result.additionalContexts?.length ? { _meta: { dshAdditionalContexts: result.additionalContexts, ...(result.meta === undefined ? {} : { dsh: result.meta }) } } : {}),
      };
    } finally { active.delete(requestId); }
  }
  if (method === 'dispose') { initialized = false; for (const controller of active.values()) controller.abort();scheduler?.dispose();cancelBridges();await uiStreams?.dispose();await uiEventJournal?.dispose();await moduleRuntime?.dispose(); await ctx?.fiber.dispose(); await sessionQuery?.close(); return { disposed: true }; }
  throw error('Unknown or unsupported DSH host RPC method', 'HOST_RPC_UNSUPPORTED');
}
process.on('message', async message => {
  if (!message || typeof message !== 'object') return;
  if(message.bridgeResponse){const response=message.bridgeResponse;bridgePending.get(response.id)?.finish(response.error?error(response.error.message,response.error.code):null,response.result);return;}
  if (message.method === 'cancel') { active.get(message.params?.requestId)?.abort(); return; }
  try { const result = await dispatch(message.method, message.params ?? {}, message.id); send({ id: message.id, result }); }
  catch (cause) { describePermissionError(cause);send({ id: message.id, error: { message: cause.message, code: cause.code ?? 'DSH_HOST_ERROR', unsupported: cause.unsupported ?? [] } }); }
});
process.on('disconnect', () => { for (const controller of active.values()) controller.abort();scheduler?.dispose();cancelBridges();void (async()=>{try{await uiStreams?.dispose();await uiEventJournal?.dispose();await moduleRuntime?.dispose();await ctx?.fiber.dispose();await sessionQuery?.close();}finally{process.exit(0);}})(); });
