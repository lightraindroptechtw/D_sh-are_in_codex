import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scanSecurity} from '../lib/cc-security-scan.mjs';
import {renderCCScanOverview} from '../lib/security-scan.mjs';
import {renderCCScanDetails,renderCodexSettings} from '../lib/cc-scan-markdown.mjs';
import {writeRiskySource,writeObfuscatedSource,minifiedText,FAKE_SECRET} from './cc-security-scan-fixtures.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc-scan-markdown-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return root;
}

test('overview preserves CC counts and links the fixture evidence across report categories',async t=>{
  const source=await writeRiskySource(await fixture(t)),scan=await scanSecurity(source);
  const before=structuredClone(scan);
  const markdown=renderCCScanOverview(scan,{source:{origin:'fixture',root:source,commit:'1234567890abcdef'},reportPath:'C:\\review\\scan.json'});
  assert.deepEqual(scan,before,'rendering must not alter the scanner result');
  assert.match(markdown,/完整掃描結果.*`C:\/review\/scan.json`/);
  assert.match(markdown,/提交 `1234567890ab`/);
  assert.match(markdown,/\| 自己開程式 \|[^\n]+\| 9 \|/);
  assert.match(markdown,/\| 連網路 \|[^\n]+\| 6 \|/);
  assert.match(markdown,/\| 寫入或刪除檔案 \|[^\n]+\| 4 \|/);
  assert.match(markdown,/\| 工具總數 \| 9 \|/);
  assert.match(markdown,/\| 需要金鑰 \|[^\n]+\| 4 \|/);
  assert.match(markdown,/\| 用你的帳號對外發文的工具 \|[^\n]+\| 4 \|/);
  assert.match(markdown,/\| 內附 Python 工具裡會對外發文的 \| `send_message` \| 1 \|/);
  const details=markdown.slice(markdown.indexOf('## 逐項位置'));
  for(const heading of ['自己開程式','連網路','讀寫檔案','用到使用者家目錄','金鑰','把整份環境變數交出去','對外發文','其他語言的檔案','安裝腳本','打包的依賴'])assert.ok(details.includes('### '+heading),heading);
  assert.match(details,/`index.js:13`[^\n]+child_process.spawn[^\n]+`python`/);
  assert.match(details,/`index.js:25`[^\n]+hooks.slack.com/);
  assert.match(details,/`index.js:21`[^\n]+絕對路徑[^\n]+\/etc\/hosts/);
  assert.match(details,/`index.js:32`/);
  assert.match(details,/`post_comment`[^\n]+`index.js:34`[^\n]+目的地欄位 bvid[^\n]+內容欄位 text/);
  assert.match(details,/`send_message`[^\n]+`mcp_server.py:7`/);
  assert.ok(!details.includes('fixture.test.js'),'test evidence is excluded from live behavior sections');
  assert.ok(!markdown.includes(FAKE_SECRET));
  assert.ok(!markdown.includes('Claude'));
  assert.ok(!markdown.includes('allowDirectExec'));
  assert.ok(!markdown.includes('outboundMode'));
});

test('Codex settings use the installed implementation defaults and distinguish plan capabilities',async t=>{
  const scan=await scanSecurity(await writeRiskySource(await fixture(t)));
  const plan={host:{services:['llm','agents'],chatEvents:[{name:'session/event'},{name:'agent.followup'}],behaviors:[{kind:'tool-hook'}],client:true},issues:[{message:'合成未支援項目'}]};
  const settings=renderCodexSettings(scan,{plan});
  assert.match(settings,/\| 插件呼叫模型 \| 開啟 \|/);
  assert.match(settings,/\| 插件建立與操作代理 \| 開啟 \|/);
  assert.match(settings,/\| 插件直接啟動程序 \| 關閉 \|/);
  assert.match(settings,/\| 對外發文 \| 每次確認 \|/);
  assert.match(settings,/\| 讓插件知道目前對話裡發生的事 \| 開啟 \|/);
  assert.match(settings,/\| 插件主動送出訊息 \| 關閉 \|/);
  assert.match(settings,/\| 原生工具掛鉤 \| 關閉 \|/);
  const markdown=renderCCScanOverview(scan,{plan});
  assert.match(markdown,/## Codex 不支援或尚待確認的 DSH 功能/);
  assert.match(markdown,/DSH 的畫面、側欄與原生聊天按鈕不轉換/);
  assert.match(markdown,/合成未支援項目/);
});

test('obfuscation and minification retain their distinct locations and evidence',async t=>{
  const source=await writeObfuscatedSource(await fixture(t));
  await fs.writeFile(path.join(source,'min.js'),minifiedText());
  const markdown=renderCCScanOverview(await scanSecurity(source));
  assert.match(markdown,/無法審查：有混淆過的程式碼/);
  assert.match(markdown,/### 混淆與壓縮/);
  assert.match(markdown,/混淆\*\* ：`lib\/core.js`[^\n]+_0x/);
  assert.match(markdown,/壓縮（不算混淆）：`min.js`/);
});

test('long evidence lists keep the CC display limit and point to the full caller report',async t=>{
  const source=await writeRiskySource(await fixture(t)),scan=await scanSecurity(source);
  scan.processes=Array.from({length:27},(_,index)=>({path:'many.js',line:index+1,context:'runtime',api:'spawn',program:'python'}));
  const details=renderCCScanDetails(scan,{reportPath:'C:\\review\\complete.json'});
  assert.ok(details.includes('`many.js:25`'));
  assert.ok(!details.includes('`many.js:26`'));
  assert.match(details,/還有 2 處，見 `C:\/review\/complete.json`/);
});
