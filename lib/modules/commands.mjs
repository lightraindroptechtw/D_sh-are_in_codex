import crypto from 'node:crypto';
import {createBridgeAgent} from './approval.mjs';

const executionReason='官方命令執行需要真實 DSH Agent、命令生命週期事件與對話紀錄；Codex 對話無法提供這些語意，未建立替代會話';
export const descriptor={
  id:'commands',displayName:'斜線指令模組',services:['commands'],officialPackage:'@deepseek-ai/dsh-commands',
  requires:{minimumCodexVersion:'0.160.0',capabilities:['mcp','skills']},
  methods:{
    register:{support:'full',reason:'沿用官方命令登記、重複名稱檢查與清除機制'},
    list:{support:'partial',reason:'可列舉全域命令；沒有 DSH Agent，因此不列舉 DSH 代理專屬命令'},
    find:{support:'partial',reason:'可查找全域命令定義；沒有 DSH 代理範圍'},
    execute:{support:'unsupported',reason:executionReason},
    run:{support:'partial',reason:'直接呼叫已登記的全域命令處理函式；依賴 DSH 代理完整生命週期的處理函式仍須個別移植'},
    registerFileReceiptResolver:{support:'unsupported',reason:'DSH 上傳收據需要真正的 DSH 對話擁有者'},
  },
  requirements:['靜態可辨識的命令會產生對應技能，經 dsh_host_command_run 執行','動態命令名稱必須啟動宿主後透過 dsh_host_commands 列舉'],
};

export function unsupported(method='execute'){
  const reason=descriptor.methods[method]?.reason??'未對應的 DSH 命令方法';
  return Object.assign(new Error(`斜線指令模組 commands.${method}：${reason}`),{code:'DSH_MODULE_METHOD_UNSUPPORTED',module:'commands',method,reason});
}

export async function install({root,capabilities={}}={}){
  if(capabilities.mcp===false||capabilities.skills===false)return {services:{},diagnostics:[{module:'commands',code:'MODULE_CAPABILITY_UNAVAILABLE',reason:'Codex 缺少 MCP 或技能能力'}]};
  const official=root?.get?.('commands');
  if(!official)return {services:{},diagnostics:[{module:'commands',code:'MODULE_SERVICE_UNAVAILABLE',reason:'官方命令登記服務尚未掛載'}]};
  // Wrap instance methods, keeping service identity and the official registration
  // scope. No official file or plugin source is changed, and no Agent is created.
  const originals=new Map();
  for(const method of ['execute','registerFileReceiptResolver']){
    originals.set(method,Object.getOwnPropertyDescriptor(official,method));
    Object.defineProperty(official,method,{configurable:true,writable:true,value(){throw unsupported(method);}});
  }
  return {services:{commands:official},diagnostics:[{module:'commands',code:'COMMAND_EXECUTION_PARTIAL',reason:'可透過 commands.run 呼叫全域命令處理函式；'+executionReason}],dispose:async()=>{for(const [method,original]of originals)if(original)Object.defineProperty(official,method,original);else delete official[method];}};
}

export async function runCommand(root,{name,args='',signal,agent}={}){
  const registry=root.get('commands');if(!registry)throw Object.assign(Error('官方命令登記服務沒有掛載'),{code:'HOST_SERVICE_UNAVAILABLE'});
  if(typeof name!=='string'||!/^[a-z][a-z0-9_-]*$/.test(name))throw Object.assign(Error('命令名稱不合法'),{code:'INVALID_ARGUMENT'});
  const definition=registry.find(undefined,name);if(!definition)throw Object.assign(Error(`找不到全域命令 /${name}`),{code:'COMMAND_NOT_FOUND'});
  const rawInput=typeof args==='string'&&args.length?(/^\s/.test(args)?args:' '+args):'';
  const outcome=await definition.handler({commandId:'codex-'+crypto.randomUUID(),agent:agent??createBridgeAgent({root,callId:'command-'+name,args:{}}),rawInput,attachments:[],signal:signal??new AbortController().signal});
  if(outcome?.kind==='error')throw Object.assign(Error(String(outcome.text??'命令回報錯誤')),{code:'COMMAND_FAILED'});
  return {text:typeof outcome?.text==='string'?outcome.text:''};
}

/** Generate one discovery skill for each statically known command. All text
 * explicitly reports the execution limitation; no prompt claims handler parity.
 */
export function generateCommandSkills(plan={}, {hostTool='dsh_host_commands'}={}){
  const definitions=plan.capabilities?.commands?.definitions??[];
  const dynamic=plan.capabilities?.commands?.dynamicRegistrations??[];
  const byName=new Map(definitions.map(row=>[row.name,row]));
  const skills=[];
  for(const [name,row]of byName){
    if(!/^[a-z][a-z0-9_-]*$/.test(name))continue;
    const suffix=crypto.createHash('sha256').update(name).digest('hex').slice(0,8);
    const skillName=`dsh-command-${name.slice(0,40)}-${suffix}`;
    const title=`執行 DSH /${name} 命令`;
    const content=`---\nname: ${skillName}\ndescription: ${JSON.stringify(title+'；呼叫原插件登記的處理函式')}\n---\n\n使用 ${hostTool} 列舉命令，再使用 dsh_host_command_run，name 填 ${JSON.stringify(name)}，args 填使用者提供的參數。\n\n只有使用者要求時才執行；可能修改檔案或對外操作。依賴 DSH 原生代理生命週期的命令可能仍不能使用，請依工具結果說明，不要聲稱成功。\n`;
    skills.push({name:skillName,command:name,path:`skills/${skillName}/SKILL.md`,content,source:{path:row.path,line:row.line},execution:'direct-global-handler'});
  }
  return {skills,diagnostics:dynamic.map(row=>({module:'commands',code:'COMMAND_DYNAMIC_NAME',path:row.path,line:row.line,reason:'命令名稱無法靜態確認；請啟動後使用 dsh_host_commands 列舉'}))};
}
export const generators={commandSkills:generateCommandSkills};
