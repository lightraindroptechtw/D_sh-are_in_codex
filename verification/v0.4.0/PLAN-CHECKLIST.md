# 0.4.0 規劃與驗收對照清單

更新日期：2026-10-23。依工作區 `dsh-to-codex-0.4.0-plan.md`，對照目前程式、測試檔與已保存證據。本文件不執行測試，也不把進行中的統計當成最終結果。

狀態分為「已實作／有驗證」、「部分完成／待驗收」與「未實作」。有測試檔不等於全量驗收；本清單已核對一般與整合模式最終測試紀錄及固定 100 來源彙整。彙整以 `final2` 完整 100 筆為基準，再以最後補齊依賴後的 `peerfix` 32 來源子集覆蓋對應列；其餘 68 筆未在最後環境重跑。每個來源仍可能因未支援服務、原始碼錯誤或缺少外部條件而無法啟動。

## A1–A10

| 項目 | 目前交付與邊界 | 測試或證據 | 驗收狀態 |
|---|---|---|---|
| A1 預發布版本範圍 | 採 `includePrerelease=true` 的較寬鬆規則。相同 0.3.1 官方環境與相同來源重新計算，歷史警示 57 更正為 26；不是功能成功率。歷史報告保留原數字並附更正連結 | [版本測試](../../tests/runtime-versions.test.mjs)、[A1 測試](../../tests/v040-analysis.test.mjs)、[逐項更正](range-correction.json)、[說明](analysis-corrections.md) | 已實作／有驗證 |
| A2 來源正式依賴 | 預設可連線安裝；可關閉。安裝前先保存套件與規格，只處理正式依賴及所需傳遞依賴，排除另一套官方 DSH 與來源開發依賴。停用腳本，可信鎖定檔過濾後優先使用；失敗明確報告，來源清單與鎖定檔不改寫 | [依賴測試](../../tests/v040-deps.test.mjs)、[轉換接線測試](../../tests/v040-conversion-options.test.mjs)、[無鎖定檔實裝](dependency-install-smoke.json)、[有鎖定檔實裝](dependency-lock-smoke.json)、[檔案核對](dependency-filesystem-check.json)、[逐來源批次結果](batch-report.json) | 已實作／小套件兩條實裝路徑有證據；來源初始化另按四層報告，不由安裝成功推定 |
| A3 環境變數轉送 | 語法樹只記入口可達檔案中的靜態名稱；`.mcp.json` 的 `env_vars` 與宿主 `passEnv` 轉送名稱。預設連線代理變數及明確模組憑證映射一併處理，不把環境變數值寫入報告 | [分析測試](../../tests/v040-analysis.test.mjs)、[生成設定測試](../../tests/v040-conversion-options.test.mjs)、[宿主環境測試](../../tests/v040-host.test.mjs)、[100 來源靜態資料](static-analysis-100.json) | 已實作／有驗證；動態變數名稱仍需使用者明確指定 |
| A4 主目錄選項 | 預設 `homeMode="isolated"`；明確選 `real` 才保留真實主目錄相關環境。報告保存讀取證據，不把靜態命中當成必須開放真實主目錄的理由 | [分析測試](../../tests/v040-analysis.test.mjs)、[真實／隔離主目錄測試](../../tests/v040-host.test.mjs)、[生成設定測試](../../tests/v040-conversion-options.test.mjs) | 已實作／有合成驗證；不是檔案存取沙箱 |
| A5 逾時、取消與恢復 | 初始化與呼叫上限分開；來源工具宣告的上限優先。先送取消訊號，不配合時重啟宿主並重新初始化，不自動重送原呼叫。生成的外層 MCP 上限包含靜態工具上限與取消寬限；動態上限另報限制 | [宿主測試](../../tests/v040-host.test.mjs)、[工作程序測試](../../tests/v040-worker.test.mjs)、[外層上限測試](../../tests/v040-conversion-options.test.mjs) | 已實作／有合成與官方宿主驗證；重啟可能中斷其他進行中呼叫 |
| A6 同時處理請求與取消 | MCP（工具連接協定）不被單次慢呼叫阻塞；支援取消通知。工具仍遵守官方規則：預設獨占，明確可並行才同時執行；排隊中的取消不進入工具本體 | [協定測試](../../tests/v040-protocol.test.mjs)、[排程測試](../../tests/v040-scheduler.test.mjs)、[工作程序測試](../../tests/v040-worker.test.mjs) | 已實作／有驗證 |
| A7 核准與呼叫識別 | 單次表單互動詢問；必須明確接受且 `approve=true`。取消、拒絕、缺少能力或傳輸失敗均不授權。呼叫識別只滿足工具核准所需資料，不冒充完整 DSH 代理 | [核准測試](../../tests/v040-approval.test.mjs)、[協定測試](../../tests/v040-protocol.test.mjs)、[工作程序核准測試](../../tests/v040-worker.test.mjs) | 部分對應已實作／有合成傳輸與官方政策驗證；真 Codex 使用者確認視窗的端到端操作待驗收 |
| A8 服務分析與 Cordis 衝突 | 依注入宣告、入口參數、別名、解構與注入回呼辨認服務。Cordis（插件執行環境）內建方法／屬性另列 `host.contextApi`，選取及安裝均禁止當成替代服務；未知名稱保留未確認，不覆寫內建存取器 | [分析測試](../../tests/v040-analysis.test.mjs)、[衝突回歸測試](../../tests/v040-cordis-context.test.mjs)、[登記表測試](../../tests/v040-agents-registry.test.mjs)、[100 來源更正](a8-cordis-context-correction.json) | 已實作／有真宿主合成來源驗證；跨檔案任意傳參與動態名稱仍有分析限制 |
| A9 固定狀態目錄與遷移 | 新包以來源、套件子目錄及名稱決定固定識別碼，預設存使用者資料目錄，不跟隨插件快取版本。舊包可繼續讀 `.state`；遷移只複製，不刪來源或覆寫目的地 | [狀態程式](../../lib/state-paths.mjs)、[狀態／遷移測試](../../tests/v040-state.test.mjs)、[可攜工具接線測試](../../tests/v040-conversion-options.test.mjs) | 已實作／路徑移動與遷移有驗證；真 Codex 升級／重裝後保留原狀態的完整生命週期待驗收 |
| A10 選填寬鬆輸出 | 預設關閉。開啟後只在原工具回傳後、官方驗證前移除一般物件中值為 `undefined`（未定義值）的可列舉欄位；其餘欄位、陣列與官方驗證不放寬，不改來源或官方檔案 | [輸出測試](../../tests/v040-output.test.mjs)、[轉換設定測試](../../tests/v040-conversion-options.test.mjs) | 已實作／嚴格預設、選填清除及未宣告欄位拒絕都有驗證；批次結果須註明是否啟用 |

