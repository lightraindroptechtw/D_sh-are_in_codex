import fs from 'node:fs/promises';
import path from 'node:path';
import {startPluginUi} from './ui-server.mjs';
import {serveMcp} from './protocol.mjs';

/** One browser origin per plugin runtime. Opening a panel never starts a model. */
export async function createPluginUiController({root,rpc,onNotice}){
  let manifest;
  try{manifest=JSON.parse(await fs.readFile(path.join(root,'runtime/ui/manifest.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  let server,pending,closed=false;
  const describe=()=>({available:true,started:Boolean(server),name:manifest.name,version:manifest.version,clients:manifest.clients.map(({id,sha256})=>({id,sha256})),...(server?{url:server.url}:{}),placement:'Codex 右側的獨立網頁；不修改聊天外觀'});
  return {
    describe,
    async open(){
      if(closed)throw new Error('插件已結束；請重新載入插件後再開啟畫面。');
      pending??=startPluginUi({root,rpc,onNotice}).then(value=>{server=value;return value;}).catch(error=>{pending=undefined;throw error;});
      const active=await pending;
      return {...describe(),url:active.url,instruction:'請用 open_in_codex 的 browser 目標開啟此網址，畫面會出現在目前對話右側。'};
    },
    async close(){closed=true;try{await pending;}catch{}await server?.close();server=undefined;},
  };
}

/** Frontend-only packages remain usable without inventing a backend service. */
export async function serveUiOnly({root,name}){
  const rpc=async(method)=>{
    if(method==='describe')return {name,backend:false,uiOnly:true};
    if(method==='settings.describe')return [];
    if(method==='routes')return null;
    throw new Error('這個插件只提供畫面，沒有註冊這項後端功能：'+method);
  };
  const controller=await createPluginUiController({root,rpc});
  if(!controller)throw new Error('找不到插件的畫面檔案，請重新轉換。');
  const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
  try{await serveMcp({name,tools:[
    {name:'dsh_host_ui_open',description:'取得原插件畫面的本機網址，再用 open_in_codex 開在目前對話右側。',inputSchema:{type:'object',properties:{},additionalProperties:false},execute:async()=>result(await controller.open())},
    {name:'dsh_host_ui_status',description:'讀取原插件畫面的載入位置與狀態。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>result(controller.describe())},
  ],dispose:()=>controller.close()});}finally{await controller.close();}
}
