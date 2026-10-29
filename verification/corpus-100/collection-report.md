# DSH 插件額外100筆靜態來源清單

日期：2026-10-23（Asia/Taipei）

## 結果

已找到100個符合本次範圍的額外 DSH 插件套件。每筆都固定在一個 npm 發佈版本，記錄來源封存 SHA-256、下載網址、套件根目錄、manifest、入口、授權、功能描述、初始化風險，以及可檢查的 DSH 結構證據。完整增量資料在 `candidates.json`，套件快照在 `sources/`。

100個套件名稱互不重複，對應98個GitHub儲存庫。其中一個多插件儲存庫提供三個不同套件名稱與各自的 npm 版本、manifest 及 `dsh.bundle.patch`，所以按插件套件計算為三筆。這98個儲存庫均未出現在既有24筆清單中。沒有完全相同的內容；未完整查核 fork 關係。

## 發現與篩選

GitHub 公開搜尋 API 在本次查詢時回覆 403 rate limit，因此沒有盲目重試。改用 npm 公開 registry（套件登錄資料庫）與 `dsh-plugin-catalog` 社群索引發現來源，再直接取用 npm 固定版本的套件封存。索引快照列出3,261個套件紀錄；排除既有來源、官方 `deepseek-ai` 命名空間及 `ui`、`theme`、`skill` 分類後，留下2,442筆套件紀錄，合併重複儲存庫後為2,329個候選 repo。這是目錄候選數，不代表都是真正插件，也不是整個 DSH 生態的完整總數。

對納入的100筆逐一檢查發布封存中的 `package.json` 與 patch 檔：100/100 都有 `dsh.bundle.patch`，並存在該欄位指向的 patch 檔；61筆另找到工具註冊形式（例如 `ctx.tools.register`、`tools.register` 或 `defineTool`），66筆宣告 `@deepseek-ai/dsh-*` 依賴。工具註冊不是入選的唯一條件，因為真正 DSH 插件也可透過 bundle patch 加入宿主路由、事件、模型供應商或其他服務。

索引分類只用來選樣，不用來證明插件身分。排除了純聊天內容渲染套件 `dsh-md-render`，並以 VBA 專用工具 `dsh-vba-bridge` 補足名額。每筆都必須有可驗證的 `dsh.bundle.patch`；只修改聊天介面、一般技能內容、官方內部套件或已存在來源均不列入。

## 下載與安全界線

來源是 npm 封存，並非 Git HEAD。每個套件以精確版本和封存 SHA-256 固定；`candidates.json` 內的 `snapshotUrl`、`snapshotSha256` 和 `registryMetadataUrl` 可供重取與核對。`sources/` 保存解開後的發佈檔案，套件根目錄及 `package.json` 路徑都已核實存在。

本次只下載、解壓及靜態讀取檔案，沒有執行上游 JS、TS、Python 或安裝/打包腳本，沒有安裝依賴、匯入插件或呼叫工具，也沒有登入、發訊息、啟動 Blender、瀏覽器或外部模型。30筆宣告了安裝或打包生命週期腳本，均只記錄而未執行。每筆 package.json 都有授權欄位；如套件要求特定 DSH/Node 版本、平台或宿主依賴，資料列的 `runtimeEngines`、`targetPlatforms` 和 `initializationRisks` 會標出。

這是適合交給轉換器做批次靜態分析的來源語料，不代表套件已安裝、已成功轉換或能在 Codex 載入。

## 抽樣與重複檢查

抽樣依社群索引的功能分類分層，避免按熱度或目錄前100名直取。初始名額為 tools 25、browser 10、vision 8、voice 4、docs 7、workflow 10、git 4、security 5、notify 4、remote 3、agi 2、usage 3、memory 7、dev 6、wsl 1、market 1；同層依 canonical repo 和 npm 套件名排序選取。靜態檢查後移除純聊天訊息渲染套件 `dsh-md-render`，從已下載備選加入 Windows VBA 工具 `dsh-vba-bridge`。最終分類數是 tools 26、browser 10、workflow 10、vision 8、memory 7、docs 6、dev 6、security 5、voice 4、git 4、notify 4、remote 3、usage 3、agi 2、wsl 1、market 1。

去重稽核結果：套件名100個互異；canonical repo 98個；npm 封存 SHA-256、解包樹 SHA-256、實作檔集合 SHA-256 各100個互異。唯一重複 canonical repo 是 `0x7a7a6572/dsh-forge-studio`，其中三個套件有不同名稱、各自的 bundle patch 與 npm 封存，屬同一 monorepo 的三個插件，不是 fork 重複。沒有找到封存內容或實作檔完全相同的重複來源。GitHub fork-parent 欄位因公開 API 限流未能查驗；此檢查以 repo canonical 與三種內容雜湊確認入選資料沒有重複實作，不能據此推斷所有不同 repo 之間不存在任何共同祖先。

清單保留少數同時提供介面與宿主功能的插件，因為其功能超出聊天介面：

- `dsh-plugin-nlbi` 有 BI 面板，也註冊 `mysql_query`、`mysql_tables`、`mysql_execute`、`nl_query`、`sql_to_chart` 工具；來源入口 [lib/index.js](sources/dsh-plugin-nlbi_0.2.1/lib/index.js) 1137–1180 行，並有資料庫/報表檔案路徑。
- `dsh-schedule-later` 有排程按鈕，也提供 `schedule_message`、`list`、`cancel` 工具、持久佇列及到期投遞；來源 [src/index.js](sources/dsh-schedule-later_0.6.0/src/index.js) 24–78 行、[src/scheduler.js](sources/dsh-schedule-later_0.6.0/src/scheduler.js) 18–44 行。它會在初始化建立或讀寫排程資料夾，所以只列為轉換語料，不列為安全 smoke test。
- `dsh-git-panel` 有 Git 側欄，也透過宿主路由執行 diff、讀寫檔案、stage/unstage、cherry-pick、revert；其 credential route 會改寫使用者 `.git-credentials` 和全域 Git 設定。來源 [lib/index.js](sources/dsh-git-panel_0.1.20/lib/index.js) 843 行、919–940 行。
- `dsh-plugin-orchd` 有任務面板，也掛接專案路由並呼叫本機 orchd CLI；安裝命令會把固定接入提示交給 agent，但插件本身寫明不自行安裝。來源 [lib/index.js](sources/dsh-plugin-orchd_0.1.0/lib/index.js) 51–101 行。

## 可安全驗證的合成輸入候選

`safe-test-candidates.json` 列出9個只建議用合成數字或文字的工具動作，包含參數、預期結果、execute 分支、純函式位置和風險。候選來自 `finance_data`、`edu_kit`、`translate_kit`。這些分支在入口只轉呼叫本機計算或文字處理；其中 `translate_kit` 的其他 action 會讀寫記憶檔，因此清單明確排除 memo/glossary/tone 寫入分支。此檔是給另一階段評估的提案，本次沒有執行任何候選。