## 九項優先模組

下表對應原規劃 4.3。完整十五模組的方法、條件與限制見 [MODULES.md](../../MODULES.md)。「部分」是明確的功能邊界，不表示全部原方法已完成。

| 規劃順序與模組 | 已完成對應 | 保留限制與待驗收 | 對照檔案 |
|---|---|---|---|
| 1 核准 | 官方工具的詢問接到 MCP 單次表單；提供最小呼叫識別 | 不實作永久核准政策或原生代理生命週期；真 Codex 表單操作待驗收 | [approval.mjs](../../lib/modules/approval.mjs)、[核准測試](../../tests/v040-approval.test.mjs)、[工作程序測試](../../tests/v040-worker.test.mjs) |
| 2 內建網頁工具 | 沿用官方來源登記、來源選擇、工具參數結構與驗證；搜尋來源可接到官方 `web_search`／`web_fetch` | 合成來源不等於真供應商已搜尋成功；金鑰與可用來源仍須提供 | [web.mjs](../../lib/modules/web.mjs)、[網頁測試](../../tests/v040-web.test.mjs)、[附帶工具掛載回歸測試](../../tests/v040-regressions.test.mjs) |
| 3 提示詞 | 官方段落登記與組裝；預設生成對話開始／送出訊息掛鉤附加上下文 | 不取代 Codex 系統角色；仍需使用者信任；實際由 Codex 執行掛鉤待驗收 | [system-prompt.mjs](../../lib/modules/system-prompt.mjs)、[事件測試](../../tests/codex-events.test.mjs)、[宿主轉換測試](../../tests/host-conversion.test.mjs) |
| 4 工具攔截 | 工具執行前後掛鉤對應官方政策；前置拒絕可阻止操作 | 掛鉤內詢問無法開啟確認表單，因此拒絕；後置不能撤銷副作用或改寫原結果；只涵蓋 Codex 可掛鉤工具 | [interception.mjs](../../lib/modules/interception.mjs)、[掛鉤測試](../../tests/v040-hooks.test.mjs)、[生成產物測試](../../tests/v040-generated.test.mjs)、[工作程序測試](../../tests/v040-worker.test.mjs) |
| 5 代理與對話 | 建立／續用自有或明確允許的 Codex 對話、文字回合、執行中引導、中斷；對話讀取受限於允許清單 | 預設禁止模型呼叫；只轉入靜態建立提示，不支援任意掛工具、代理預設、每一步控制或完整 DSH 重播。真模型回答未驗證 | [agents.mjs](../../lib/modules/agents.mjs)、[sessions.mjs](../../lib/modules/sessions.mjs)、[模型／對話測試](../../tests/v040-agents-modules.test.mjs)、[歷史讀取測試](../../tests/codex-sessions.test.mjs) |
| 6 插件自行呼叫模型 | 明確選用 API（程式呼叫介面）金鑰後端；官方模型執行服務、精確路由及金鑰名稱檢查；合成供應商可驗證傳輸 | 「Codex 帳號無工具短對話」假說未採用，無法保證關閉全部工具。API 模式預設停用，另需相容轉接器；真回答、速度與費用未驗證 | [llm.mjs](../../lib/modules/llm.mjs)、[合成供應商及預設拒絕測試](../../tests/v040-agents-modules.test.mjs) |
| 7 常駐與排程 | 生成獨立背景宿主；明確啟動後維持官方計時器與服務，可查詢／停止 | 不自動啟動或設定開機工作，不補跑停機期間任務；背景啟動不等於允許模型呼叫 | [background.mjs](../../lib/modules/background.mjs)、[背景控制](../../lib/daemon-control.mjs)、[生成背景宿主測試](../../tests/v040-generated.test.mjs) |
| 8 斜線指令 | 沿用官方全域登記與探索；靜態名稱生成探索技能，動態名稱留待宿主列舉 | 原處理函式需要真實 DSH 代理與生命週期紀錄，`execute` 明確不支援；探索技能不是已移植的命令執行 | [commands.mjs](../../lib/modules/commands.mjs)、[指令測試](../../tests/v040-commands.test.mjs) |
| 9 憑證 | 明確 `envMapping` 對應環境變數名稱，每次在記憶體取值；只回報是否設定與來源 | 不持久保存或修改秘密，不實作 DSH 憑證紀錄與授權授予 | [credentials.mjs](../../lib/modules/credentials.mjs)、[憑證測試](../../tests/v040-agents-modules.test.mjs)、[名稱轉送測試](../../tests/v040-conversion-options.test.mjs) |

