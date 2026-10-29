import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** A trusted preload for this isolated worker's Node descendants. Ambient
 * NODE_OPTIONS is removed by the parent; only this generated resolver is added.
 * Relative imports/assets and a dependency's own exports retain Node semantics. */
export async function installNativeNodeResolution({stateDir,runtimeRoot,sourceNodePaths=[],versionAliases=[]}) {
  const hostAnchor=pathToFileURL(join(runtimeRoot,'__bridge_resolution__.mjs')).href;
  const anchors=[...new Set([...sourceNodePaths.map(p=>pathToFileURL(join(dirname(resolve(p)),'__bridge_resolution__.mjs')).href),hostAnchor])];
  const file=join(stateDir,'native-node-resolution.mjs');await mkdir(stateDir,{recursive:true});
  const code=`import{registerHooks,createRequire}from'node:module';import{pathToFileURL}from'node:url';
const anchors=${JSON.stringify(anchors)},hostAnchor=${JSON.stringify(hostAnchor)},aliasNames=${JSON.stringify(versionAliases.map(row=>row.name))},aliasAnchor=${JSON.stringify(pathToFileURL(join(stateDir,'compiled','__alias_resolution__.mjs')).href)},runtimePrefix=${JSON.stringify(pathToFileURL(resolve(runtimeRoot)+pathSeparator()).href)};
let fallbackDepth=0;
registerHooks({resolve(specifier,context,nextResolve){
  if(fallbackDepth)return nextResolve(specifier,context);
  const bare=!/^(?:[./]|[a-zA-Z][a-zA-Z0-9+.-]*:|[a-zA-Z]:[\\\\/])/.test(specifier);
  if(!bare)return nextResolve(specifier,context);
  const at=parentURL=>{if(![...context.conditions??[]].includes('require'))return nextResolve(specifier,{...context,parentURL});fallbackDepth++;try{const file=createRequire(parentURL).resolve(specifier);return{url:pathToFileURL(file).href,shortCircuit:true};}finally{fallbackDepth--;}};
  if(specifier.startsWith('@deepseek-ai/')){const aliased=aliasNames.some(name=>specifier===name||specifier.startsWith(name+'/'));return at(aliased&&!context.parentURL?.startsWith(runtimePrefix)?aliasAnchor:hostAnchor);}
  let original;try{return nextResolve(specifier,context);}catch(error){if(!['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error.code))throw error;original=error;}
  for(const parentURL of anchors)try{return at(parentURL);}catch(error){if(!['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error.code))throw error;}
  throw original;
}});
`;
  await writeFile(file,code,'utf8');const url=pathToFileURL(file).href;
  await import(url);
  process.env.NODE_OPTIONS='--import='+url;
  return {file,sourceRoots:sourceNodePaths.length,minimumNodeVersion:'22.15.0',ambientNodeOptionsForwarded:false};
}

function pathSeparator(){return process.platform==='win32'?'\\':'/';}
