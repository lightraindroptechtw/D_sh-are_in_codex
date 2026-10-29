import {guardService,moduleError,moduleUnavailable,unsupportedService} from '../codex-control.mjs';

export const descriptor={id:'sessions',displayName:'對話讀取模組',services:['sessions'],requires:{minimumCodexVersion:'0.160.0',capabilities:['appServer']},methods:{
  list:{support:'partial',reason:'Synchronous list of live module-owned agent session projections only.'},
  get:{support:'partial',reason:'Synchronous lookup of a live owned session; no desktop history enumeration.'},
  readSession:{support:'partial',reason:'Reads the conversations made available by the Codex host; presentation projection, not DSH replay.'},
  listSessions:{support:'partial',reason:'Lists conversations made available by the existing Codex sessionQuery host.'},
  create:{support:'unsupported',reason:'Use agents.create with an explicit Codex model; arbitrary DSH session creation is unsupported.'},
  fork:{support:'unsupported',reason:'DSH fork/replay boundaries have no verified mapping.'},
  restore:{support:'unsupported',reason:'Full DSH event replay is unsupported.'},
  flush:{support:'unsupported',reason:'There is no DSH persistence writer behind Codex projections.'},
  registerMessageProjection:{support:'unsupported',reason:'Changing DSH replay interpreters cannot alter Codex history.'},
},requirements:['History access follows the existing Codex host permission and sharing settings','All returned sessions are presentation projections, not replay-validated DSH logs']};

export async function install({root,options={},capabilities={},sessionQuery}={}){
  const reason=moduleUnavailable(descriptor,capabilities);
  if(reason)return {services:{sessions:unsupportedService('sessions',Object.keys(descriptor.methods),reason)},dispose:async()=>{},diagnostics:[{module:'sessions',level:'warning',status:'disabled',reason}]};
  const agents=()=>options.agents??root?.get?.('agents');
  const list=()=>agents()?.list?.().filter(agent=>typeof agent.codexThreadId==='string'||agent.id==='codex-main-conversation').map(agent=>agent.session)??[];
  const query=sessionQuery??options.sessionQuery;
  const service=guardService({
    list,
    get(id){return list().find(session=>session.id===id);},
    async readSession(id){if(!query)throw moduleError('sessions','readSession','Codex 對話讀取服務尚未啟用。');return query.readSession(id);},
    async listSessions(signal){if(!query)throw moduleError('sessions','listSessions','Codex 對話讀取服務尚未啟用。');return query.listSessions(signal);},
  },'sessions','DSH session mutations, full event replay and unscoped history discovery are unsupported');
  return {services:{sessions:service},dispose:async()=>{},diagnostics:[{module:'sessions',level:'warning',reason:'對話清單與讀取沿用 Codex 主機現有權限；回傳顯示用投影，不提供完整 DSH 重播或持久化寫入。'}]};
}
