import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {McpClient} from './protocol.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
// Use the desktop's bundled MCP server and its own tool dispatcher. Never open
// an independent Codex model process or change the destination to another chat.
export function desktopConversationContext(metadata={},env=process.env){
  let turn=metadata['x-codex-turn-metadata'];if(typeof turn==='string')try{turn=JSON.parse(turn);}catch{turn=null;}
  const threadId=metadata['openai/threadId']??metadata['openai/thread_id']??metadata.codexThreadId??metadata.thread_id??turn?.thread_id??env.CODEX_THREAD_ID;
  return typeof threadId==='string'&&threadId&&env.CODEX_APP_TOOLS_PIPE_PATH?{threadId,pipePath:env.CODEX_APP_TOOLS_PIPE_PATH}:null;
}
export function createDesktopConversation({context=desktopConversationContext(),env=process.env,builtinRoot=path.join(env.CODEX_HOME??path.join(os.homedir(),'.codex'),'plugins/cache/openai-bundled/codex-app-tools'),clientFactory=(config,options)=>new McpClient(config,options),promptPath=path.join(root,'data/market-review-handoff.md')}={}){
  let client,connected=false,reason=null;
  async function connect(){
    if(!context?.threadId||!context?.pipePath)throw Error('請先在要接收審查的 Codex 對話中開啟市場，才能連接該對話。');
    if(client)return client;
    const versions=(await fs.readdir(builtinRoot,{withFileTypes:true})).filter(row=>row.isDirectory()).map(row=>row.name).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    let entry;for(const version of versions)try{const candidate=path.join(builtinRoot,version,'server.mjs');await fs.access(candidate);entry=candidate;break;}catch{}
    if(!entry)throw Error('這個 Codex 版本沒有提供桌面對話連線元件。');
    const next=clientFactory({command:process.execPath,args:[entry],env:{...env,CODEX_APP_TOOLS_PIPE_PATH:context.pipePath}},{cwd:root,timeout:20000});
    try{
      await next.start();const tools=await next.listTools();
      if(!tools.some(tool=>tool.name==='send_message_to_thread'))throw Error('目前桌面元件沒有提供傳送到既有對話的功能。');
      const result=await next.request('tools/call',{name:'read_thread',arguments:{threadId:context.threadId,turnLimit:1,maxOutputCharsPerItem:0},_meta:{'openai/threadId':context.threadId}});
      if(result.isError)throw Error('無法確認開啟市場的 Codex 對話，尚未提交審查。');
      client=next;connected=true;reason=null;return client;
    }catch(cause){await next.close();reason=cause.message;throw cause;}
  }
  async function sendReview({reviewId}){
    if(typeof reviewId!=='string'||!/^[a-f0-9-]{36}$/i.test(reviewId))throw Error('待審項目的識別碼無效。');
    const template=await fs.readFile(promptPath,'utf8');
    const body=template.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1];if(!body)throw Error('找不到主對話審查指引。');
    const active=await connect();
    // The skill retrieves the pending ID from the queue. Keep implementation
    // instructions and IDs out of the visible message; preserve chat settings.
    const result=await active.request('tools/call',{name:'send_message_to_thread',arguments:{threadId:context.threadId,prompt:body.replaceAll('{{REVIEW_ID}}',reviewId)},_meta:{'openai/threadId':context.threadId}});
    if(result.isError)throw Error('Codex 沒有接受這次審查訊息，請回目標對話查看原因；這筆來源尚未安裝。');
    return {submitted:true,transport:'bundled-codex-app-tools',threadId:context.threadId};
  }
  async function openMarket({url}){
    let target;try{target=new URL(url);}catch{throw Error('市場網址無效。');}
    if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.pathname!=='/'||target.search||target.username||target.password||!/^#access=[a-f0-9]{64}$/.test(target.hash))throw Error('只開啟這個插件產生的本機市場網址。');
    const active=await connect();
    const result=await active.request('tools/call',{name:'open_in_codex',arguments:{target:{type:'browser',url}},_meta:{'openai/threadId':context.threadId}});
    if(result.isError)throw Error('Codex 未接受開啟市場的要求，尚未在畫面開啟。');
    let acknowledgement=result.structuredContent;
    if(!acknowledgement)for(const item of result.content??[])if(item.type==='text')try{acknowledgement=JSON.parse(item.text);break;}catch{}
    const status=acknowledgement?.status;
    if(!['opened','queued','success'].includes(status))throw Error('Codex 沒有回報市場已開啟或已排入開啟，請由目前對話的瀏覽器工具開啟。');
    return {status:status==='queued'?'queued':'opened',transport:'bundled-codex-app-tools'};
  }
  return {sendReview,openMarket,probe:async()=>{try{await connect();}catch(cause){reason=cause.message;}return {available:connected,reason};},status:()=>({available:connected,configured:Boolean(context),reason}),async bind(next){await client?.close();client=null;connected=false;reason=null;context=next;return this.probe();},async close(){await client?.close();client=null;connected=false;}};
}
