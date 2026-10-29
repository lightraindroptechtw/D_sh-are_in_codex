/** Fixed-source compatibility evidence. Only explicitly reviewed cases execute. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {convert,verify} from '../lib/converter.mjs';
import {McpClient} from '../lib/protocol.mjs';
const workspace=path.resolve(import.meta.dirname,'../../..');
const arg=process.argv.indexOf('--out');if(arg<0)throw new Error('Use --out with a new directory');
const out=path.resolve(process.argv[arg+1]);await fs.mkdir(out,{recursive:false});
const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const original=await json(path.join(workspace,'work/dsh-converter-corpus/catalog.json'));
const extra=await json(path.join(workspace,'work/dsh-expanded-corpus/expanded-catalog.json'));
const sources=[...original.entries,{id:'dsh-plugin-development',localPath:path.join(workspace,'work/dsh-independent-qa/additional-source/dsh-plugin-development')},...extra.entries];
const fixture=path.join(out,'fixtures');await fs.mkdir(fixture);await fs.mkdir(path.join(fixture,'empty'));await fs.mkdir(path.join(fixture,'vault'));
await fs.writeFile(path.join(fixture,'vault/note.md'),'---\ntags: [synthetic]\n---\n# Synthetic vault\nOriginal plugin reads this content.\n');
// Synthetic PDF with a complete embedded XML invoice: 100 + 13 = 113.
const xml='<Invoice><InvoiceCode>044001900111</InvoiceCode><InvoiceNo>24412000000012345678</InvoiceNo><IssueDate>2024-01-05</IssueDate><TaxExclusiveAmount>100.00</TaxExclusiveAmount><TaxAmount>13.00</TaxAmount><TaxInclusiveAmount>113.00</TaxInclusiveAmount><BuyerName>Synthetic Buyer</BuyerName><BuyerTaxId>91110108MA01ABCDEF</BuyerTaxId><SellerName>Synthetic Seller</SellerName><SellerTaxId>91310115MA1K123456</SellerTaxId></Invoice>';
const pdf='%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(Invoice.xml) 6 0 R] >> >> >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n6 0 obj\n<< /Type /Filespec /F (Invoice.xml) /EF << /F 7 0 R >> >>\nendobj\n7 0 obj\n<< /Type /EmbeddedFile /Subtype /XML /Length '+Buffer.byteLength(xml)+' >>\nstream\n'+xml+'\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
await fs.writeFile(path.join(fixture,'invoice.pdf'),pdf);
const lines=['发票号码 24412000000012345678','发票代码 044001900111','开票日期 2024-01-05','金额 100.00','税额 13.00','价税合计 113.00'];
const hex=s=>'FEFF'+[...s].map(ch=>ch.charCodeAt(0).toString(16).padStart(4,'0')).join('');
const content='BT '+lines.map(line=>'<'+hex(line)+'> Tj 0 -14 Td').join(' ')+' ET';
await fs.writeFile(path.join(fixture,'invoice-text.pdf'),'%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'\nendstream\nendobj\n%%EOF');
const checks=[];
const check=(label,fn)=>{try{fn();checks.push({label,passed:true});}catch(e){checks.push({label,passed:false,error:e.message});}};
const pure={
  'dsh-pace-calc':['pace_calc',{dist:5,min:30,sec:0}],
  'dsh-rf-toolkit':['rf_shannon_capacity',{bandwidthHz:1000000,snrDb:0}],
  'dsh-tool-encoding':['encoding',{action:'base64_encode',input:'hello'}],
  'dsh-plugin-local-life':['local_life',{action:'convert',value:1,from:'kg',to:'斤'}],
  'dsh-folder-timemachine':['folder_timemachine',{action:'status'}],
  'dsh-invoice-tools':['invoice_parse',{path:path.join(fixture,'invoice-text.pdf')}],
  'dsh-obsidian':['obsidian_read',{path:'note.md'}],
};
const entries=[];
for(const source of sources){
  const row={id:source.id,source:source.repoUrl??source.repository??source.localPath,commit:source.commit??null,outputDir:path.join(out,source.id),skills:[],checks:[],sourceExecuted:false,toolsCalled:[]};
  const root=source.localPath??source.path;
  const config=source.id==='dsh-obsidian'?{vaultPath:path.join(fixture,'vault'),useCli:false,vaultWorkspaceOnly:false}:source.id==='dsh-bili-scroll'?{peakValley:false,autoComment:false}:source.id==='dsh-keep-awake'?{enabled:false,manualHold:false}:source.id==='dsh-cdp'?{autoConnect:false}:{};
  try{
    const report=await convert(root,{outputDir:row.outputDir,config,workspace:fixture,...(source.sourceEntry?{sourceEntry:source.sourceEntry}: {})});
    row.commit=report.source.commit;row.generated=report.conversion.validation?.valid===true;row.status=report.conversion.status;row.components=report.conversion.components.map(c=>({kind:c.kind,name:c.name}));row.issues=report.conversion.omitted;row.skills=report.capabilities.skills;
    check(source.id+' generation is honest about execution',()=>assert.equal(report.conversion.verification.toolsListed,false));
    const spec=pure[source.id];
    if(spec){
      const server=report.conversion.serverNames.dsh;row.verify=await verify(row.outputDir,{executeSource:true,server,call:spec[0],args:spec[1]});row.sourceExecuted=true;
      const result=row.verify.servers[0];check(source.id+' actual original tool call',()=>assert.equal(result.status,'tool-called',JSON.stringify(result)));if(result.status==='tool-called')row.toolsCalled.push(spec[0]);
      if(source.id==='dsh-invoice-tools')check('invoice original parser computes 100 + 13 = 113',()=>{const data=result.call.result.structuredContent;assert.equal(data.summary.parsedCount,1);assert.equal(data.summary.total,113);assert.equal(data.summary.checksFailed,0);});
      if(source.id==='dsh-invoice-tools'){
        row.xmlNegative=await verify(row.outputDir,{executeSource:true,server,call:'invoice_parse',args:{path:path.join(fixture,'invoice.pdf')}});
        check('original XML undefined output remains rejected by official lossless JSON validation',()=>{assert.equal(row.xmlNegative.servers[0].status,'call-error');assert.match(row.xmlNegative.servers[0].call.result.content[0].text,/lossless JSON/);});
        row.runtimeLimitations=['Original XML path sets source.matchedRules to undefined (src/invoice-model.ts buildInvoice). Official output validation refuses it. Source was not rewritten.'];
      }
      if(source.id==='dsh-obsidian')check('obsidian reads synthetic note through original source',()=>assert.match(result.call.result.structuredContent.content,/Original plugin reads this content/));
      if(source.id==='dsh-plugin-local-life')check('local life 1kg = 2 jin',()=>assert.equal(result.call.result.structuredContent.value,2));
      if(source.id==='dsh-folder-timemachine')check('folder status has no snapshots',()=>assert.deepEqual(result.call.result.structuredContent.snapshots,[]));
    }
    if(['dsh-bili-scroll','dsh-cdp','dsh-keep-awake','dsh-mcp-test'].includes(source.id)){
      const mcp=await json(path.join(row.outputDir,'.mcp.json'));const client=new McpClient({...mcp.mcpServers[report.conversion.serverNames.dsh],cwd:row.outputDir},{cwd:row.outputDir,timeout:30000});
      try{
        await client.start();row.sourceExecuted=true;row.listed=(await client.listTools()).map(t=>t.name);
        if(source.id==='dsh-mcp-test'){await new Promise(r=>setTimeout(r,1800));const baseline=await json(path.join(row.outputDir,'.state/.dsh-mcp-test/baseline.json'));check('mcp-test original observer persists baseline',()=>assert.ok(Array.isArray(baseline.tools)));row.runtimeBehavior='original registry observer created isolated baseline';}
        else {
          const route=source.id==='dsh-bili-scroll'?'/api/bili-duty/status':source.id==='dsh-cdp'?'/api/dsh-cdp?cmd=status':'/dsh-keep-awake/state';
          row.routeCall=await client.request('tools/call',{name:'dsh_host_http',arguments:{path:route,method:'GET'}});check(source.id+' local status route succeeds',()=>{assert.ok(!row.routeCall.isError,JSON.stringify(row.routeCall));assert.equal(row.routeCall.structuredContent.status,200);});if(!row.routeCall.isError&&row.routeCall.structuredContent.status===200)row.toolsCalled.push('dsh_host_http (status only)');
        }
      }finally{await client.close();}
    }
  }catch(e){row.error=e.message;row.runtimeCompatible=false;}
  entries.push(row);await fs.writeFile(path.join(out,'matrix.json'),JSON.stringify({entries},null,2)+'\n');console.log(JSON.stringify({id:row.id,generated:row.generated,called:row.toolsCalled,error:row.error}));
}
const result={schemaVersion:2,entries,checks,summary:{plugins:entries.length,generated:entries.filter(e=>e.generated).length,originalSourceExecuted:entries.filter(e=>e.sourceExecuted).length,pluginsWithCalls:entries.filter(e=>e.toolsCalled.length).length,checks:checks.length,checksPassed:checks.filter(c=>c.passed).length,modelCalls:0,logins:0,externalMessagesSent:0,blenderStarted:false,allGeneratedMeansAllCompatible:false}};
await fs.writeFile(path.join(out,'matrix.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.summary));if(checks.some(c=>!c.passed))process.exitCode=1;