十五個登記模組中，優先清單的「代理與對話」由 agents 與 sessions 分開承接；另有計時器、檔案、設定、本機網頁路由與技能五個既有模組。原生服務沿用官方套件的範圍與產品介面限制，不能把「登記表有該模組」解讀為來源所有功能都支援。

## 基準、逐模組測試與 100 來源四層驗收

| 驗收項目 | 已保存證據／負責更新處 | 目前狀態與限制 |
|---|---|---|
| 完整備份 | `outputs/dsh-to-codex-0.3.1-backup/` | 已建立；歷史 0.3.1 資料與版本更正分開保存 |
| 修改前一般與整合基準 | [baseline-default.log](baseline-default.log)、[baseline-integration.log](baseline-integration.log) | 已有基準紀錄；不是修改後通過率 |
| 最新一般與整合全套測試 | [final-default.log](final-default.log)、[final-integration.log](final-integration.log)、[core-freeze-check.log](core-freeze-check.log) | 一般模式 201 項中 196 通過、5 跳過、0 失敗；整合模式 201 通過、0 跳過、0 失敗。這不代替 100 個來源的實際驗收 |
| 每模組方法、缺能力隔離、不支援錯誤 | [登記表測試](../../tests/v040-agents-registry.test.mjs)、[能力測試](../../tests/v040-capabilities.test.mjs)與各模組測試 | 已有共用及個別測試；對十五模組逐方法的完整覆蓋清單尚未獨立簽核，不宣稱所有方法均已單獨測過 |
| 固定 100 來源清單與啟動規則 | [batch-startup-review.md](batch-startup-review.md)、[batch-startup-review.json](batch-startup-review.json)、[安全呼叫選擇](drivers/safe-call-selection.json) | 已有具體清單；本輪已由使用者授權。不得順帶登入、發送內容、呼叫模型或付費服務 |
| 第 1 層：生成插件與結構 | [批次彙整報告](batch-report.md)、[逐筆 JSON](batch-report.json) | 成功 90、失敗 0、不適用 10。未生成可轉換能力者列不適用；混合插件不因 `NATIVE_UI`（原生畫面診斷）整包排除 |
| 第 2 層：MCP 初始化 | 同上，另對照每筆啟動分類與原因碼 | 成功 57、失敗 31、不適用 12。安裝依賴、生成包或解析成功均不能代替初始化 |
| 第 3 層：來源工具列舉 | 同上；來源工具與 `dsh_host_*` 宿主控制工具分開統計 | 成功 43、失敗 0、不適用 57；共列出來源工具 191 個、控制工具 513 個。只有控制工具不能當成列出來源工具成功 |
| 第 4 層：安全工具呼叫 | 同上及安全呼叫選擇檔 | 成功 1、失敗 4、不適用 95。4 個失敗中 3 個為未定義輸出值、1 個為輸出規格錯誤；不關閉官方驗證。沒有安全項目列不適用 |
| 與歷史版本對照 | [0.3.1 原調查](../investigation-031/REPORT.md)、[修正前批次](v040-before-fixes.batch-report.md)、[Claude 複查](claude-review.md) | 歷史 87 個只是靜態候選，不是 87 個啟動成功；修正前批次與進行中重跑不混成單一通過率 |
| 各輪來源與環境完整性 | [完整 100 筆原始輪次](batch-report-final2.json)、[最後 32 筆子集](batch-report-peerfix.json)、[彙整逐筆證據](batch-report.json)的 `provenance`（證據來源）與 `runProvenance` | 已保存每筆報告、批次、雜湊與輸出目錄；最新覆蓋為 peerfix 32 筆、final2 68 筆。初批初始化 36→57 成功是 21 筆修復；失敗 53→31 的差額另含 1 筆遠端授權代理改列不適用，不算修復。來源批次關閉掛鉤 |

