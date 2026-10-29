import {guardService} from '../codex-control.mjs';
export const descriptor={id:'agentDefaultModel',displayName:'主對話目前模型（唯讀）',services:['agentDefaultModel'],requires:{minimumCodexVersion:null,capabilities:[]},methods:{currentSelection:{support:'partial',reason:'回傳目前主對話掛鉤提供的模型，尚未連接時 model 為 null；不能切換。'}},requirements:['信任並啟用插件掛鉤']};
export async function install({conversation}={}){return {services:{agentDefaultModel:guardService({currentSelection:()=>conversation?.selection()??{provider:'codex',model:null}},'agentDefaultModel','目前模型只能讀取，不能切換。')},diagnostics:[]};}
