import {guardService,moduleError} from '../codex-control.mjs';
import {createRemoteSubprocessService} from './subprocess.mjs';
export const descriptor={id:'shell',displayName:'本機指令服務',services:['shell','subprocess'],requires:{minimumCodexVersion:null,capabilities:[]},methods:{execute:{support:'partial',reason:'可信主機執行完整 argv；可見規則允許時直接執行，其他一般權限要求本機單次核准。'},spawn:{support:'partial',reason:'可信主機啟動真實程序，提供 stdin/stdout/stderr、完成、取消、逾時及行程樹終止；不提供 PTY、control、spill。'}},requirements:[]};
export async function install({requestHost}={}){
  const execute=async(input={},execution={})=>{
    if(typeof requestHost!=='function')throw moduleError('shell','execute','沒有可信本機指令通道');
    const command=input.command??input.argv;
    if(!Array.isArray(command)||!command.length||command.some(value=>typeof value!=='string'))throw moduleError('shell','execute','command 必須是包含程式與全部參數的陣列；不會將字串自行交給另一個 shell');
    return requestHost('codex.shell',{command,cwd:input.cwd,env:input.env,providedSecrets:input.providedSecrets},execution);
  };
  const subprocess=createRemoteSubprocessService({requestHost});
  return {services:{shell:guardService({execute,run:execute,exec:execute},'shell'),subprocess:subprocess.service},dispose:()=>subprocess.dispose(),diagnostics:[{module:'shell',code:'LOCAL_APPROVAL_FALLBACK',reason:'可見 Codex 規則禁止時擋下、明確允許時免本機詢問；其他一般權限使用本機單次核准。保留本次原生沙箱權限，無法同步記憶體中的當次規則，不宣稱原生核准完全一致。subprocess 終止會停止行程樹；waitForExit 僅觀察直接程序結束，沒有受管行程範圍。'}]};
}
