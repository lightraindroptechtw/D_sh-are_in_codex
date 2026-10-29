# 最後獨立驗證：0.3.0 測試與 Codex 插件讀取

日期：2026-10-23（台北）

## 完整測試

在目前套件版本 0.3.0、Codex CLI 0.160.0 下，以 `CODEX_INTEGRATION=1 npm test` 執行：104 項通過、0 失敗、0 跳過，耗時約 11.8 秒。完整終端輸出保存在 [npm-test-0.3.0.log](npm-test-0.3.0.log)，摘要在 [test-run-0.3.0.json](test-run-0.3.0.json)。較早的 0.2.1 測試輸出也保留為 `npm-test.log`，最終結果以 0.3.0 這次為準。

## `codex-smoke.mjs` 審查與讀取驗證

我檢視了 [codex-smoke.mjs](../../outputs/dsh-to-codex/scripts/codex-smoke.mjs)。它除了呼叫 `plugin/read`，也會用 CLI 加入 marketplace、加入轉換器和幾個已審查的舊插件，最後呼叫 `mcpServerStatus/list`。因此我沒有原樣執行該完整流程，而是建立只發出 `initialize` 和 `plugin/read` 的讀取驅動；不呼叫 `plugin add`、`mcpServerStatus/list` 或工具呼叫。

讀取驅動以全新的隔離 `CODEX_HOME` 啟動 Codex app-server，對批次中 81 個結構有效的插件包逐一呼叫 `plugin/read`。它先從每個產物的 `.codex-plugin/plugin.json` 建立同一個本機 marketplace，並確認所有目標名稱唯一。Codex CLI 版本是 0.160.0；81 個插件全部解析成功、0 失敗，合計列出 236 個技能項目。逐筆結果、已解析技能名稱和說明見 [codex-plugin-read.json](codex-plugin-read.json)，可重跑的讀取驅動見 [read-81-plugins.mjs](read-81-plugins.mjs)。

本次 app-server 請求沒有安裝或啟用這 81 個插件，沒有送出 MCP 狀態查詢或工具呼叫。讀取驅動的操作記錄為 `pluginAddCommands=0`、`mcpServerStatusRequests=0`、`sourceMcpProcessesStarted=0`、`modelTurnsStarted=0`。這項測試驗證 Codex 能解析清單和技能中繼資料，不代表插件的 MCP 服務或來源功能已可執行。

Codex app-server 的 stderr 有一條背景警告：它嘗試預熱 featured plugin IDs 快取時收到 `401 Unauthorized`。沒有登入或提供憑證；插件解析本身仍對 81/81 成功。這是 app-server 啟動時的背景請求，並非來源插件的網路行為。

本次只產生本地驗證證據與本機 marketplace 清單；未啟動任何新來源或其 MCP，未呼叫模型，未使用已登入的使用者 `CODEX_HOME`。
