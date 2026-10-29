import path from 'node:path';
import {homedir} from 'node:os';
import {createCodexSessionQuery} from './codex-sessions.mjs';

/** The trusted parent reads the same local Codex store; no model turn is started. */
export function createConversationHistoryHost({settings=async()=>({}),notify=async()=>{},createQuery=createCodexSessionQuery,codexHome=process.env.CODEX_HOME??path.join(homedir(),'.codex'),command='codex',queryOptions={}}={}){
  let reader,closed=false,announced=false;
  const query=async()=>{
    if(closed)throw Object.assign(new Error('對話讀取服務已關閉。'),{code:'CODEX_SESSION_CLOSED'});
    if((await settings()).shareConversation===false){
      const notice={kind:'conversation-history-disabled',what:'插件要求讀取 Codex 的對話清單或紀錄，這次操作未執行。',why:'「讓插件知道目前對話裡發生的事」已關閉。',setting:'插件安全設定 → 讓插件知道目前對話裡發生的事',impact:'開啟後插件才能列出或讀取這個 Codex 儲存區可存取的對話。'};
      await notify(notice);throw Object.assign(new Error(`${notice.what} ${notice.why} 請到${notice.setting}開啟；關閉時無法讀取對話。`),{code:'DSH_CONVERSATION_SHARING_DISABLED'});
    }
    if(!announced){announced=true;await notify({kind:'conversation-history-active',what:'此插件正在使用 Codex 的對話清單或紀錄讀取功能。',why:'插件要求讀取對話，且對話分享已開啟。',setting:'插件安全設定 → 讓插件知道目前對話裡發生的事',impact:'插件可讀取這個 Codex 儲存區可存取的對話；關閉此設定後，後續讀取會停止。'});}
    if(!reader)reader=Promise.resolve().then(()=>createQuery({...queryOptions,codexHome:queryOptions.codexHome??codexHome,command:queryOptions.command??command,allowDiscovery:queryOptions.allowDiscovery!==false})).catch(error=>{reader=undefined;throw error;});
    return reader;
  };
  return {
    async request(method,params={}){
      if(!['list','read'].includes(method))throw Object.assign(new Error('這個對話操作尚未接上；目前可列出及讀取對話。'),{code:'CODEX_SESSION_METHOD'});
      const source=await query();
      try{return method==='list'?await source.listSessions():await source.readSession(params.id);}
      catch(error){throw Object.assign(new Error(`無法${method==='list'?'列出 Codex 對話':'讀取對話「'+params.id+'」'}：${error.message}。請確認 Codex 可用及插件的對話分享設定；這次未取得所要求的紀錄。`),{code:error.code??'CODEX_SESSION_READ'});}
    },
    async close(){closed=true;if(reader)await(await reader).close();},
  };
}
