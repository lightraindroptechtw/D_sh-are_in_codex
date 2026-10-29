# DSH 轉 Codex 0.5.0

以固定程式規則，把 DSH 插件可保留的工具與服務轉為 Codex 插件。轉換器內附固定版本的官方 DSH/Cordis（插件執行環境），不必安裝或開啟 DSH 主程式。檢查與轉換不初始化來源、不呼叫模型；轉換預設會連線安裝來源的正式 npm 依賴，並停用安裝腳本。

0.5.0 新增讓人直接操作的 DSH 社群插件市場。頁面隨本插件提供，由本機服務開在瀏覽器；不需要 AI 代操作，也不呼叫 AI／模型或付費推論服務。這個頁面不修改 Codex 原生插件頁，市場列出的插件仍須逐個分析轉換，不能據此保證全部功能相容。

## 直接瀏覽社群市場

需要 Node.js 22.19.0 以上與 npm；取得 Git 來源另需 Git，確認安裝時需可使用 `codex` 命令。

1. 在本插件根目錄雙擊 [開啟DSH插件市場.cmd](開啟DSH插件市場.cmd)，或 [開啟DSH插件市場.vbs](開啟DSH插件市場.vbs)，讓本機市場頁面在瀏覽器開啟。
2. 在頁面選擇市場來源，用搜尋、分類與分頁找插件。內附 [DSH 社群精選](https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json)與 [DSH 開放插件市場](https://dshopen.org/index.json)兩個社群索引；用途、作者與版本資料由各社群來源提供。
3. 按「了解插件」，閱讀用途、來源、可選版本與限制，再按「準備安裝」。這一步連線下載指定版本、分析及轉換，預設安裝正式依賴並停用安裝腳本；不初始化來源，尚未安裝到 Codex。
4. 閱讀準備結果，確認保留的工具、略過的內容與限制；產物可安裝不代表功能已實測。確認接受結果後，按「確認安裝到這台電腦」。
5. 安裝完成後，新開 Codex 聊天載入插件。來源若需要憑證、外部程式或其他服務，仍須按其說明設定；後續載入生成插件可能啟動來源宿主。

也可在本目錄的 PowerShell 執行：

```powershell
node ./bin/dsh-to-codex.mjs market --open
```

第 4 個 MCP（工具連接協定）工具 `open_dsh_market` 只開啟市場頁面，不替使用者選插件、準備或確認安裝。一般瀏覽、下載與轉換不需要登入，不會附帶呼叫模型。市場索引與 npm 壓縮包有下載大小限制；Git 傳輸有逾時限制，目前沒有傳輸位元組數的硬上限。0.5.0 新測試的最終結果見 [VERIFICATION.md](VERIFICATION.md)；下方 0.4.1 與 0.4.0 結果保留各自的實測範圍。

0.4.0 以共通模組提供核准、網頁工具、提示內容、工具攔截、代理與對話、憑證等服務。每個來源的 `conversion-report.json` 列出需要的模組、能力檢查、逐方法支援程度和限制。請同時閱讀 [MODULES.md](MODULES.md) 與 [COMPATIBILITY.md](COMPATIBILITY.md)；生成包、啟動、列工具與安全工具呼叫是不同的驗證層級。

0.4.1 針對真正工具呼叫修正了輸出相容、跨次呼叫的本機狀態、非同步工具登記，以及 Node 子程序的套件解析；新增可明確設定網站範圍的 HTTP（網頁傳輸協定）文字抓取來源。原本四個失敗來源均已用新生成包通過 11 個功能案例，另有財務計算與瀏覽器操作實測。最新結果與逐來源限制見 [0.4.1 交付報告](verification/v0.4.1/RELEASE-RESULTS.md)；舊版 100 來源批次成績保留為歷史證據。

## 使用 AI 工具檢查指定來源

安裝後，在新的 Codex 對話提供 DSH 倉庫網址或本機插件資料夾：

```text
使用 dsh-to-codex 檢查並轉換這個 DSH 插件：C:/example/dsh-plugin
列出能保留的功能、所需模組和限制。執行來源前，先確認目前授權涵蓋哪些測試。
```

| 工具 | 工作 | 是否執行來源 |
|---|---|---|
| `inspect_dsh_plugin` | 分析入口、服務、依賴、環境變數名稱與主目錄讀取證據 | 否 |
| `convert_dsh_plugin` | 在新資料夾產生插件、模組報告，預設安裝正式依賴及產生掛鉤 | 不初始化來源；依賴安裝停用腳本 |
| `verify_codex_plugin` | 檢查結構；可選啟動 MCP（工具連接協定）、列工具、呼叫指定工具 | `executeSource=true` 才會 |
| `open_dsh_market` | 在瀏覽器開啟本機市場，交由人直接操作 | 否；開頁不安裝 |

啟動生成的 MCP 或背景宿主會執行來源初始化、事件與計時器，具有目前使用者的本機權限；程序隔離不是檔案、網路或程序沙箱。只對已授權的可信來源執行。工具列舉成功不能代替功能驗證。

## 安裝與命令列

需要 Node.js 22.19.0 以上、npm；取得遠端來源另需 Git。子程序使用 Node 的[模組解析掛鉤](https://nodejs.org/download/release/v22.15.0/docs/api/module.html#moduleregisterhooksoptions)，讓原生載入也能找到生成包內的來源依賴。開啟 PowerShell，切換到本目錄：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
codex plugin marketplace add . --json
codex plugin add dsh-to-codex@dsh-converter-local --json
```

安裝完成後開啟新的 Codex 對話。用 `codex plugin list --json` 核對本機狀態；原對話未出現工具不等於安裝失敗。移除時只操作本插件：

```powershell
codex plugin remove dsh-to-codex@dsh-converter-local
codex plugin marketplace remove dsh-converter-local
```

也能直接執行：

```powershell
node ./bin/dsh-to-codex.mjs inspect C:/example/dsh-plugin
node ./bin/dsh-to-codex.mjs convert C:/example/dsh-plugin --out C:/example/new-codex-plugin
node ./bin/dsh-to-codex.mjs verify C:/example/new-codex-plugin
node ./bin/dsh-to-codex.mjs verify C:/example/new-codex-plugin --execute-source
```

實際工具呼叫另加 `--call 工具名稱 --args '{"參數":"值"}'`。`--config 設定檔.json` 提供來源設定，`--ref 提交` 鎖定遠端版本。輸出資料夾必須不存在。來源在程式庫子目錄時，用 `--package-dir packages/plugin`；`--entry src/index.ts` 相對於該套件。來源仍指向整個程式庫，以保留上層資源。`--workspace` 指定來源檔案服務的工作目錄，並非存取限制。

## 沿用 0.4.1 的預設值與選項

`engine=auto` 對需要執行 JavaScript/TypeScript（程式語言）入口的工具與服務，使用官方宿主及模組；純工具也走這條路。`official-dsh` 使用內附官方套件，不是啟動本機 DSH。明確選擇 `portable-tools` 才使用可攜工具相容層；它不掛官方服務模組，也不套用官方宿主的主目錄隔離、核准、掛鉤與逾時選項，報告會列出忽略項目。只宣告外部 MCP 或技能的來源不必產生官方宿主。

| 功能 | 預設與控制方式 |
|---|---|
| 正式依賴 | `installDependencies=true`；命令列用 `--no-install-dependencies` 關閉 |
| 掛鉤 | `hooks=true`；用 `--no-hooks` 關閉；生成後仍須使用者在 Codex 信任 |
| 來源主目錄 | `homeMode="isolated"`；`--home-mode real` 才使用真實主目錄相關環境 |
| 環境變數 | `passEnv` 只收名稱；`--pass-env TAVILY_API_KEY` 可重複指定 |
| 初始化上限 | `initializeTimeoutMs=120000`；`--initialize-timeout-ms` |
| 工具呼叫上限 | 來源工具有 `timeoutMs` 時使用該值，否則 `callTimeoutMs=60000`；`--call-timeout-ms` |
| 取消寬限 | `cancelGraceMs=1000`；`--cancel-grace-ms` |
| 寬鬆輸出 | `lenientOutput=false`；明確使用 `--lenient-output` 才開啟 |
| 額外輸出欄位 | `allowUndeclaredOutput=false`；明確使用 `--allow-undeclared-output` 才保留來源未宣告的額外欄位 |
| 模組設定 | MCP 參數 `moduleOptions`；命令列 `--module-config 設定檔.json`，內容按模組識別碼分組 |
| 長期狀態 | 預設固定使用者資料目錄；`--state-root` 可指定絕對路徑 |
| 模型與背景執行 | 預設不允許模型呼叫，也不自動啟動背景宿主 |

依賴安裝先把套件與版本寫入報告，再在輸出的 `runtime/source-deps` 安裝。只處理 `dependencies` 及所需傳遞依賴，不安裝來源開發依賴或另一套 `@deepseek-ai/*`。可用的 npm 鎖定檔優先採用，過濾後以 `npm ci --ignore-scripts --omit=dev` 安裝；否則先解析並過濾依賴樹再安裝。僅接受支援的公開 npm 規格；無法使用鎖定檔的原因、略過或安裝失敗都寫入報告。來源清單與鎖定檔不改寫，不執行 `build`、`prepare` 或安裝腳本。

分析器從注入宣告、入口第一參數、別名及解構辨認服務，未知項目另列為未確認；仍不能解析所有跨函式傳參或動態名稱。環境變數只記錄名稱與位置，將來源可靜態辨認的名稱、明確指定的名稱，以及 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 寫入 `.mcp.json` 的 `env_vars` 與執行設定的 `passEnv`。金鑰值由執行時環境提供，不放入轉換報告或模組設定；憑證模組只對明確的 `envMapping` 在記憶體逐次取值，不支援憑證寫入與授權紀錄。

工具執行保留官方並行規則：預設獨占，只有官方判為可並行的工具才能並行；慢工具不會阻塞 MCP 的其他請求與取消通知。超時或取消先傳遞 `AbortSignal`（取消訊號）；來源不配合時才重啟宿主並重新初始化，後續呼叫可恢復。重啟會再次執行來源初始化，不自動重送原工具呼叫。同時進行的其他呼叫可能收到宿主重啟錯誤。

`lenientOutput=true` 只在原工具回傳後、官方驗證前，遞迴移除一般物件可列舉且值為 `undefined`（未定義值）的欄位；不移除未宣告欄位、不把陣列的 `undefined` 改成其他值，也不關閉官方輸出規格驗證。不改來源或官方套件。

部分舊插件實際回傳的欄位比自己宣告的多，特別是驗證工具的 `summary.format`、`summary.depth`。可另外明確開啟 `allowUndeclaredOutput=true`：只複製並修改輸出結構中的 `additionalProperties:false`（禁止額外欄位），保留實際資料；已宣告欄位的型別、必填、列舉值及輸入驗證仍然生效。報告會記錄此選項與 `OUTPUT_EXTRA_FIELDS_PRESERVED` 警示，不能把相容模式的成功說成原始輸出宣告通過。原本四個失敗來源的可用生成設定為兩個選項皆開啟；不替所有來源預設放寬。

```powershell
node ./bin/dsh-to-codex.mjs convert C:/example/dsh-plugin --out C:/example/new-codex-plugin --lenient-output --allow-undeclared-output
```

同一宿主程序內，工具呼叫共用穩定的連線識別與工作目錄，逐次核准仍分開；重新啟動宿主會建立新識別。來源自訂的插件事件寫入獨立的本機紀錄檔，可支援專注筆記等跨次讀寫；不寫入 Codex 聊天，也不假造 DSH 的原生代理步驟或模型回合。

若來源只有可選的網頁抓取依賴，可明確用模組設定掛載 HTTP 抓取來源。設定的模組會被選入報告與實際宿主；明確指定 `modules` 清單時仍以該清單為準。下例儲存為 JSON 設定檔，再以 `--module-config` 傳入：

```json
{
  "web": {
    "nativeFetch": {
      "allowedOrigins": ["https://example.com"],
      "timeoutMs": 30000,
      "maxBytes": 1500000,
      "maxRedirects": 5
    }
  }
}
```

`nativeFetch` 預設不掛載，必須列出允許的網站來源；每次重新導向也檢查。只接受宣告為文字的 HTTP／HTTPS 回應，保留非成功狀態碼，限制回應大小並傳遞取消。它不提供搜尋、登入、執行網頁程式、圖片下載或 shell（系統命令環境）；有多個可用抓取來源時仍遵循官方的明確選擇規則，必要時在來源的 `web.fetchProvider` 設為 `codex-native-http`。

財務插件另有上游程式本身的計算與格式問題，修正在 [repairs/finance-data](repairs/finance-data)，附原授權與[差異檔](verification/v0.4.1/finance-source-repair.patch)。此私有修正副本已通過嚴格模式 30 例及寬鬆模式 30 例；轉換時指定該目錄即可。不修改原始語料或官方套件，通用轉換器也沒有針對插件名稱的特殊分支。

## 模組與功能邊界

- 核准模組把來源工具的單次確認接到 MCP `elicitation`（互動詢問）。客戶端必須宣告支援表單詢問，且使用者明確接受並允許本次操作；拒絕、取消、缺能力或失敗時均不授權。呼叫識別不冒充完整 DSH 代理。
- 網頁模組沿用官方搜尋／抓取來源登記及 `web_search`、`web_fetch` 工具。來源與金鑰仍須可用；列出工具不代表已完成搜尋。
- 提示詞模組透過掛鉤附加來源組裝內容，不取代 Codex 系統角色。工具攔截只涵蓋 Codex 有提供掛鉤的工具；前置拒絕可阻擋操作，後置攔截不能撤銷已完成副作用，也不能改寫官方工具結果。
- 代理模組以 Codex `app-server`（應用服務）對應建立／續用對話、文字送入、引導進行中回合與中斷。`allowModelCalls` 預設為 `false`，必須明確設為 `true` 並指定可用模型；不默默將 DeepSeek 等模型換成 Codex 模型。只操作自己建立或明確允許的對話。只投影靜態建立提示，工具、代理預設及完整步驟修改會明確拒絕。設定核准政策 `never` 時會警告。
- `sessions` 的同步清單與查詢只含本模組擁有的即時投影；`sessionQuery` 歷史讀取只限明確允許的識別碼。投影不是完整 DSH 事件重播，也不能保證舊紀錄含全部工具輸出。
- 「用 Codex 帳號開沒有工具的短對話供 `llm` 使用」的假說未採用：目前確認的介面無法保證關閉全部工具。`llm` 僅提供明確選擇的 `backend="api-key"` 路徑，使用官方 DSH 模型執行服務，另需 `allowModelCalls=true`、允許的精確模型路由、`credentialEnv` 名稱及已掛載的供應商轉接器。這是另外計費的 API 選擇，不會自動改用、建立金鑰或登入；實際模型回答、速度與費用未驗證。
- 斜線指令保留登記與清單；靜態可辨識的指令產生探索技能，動態指令以 `dsh_host_commands` 查詢。探索技能不會執行原命令處理函式；原命令執行仍明確不支援。

完整逐方法對照見 [MODULES.md](MODULES.md)。能力或 Codex 版本不足時只停用相應模組並報告；若來源初始化不能處理缺少的方法，它仍可能無法啟動。DSH 原生畫面、側欄、聊天按鈕、替換 Codex 供應商與改造其內部代理迴圈不支援。規劃中的 `engine="installed-dsh"` 尚未實作。

## 掛鉤、狀態與背景宿主

已查核 11 個掛鉤事件；Codex 0.160.0 不支援 `Notification`（通知事件），因此不生成該項。預設生成 `hooks/hooks.json` 的其餘 10 項：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`SubagentStart`、`SubagentStop`、`Stop`、`PreCompact`、`Interrupt`、`SessionEnd`。其中 `SessionEnd`（對話結束）與 `Interrupt`（中斷）上限為 3 秒。轉換器不修改使用者信任設定。事件檔只保存生命週期中繼資料；攔截所需原工具參數只留在記憶體。來源提示快照另存狀態目錄，供回合開始掛鉤附加；只反映宿主及已收到事件，不保證觀察全部背景工作。需要攔截時宿主須正在執行；無法處理規則時採拒絕。

新生成包的狀態預設存於 `CODEX_HOME/dsh-to-codex-state/<固定插件識別碼>`；未設定 `CODEX_HOME` 時為使用者的 `~/.codex/dsh-to-codex-state/`。識別碼由來源、套件子目錄與名稱決定，不依賴插件快取版本目錄。舊包沒有新設定時仍可讀包內 `.state`。需要遷移時，先將新設定配置於要遷移的包，再使用：

```powershell
node ./bin/dsh-to-codex.mjs migrate-state C:/example/generated-plugin --dry-run
node ./bin/dsh-to-codex.mjs migrate-state C:/example/generated-plugin
```

遷移只複製，不刪舊資料、不覆寫既有目的地；拒絕符號連結。來源與目的地相同時不需遷移。

官方宿主包同時生成 `runtime/background.mjs`，但不自動啟動、不設定開機工作。使用者明確要求後才執行：

```powershell
node ./bin/dsh-to-codex.mjs daemon status C:/example/generated-plugin
node ./bin/dsh-to-codex.mjs daemon start C:/example/generated-plugin
node ./bin/dsh-to-codex.mjs daemon stop C:/example/generated-plugin
```

同一狀態目錄只允許一個宿主擁有者；已由 Codex MCP 啟動時，狀態會指出目前模式，不能用背景停止命令關閉它。背景宿主只在程序存活時維持原計時器與服務，電腦或程序停止期間不補跑，也不因此取得模型呼叫權限。

## 設定範例與控制工具

以下是 `--module-config` 的 JSON 範例，只列環境變數名稱，並保持模型呼叫關閉：

```json
{
  "credentials": {
    "envMapping": { "TAVILY_API_KEY": "TAVILY_API_KEY" }
  },
  "agents": { "allowModelCalls": false }
}
```

對話歷史讀取另用 `--session-config JSON檔`，內容為明確的 `codexHome` 絕對路徑與 `allowedThreadIds` 清單；預設空清單，不列舉其他聊天、不啟動模型回合。來源設定 `--config` 與模組設定是不同檔案，勿把秘密值寫進任一檔案。

生成的 9 個宿主控制工具包含：`dsh_host_status`、`dsh_host_context`、`dsh_host_settings_read/update`、`dsh_host_routes/http`、`dsh_host_commands`、`dsh_host_skills_list/get`。它們分別用於狀態、原提示內容、設定、本機路由、指令探索與允許模型使用的動態技能。原提示與技能只是來源參考，不覆蓋使用者或 Codex 指令。路由呼叫仍可能寫入或連外，需要相應授權。

來源技能保留在 `source/` 原位置，連同資源、授權與第三方聲明；名稱不必等於原資料夾名。來源相對路徑以 `source/` 為基準。`allowTools` 只限制橋接來源工具，不限制來源另行宣告的外部 MCP；未知名稱會寫入報告，官方宿主容許後續動態登記，不能把尚未登記當成可呼叫。

Python 服務預設只列候選。明確擷取時需 `--python-entry 來源相對路徑 --allow-tool 工具名稱`；清單可重複指定，不開放清單外工具。`setup <輸出> --python Python完整路徑` 才建立獨立環境並依 `requirements.txt`（Python 依賴清單）安裝，這與預設的 npm 正式依賴安裝分開。服務擷取不等於移植 DSH 外層權限。

## 驗證與證據

```powershell
npm test
$env:CODEX_INTEGRATION='1'
npm test
```

0.5.0 整合測試 241 項全部通過；已實際用市場頁面安裝配速插件，確認真正 Codex 能載入工具，並從已安裝快取通過三個計算案例，詳見 [本版交付報告](verification/v0.5.0/RELEASE-RESULTS.md)。既有來源功能的 0.4.1 實測見 [0.4.1 交付報告](verification/v0.4.1/RELEASE-RESULTS.md)。以下保留 0.4.0 歷史證據，不作為 0.5.0 的第三方全量重測成績。

`runtimeCompatibility` 以 `includePrerelease=true` 比對來源官方依賴範圍與內附版本。對相同 0.3.1 套件環境及 100 來源重算，先前 57 個版本警示更正為 26；這是規則更正，不是功能成功率。逐項資料見 [0.4.0 更正說明](verification/v0.4.0/analysis-corrections.md)。

0.4.0 最終一般測試共 201 項，196 通過、5 跳過、0 失敗；開啟整合測試後 201 項全部通過。紀錄見 [一般模式](verification/v0.4.0/final-default.log) 與 [整合模式](verification/v0.4.0/final-integration.log)。當時內附的 34 個官方 SDK（軟體開發套件）已全部通過[純匯入檢查](verification/v0.4.0/official-sdk-import-final.json)，[複製環境測試](tests/v040-runtime-environment.test.mjs)也確認各套件能從生成包使用的官方環境匯入；這些檢查沒有建立服務、初始化第三方來源或呼叫模型，不能當成 34 個套件的全部功能均可用。

[100 來源彙整報告](verification/v0.4.0/batch-report.md)以 `final2` 完整 100 筆為基準，再用最後補齊依賴後的 `peerfix` 32 筆重測覆蓋對應來源；其餘 68 筆沿用 `final2`，沒有在最後環境重跑。下表是逐來源最新證據的覆蓋統計，各層分母均為固定 100 來源。

| 驗證層級 | 成功 | 失敗 | 不適用 |
|---|---:|---:|---:|
| 生成插件與結構 | 90 | 0 | 10 |
| MCP 初始化 | 57 | 31 | 12 |
| 列出來源工具 | 43 | 0 | 57 |
| 安全工具呼叫 | 1 | 4 | 95 |

[逐來源資料](verification/v0.4.0/batch-report.json)保留測試批次、實作雜湊、產物路徑及原因碼。初始化成功由初批 36 增為 57，共 21 個來源由失敗轉為成功；失敗由 53 降為 31，其中另有 1 個遠端授權代理改列不適用，不算啟動修復。安全呼叫只有 5 個適用來源，不能將其餘 95 個視為成功；掛鉤在這項來源批次中關閉。

最新 90 個生成產物均有 Codex 解析成功證據，已逐識別碼與完整路徑核對；其中最後替換的 31 個產物另行解析，其餘 59 個沿用 `final2` 的既有解析。見[解析報告](verification/v0.4.0/codex-read.md)，這與來源功能測試分開。合成插件生成的 10 個掛鉤均被列出，沒有警告或錯誤；掛鉤仍未受信任、未由 Codex 實際執行，真使用者核准互動也未驗收。既有檢查與失敗原因保留在 [claude-review.md](verification/v0.4.0/claude-review.md)；完整規劃對照見[驗收清單](verification/v0.4.0/PLAN-CHECKLIST.md)，歷史證據見 [VERIFICATION.md](VERIFICATION.md) 與 [COMPATIBILITY.md](COMPATIBILITY.md)。

0.4.0 安裝當時已核對核心、依賴、文件與版本，34 個官方 SDK 版本一致；見[安裝證據](verification/v0.4.0/installed-040.json)。當時 Codex 對話已實際透過三個轉換器工具完成合成來源的分析、轉換、啟動驗證及本機加法 `4+7=11`，見[當時對話驗證](verification/v0.4.0/current-chat-smoke.json)。這項合成測試獨立於第三方 100 來源統計，沒有另開新對話、呼叫模型或改變掛鉤信任。

本包沿用 Codex 0.160.0 曾實際解析的 `.codex-plugin/plugin.json` 與 `.mcp.json` 格式。文件來源：[Codex 插件建立文件](https://developers.openai.com/plugins/build/plugins)、[DSH 原始碼](https://github.com/deepseek-ai/deepseek-harness)。
