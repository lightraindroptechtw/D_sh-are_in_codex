import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createMarketOperations} from '../lib/market-operations.mjs';
import {verify} from '../lib/converter.mjs';
import {RESULT_FILE} from '../lib/rewrite.mjs';
import {startMarketServer} from '../lib/market-server.mjs';
import {createMarketConversation} from '../lib/market-conversation.mjs';
import {secureGeneratedPackage} from '../lib/security-package.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
async function setup(t,{secure=false}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'market rewrite flow '));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'local source');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'package.json'),json({name:'synthetic-native-ui',version:'1.0.0',license:'MIT',type:'module',main:'index.mjs',dsh:{client:'client.js'}}));
  await fs.writeFile(path.join(source,'index.mjs'),"throw new Error('Third-party-style source must never execute'); export function apply(){}\n");
  await fs.writeFile(path.join(source,'client.js'),"window.__ModuleLoader__.load({id:'synthetic-native-ui',apply(){throw new Error('client must never execute')}});\n");
  await fs.writeFile(path.join(source,'LICENSE'),'MIT fixture author\n');
  const calls=[];
  const operations=await createMarketOperations({dataRoot:path.join(root,'market'),codexHome:path.join(root,'isolated home'),codexCommand:'synthetic-no-native-cli',installDependencies:false,
    // Only the native registration and OS restriction boundary are mocked.
    // Source inspection, conversion, signed reviews/digests and MCP verification are real.
    runImpl:async(command,args)=>{calls.push({command,args});return {code:0,stdout:'{"success":true}'};},sandboxImpl:secure?(root,options)=>secureGeneratedPackage(root,{...options,runGuardedImpl:async()=>({enforced:true,testBoundary:'native OS probe stub only'})}):async()=>({enforced:true,testBoundary:'synthetic restriction only'})});
  return {root,source,calls,operations};
}
async function writeEcho(prepared){
  const pluginDir=prepared.pluginDir;
  await fs.mkdir(path.join(pluginDir,'skills/rewrite'),{recursive:true});
  await fs.writeFile(path.join(pluginDir,'skills/rewrite/SKILL.md'),'---\nname: rewrite\ndescription: 呼叫合成回音工具。\n---\n\n使用 rewrite 伺服器的 echo 工具。\n');
  await fs.mkdir(path.join(pluginDir,'runtime/rewrite'),{recursive:true});
  await fs.writeFile(path.join(pluginDir,'runtime/rewrite/echo.mjs'),`import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){
 const m=JSON.parse(line);if(m.id===undefined)continue;let result;
 if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'synthetic-rewrite-echo',version:'1'}};
 else if(m.method==='tools/list')result={tools:[{name:'echo',description:'Return supplied synthetic text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]};
 else if(m.method==='tools/call')result={content:[{type:'text',text:m.params.arguments.text}]};
 else result={};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}
`);
  await fs.writeFile(path.join(pluginDir,RESULT_FILE),json({schemaVersion:1,conclusion:'partial',implemented:['加入合成 echo 工具與對應技能。'],limitations:['只驗證回音；沒有移植 DSH 介面。'],mcpServers:{rewrite:{command:'node',args:['./runtime/rewrite/echo.mjs'],cwd:'.'}},verification:{rewrittenCodeExecuted:false}}));
}

test('review local pure UI -> prepare rewrite -> static finish -> consented native-registration stub -> actual synthetic MCP echo',async t=>{
  const f=await setup(t),reviewed=await f.operations.reviewSource({source:f.source,aiScope:'none'});
  assert.equal(reviewed.startedModel,false);assert.equal(reviewed.converted,false);
  const prepared=await f.operations.rewrite({action:'prepare',reviewId:reviewed.reviewId,model:'current-conversation',effort:'high'});
  assert.equal(prepared.startedModel,false);assert.equal(f.calls.length,0);
  const task=JSON.parse(await fs.readFile(prepared.taskPath,'utf8'));assert.equal(task.requestedExecution.effort,'high');
  await writeEcho(prepared);
  const finished=await f.operations.rewrite({action:'finish',rewriteId:prepared.rewriteId});
  assert.equal(finished.rewrittenCodeExecuted,false);assert.match(finished.artifactHash,/^[a-f0-9]{64}$/);assert.equal(f.calls.length,0);
  await assert.rejects(f.operations.installReviewed({reviewId:reviewed.reviewId,rewriteId:prepared.rewriteId,consent:false}),/明確同意/);
  const installed=await f.operations.installReviewed({reviewId:reviewed.reviewId,rewriteId:prepared.rewriteId,consent:true});
  assert.equal(installed.installed,true);assert.equal(installed.status,'partial');assert.ok(installed.components.some(row=>row.kind==='rewrite'));
  assert.deepEqual(f.calls.map(row=>row.args.slice(0,2)),[['plugin','marketplace'],['plugin','add']]);
  const installedEntry=(await f.operations.installed())[0];
  const packageRoot=installed.packageRoot??installedEntry.packageRoot;
  const before=await fs.readFile(path.join(packageRoot,'runtime/rewrite/echo.mjs'),'utf8');assert.match(before,/synthetic-rewrite-echo/);
  const verified=await verify(packageRoot,{executeSource:true,server:'rewrite',call:'echo',args:{text:'actual synthetic echo'}});
  assert.equal(verified.structure.valid,true);assert.equal(verified.executed,true);assert.equal(verified.servers[0].status,'tool-called');
  assert.equal(verified.servers[0].call.result.content[0].text,'actual synthetic echo');
  assert.equal(await fs.readFile(path.join(packageRoot,'source/LICENSE'),'utf8'),'MIT fixture author\n');
});

