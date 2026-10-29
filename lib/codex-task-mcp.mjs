/** Trusted MCP-to-Codex dynamic tools. Source commands must match a reviewed, fixed launch description. */
import {createInterface} from 'node:readline';
import {moduleError} from './codex-control.mjs';




const fail=message=>moduleError('codex-task-mcp','resolve',message,'DSH_TASK_MCP_POLICY');
const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):value);
const launchShape=server=>({serverName:server.serverName,transport:server.transport,command:server.command,args:server.args,env:server.env??{}});

/** spawnServer is a trusted host policy hook, not a callback supplied by the source. */
export function createMcpTaskResolver({approvedServers=[],spawnServer,timeoutMs=180000,maxMessageBytes=16*1024*1024}={}){
  if(typeof spawnServer!=='function')throw fail('A trusted policy-enforcing subprocess launcher is required');
  const approved=new Map(approvedServers.map(server=>[server.serverName,server])),clients=new Map();
  let closed=false;
  async function connect(server){
    const spec=approved.get(server.serverName);
    if(!spec||canonical(launchShape(server))!==canonical(launchShape(spec))||!Array.isArray(spec.allowedTools)||!spec.allowedTools.length)throw fail('MCP command, arguments, environment or tool authorization differs from the reviewed launch description');
    if(clients.has(server.serverName))return clients.get(server.serverName);
    const startup=(async()=>{
      const child=await spawnServer(spec),pending=new Map();let sequence=0,exited=false;
      const rejectAll=()=>{exited=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(fail('MCP subprocess closed'));}pending.clear();};
      child.once('error',rejectAll);child.once('close',rejectAll);child.stderr?.resume();
      const lines=createInterface({input:child.stdout});
      lines.on('line',line=>{
        if(Buffer.byteLength(line)>maxMessageBytes){rejectAll();child.kill();return;}
        let message;try{message=JSON.parse(line);}catch{return;}
        if(message.method&&message.id!==undefined){child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Server-initiated requests are unsupported'}})+'\n');return;}
        const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
        message.error?item.reject(fail('MCP request failed')):item.resolve(message.result);
      });
      const request=(method,params)=>new Promise((resolve,reject)=>{
        if(exited){reject(fail('MCP subprocess is closed'));return;}
        const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(fail('MCP request timed out'));},timeoutMs);
        pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',cause=>{if(cause){clearTimeout(timer);pending.delete(id);reject(fail('MCP stdin closed'));}});
      });
      const client={request,async close(){rejectAll();lines.close();if(child.exitCode!==null||child.signalCode!==null)return;await new Promise(resolve=>{child.once('close',resolve);child.kill();});}};
      try{
        const hello=await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'dsh-to-codex-task',version:'0.10.0'}});
        if(!['2024-11-05','2025-03-26','2025-06-18'].includes(hello?.protocolVersion))throw fail('Unsupported MCP protocol version');
        child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
        const tools=[];let cursor;const cursors=new Set();
        do{
          const page=await request('tools/list',cursor?{cursor}:{});if(!Array.isArray(page?.tools))throw fail('Invalid MCP tool catalog');
          tools.push(...page.tools);cursor=page.nextCursor;if(cursor&&cursors.has(cursor))throw fail('Repeated MCP tools cursor');if(cursor)cursors.add(cursor);
          if(tools.length>1000||cursors.size>50)throw fail('MCP tool catalog exceeds limits');
        }while(cursor);
        client.tools=tools.filter(tool=>spec.allowedTools.includes(tool.name)).map(tool=>({name:tool.name,description:tool.description??'',inputSchema:tool.inputSchema,async execute(args){
          const result=await request('tools/call',{name:tool.name,arguments:args});
          if(result?.isError)throw fail('MCP tool returned an error');
          return result;
        }}));
        return client;
      }catch(cause){await client.close();throw cause;}
    })();
    clients.set(server.serverName,startup);try{return await startup;}catch(cause){clients.delete(server.serverName);throw cause;}
  }
  const resolve=async servers=>{
    if(closed)throw fail('MCP resolver is closed');
    const tools=[];
    for(const server of servers){const client=await connect(server);for(const tool of client.tools){if(tools.some(row=>row.name===tool.name))throw fail('Duplicate tool names across MCP servers require an explicit namespace mapping');tools.push(tool);}}
    return tools;
  };
  resolve.close=async()=>{if(closed)return;closed=true;for(const client of clients.values())try{await (await client).close();}catch{}clients.clear();};
  return resolve;
}

