import {pathToFileURL} from 'node:url';
import {compatModuleFor,exportNamesOf} from './index.mjs';
import {readFile} from 'node:fs/promises';
import {VERSION_ALIASES} from './version-alias.mjs';

/** Re-export the actual pinned SDK, adding only compared legacy names. */
export function officialModulesPlugin({esbuild,requireFromHost,portable=false,onCompat=()=>{},versionAliases=[]}){
  return {name:'official-dsh-modules-with-compat',setup(api){
    api.onResolve({filter:/^@deepseek-ai\//},async args=>{
      let resolved;try{resolved=requireFromHost.resolve(args.path);}catch{throw Object.assign(Error('官方執行環境依賴不存在：'+args.path),{code:'HOST_DEPENDENCY_MISSING'});}
      const alias=versionAliases.find(row=>args.path===row.name+'/package.json'&&VERSION_ALIASES.some(known=>known.name===row.name&&known.reports===row.version));
      if(alias&&args.kind!=='require-resolve')return {path:args.path,namespace:'dsh-version-json',pluginData:{resolved,alias}};
      const compat=args.namespace!=='dsh-compat'&&compatModuleFor(args.path);
      if(compat)return {path:args.path,namespace:'dsh-compat',pluginData:{resolved}};
      return {path:portable?args.path:pathToFileURL(resolved).href,external:true};
    });
    api.onLoad({filter:/.*/,namespace:'dsh-compat'},async args=>{
      const compat=compatModuleFor(args.path),names=await exportNamesOf(esbuild,args.pluginData.resolved);
      onCompat({package:args.path,olderRelease:compat.olderRelease,provides:[...compat.provides],differs:[...compat.differs]});
      return {contents:compat.render(args.path,names),loader:'js'};
    });
    api.onLoad({filter:/.*/,namespace:'dsh-version-json'},async args=>{
      const manifest=JSON.parse(await readFile(args.pluginData.resolved,'utf8')),alias=args.pluginData.alias;
      if(!VERSION_ALIASES.some(known=>known.name===alias.name&&known.reports===alias.version&&known.hostVersions.includes(manifest.version)))throw Error('官方套件不符合已比對的版本對應');
      return {contents:JSON.stringify({...manifest,version:alias.version}),loader:'json'};
    });
  }};
}
