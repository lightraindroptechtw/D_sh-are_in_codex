import {appendFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {moduleError} from './codex-control.mjs';

/** Local plugin records, using the official detached Session validator. This
 * journal never appends to a Codex conversation or replays native agent events. */
export function createBridgeSessionJournal({Session,appendPluginRecord,stateDir,sessionId,workspace}) {
  const session=Session.create(sessionId,undefined,{version:4,id:sessionId,createdAt:Date.now(),isSeeded:false,cwd:workspace});
  const folder=join(stateDir,'bridge-plugin-events');mkdirSync(folder,{recursive:true});
  const file=join(folder,sessionId.replace(/[^a-zA-Z0-9_-]/g,'_')+'.jsonl');
  const reserved=new Set(['session','agent','turn','step','user','assistant','tool','system','developer','inbox','request','approval']);
  const append=(type,data,...extra)=>{
    if(typeof type!=='string'||!type||extra.length)throw moduleError('bridge-session','append','Only custom plugin records with JSON data are supported');
    const bare=type.replace(/^plugin:/,'');
    if(reserved.has(bare.split('/')[0]))throw moduleError('bridge-session','append','Native agent/session events cannot be written through the plugin journal');
    if(session.log.length>=10000)throw moduleError('bridge-session','append','Plugin journal exceeded 10000 connection-local records');
    const seq=appendPluginRecord(session,'plugin:'+bare,data),event=session.log.at(-1);
    appendFileSync(file,JSON.stringify({...event,bridgeSessionId:sessionId,originalType:type})+'\n',{encoding:'utf8',mode:0o600});
    return {...event,type,seq};
  };
  return {append,file,get count(){return session.log.length;}};
}
