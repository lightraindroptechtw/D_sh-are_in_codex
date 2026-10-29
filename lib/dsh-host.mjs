/** Isolated process adapter for pinned, unmodified official DSH host services. */
import { fork } from 'node:child_process';
import { mkdir, lstat, realpath, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkDirectory } from './directory-link.mjs';

export class DshHostError extends Error {
  constructor(message, code = 'DSH_HOST_ERROR', unsupported = []) { super(message); this.name = 'DshHostError'; this.code = code; this.unsupported = unsupported; }
}
function jsonClone(value, label) {
  const seen = new Set();
  const walk = v => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)) return;
    if (!v || typeof v !== 'object' || seen.has(v) || !Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new TypeError(`${label} must be lossless JSON`);
    if (Object.getOwnPropertySymbols(v).length || Array.isArray(v) && Object.keys(v).length !== v.length) throw new TypeError(`${label} must be lossless JSON`);
    seen.add(v);
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (Array.isArray(v) && key === 'length') continue;
      if (!d.enumerable || !('value' in d)) throw new TypeError(`${label} cannot contain accessors or hidden fields`);
      walk(d.value);
    }
    seen.delete(v);
  };
  walk(value); return JSON.parse(JSON.stringify(value));
}
const OS_ENV = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATHEXT', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'LANG', 'LC_ALL'];
// Windows supplies names such as ProgramFiles(x86); shell identifiers are too restrictive.
const validEnvironmentName = name => typeof name === 'string' && name.length > 0 && !/[=\0]/.test(name);

/**
 * Source is trusted and can execute arbitrary Node.js: process isolation protects
 * host state/environment, not the filesystem or the network. No model provider is mounted.
 */