## 真正 Codex 的插件與掛鉤驗收

| 項目 | 證據 | 狀態 |
|---|---|---|
| 隔離設定目錄 | [codex-read.json](codex-read.json)、[codex-read.md](codex-read.md) | 已有隔離 `CODEX_HOME` 證據；未使用使用者登入中的設定目錄 |
| 轉換器安裝與 MCP 列舉 | [codex-converter-smoke.json](codex-converter-smoke.json) | 已驗證隔離環境安裝 0.4.0、讀取插件及列出轉換器工具；未藉此聲稱實際轉換工具或第三方插件功能全部成功 |
| 11 個事件逐項查核 | [事件生成程式](../../lib/codex-events.mjs)、[能力檢查](../../lib/codex-capabilities.mjs)、[Codex 解析證據](codex-read.md) | 已查核；`Notification`（通知事件）在 Codex 0.160.0 不支援，明確停用並且不生成 |
| 其餘 10 個掛鉤被實際列出 | [codex-read.json](codex-read.json)、[codex-read.md](codex-read.md) | 主代理已完成第二輪解析覆核：生成 10 個、實際列出 10 個，無警告或錯誤；全部仍未受信任。`SessionEnd`（對話結束）與 `Interrupt`（中斷）上限 3 秒 |
| 掛鉤由 Codex 真正執行 | [生成程式直接執行測試](../../tests/v040-generated.test.mjs)、[掛鉤傳輸測試](../../tests/v040-hooks.test.mjs) | 待驗收。合成測試已涵蓋直接執行生成程式與拒絕回傳，但目前隔離 Codex 的掛鉤仍未受信任、未實際執行；不修改使用者信任設定來補成績 |
| 最新 90 個生成產物的 Codex 解析 | [解析驅動](drivers/codex-read.mjs)、[解析 JSON](codex-read.json)、[解析說明](codex-read.md)、[彙整來源](batch-report.json) | 90／90 成功；已逐識別碼及完整輸出路徑核對，差異清單為空。最後替換的 31 個產物另行解析，其餘 59 個沿用 `final2` 既有解析；未安裝或啟動來源 MCP。100 個來源不等於 100 個生成產物 |

