import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {build,transform} from 'esbuild';
import {lazyDependenciesPlugin} from './lazy-dependencies.mjs';
import * as esbuild from 'esbuild';
import {officialModulesPlugin} from './compat/compiler.mjs';

/** Trusted preparation only: compile reviewed bytes without importing the plugin. */
export async function precompileSource({packageRoot,settings,entryId}){
  if(settings.entries?.length){
    const entries=[];for(const def of settings.entries){const result=await precompileSource({packageRoot,settings:{...settings,entries:undefined,entry:def.entry},entryId:def.id});entries.push({id:def.id,entry:def.entry,...result});}return {entries};
  }
  packageRoot=await fs.realpath(path.resolve(packageRoot));
  const assertPackageFile=async file=>{
    const actual=await fs.realpath(file),relative=path.relative(packageRoot,actual);
    if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('預編譯拒絕讀取插件產物以外的檔案');
    return actual;
  };
  const sourceRoot=path.join(packageRoot,'source'),entry=path.resolve(sourceRoot,settings.entry);
  const relativeEntry=path.relative(sourceRoot,entry);
  if(relativeEntry==='..'||relativeEntry.startsWith('..'+path.sep)||path.isAbsolute(relativeEntry))throw Error('預編譯入口超出來源目錄');
  const runtime=path.join(packageRoot,'runtime'),hostRequire=createRequire(path.join(runtime,'host-env','package.json'));
  const file=entryId===undefined?'precompiled-source.mjs':'precompiled-source-'+createHash('sha256').update(entryId).digest('hex').slice(0,16)+'.mjs',marker='__DSH_CODEX_SOURCE_ROOT_'+randomUUID().replaceAll('-','')+'__';
  await fs.mkdir(runtime,{recursive:true});
  await build({entryPoints:[entry],outfile:path.join(runtime,file),absWorkingDir:sourceRoot,nodePaths:[...(settings.sourceNodePaths??[]).map(value=>path.resolve(packageRoot,value)),path.join(runtime,'host-env','node_modules')],bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent',
    banner:{js:`import {createRequire as __hostCreateRequire} from 'node:module';const __dshSourceRoot=${JSON.stringify(marker)};const require=__hostCreateRequire(new URL('package.json',__dshSourceRoot));`},
    plugins:[{name:'reviewed-relocatable-dsh-source',setup(api){
      // This guard runs before every loader, including esbuild's JSON loader.
      api.onLoad({filter:/.*/,namespace:'file'},async args=>{await assertPackageFile(args.path);});
      api.onLoad({filter:/\.(?:[cm]?[jt]sx?)$/},async args=>{
        const actual=await assertPackageFile(args.path);
        const ext=path.extname(args.path).slice(1),loader={cjs:'js',mjs:'js',mts:'ts',cts:'ts'}[ext]??ext;
        const relative=path.relative(sourceRoot,args.path).split(path.sep).map(encodeURIComponent).join('/');
        const variable='__dshModuleUrl_'+createHash('sha256').update(relative).digest('hex').slice(0,16);
        const transformed=await transform(await fs.readFile(actual,'utf8'),{loader,target:'node22',sourcefile:args.path,define:{'import.meta.url':variable}});
        return {contents:`const ${variable}=new URL(${JSON.stringify(relative)},__dshSourceRoot).href;\n`+transformed.code,loader:'js',resolveDir:path.dirname(args.path)};
      });
    }},officialModulesPlugin({esbuild,requireFromHost:hostRequire,portable:true,versionAliases:settings.versionAliases}),lazyDependenciesPlugin()],
  });
  return {file,marker};
}