export async function loadDshHost(options = {}) {
  const { entry, config = {}, stateDir, sourceRoot = entry && dirname(resolve(entry)), runtimeRoot = fileURLToPath(new URL('../', import.meta.url)), workerPath = fileURLToPath(new URL('./dsh-host-worker.mjs', import.meta.url)), timeout, initializeTimeoutMs = timeout ?? 120000, callTimeoutMs = timeout ?? 60000, cancelGraceMs = 1000, homeMode = 'isolated', logger, env = {}, passEnv = [] } = options;
  if (!entry || !stateDir) throw new TypeError('loadDshHost requires entry and a dedicated stateDir');
  for (const [key, value] of Object.entries({ initializeTimeoutMs, callTimeoutMs, cancelGraceMs, ...(timeout === undefined ? {} : { timeout }) })) if (!Number.isFinite(value) || value <= 0 || value > 2 ** 31 - 1) throw new TypeError(`${key} must be a positive bounded number`);
  if (!['isolated', 'real'].includes(homeMode)) throw new TypeError('homeMode must be isolated or real');
  const home = resolve(stateDir), runtime = resolve(runtimeRoot);
  const workerExecArgv=[];
  if(options.workerPermissions!==undefined){
    const permissions=options.workerPermissions;
    if(!permissions||typeof permissions!=='object'||Array.isArray(permissions)||Object.keys(permissions).some(key=>!['readRoots','writeRoots','allowDirectSpawn'].includes(key)))throw new TypeError('workerPermissions must contain only readRoots, writeRoots and allowDirectSpawn');
    workerExecArgv.push('--permission');
    if(permissions.allowDirectSpawn===true){
      for(const flag of ['--allow-child-process','--allow-worker','--allow-addons','--allow-wasi']){
        if(!process.allowedNodeEnvironmentFlags.has(flag))throw new DshHostError(`Node.js does not support ${flag}; update the runtime to enable direct process launch`,'HOST_PERMISSION_FLAG_UNSUPPORTED');
        workerExecArgv.push(flag);
      }
    }
    for(const [key,flag] of [['readRoots','--allow-fs-read'],['writeRoots','--allow-fs-write']]){
      if(!Array.isArray(permissions[key])||permissions[key].some(value=>typeof value!=='string'||!value||/[\0*?]/.test(value)))throw new TypeError(`workerPermissions.${key} must contain concrete filesystem paths`);
      for(const directory of new Set(permissions[key].map(value=>resolve(value))))workerExecArgv.push(`${flag}=${directory}`);
    }
    // Node permissions are defense in depth for reviewed code, not a hostile-code
    // security boundary. Native OS restrictions remain responsible for writes.
    // Direct-launch opt-in also enables worker threads, native addons and WASI, matching the CC host.
  }
  await mkdir(home, { recursive: true });
  if(options.workerPermissions!==undefined){
    // Node's permission model requires unrestricted filesystem access to create
    // symlinks. The trusted outer host prepares only this pinned SDK junction;
    // the source worker keeps its read/write allowlists and only checks it.
    const moduleDir=join(home,'compiled','node_modules'),scopeLink=join(moduleDir,'@deepseek-ai'),scopeDirectory=join(runtime,'node_modules','@deepseek-ai');
    await mkdir(moduleDir,{recursive:true});let ready=false;
    try{
      const info=await lstat(scopeLink);if(!info.isSymbolicLink())throw new DshHostError('Managed SDK resolution path is occupied','HOST_STATE_CONFLICT');
      try{ready=await realpath(scopeLink)===await realpath(scopeDirectory);}catch{}
      if(!ready)await unlink(scopeLink);
    }catch(cause){if(cause.code!=='ENOENT')throw cause;}
    if(!ready)await linkDirectory(scopeDirectory,scopeLink);
    // Official boot resolves the installation anchor before its profile anchor.
    // A miss under state/node_modules would probe unreadable ancestor folders
    // and discard the whole bundle before it can try the profile directory.
    const bundleTarget=join(home,'profiles','codex-bridge','node_modules','codex-host-bundle'),bundleLink=join(home,'node_modules','codex-host-bundle');
    await mkdir(bundleTarget,{recursive:true});await mkdir(dirname(bundleLink),{recursive:true});let bundleReady=false;
    try{
      const info=await lstat(bundleLink);if(!info.isSymbolicLink())throw new DshHostError('Managed boot bundle path is occupied','HOST_STATE_CONFLICT');
      try{bundleReady=await realpath(bundleLink)===await realpath(bundleTarget);}catch{}
      if(!bundleReady)await unlink(bundleLink);
    }catch(cause){if(cause.code!=='ENOENT')throw cause;}
    if(!bundleReady)await linkDirectory(bundleTarget,bundleLink);
  }
  const homeKeys = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'HOMEDRIVE', 'HOMEPATH'];
  const childEnv = {};
  for (const key of [...OS_ENV, ...(homeMode === 'real' ? homeKeys : [])]) if (process.env[key] !== undefined) childEnv[key] = process.env[key];
  if (!Array.isArray(passEnv) || passEnv.some(k => !validEnvironmentName(k))) throw new TypeError('passEnv must contain environment variable names');
  for (const key of passEnv) if (process.env[key] !== undefined) childEnv[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (!validEnvironmentName(key) || typeof value !== 'string' || value.includes('\0')) throw new TypeError('env must map environment variable names to strings without NUL characters');
    childEnv[key] = value;
  }
  // Explicit passEnv/env cannot re-enable runtime injection or escape isolated home lookup.
  const blockedEnv=new Set(['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'CORDIS_SHARED', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES']);
  for (const key of Object.keys(childEnv)) if(blockedEnv.has(key.toUpperCase()))delete childEnv[key];
  if (homeMode === 'isolated') {
    const homeEnv=new Set(homeKeys);
    for (const key of Object.keys(childEnv)) if(homeEnv.has(key.toUpperCase()))delete childEnv[key];
    Object.assign(childEnv, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'), XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state') });
  }
  Object.assign(childEnv, { DSH_HOME: home, DSH_HOST_MODULES: join(runtime, 'node_modules', '@deepseek-ai'), DSH_TELEMETRY_DISABLED: '1', TEMP: join(home, 'tmp'), TMP: join(home, 'tmp') });
  await Promise.all(['tmp', 'appdata', 'localappdata', 'config', 'cache', 'data', 'state'].map(p => mkdir(join(home, p), { recursive: true })));
  const payload = jsonClone({
    entry: resolve(entry), config, stateDir: home, sourceRoot: resolve(sourceRoot), runtimeRoot: runtime,
    ...(options.entries?.length?{entries:options.entries.map(def=>({...def,entry:resolve(sourceRoot,def.entry)}))}:{}),
    workspace: resolve(options.workspace ?? sourceRoot), services: options.services ?? ['timer', 'fs', 'settings', 'webServer', 'commands', 'skills'],
    serviceConfig: options.serviceConfig ?? {}, ...(options.entryId ? { entryId: options.entryId } : {}),
    codexSessionQuery: options.codexSessionQuery ?? {}, homeMode,
    conversationHistory:options.conversationHistory===true,
    ...(options.filePolicy?{filePolicy:options.filePolicy}:options.workerPermissions?{filePolicy:{mode:options.workerPermissions.writeRoots?.includes(resolve(options.workspace??sourceRoot))?'workspace-write':'read-only'}}:{}),
    ...(options.modules === undefined ? {} : { modules: options.modules }),
    ...(options.disabledModules === undefined ? {} : { disabledModules: options.disabledModules }),
    ...(options.moduleConfig === undefined ? {} : { moduleConfig: options.moduleConfig }),
    ...(options.lenientOutput === undefined ? {} : { lenientOutput: options.lenientOutput }),
    ...(options.allowUndeclaredOutput === undefined ? {} : { allowUndeclaredOutput: options.allowUndeclaredOutput }),
    ...(options.codexCapabilities === undefined ? {} : { codexCapabilities: options.codexCapabilities }),
    ...(options.sourceNodePaths === undefined ? {} : { sourceNodePaths: options.sourceNodePaths }),
    ...(options.precompiledSource === undefined ? {} : { precompiledSource: options.precompiledSource }),
    ...(options.precompiledSourceMarker === undefined ? {} : { precompiledSourceMarker: options.precompiledSourceMarker }),
    ...(options.precompiledEntries===undefined?{}:{precompiledEntries:options.precompiledEntries}),
    versionAliases:options.versionAliases??[],
    ...(options.nodePaths === undefined ? {} : { nodePaths: options.nodePaths }),
    ...(options.plan === undefined ? {} : { plan: options.plan }),
    ...(options.moduleOptions === undefined ? {} : { moduleOptions: options.moduleOptions }),
    ...(options.mcpServerName === undefined ? {} : { mcpServerName: options.mcpServerName }),
    nativeToolHooks:options.nativeToolHooks===true,
    trustedRuntimeHashes:options.trustedRuntimeHashes??{},sourceSecretNames:options.sourceSecretNames??[],
    sensitiveConfigFields:options.runtimeBindings?.sensitiveConfigFields??options.sensitiveConfigFields??[],
  }, 'host configuration');
  let sequence = 0, disposed = false, connection, current, recovery;
  const listeners = new Set();
  const emitChanged = () => { for (const listener of listeners) { try { listener(); } catch {} } };
  const wrapTools = schemas => (schemas ?? []).map(schema => ({ ...schema, execute: (args = {}, execution = {}) => rpc('execute', { name: schema.name, args: jsonClone(args, 'tool arguments'), ...(execution.callId !== undefined ? { callId: execution.callId } : {}), ...(execution.clientCapabilities === undefined ? {} : { clientCapabilities: jsonClone(execution.clientCapabilities, 'client capabilities') }) }, { ...execution, timeoutMs: schema.timeoutMs ?? callTimeoutMs }) }));
  function cleanup(slot) { clearTimeout(slot.timer); clearTimeout(slot.killTimer); slot.removeAbort?.(); }
  function settle(g, id, cause, result) { const slot = g.pending.get(id); if (!slot) return; g.pending.delete(id); cleanup(slot); slot.controller.abort(); cause ? slot.reject(cause) : slot.resolve(result); }
  function rejectAll(g, cause) { for (const id of [...g.pending.keys()]) settle(g, id, cause); for (const c of g.bridges.values()) c.abort(); g.bridges.clear(); }
  function send(g, message) { if (g.exited || !g.child.connected) throw new DshHostError('DSH host is disconnected', 'HOST_EXITED'); g.child.send(message, cause => { if (cause && !g.exited) rejectAll(g, new DshHostError('DSH host IPC failed', 'HOST_IPC_ERROR')); }); }
  function initialTools(g,initial){return (g.latestToolsRevision??-1)>(initial.toolsRevision??-1)?g.latestTools:initial.tools;}
  function update(initial) { if (connection) { connection.tools = wrapTools(initialTools(current,initial)); connection.metadata = initial.metadata; connection.unsupported = initial.metadata?.unsupported ?? []; emitChanged(); } }
  function restart(g, triggerId, code) {
    if (g !== current || disposed || g.restarting) return;
    g.restarting = true;
    // Publish recovery before rejecting callers; their next call awaits the new initialized worker.
    recovery = (async () => { await stop(g); if (disposed) return; const fresh = launch(); const initial = await direct(fresh, 'initialize', payload, { timeoutMs: initializeTimeoutMs }); update(initial); })();
    recovery.catch(() => {});
    for (const id of [...g.pending.keys()]) settle(g, id, new DshHostError(id === triggerId ? 'DSH host request did not stop after cancellation; host restarted' : 'DSH host restarted while this request was active; request was not retried', id === triggerId ? code : 'HOST_RESTARTED'));
    for (const c of g.bridges.values()) c.abort();g.bridges.clear();
  }
  async function stop(g) { if (!g || g.closed) return; await new Promise((resolveStop,rejectStop) => { const timer = setTimeout(()=>rejectStop(new DshHostError('Worker resources did not close after shutdown','HOST_STOP_TIMEOUT')),5000); g.child.once('close', () => { clearTimeout(timer); resolveStop(); }); if(!g.exited)g.child.kill(); }); }
  async function bridge(g, message) {
    const slot = g.pending.get(message.requestId), controller = new AbortController();
    const key = message.id;g.bridges.set(key, controller);
    const abort = () => controller.abort();slot?.controller.signal.addEventListener('abort', abort, { once: true });
    try {
      if (slot?.controller.signal.aborted) controller.abort();
      const callback = message.method.startsWith('codex.') ? options.bridgeRequest : slot?.requestClient ?? options.bridgeRequest;
      if (typeof callback !== 'function') throw new DshHostError('No client request bridge is available', 'CLIENT_CAPABILITY_UNAVAILABLE');
      if (controller.signal.aborted) throw new DshHostError('Client request canceled', 'HOST_CANCELED');
      const result = await callback(message.method, message.params ?? {}, { signal: controller.signal });
      if (!controller.signal.aborted && !g.exited) send(g, { bridgeResponse: { id: key, result: jsonClone(result, 'client response') } });
    } catch (cause) { if (!g.exited) { try { send(g, { bridgeResponse: { id: key, error: { message: cause.message, code: cause.code ?? 'CLIENT_REQUEST_FAILED' } } }); } catch {} } }
    finally { slot?.controller.signal.removeEventListener('abort', abort);g.bridges.delete(key); }
  }
  function launch() {
    const child = fork(resolve(workerPath), [], { cwd: home, env: childEnv, execArgv: workerExecArgv, windowsHide: true, serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const g = { child, exited: false, closed:false, restarting: false, pending: new Map(), bridges: new Map() };current = g;
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => { if (typeof logger === 'function') logger({ stream, text: chunk.toString('utf8') }); });
    child.on('error', () => rejectAll(g, new DshHostError('Cannot start the isolated DSH host process', 'HOST_START_FAILED')));
    child.on('exit', (code, signal) => { g.exited = true; rejectAll(g, new DshHostError(`Isolated DSH host exited (${signal ?? code})`, 'HOST_EXITED')); });
    child.on('close',()=>{g.closed=true;});
    child.on('message', message => {
      if (!message || typeof message !== 'object' || g !== current || g.restarting) return;
      if (message.event === 'bridgeRequest') { void bridge(g, message);return; }
      if (message.event === 'toolsChanged') { g.latestTools=message.tools;g.latestToolsRevision=message.revision??0;if (connection) connection.tools = wrapTools(message.tools);emitChanged();return; }
      const slot = g.pending.get(message.id);if (!slot) return;
      const cause = slot.cancelCode === 'HOST_TIMEOUT' ? new DshHostError('DSH host request timed out', 'HOST_TIMEOUT') : message.error ? new DshHostError(message.error.message, message.error.code, message.error.unsupported) : slot.cancelCode && !message.result?.isError ? new DshHostError('DSH host request canceled', slot.cancelCode) : null;
      settle(g, message.id, cause, message.result);
    });return g;
  }
  function direct(g, method, params = {}, execution = {}) {
    if (disposed && method !== 'dispose') return Promise.reject(new DshHostError('DSH host has been disposed', 'DISPOSED'));
    if (g.exited) return Promise.reject(new DshHostError('DSH host exited', 'HOST_EXITED'));
    if (execution.signal?.aborted) return Promise.reject(new DshHostError('DSH host request was canceled before dispatch', 'HOST_CANCELED'));
    const id = ++sequence;
    return new Promise((resolveRpc, rejectRpc) => {
      const slot = { resolve: resolveRpc, reject: rejectRpc, controller: new AbortController(), requestClient: execution.requestClient };
      const cancel = code => {
        if (!g.pending.has(id) || slot.cancelCode) return;slot.cancelCode = code;slot.controller.abort();
        try { send(g, { method: 'cancel', params: { requestId: id } }); } catch {}
        slot.killTimer = setTimeout(() => {
          if (method === 'initialize' || disposed) { settle(g, id, new DshHostError('DSH host request did not stop after cancellation', code));void stop(g); }
          else restart(g, id, code);
        }, cancelGraceMs);
      };
      slot.timer = setTimeout(() => cancel('HOST_TIMEOUT'), execution.timeoutMs ?? callTimeoutMs);
      if (execution.signal) { const abort = () => cancel('HOST_CANCELED');execution.signal.addEventListener('abort', abort, { once: true });slot.removeAbort = () => execution.signal.removeEventListener('abort', abort); }
      g.pending.set(id, slot);try { send(g, { id, method, params }); } catch (cause) { settle(g, id, cause); }
    });
  }
  async function rpc(method, params = {}, execution = {}) {
    if (disposed && method !== 'dispose') throw new DshHostError('DSH host has been disposed', 'DISPOSED');
    if (recovery && method !== 'dispose') await recovery;
    return direct(current, method, params, execution);
  }
  try {
    const g = launch(), initial = await direct(g, 'initialize', payload, { timeoutMs: initializeTimeoutMs });
    connection = {
      tools: wrapTools(initialTools(g,initial)), metadata: initial.metadata, unsupported: initial.metadata?.unsupported ?? [],
      async getTools() { connection.tools = wrapTools(await rpc('getTools'));return connection.tools; },
      onToolsChanged(callback) { if (typeof callback !== 'function') throw new TypeError('callback must be a function');listeners.add(callback);return () => listeners.delete(callback); },
      async describe() { connection.metadata = await rpc('describe');return connection.metadata; },
      context: () => rpc('context'), dispatchEvent: (name, args = []) => rpc('dispatchEvent', { name, args: jsonClone(args, 'event arguments') }),
      request: (method, params = {}, execution={}) => rpc(method, jsonClone(params, 'host RPC arguments'),execution),
      async dispose() {
        if (disposed) return;disposed = true;listeners.clear();
        for (const id of [...current.pending.keys()]) { const slot = current.pending.get(id);slot.controller.abort();try { send(current, { method: 'cancel', params: { requestId: id } }); } catch {}settle(current, id, new DshHostError('DSH host disposed during request', 'DISPOSED')); }
        try { if (!current.exited && !current.restarting) await direct(current, 'dispose', {}, { timeoutMs: cancelGraceMs }); } finally { rejectAll(current, new DshHostError('DSH host disposed', 'DISPOSED'));await stop(current);await recovery?.catch(() => {}); }
      },
    };return connection;
  } catch (cause) { disposed = true;if (current) { rejectAll(current, cause);await stop(current); }throw cause; }
}
