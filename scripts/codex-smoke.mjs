import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {run} from '../lib/source.mjs';

// This test starts a real Codex app-server, installs only this local plugin into
// an isolated home, and inspects its tools. No model turn or login is requested.
const pluginRoot=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2);const out=args.indexOf('--out');
const evidenceFile=out>=0?path.resolve(args[out+1]):null;
const corpusIndex=args.indexOf('--corpus');const corpus=corpusIndex>=0?path.resolve(args[corpusIndex+1]):null;
const root=await fs.mkdtemp(path.join(os.tmpdir(),'codex plugin smoke '));
const home=path.join(root,'home');await fs.mkdir(home);
const env={...process.env,CODEX_HOME:home,HOME:root,USERPROFILE:root};
const commands=[];
const plan=[['plugin','marketplace','add',pluginRoot,'--json'],['plugin','add','dsh-to-codex@dsh-converter-local','--json']];
const generated=[];const reviewedPure=['dsh-pace-calc','dsh-rf-toolkit','dsh-tool-encoding'];
const reviewedHosts=args.includes('--reviewed-hosts')?['dsh-plugin-local-life','dsh-invoice-tools','dsh-folder-timemachine']:[];
if(corpus){
  const matrix=JSON.parse(await fs.readFile(path.join(corpus,'matrix.json'),'utf8'));
  for(const row of matrix.entries){try{const manifest=JSON.parse(await fs.readFile(path.join(row.outputDir,'.codex-plugin/plugin.json'),'utf8'));generated.push({id:row.id,outputDir:row.outputDir,name:manifest.name,expectedSkills:(row.skills?.length??0)});}catch(e){if(e.code!=='ENOENT')throw e;}}
  const marketplace=path.join(corpus,'.agents/plugins/marketplace.json');await fs.mkdir(path.dirname(marketplace),{recursive:true});
  await fs.writeFile(marketplace,JSON.stringify({name:'dsh-converted-validation',plugins:generated.map(g=>({name:g.name,source:{source:'local',path:'./'+path.relative(corpus,g.outputDir).replaceAll('\\','/')},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}))},null,2));
  plan.push(['plugin','marketplace','add',corpus,'--json']);
  for(const g of generated.filter(g=>[...reviewedPure,...reviewedHosts].includes(g.id)))plan.push(['plugin','add',g.name+'@dsh-converted-validation','--json']);
}
for(const command of plan){
  const result=await run('codex',command,{cwd:root,env,timeout:60000});
  if(result.code)throw new Error(result.stderr||result.stdout);
  commands.push({args:command,result:JSON.parse(result.stdout)});
}
const child=spawn('codex',['app-server','--stdio','-c','features.plugins=true'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const closed=once(child,'close');let stderr='',sequence=0;const pending=new Map();
child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8000);});
child.on('error',error=>{for(const p of pending.values())p.reject(error);});
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out: '+stderr));},45000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
try{
  const initialize=await request('initialize',{clientInfo:{name:'dsh-real-plugin-smoke',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
  const plugin=await request('plugin/read',{marketplacePath:path.join(pluginRoot,'.agents/plugins/marketplace.json'),pluginName:'dsh-to-codex'});
  assert.ok(plugin.plugin.skills.some(s=>s.name.endsWith('dsh-to-codex')));
  const convertedReads=[];
  for(const g of generated){const read=await request('plugin/read',{marketplacePath:path.join(corpus,'.agents/plugins/marketplace.json'),pluginName:g.name});assert.equal(read.plugin.summary.name,g.name);if(g.id==='agent-useful-skills')assert.equal(read.plugin.skills.length,14,JSON.stringify(read));if(g.id==='dsh-plugin-development')assert.equal(read.plugin.skills.length,2,JSON.stringify(read));convertedReads.push({id:g.id,result:read});}
  const statuses=await request('mcpServerStatus/list',{});
  const data=statuses.data??statuses.servers??[];
  const match=data.find(s=>Object.keys(s.tools??{}).some(n=>n.includes('inspect_dsh_plugin')));
  assert.ok(match,'Real Codex must discover converter MCP tools: '+JSON.stringify(statuses));
  const names=Object.values(match.tools).map(t=>t.name).sort();
  assert.ok(names.some(n=>n.includes('convert_dsh_plugin')));assert.ok(names.some(n=>n.includes('verify_codex_plugin')));
  assert.ok(names.some(n=>n.includes('open_dsh_market')));
  const allNames=data.flatMap(s=>Object.values(s.tools??{}).map(t=>t.name));
  if(corpus)for(const name of ['pace_calc','rf_shannon_capacity','encoding'])assert.ok(allNames.includes(name),'Real Codex must load converted tool '+name+': '+JSON.stringify(statuses));
  if(reviewedHosts.length)for(const name of ['local_life','invoice_parse','folder_timemachine'])assert.ok(allNames.includes(name),'Real Codex must load official-host tool '+name+': '+JSON.stringify(statuses));
  const evidence={passed:true,commands,initialize,pluginRead:plugin,convertedReads,mcpServerStatus:statuses,modelTurnsStarted:0,externalServicesStarted:0};
  if(evidenceFile){await fs.mkdir(path.dirname(evidenceFile),{recursive:true});await fs.writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n');}
  process.stdout.write(JSON.stringify({passed:true,toolNames:allNames,convertedPackagesParsed:convertedReads.length,skills:plugin.plugin.skills.map(s=>s.name),modelTurnsStarted:0,evidenceFile},null,2)+'\n');
}finally{
  for(const p of pending.values())clearTimeout(p.timer);child.kill();await closed.catch(()=>{});lines.close();
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('codex plugin smoke '));
  await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
