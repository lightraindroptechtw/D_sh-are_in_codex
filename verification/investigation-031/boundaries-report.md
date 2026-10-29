# 100 個新增來源：unsupported 邊界靜態調查

日期：2026-10-23。調查對象是 `work/dsh-luna-validation-100-v0.2.1-20261023-run2` 的 19 個 unsupported 樣本。只讀來源封存、manifest、patch、入口與既有轉換報告；未初始化/執行任何新來源，未呼叫模型。另以自行合成的技能 plugin 做 Codex `plugin/read`；沒有安裝或啟動它。

## 結果

19 件並非一種失敗：4 件是純 DSH 瀏覽器介面、5 件有 DSH 專用宿主或會話生命週期依賴、7 件是通用分析/包裝缺口、2 件是技能目錄驗證誤判，另 1 件因來源高度混淆而無法安全分類。這些數字是主分類；有些項目同時具有多個問題。

最明確的一般缺陷是 0.2.1 baseline 的 inspect 規則曾靜默略過超過 512 KiB 的 JavaScript；父端已在 0.3.1 修正為 8 MiB 單檔上限，超過時回報 `JS_ANALYSIS_LIMIT`（現行程式 [inspect.mjs](/<local-workspace>)）。0.3.1 重轉四個大入口後，工具註冊重新出現在報告。`dsh-literature`、`dsh-office`、`dsh-eteams`、`dsh-auto-memory` 的入口是 0.70–1.46 MiB；逐檔呼叫純靜態 `inspectJs` 時，分別可找出 1、8、6、1 個 `tools.register` 註冊。Office 可見 8 個具名工具；auto-memory 的工具名稱透過 `defineTool(name, ...)` 及變數註冊，現有 AST 雖看到註冊但取不到名稱。這些不是執行來源，而是解析原始文字。

第二個通用缺口是宿主服務注入的別名追蹤。分析器只看 `ctx`/`context` 的直接屬性，但 `dsh-client-ui-second-brain` 以 `ctx.inject(['webServer'], (httpCtx) => httpCtx.webServer.register(...))` 提供會話讀取/筆記處理路由；`dsh-capmap-viz` 使用 `ctx.connection.rpc.handle`；simple-worktree 和 VPS 使用 `ctx.connection.fetch.register`。這些都不是純 UI。要不要產生 Codex 工具仍需核實 handler schema 和授權界線；但至少不應因分析器沒看見而顯示為「沒有可轉換功能」。

技能 name 與目錄名不同確實是舊驗證器過嚴。真實 Codex `plugin/read` 對合成 plugin 接受 `skills/skill/SKILL.md` 裡 `name: cua-driver`，以及 `skills/source/SKILL.md` 裡 `name: schedule-later`，回傳兩個 `enabled: true` 的技能；讀出的 path 保留各自原目錄。實測證據在 [synthetic-skill-dir-plugin-read.json](/<local-workspace>)。Codex 原始碼測試 helper [test_support.rs](/<local-workspace>) 將 frontmatter 解析為技能 metadata，並以目錄名稱作為缺少名稱時的 fallback；這段沒有要求兩者必須相等。父端已改成保留來源內容/資源路徑，只檢查技能名稱是否合法與必要欄位，目錄不同時給 warning。

第三個需區分的情況是 patch 目標依賴 profile 基底。`dsh-web-search-firecrawl` 的 `cordis.patch.yml` 先修改核心 `id:web` 的搜尋設定，再插入套件；孤立來源轉換沒有 `web` 基底，所以回報 `PATCH_TARGET`。入口實際呼叫 `ctx.web.registerSearchProvider`。這有真實搜尋後端功能，並非只有 UI；但它是 DSH 的 provider 擴充介面，不能從一個通用 Codex tool 裡猜出等價語義。更好的處理是讓使用者明確選 profile base，並把 DSH provider API 未支援另列，而非把 patch 當成來源版本錯誤。

同一 19 件的靜態相容性檢查另發現 6 件與實際封裝的官方依賴版本宣告範圍不符：`dsh-obsidian-board`、`dsh-cua-drive`、`dsh-web-search-firecrawl`、`dsh-capmap-viz`、`dsh-eteams`、`dsh-simple-worktree`。完整 100 件含傳遞依賴的證據是 [inspect-100.json](/<local-workspace>)；舊的 direct-dependency audit 是 54/100，新口徑為 57/100。這是相容性警示，不足以解釋 analyzer 標成 unsupported，也沒有實測其執行失敗。

## 19 個來源判斷

