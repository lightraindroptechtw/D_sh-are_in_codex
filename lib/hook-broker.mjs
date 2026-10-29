import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {denyNativeTool} from './native-tool-hooks.mjs';

const endpointFile=stateDir=>path.join(stateDir,'bridge-endpoint.json');
export async function startHookBroker({stateDir,evaluate,shutdown,status,mode='mcp'}){
  const file=endpointFile(stateDir),token=randomBytes(32).toString('hex');
  // Refuse concurrent owners of the same plugin state, including daemon + MCP.
  try{const old=JSON.parse(await fs.readFile(file,'utf8'));await requestBroker(old,'status',{});throw Object.assign(new Error('This plugin state already has a running host'),{code:'HOST_STATE_IN_USE'});}catch(error){if(error.code==='HOST_STATE_IN_USE')throw error;}
  const server=http.createServer(async(req,res)=>{
    const provided=Buffer.from((req.headers.authorization??'').replace(/^Bearer /,'')),expected=Buffer.from(token);
    if(provided.length!==expected.length||!timingSafeEqual(provided,expected)){res.writeHead(403).end();return;}
    if(req.method!=='POST'){res.writeHead(405).end();return;}
    try{
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1048576)throw new Error('Hook payload exceeds 1 MiB');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');let result;
      if(req.url==='/status')result={running:true,mode,pid:process.pid,...await status?.()};
      else if(req.url==='/hook')result=await evaluate(input);
      else if(req.url==='/stop'&&mode==='daemon'){result={stopping:true};setTimeout(()=>void shutdown?.(),20);}
      else {res.writeHead(404).end();return;}
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
    }catch{res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:'Host hook evaluation failed'}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const endpoint={origin:`http://127.0.0.1:${server.address().port}`,token,pid:process.pid,mode};
  await fs.mkdir(stateDir,{recursive:true});await fs.writeFile(file,JSON.stringify(endpoint)+'\n',{mode:0o600});
  return {endpoint,async close(){await new Promise(resolve=>server.close(resolve));try{const current=JSON.parse(await fs.readFile(file,'utf8'));if(current.token===token)await fs.unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}}};
}
export async function requestBroker(endpoint,method,input,{timeoutMs=22000}={}){
  const url=new URL(endpoint.origin);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!url.port||!/^[a-f0-9]{64}$/.test(endpoint.token))throw new Error('Invalid local host endpoint');
  const response=await fetch(new URL('/'+method,url),{method:'POST',headers:{authorization:'Bearer '+endpoint.token,'content-type':'application/json'},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw new Error('Local host request failed');return response.json();
}
export async function queryBroker(stateDir,method,input,options){return requestBroker(JSON.parse(await fs.readFile(endpointFile(stateDir),'utf8')),method,input,options);}
export async function runNativeHook({stateDir,input,enabled=false}){
  if(['SessionStart','UserPromptSubmit','SubagentStart','Stop','Interrupt','SessionEnd'].includes(input.hook_event_name)){
    try{return await queryBroker(stateDir,'hook',input);}catch{return {};}
  }
  if(!['PreToolUse','PostToolUse'].includes(input.hook_event_name))return {};
  try{return await queryBroker(stateDir,'hook',input);}
  catch{if(!enabled)return {};return input.hook_event_name==='PreToolUse'?denyNativeTool('工具攔截宿主尚未就緒或無法處理規則；已拒絕操作。'):{decision:'block',reason:'工具已執行，但攔截宿主無法檢查結果；無法撤銷副作用。'};}
}