test('market signed rewrite binding rejects a generated file changed after finish and never invokes native install',async t=>{
  const f=await setup(t),reviewed=await f.operations.reviewSource({source:f.source,aiScope:'none'});
  const prepared=await f.operations.rewrite({action:'prepare',reviewId:reviewed.reviewId});await writeEcho(prepared);
  await f.operations.rewrite({action:'finish',rewriteId:prepared.rewriteId});
  await fs.appendFile(path.join(prepared.pluginDir,'runtime/rewrite/echo.mjs'),'\n// Changed after review\n');
  await assert.rejects(f.operations.installReviewed({reviewId:reviewed.reviewId,rewriteId:prepared.rewriteId,consent:true}),/已審查補寫產物/);
  assert.equal(f.calls.length,0);assert.deepEqual(await f.operations.installed(),[]);
});

test('queued HTTP rewrite completes through the conversation carrier without returning raw source plans or starting models',async t=>{
  const f=await setup(t),dataRoot=path.join(f.root,'market');
  const server=await startMarketServer({dataRoot,operations:f.operations,idleTimeoutMs:0,ccFetchText:()=>{throw Error('No catalog fetch');},desktopConversation:{close:async()=>{}}});t.after(()=>server.close());
  const conversation=createMarketConversation({dataRoot,launchImpl:async()=>{},readRecord:async()=>({url:server.url,accessToken:server.accessToken})});
  const review=await conversation.reviewSource({source:f.source,aiScope:'none'});
  const check=await conversation.rewrite({action:'check',reviewId:review.reviewId});
  assert.equal(check.plan,undefined);assert.equal(check.startedModel,false);assert.ok(check.targets.length);
  const prepared=await conversation.rewrite({action:'prepare',reviewId:review.reviewId});await writeEcho(prepared);
  const result=await conversation.rewrite({action:'finish',rewriteId:prepared.rewriteId,aiScope:'none'});
  assert.equal(result.status,'static-only');assert.equal(result.installed,false);assert.equal(result.startedModel,false);assert.equal(result.untrustedSourceData,undefined);
  assert.match(result.artifactHash,/^[a-f0-9]{64}$/);assert.equal(f.calls.length,0);
});

test('rewritten publication tools and declared keys reach installed policy without rescanning the bundled framework',async t=>{
 const f=await setup(t,{secure:true}),reviewed=await f.operations.reviewSource({source:f.source,aiScope:'none'}),prepared=await f.operations.rewrite({action:'prepare',reviewId:reviewed.reviewId});await writeEcho(prepared);
 await fs.writeFile(path.join(prepared.pluginDir,'runtime/rewrite/posting.mjs'),`const key=process.env.REWRITE_API_KEY;defineTool({name:'send_comment',description:'發送留言',parameters:{to:{type:'string'},content:{type:'string'}},execute:async()=>{throw Error('Never execute a posting test')}});`);
 const finished=await f.operations.rewrite({action:'finish',rewriteId:prepared.rewriteId,aiScope:'none'});
 assert.ok(finished.abilitySummary.postingTools.includes('send_comment'));assert.ok(finished.abilitySummary.scanSummary.programFiles<10);
 const result=await f.operations.installReviewed({reviewId:reviewed.reviewId,rewriteId:prepared.rewriteId,consent:true});
 const root=result.packageRoot??(await f.operations.installed())[0].packageRoot;
 const report=JSON.parse(await fs.readFile(path.join(root,'conversion-report.json'),'utf8'));
 assert.ok(report.environment.requestedEnvNames.includes('REWRITE_API_KEY'));assert.ok(report.securityScan.postingTools.some(row=>row.name==='send_comment'));
 assert.equal(report.securityScan.summary.findings,report.securityScan.findings.length);assert.ok(report.rewriteSecurityScan.files.every(row=>!/host-env/.test(row.file)));
 const policy=JSON.parse(await fs.readFile(path.join(root,'runtime/security-policy.json'),'utf8'));
 assert.ok(policy.declaredSecrets.includes('REWRITE_API_KEY'));assert.ok(policy.postingTools.some(row=>row.name==='send_comment'));
});