| 來源 | 分類 | 靜態證據與判斷 |
|---|---|---|
| `dsh-obsidian-board` | DSH 專用宿主/互動流程，混合 UI 與 RAG | `lib/index.js:406` 是 `TypertRemoteService`，`3–11` 說明客戶端透過 `obsidianBoard` RPC、模型走 `ctx.llm`；有實質 vault 檢索與引用，不能因面板 UI 排除，但現有入口不是 Codex 可呼叫工具。 |
| `@czf1995/dsh-waste-market` | 來源混淆，無法安全分類 | manifest 是 web client 與 dashboard 描述；main/client bundle 均高度混淆且大段單行。本輪不解碼或執行，分類未知是**實測限制**；純 UI 是假說，不能據此排除非 UI 功能。 |
| `dsh-cua-drive` | 通用驗證器誤判 | `lib/index.mjs:1938–2078` 註冊 CUA 工具；來源 `skill/SKILL.md` 名稱是 `cua-driver`。錯誤僅為產物目錄 `skill` 不同於 frontmatter。合成 `plugin/read` 已證明 Codex 接受此種結構。 |
| `@a9i5k4/dsh-literature` | 0.2.1 的 512 KiB 通用分析缺口（0.3.1 已修），另有 DSH fallback | `lib/index.js:36740` 註冊 web route，`:36859–36869` 註冊工具。1,369,984 bytes 超出靜態掃描上限，直接 `inspectJs` 找到 registration。部分 session/event fallback 仍依賴 DSH。 |
| `dsh-web-search-firecrawl` | DSH provider API + profile patch context 缺口 | `lib/dsh-web-search-firecrawl.js:332–341` 讀設定並呼叫 `ctx.web.registerSearchProvider`；patch 修改 `id:web`，但單包沒有基底。搜尋功能不是 UI-only；Codex 搜尋 provider 不應靠猜測轉成通用 HTTP tool。 |
| `dsh-image-conatiner` | 純 UI | `lib/index.js:5` 的 `apply(_ctx)` 無 host side；manifest 指向 client gallery/lightbox。 |
| `@ai-galaxy/dsh-sound` | DSH 事件生命週期 | `lib/index.js:59–63` 只註冊 settings，功能描述是完成/核准/問題/失敗等 DSH turn 事件音效。不是換色，但也沒有獨立工具入口。 |
| `dsh-dictation-hotkey` | DSH composer/speech API | `host/index.js:26` 的 `apply()` 為空；套件描述的語音輸入經 DSH speech Remote 寫入 Web composer。屬於非外觀輸入能力，但依賴 DSH 客戶端服務。 |
| `@chenjh12/dsh-capmap-viz` | RPC host 服務分析/包裝缺口 | `lib/index.js:20` 呼叫 `ctx.connection.rpc.handle`，client 顯示能力圖譜。資料/RPC 有非 UI 功能；沒有已宣告 MCP tool，通用轉換需解析 RPC endpoint/schema。 |
| `dsh-client-ui-second-brain` | 注入別名追蹤缺口 + DSH session 功能 | `lib/index.js:1066–1088` 讀 DSH session logs；`:2496–2566` 透過 callback 別名 `httpCtx.webServer.register` 提供多個路由。實際有會話整理與 Obsidian 寫入，不是純 UI；分析器沒有追蹤 `ctx.inject` callback alias。 |
| `dsh-md-studio` | 純 UI | `lib/index.js:2–3` 明示 `inject=[]`、`apply(){}`；功能是 Markdown/圖表側欄預覽。 |
| `dsh-consistency-guard` | 純 UI | `lib/index.js:1–13` 說功能全在 client bundle，`apply` 無服務端服務；對話文字衝突提示與跳轉在 conversation slot。 |
| `@copylee/dsh-office` | 0.2.1 的 512 KiB 通用分析缺口（0.3.1 已修） + Windows 執行前提 | `lib/index.js:18977–19309` 定義 Office tools；`:19420–19433` 註冊工具。702,949 bytes 被靜默略過；直讀 AST 找到 8 個具名工具。非 UI；需要宿主 Windows/Office 是平台條件，不能假稱已執行驗證。 |
| `dsh-eteams` | 0.2.1 512 KiB 漏檢（0.3.1 已修）+ DSH subagent/session 依賴 | `lib/index.js:2,9` 匯入 tools/session；`:8716+` 定義多個團隊/任務工具。765,249 bytes；AST 找到 6 registrations 和多個工具。團隊子會話編排依賴 DSH agent/session，但成員/任務工具仍是非 UI 功能。 |
| `dsh-schedule-later` | 通用驗證器誤判 + DSH wakeup 語義 | `src/index.js:21,30,79,93` 注入 webServer/tools/skills 並註冊工具；根 `SKILL.md` 名稱 `schedule-later`。產物放在 `skills/source` 被舊驗證器拒絕。Codex `plugin/read` 已證明可保留此路徑。定時喚醒 DSH 對話仍是 DSH lifecycle 功能。 |
| `@alpacachen/dsh-simple-worktree` | connection wrapper 分析缺口 | `lib/index.js:173–177` 宣告 connection/subprocess/settings；`:312` 透過 `ctx.connection.fetch.register` 暴露 worktree endpoints。管理 worktree 是非 UI 操作，但沒有直接 `tools.register`。需要保持 authenticated carrier 的授權界線。 |
| `dsh-notch-focus` | 純 DSH UI/session controller 整合 | `lib/dsh-notch-focus.js:4` 只有載入 log；manifest 注入 session/workspace controller，描述是導航/read-state 同步。沒有 host callable surface。 |
| `dsh-vps` | DSH host route + pluginManager/desktopActions 依賴 | `plugin/index.mjs:25–45` 注入 pluginManager、desktopActions、connection；`:9` 說使用 DSH `/api` Host/Origin fence。安裝/更新/重啟是實際非 UI 功能；沒有 tool registration，不能按純介面排除，也不可去掉原授權圍欄。 |
| `@a9i5k4/dsh-auto-memory` | 0.2.1 512 KiB 漏檢（0.3.1 已修）+ DSH prompt/subagent/session 依賴 | `lib/index.js:335` 注入 webServer/tools/systemPrompt/subagents/llm；`:13887` 用 `defineTool(name, ...)`；`:15385` apply；`:18094+` 有大量具名工具。1,458,742 bytes 被略過，AST 可見一筆註冊但取不到動態工具名。讀寫/搜尋記憶是非 UI 功能；prompt 注入及代理整合仍是 DSH 專用。 |

