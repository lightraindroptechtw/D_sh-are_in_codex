# 0.4.0 測試補完與失敗原因（Claude 檢查紀錄）

日期：2026-10-23。GPT 額度用完時，`drivers/batch-100.mjs --run` 沒有中斷，背景跑完 100 個來源（02:01–02:14）。本紀錄補上之後的測試與失敗原因分析。

## 已跑的測試

| 測試 | 結果 |
|---|---|
| `node --test tests/*.test.mjs` | 189 項：183 通過、1 失敗、5 跳過。失敗的是 `v040-host.test.mjs` 第一項（計時 160 毫秒的超時測試），當時批次啟動正在背景跑、搶電腦資源；單獨重跑 3 次都通過。這項測試的時間抓得太緊，電腦忙時會誤報 |
| `CODEX_INTEGRATION=1 node --test tests/*.test.mjs` | 189 項全部通過、0 跳過 |
| 隔離的 Codex（0.160.0）讀取 90 個生成的插件包（`plugin/read`） | 90/90 解析成功。批次轉換時關閉了掛鉤，所以這次沒有驗證掛鉤檔案被 Codex 讀取 |
| 批次啟動（100 個來源） | 結構 90 成功、10 失敗；MCP 初始化 36 成功、53 失敗、11 不適用；列出來源工具 24；安全工具呼叫 1 成功、3 失敗、96 不適用 |

## 批次報告本身要修正的地方

1. 10 個「結構失敗」全部是轉換器判定為純 DSH 介面（`NATIVE_UI`）而刻意不轉換的插件，應該記成「不適用」，不是失敗。
2. 報告不保存錯誤訊息，導致 53 個初始化失敗有 40 多個被歸成「其他」，看不出原因。另外「缺金鑰」的判斷用正規表示式比對到套件名稱 `dsh-credentials`，實際上是缺官方套件，不是缺金鑰。建議保留經過遮蔽的第一行錯誤訊息。
3. 生成的 `runtime/server.mjs` 把宿主工作程序的輸出丟掉（`logger: () => {}`），插件初始化失敗的真正原因只會出現在那裡。下表的原因是我用 `lib/dsh-host.mjs` 開啟日誌重新啟動每個失敗來源抓到的。

## 53 個初始化失敗的真正原因

### 轉換器本身的錯誤（修好後可能直接恢復）

| 原因 | 數量 | 來源 |
|---|---:|---|
| 分析器把 Cordis 的方法名稱 `inject`、`provide`、`emit` 當成 DSH 服務；`lib/modules/index.mjs` 的 `CORE` 只排除了 `get`、`on`，於是 `installModules` 對這些名稱呼叫 `root.provide`，Cordis 回報 `property "inject" is already declared as accessor`，整個模組層失敗，插件一直等 `bridgeModulesReady` | 19 | 只卡在這個問題的 11 個：desktop-uia、scrape-webpage、web-search-firecrawl、plugin-nlbi、dsh-sound、client-ui-second-brain、pstack-dsh、schedule-later、ledger-memory、wrapup-guard、mcmodsdevbridge。修好後還會卡在其他服務的 8 個：vision-fallback（llm）、project-memory（llm）、trellis（agents）、plugin-focus（agents）、reme（agents、sessions）、eteams（subagents 等）、plugin-orchd（workspaceRegistry）、ui-auth（connection） |
| 內附官方環境缺少官方套件 | 15 | `@deepseek-ai/dsh-credentials`：plugin-tavily、websearch、web-search-pro、vision-toolkit、github-router、auth-tunnel；`dsh-storage-domain`：daily-log、oh-my-deepseekharness、usage-billing、plugin-memory、vision-toolkit；`dsh-mcp-client`：oh-my-deepseekharness；`dsh-client-connection`：simple-worktree；`dsh-agent`：message-gateway、messaging-gateway；`dsh-plugin-manager`：creator-mode-plus；`@deepseek-ai/schemastery`：api-dashboard |
| 選用依賴被當成必要依賴：程式碼寫「有裝就用」的動態載入，esbuild 打包時找不到就整個失敗 | 2 | read-url（`@mozilla/readability`、`happy-dom`）、agentmail（依賴的依賴 `@x402/fetch`）。message-gateway 也有 `undici` 這個問題 |
| 套件名稱有範圍前綴（例如 `@copylee/dsh-office`）時，`entryId` 直接用套件名稱，不符合 `/^[A-Za-z0-9_.-]+$/`，回報 `Plugin entry id is invalid` | 2 | dsh-office、plugin-mall |
| 插件用自己的位置找 `@deepseek-ai/dsh-tools`，找不到內附官方環境（假說，未逐行確認） | 1 | veriscope（`SDK_MISSING`） |

### 缺少的通用模組（DSH 有、目前沒有對應模組）

| 服務 | 來源 |
|---|---|
| `shell`（執行指令） | hdc-bridge、tavily-web（另有網頁工具模組的附帶套件 `webCompanion0` 載入失敗，firecrawl 也有） |
| `subagents`（子代理） | crossfire、roundtable、auto-memory |
| `subprocess`（子程序） | cron-panel、git-panel |
| `workspaceRegistry`、`connection`、`sessionController` | diff-approval、prompt-polish（另需 `agentDefaultModel`） |

共 9 個。

### 插件寫給別的 DSH 版本

| 來源 | 錯誤 | 宣告的版本 |
|---|---|---|
| toolbox-web | `dsh-settings` 沒有 `settingsNamespace` | `^0.1.0-rc.6` |
| vision-web、youreyes | `dsh-llm` 沒有 `CallId` | `0.1.0-rc.6` |
| ark9canvas | Cordis `Invalid effect`（假說：版本差異） | — |

共 4 個。內附的是 0.2.1-rc.2，這幾個要 0.1 系列才能跑。

### 其他

- adwhispr：插件只宣告遠端 MCP（`npx mcp-remote`，需要 OAuth 登入）。批次驅動在 Windows 直接啟動 `npx` 得到 `ENOENT`；即使啟動成功也需要登入，應記成「需要登入，不適用」。

## 安全工具呼叫

3 個失敗（academic-writing、education、translation）和 0.3.1 的結論一樣：輸出含 `undefined` 欄位，被官方輸出驗證拒絕。批次用 `lenientOutput:false`，所以結果符合預期，不是新問題。

## 規劃清單尚未完成的項目

- 第 6 步文件：新增了 `MODULES.md`，但 `README.md`、`COMPATIBILITY.md`、`skills/dsh-to-codex/SKILL.md` 沒有更新。
- `package.json` 和 `.codex-plugin/plugin.json` 的版本還是 0.3.1，Codex 已安裝的插件也還是 0.3.1。
- 第 7 步（選擇性的真正 DSH 模式）沒有做，`MODULES.md` 已註明。
