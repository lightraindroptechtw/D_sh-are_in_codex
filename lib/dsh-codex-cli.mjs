#!/usr/bin/env node
/** Generic DSH headless task shim. Receives only a bounded local broker capability, never Codex credentials. */
import {parseDshTaskArguments} from './dsh-codex-task.mjs';

try{
  const argv=process.argv.slice(2);parseDshTaskArguments(argv);
  const endpoint=new URL(process.env.DSH_CODEX_TASK_ENDPOINT??'');
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('A trusted local Codex task endpoint is required');
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({argv,cwd:process.cwd()}),signal:AbortSignal.timeout(30*60*1000),redirect:'error'});
  const result=await response.json();
  if(!response.ok)throw new Error(result.message??result.error??'Codex task failed');
  for(const notice of result.warnings??[])process.stderr.write([notice.what,notice.why,notice.setting,notice.impact].filter(Boolean).join('。')+'\n');
  process.stdout.write((result.text??'')+'\n');
}catch(cause){process.stderr.write((cause.message??'Codex task failed')+'\n');process.exitCode=1;}