## 建議優先修的通用規則

1. **已在 0.3.1 修正** ：單檔上限 8 MiB，超限入口可達檔案會有 `JS_ANALYSIS_LIMIT`，不得靜默當成沒有功能。六包重轉已驗證本批四個大入口被解析。
2. 追蹤 `ctx.inject` 依賴陣列與 callback 參數 alias；把 `webServer.register`、`connection.rpc.handle`、`connection.fetch.register` 紀錄成路由能力和依賴，不自動捏造 schema。無法安全包成 tool 時仍給 partial 並列出人工介接需求。
3. 安全追蹤本地 `defineTool(name, ...)` 的字串名稱與變數註冊；遇到動態名稱報 unconfirmed，實際執行能力以官方 DSH runtime 的 `tools/list` 為準。
4. Patch 若依賴 profile 核心層，提供明確 profile base 選擇；把未知基底列作 context 缺失，而非來源壞版。
5. 混合 UI/host 套件分開記錄 client UI、route/tool、session/agent 等能力。`NATIVE_UI` 只能表示 UI 沒搬，不能抵消同一來源的 backend 能力。

完整逐筆證據、分類 machine-readable 資料與合成 parser 證據見 [boundaries-report.json](/<local-workspace>)。本報告是靜態與 `plugin/read` 解析驗證，不代表來源執行成功、依賴相容性已在 runtime 證實，或插件能安全在 Codex 啟動。

## 修復後重測

父端發布轉換器 0.3.1 後，我重轉了兩個技能來源與四個超過舊 512 KiB 上限的 bundle。六份都產生結構有效的 partial 套件；Codex 0.160.0 對六份都成功 `plugin/read`，沒安裝、沒啟動 MCP、沒執行來源、沒呼叫模型。逐份狀態、工具註冊與相容性警示見 [reconvert-six-summary.json](/<local-workspace>)，完整 parser 結果見 [plugin-read-six.json](/<local-workspace>)。

CUA Driver 的 8 個 `skill/` 檔案（含 `SKILL.md`、BROWSER/EMBEDDING/LINUX/MACOS/README/RECORDING/WINDOWS 資源）逐檔 SHA-256 與產物 `source/skill/` 一致；排程來源根目錄 `SKILL.md` 也與 `source/SKILL.md` 完全一致。Codex 實際列出 `dsh-cua-drive-codex:cua-driver` 與 `dsh-schedule-later-codex:schedule-later`。兩份仍是 partial，因執行依賴與 DSH chat wakeup 語義各有明確範圍限制；目錄名誤判已消失。

四個大入口在新 8 MiB 限制內，重轉後至少偵測到 literature 1、Office 1、eteams 6、auto-memory 1 次工具註冊；Office 有 8 個具名工具，eteams 有 37 個具名工具。Literature/auto-memory 的具名工具透過變數工廠傳遞，靜態名稱仍未知，但入口不再被默默當成無能力。其他 callback alias/RPC 到 MCP 的包裝缺口留作後續一般化工作，這次沒有擴大為直接推測轉換。

最終回歸命令 `CODEX_INTEGRATION=1 npm test`：109/109 通過、0 失敗，完整輸出保存在 [npm-test-0.3.1.log](/<local-workspace>)。



