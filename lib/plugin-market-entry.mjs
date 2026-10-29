import {launchMarket} from './market-launcher.mjs';
import {createDesktopConversation,desktopConversationContext} from './codex-desktop-conversation.mjs';

/** Installed plugin entry: start the market and ask the host to show it. */
export async function openPluginMarket({openBrowser=true,conversationContext,...options}={}, {
  requestMeta,launch=launchMarket,desktopFactory=createDesktopConversation,
}={}){
  const context=conversationContext??desktopConversationContext(requestMeta);
  const result=await launch({...options,open:false,conversationContext:context});
  if(!openBrowser)return {...result,display:{status:'not-requested'}};
  const desktop=desktopFactory({context});
  try{
    const display=await desktop.openMarket({url:result.url});
    return {...result,display,message:display.status==='queued'?'市場已送到目前 Codex 對話的右側瀏覽器，切回這個對話時會顯示。':'市場已在目前 Codex 對話的右側瀏覽器開啟。'};
  }catch(cause){
    return {...result,display:{status:'needs-host-open',reason:cause.message},message:'市場已啟動，但尚未在畫面開啟。請由目前 Codex 的瀏覽器工具開啟回傳的網址；不需要桌面捷徑。'};
  }finally{await desktop.close();}
}