## 複查後追加修正

| 修正 | 驗證範圍與證據 | 狀態 |
|---|---|---|
| 官方 SDK（軟體開發套件）／依賴缺漏 | [package.json](../../package.json)已補固定版本的 `dsh-agent`、`dsh-client-connection`、`dsh-credentials`、`dsh-mcp-client`、`dsh-plugin-manager`、`dsh-storage-domain` 與 `schemastery`；最後另補 `dsh-subprocess`、`dsh-http-proxy`、`dsh-host-plugin-inventory`、`dsh-storage`，後四者均為 `0.2.1-rc.2`。見[初次安裝](runtime-dependencies-install.log)、[最後安裝](runtime-peer-dependencies-install.log) | 依賴已補；最後 32 來源子集重測另行保存，不將「套件已安裝」當成方法全支援 |
| 34 個官方 SDK 解析與匯入 | [純匯入證據](official-sdk-import-final.json)、[複製環境測試](../../tests/v040-runtime-environment.test.mjs)、[執行紀錄](runtime-environment-final.log)、[官方環境複製測試](../../tests/host-files.test.mjs) | 34／34 純匯入成功，複製環境測試也通過；測試未建立服務、初始化第三方來源或呼叫模型。這不是 34 個套件的完整功能驗收 |
| 來源延後載入選用依賴 | [v040-regressions.test.mjs](../../tests/v040-regressions.test.mjs)驗證缺少的動態匯入可回到來源原本的 `catch`（錯誤處理），缺少必要靜態匯入仍失敗 | 已有合成回歸證據，不替來源自動偽造缺失套件 |
| 帶範圍前綴的來源名稱與內部識別碼 | 同上，驗證 `@synthetic/scoped` 名稱可初始化；[回歸紀錄](regression-fixes.log)、[逐來源結果](batch-report.json) | 已有合成證據；合法來源名稱保留其原設定命名空間。實際來源仍可能因其他不支援方法或缺少外部條件失敗 |
| 網頁附帶工具的具名匯出 | 同上，以真工作程序、官方來源登記與合成來源驗證官方 `web_search` 可用 | 已有回歸證據，無外網搜尋或付費呼叫 |
| 執行期官方 SDK 動態解析 | 同上，驗證變數形式匯入與套件資料解析共用固定官方環境 | 已有合成證據；特定來源自己要求的 SDK 版本仍可能不符 |
| 啟動原因分類與秘密保護 | 同上，區分缺 `dsh-credentials` 套件與缺金鑰；未知錯誤以指紋及可安全辨認的分類處理 | 已有回歸證據；不為保留錯誤訊息而輸出秘密值 |
| Cordis 內建名稱衝突 | [v040-cordis-context.test.mjs](../../tests/v040-cordis-context.test.mjs)、[逐來源更正](a8-cordis-context-correction.json)、[實測彙整](batch-report.json) | 已有合成、真宿主及靜態重算證據；實際來源結果另按四層列出，不把移除分析雜訊等同來源全部可用 |

