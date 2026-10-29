import fs from 'node:fs/promises';
import path from 'node:path';

async function declaredOptional(importer,specifier){
  const name=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
  let current=path.dirname(importer);
  for(;;){
    try{const pkg=JSON.parse(await fs.readFile(path.join(current,'package.json'),'utf8'));return Boolean(Object.hasOwn(pkg.optionalDependencies??{},name)||pkg.peerDependenciesMeta?.[name]?.optional===true);}catch(error){if(error.code!=='ENOENT')return false;}
    const parent=path.dirname(current);if(parent===current)return false;current=parent;
  }
}

/** Keep unresolved lazy/optional imports lazy. Static imports remain errors;
 * this preserves the source's own catch/fallback instead of fabricating a module. */
export function lazyDependenciesPlugin(){return {name:'preserve-lazy-dependencies',setup(api){
  api.onResolve({filter:/^[^./\\]|^@/},async args=>{
    if(args.pluginData?.dshLazyResolution||args.path.startsWith('@deepseek-ai/')||!['dynamic-import','require-call'].includes(args.kind))return;
    const result=await api.resolve(args.path,{importer:args.importer,resolveDir:args.resolveDir,kind:args.kind,pluginData:{dshLazyResolution:true}});
    if(result.errors.length===0)return result;
    if(args.kind==='dynamic-import'||await declaredOptional(args.importer,args.path))return {path:args.path,external:true};
  });
}};}
