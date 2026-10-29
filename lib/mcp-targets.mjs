import fs from 'node:fs/promises';
import path from 'node:path';

const localNode=command=>command==='node'||command===process.execPath;
const localPython=command=>typeof command==='string'&&/^(?:python(?:3(?:\.\d+)?)?(?:\.exe)?)$/i.test(command);
const fail=(name,reason)=>{throw Object.assign(Error(`MCP ${name} ${reason}`),{code:'MCP_ENTRY_UNSUPPORTED'});};
function within(root,file){const relative=path.relative(root,file);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
async function packageFile(root,value,cwd,name){
  if(typeof value!=='string'||!value||path.isAbsolute(value)||path.win32.isAbsolute(value))fail(name,'入口不是已知的本機生成程式或包內來源檔案');
  const absolute=path.resolve(root,cwd,value);
  if(!within(root,absolute))fail(name,'入口不是已知的本機生成程式，路徑超出產物');
  let real;try{real=await fs.realpath(absolute);}catch{fail(name,'缺少固定的包內程式入口');}
  if(!within(await fs.realpath(root),real)||!(await fs.stat(real)).isFile())fail(name,'程式入口必須是包內一般檔案');
  return path.relative(root,absolute).split(path.sep).join('/');
}
function localCwd(root,value,name){
  value??='.';
  if(typeof value!=='string'||path.isAbsolute(value)||path.win32.isAbsolute(value)||!within(root,path.resolve(root,value)))fail(name,'工作目錄超出產物');
  return path.relative(root,path.resolve(root,value)).split(path.sep).join('/')||'.';
}

/** Classify immutable, reviewed package entries. Never starts source programs or
 * resolves npx/uvx/shell commands. The market owns source/dependency approval. */
export async function planMcpTargets(packageRoot,{config,report,pythonRuntime}={}){
  packageRoot=path.resolve(packageRoot);
  const servers=structuredClone(config.mcpServers??{}),targets=[],remote=[],omitted=[],notices=[];
  for(const [name,server]of Object.entries(servers)){
    try{
    const component=report?.conversion?.components?.find(item=>item.name===name);
    if(component?.adapter==='optional-env-http-proxy'){
      if(!localNode(server.command)||server.args?.length!==1||!/^\.\/runtime\/http-\d+\.mjs$/.test(server.args[0]))fail(name,'遠端轉接設定不符已知產物');
      const connection=JSON.parse(await fs.readFile(path.join(packageRoot,server.args[0].replace(/\.mjs$/,'.json')),'utf8'));
      // Optional source-requested environment headers are not authorization to
      // read credentials. Native Codex can configure authentication separately.
      for(const key of Object.keys(server))delete server[key];
      Object.assign(server,{url:connection.url,...(Object.keys(connection.httpHeaders??{}).length?{http_headers:connection.httpHeaders}:{})});
    }
    if(!server.command){
      let url;try{url=new URL(server.url);}catch{fail(name,'遠端連線缺少有效網址');}
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password)fail(name,'遠端連線須使用無內嵌帳密的 HTTP(S) 網址');
      remote.push(name);continue;
    }
    const cwd=localCwd(packageRoot,server.cwd,name);
    if(!Array.isArray(server.args)||!server.args.length||server.args.some(value=>typeof value!=='string'||value.includes('\0')))fail(name,'缺少固定程式入口及參數');
    let target;
    if(component?.kind==='python-mcp'){
      if(!pythonRuntime?.command)fail(name,'需要已確認的本機 Python 與完成審查的固定依賴');
      const runtimeId=component.runtimeId??component.sourceName;
      if(typeof runtimeId!=='string'||!/^[a-zA-Z0-9_-]+$/.test(runtimeId))fail(name,'缺少 Python 產生設定識別碼');
      const wrapper=JSON.parse(await fs.readFile(path.join(packageRoot,'runtime',runtimeId+'.json'),'utf8'));
      if(!Array.isArray(wrapper.allow)||!wrapper.allow.length||wrapper.allow.some(value=>typeof value!=='string'||!value)||JSON.stringify(wrapper.allow)!==JSON.stringify(component.allowTools))throw Object.assign(Error(`MCP ${name} Python 工具清單與來源報告不一致，可能已被修改`),{code:'SECURITY_INTEGRITY_MISMATCH'});
      const entry=await packageFile(packageRoot,'./source/'+component.entry,'.',name);
      if(!entry.endsWith('.py'))fail(name,'Python 入口副檔名不符');
      target={type:'python',entry,command:pythonRuntime.command,args:[],cwd:'.',allowTools:[...wrapper.allow],pythonPaths:pythonRuntime.pythonPaths??[]};
    }else{
      let type;
      if(localNode(server.command))type='node';else if(localPython(server.command))type='python';else{
        // A declared external MCP uses the ordinary Codex launch mechanism.
        // It cannot inherit the source Node permission model; disclose the
        // difference instead of disabling an otherwise normal connection.
        notices.push({name,code:'NATIVE_EXTERNAL_MCP',message:`${name} 由 Codex 原生 MCP 啟動；此程序不受來源 Node 的資料夾限制，請在安裝報告確認啟動指令。`,command:server.command,args:server.args,cwd:server.cwd});
        remote.push(name);continue;
      }
      if(type==='python'&&component?.kind==='declared-mcp'){
        notices.push({name,code:'NATIVE_EXTERNAL_MCP',message:`${name} 依正式宣告由 Codex 啟動 Python；沒有猜測套件內的檔案入口或替它安裝依賴。`,command:server.command,args:server.args,cwd:server.cwd});
        remote.push(name);continue;
      }
      if(server.args[0].startsWith('-'))fail(name,'入口不是已知的本機生成程式，禁止解譯器動態載入或執行旗標');
      const entry=await packageFile(packageRoot,server.args[0],cwd,name);
      if(!entry.startsWith('source/')&&!entry.startsWith('runtime/'))fail(name,'程式入口必須位於 source/ 或 runtime/');
      if(type==='node'&&!/\.(?:[cm]?js)$/.test(entry)||type==='python'&&!entry.endsWith('.py'))fail(name,'程式入口副檔名不符');
      if(type==='python'&&!pythonRuntime?.command)fail(name,'需要已確認的本機 Python 與完成審查的固定依賴');
      target={type,entry,args:server.args.slice(1),cwd,...(type==='python'?{command:pythonRuntime.command,pythonPaths:pythonRuntime.pythonPaths??[]}:{})};
    }
    targets.push(target);
    server.command='node';server.args=['./runtime/security-launch.mjs',String(targets.length-1)];server.cwd='.';server.env_vars=[];delete server.env;
    }catch(cause){
      if(cause.code==='SECURITY_INTEGRITY_MISMATCH')throw cause;
      omitted.push({name,code:cause.code??'MCP_COMPONENT_UNAVAILABLE',message:`已略過 ${name}：${cause.message}。其他可用功能仍可安裝。`});delete servers[name];
    }
  }
  return {targets,config:{...config,mcpServers:servers},remote,omitted,notices};
}
