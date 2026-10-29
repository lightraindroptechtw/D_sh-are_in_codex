import {guardService,moduleError} from '../codex-control.mjs';

export const descriptor={id:'sandboxPolicy',displayName:'目前檔案權限的資訊',services:['sandboxPolicy'],requires:{minimumCodexVersion:null,capabilities:[]},methods:{resolve:{support:'partial',reason:'提供目前插件程序的檔案權限類別與工作目錄；實際限制仍由 Codex 與 Node 執行。'},overrideOf:{support:'partial',reason:'不建立 DSH 對話權限覆寫事件。'}},requirements:[]};

/** Read facts about the existing process; this service never grants permissions. */
export async function install({workspace,filePolicy}={}){
  const mode=filePolicy?.mode??'danger-full-access',workspaceRoot=workspace??process.cwd();
  const service=guardService({defaultMode:mode,workspaceRoot,
    resolve(request={}){
      if(request.mode!==undefined&&request.mode!==mode)throw moduleError('sandboxPolicy','resolve','此介面只讀取目前權限，不能改變 Codex 或 Node 的權限。請使用 Codex 的權限設定。','CODEX_POLICY_READ_ONLY');
      return {mode,workspaceRoot:request.session?.header?.cwd??workspaceRoot,...(request.session?.id?{sessionId:request.session.id}:{})};
    },overrideOf(){return undefined;},
  },'sandboxPolicy','此介面提供目前權限資訊，不提供 DSH 的權限事件與代理執行流程。');
  return {services:{sandboxPolicy:service},diagnostics:[{module:'sandboxPolicy',level:'info',reason:'DSH 的三種權限類別無法表達所有 Codex 自訂資料夾規則；實際檔案操作仍遵守既有 Codex 與 Node 限制，resolve 不會授權。'}]};
}