## 文件、版本與安裝交付

| 項目 | 對照 | 狀態與尚待確認處 |
|---|---|---|
| 十五模組中文方法表 | [MODULES.md](../../MODULES.md) | 已更新繁體中文方法說明、支援程度、使用條件及未驗證部分；方法程度忠於目前模組宣告 |
| 操作與預設值 | [README.md](../../README.md) | 已有 0.4.0 依賴、環境、逾時、狀態與模組說明；掛鉤更正為已查核 11 項、實際生成 10 項，通知事件不支援 |
| 相容性與歷史區分 | [COMPATIBILITY.md](../../COMPATIBILITY.md) | 已同步 0.4.0 行為、201 項測試、34 SDK、四層覆蓋及 90 產物解析；歷史附錄與當前證據分開 |
| 插件技能說明 | [SKILL.md](../../skills/dsh-to-codex/SKILL.md) | 已更新 0.4.0 流程與權限邊界；同步更正為 10 個實際生成掛鉤，通知事件不支援 |
| 套件與插件版本 | [package.json](../../package.json)、[plugin.json](../../.codex-plugin/plugin.json) | 目前兩者均宣告 0.4.0；版本宣告不代表已替使用者更新現用安裝 |
| 隔離安裝成果 | [codex-converter-smoke.json](codex-converter-smoke.json) | 已有隔離 0.4.0 安裝與 MCP 工具列舉證據 |
| 使用者現用安裝副本 | [installed-040.json](installed-040.json) | 已同步 0.4.0，核心、依賴、文件與版本均比對一致，34 個官方 SDK 版本一致，未修改信任設定。命令列重新加入同版本時遇到 Windows 作業系統錯誤 5，改用逐檔比對、相同略過的同步方式，刪除數為 0；不宣稱重新加入命令成功 |
| 目前 Codex 對話實際工具操作 | [current-chat-smoke.json](current-chat-smoke.json) | 三個已安裝轉換器 MCP 工具已實際完成合成來源分析→轉換→啟動驗證及本機工具呼叫，`4+7=11`。沒有另開新對話；這已證明目前對話可載入並使用，不再列作待載入。未執行第三方來源、未呼叫模型或付費服務，獨立於 100 來源統計 |
| 規劃中的真正 DSH 引擎 | `engine="installed-dsh"` | 未實作。這是原規劃第 5 節與執行順序最後的選擇性項目，不能當成目前可選模式 |

一般及整合全量測試、34 個官方 SDK 的純匯入與複製環境測試、100 來源四層覆蓋彙整、輪次證據、最新 90 個產物的 Codex 解析、現用安裝比對與目前對話的合成工具操作均已有證據。真掛鉤執行、使用者確認互動及真 Codex 升級後狀態保留的完整生命週期仍待驗收；真模型回答、外部付費服務、登入與對外發送不因本規劃而自動納入測試授權。
