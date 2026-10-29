import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {resolvePluginState} from './state-paths.mjs';
import {queryBroker} from './hook-broker.mjs';

/** Explicit commands only; conversion never invokes this function. */
export async function controlDaemon(root,action,{waitMs=15000}={}){
  root=path.resolve(root);const options=JSON.parse(await fs.readFile(path.join(root,'runtime/settings.json'),'utf8'));
  const stateDir=resolvePluginState({root,options});
  const status=async()=>{try{return await queryBroker(stateDir,'status',{}, {timeoutMs:1000});}catch{return {running:false};}};
  if(action==='status')return status();
  if(action==='stop'){const current=await status();if(!current.running)return current;if(current.mode!=='daemon')throw new Error('The active host belongs to Codex MCP; stop it through Codex');await queryBroker(stateDir,'stop',{});return {stopping:true};}
  if(action!=='start')throw new Error('daemon action must be start, stop, or status');
  const current=await status();if(current.running)return {...current,alreadyRunning:true};
  const entry=path.join(root,'runtime/background.mjs');await fs.access(entry);
  const child=spawn(process.execPath,[entry],{cwd:root,detached:true,windowsHide:true,stdio:'ignore'});let startError;
  child.once('error',()=>{startError=true;});child.unref();
  const end=Date.now()+waitMs;
  while(Date.now()<end){if(startError)throw new Error('Cannot start background host');const value=await status();if(value.running)return {...value,started:true};await new Promise(resolve=>setTimeout(resolve,100));}
  child.kill();
  throw Object.assign(new Error('Background host did not become ready; source initialization may have failed'),{code:'DAEMON_START_TIMEOUT'});
}
