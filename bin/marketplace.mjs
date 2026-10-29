#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {startMarketServer,defaultMarketRoot} from '../lib/market-server.mjs';
import {launchMarket,marketRecord} from '../lib/market-launcher.mjs';
import {createDesktopConversation,desktopConversationContext} from '../lib/codex-desktop-conversation.mjs';

const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const dataRoot=path.resolve(value('--data-root')??defaultMarketRoot()),codexHome=value('--codex-home'),port=Number(value('--port')??0);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('市場連接埠必須介於 0 與 65535');
try{
  if(!args.includes('--serve'))console.log(JSON.stringify(await launchMarket({dataRoot,codexHome,port,open:args.includes('--open'),conversationContext:desktopConversationContext()})));
  else{
    await fs.mkdir(dataRoot,{recursive:true});const lock=path.join(dataRoot,'server.lock');let handle;
    try{handle=await fs.open(lock,'wx');}catch(cause){
      if(cause.code!=='EEXIST')throw cause;
      if(await marketRecord(dataRoot))process.exit(0);
      const previous=Number(await fs.readFile(lock,'utf8'));let alive=false;try{process.kill(previous,0);alive=true;}catch{}
      if(alive)throw new Error('另一個市場程序正在啟動，請稍後再開啟');
      await fs.unlink(lock);handle=await fs.open(lock,'wx');
    }
    await handle.writeFile(String(process.pid));await handle.close();
    const ui=await startMarketServer({dataRoot,codexHome,port,desktopConversation:createDesktopConversation()});
    const record={url:ui.url,accessToken:ui.accessToken,version:ui.version,instanceId:ui.instanceId,pid:process.pid,dataRoot,codexHome:ui.codexHome,converterRoot:ui.converterRoot,startedAt:new Date().toISOString()};await fs.writeFile(path.join(dataRoot,'server.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600});
    ui.server.once('close',()=>{fs.readFile(lock,'utf8').then(owner=>owner===String(process.pid)?fs.unlink(lock):null).catch(()=>{});});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void ui.close());
    console.log(JSON.stringify({...record,accessToken:undefined}));
  }
}catch(cause){console.error(JSON.stringify({error:cause.message}));process.exitCode=1;}
