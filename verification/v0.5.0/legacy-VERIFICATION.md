# 0.5.0 驗證

0.5.0 新增人類直接操作的社群市場：雙擊根目錄 `開啟DSH插件市場.cmd` 或 `.vbs` → 選來源、搜尋及分類 →「了解插件」→「準備安裝」→ 閱讀轉換結果 →「確認安裝到這台電腦」→ 新開 Codex 聊天。命令列入口為 `node ./bin/dsh-to-codex.mjs market --open`；第 4 個 MCP 工具 `open_dsh_market` 只開頁，不安裝。

本機頁面隨插件提供，不修改 Codex 原生插件頁。準備階段下載、分析及轉換，不初始化來源；安裝完成也不能代表所有社群插件功能相容。流程最低需要 Node.js 22.19.0；不附帶執行登入、外部內容寫入、AI／模型或付費推論呼叫。索引與 npm 來源有下載大小限制；Git 傳輸有逾時限制，目前沒有位元組數硬上限。

2026-10-24：整合模式完整測試 241 項全部通過，包含 31 項新增市場測試。已在實際瀏覽器完成來源切換、搜尋、查看介紹、準備及確認安裝；`dsh-pace-calc@0.1.1` 確實安裝至隔離 Codex，真正 Codex 能列出 `pace_calc`，並從已安裝快取完成三組配速與速度的內容斷言。轉換器四個工具亦經隔離 Codex 載入確認。桌面入口已建立，現用轉換器已更新為 0.5.0。完整範圍與限制見 [本版交付報告](verification/v0.5.0/RELEASE-RESULTS.md)。下方歷史第三方測試不列為本版全量重測。

## 0.4.1 歷史驗證

2026-10-23：完整測試 210 項，一般模式 205 通過、5 跳過、0 失敗；整合模式 210 項全部通過。四個原失敗來源使用新生成包完成 11 個內容案例；財務私有修正副本嚴格／寬鬆各 30 例；瀏覽器正常操作及故障偵測 2 例；網頁抓取與分析 1 例。來源工具清單不能代替這些內容斷言。

最新交付、功能範圍、程式與安裝證據見 [0.4.1 報告](verification/v0.4.1/RELEASE-RESULTS.md)。0.4.0 擴大功能抽測的 A／B 組紀錄與 0.4.1 重測分開列明，未假稱所有來源都在同一最終版本全量重跑。所有測試不呼叫模型或付費服務、不登入、不發訊息。

## 0.4.0 歷史驗證

交付驗收日期：2026-10-23（台北）。按規劃執行並經使用者同意測試固定100來源；Luna負責批次實測，與轉換器單元測試分開記錄。

| 層級 | 已確認結果 |
|---|---|
| 修改前基準 | 一般105通過、4跳過；整合109項全通過 |
| 修正後完整測試 | 一般201項：196通過、5跳過、0失敗；整合201項全部通過 |
| Codex真實載入 | 隔離設定中，轉換器3個MCP工具列出；合成掛鉤10個全部解析，未修改信任或執行來源 |
| 100來源四層 | 結構90成功／10不適用；初始化57成功／31失敗／12不適用；43個列出來源工具；安全呼叫1成功／4失敗／95未測。詳見 [批次報告](verification/v0.4.0/batch-report.md) |
| 官方套件環境 | 34個直接官方套件全部可匯入；複製到生成包後的環境也有獨立測試，不將匯入成功當成服務功能成功 |
| 現用安裝 | 0.4.0安裝核對見 [安裝證據](verification/v0.4.0/installed-040.json)與[套件清單](verification/v0.4.0/installed-runtime-inventory.json) |

核心修正與驗收對照見 [規劃驗收表](verification/v0.4.0/PLAN-CHECKLIST.md)、[模組方法表](MODULES.md)、[分析更正](verification/v0.4.0/analysis-corrections.md)。新回歸覆蓋Cordis名稱衝突、官方套件缺漏、選用載入、範圍套件名稱、附帶網頁工具及原生SDK解析。

完整交付說明見 [RELEASE-RESULTS.md](verification/v0.4.0/RELEASE-RESULTS.md)。上述100筆為完整一輪加32筆後續覆蓋，逐筆保留實測版本；不冒稱全部來源在最後環境重新執行。相較修正前有21個初始化失敗轉成功；遠端登入代理改列不適用另計。

已安裝工具也在本對話實際完成檢查、轉換與合成工具呼叫，得到4+7=11，見 [current-chat-smoke.json](verification/v0.4.0/current-chat-smoke.json)。這份證據獨立於第三方批次。

11種掛鉤事件已查核，Codex 0.160.0實際只讀10種，Notification明確停用。真正Codex的解析與清單證據見 [codex-read.md](verification/v0.4.0/codex-read.md)；合成來源的掛鉤阻擋、核准及背景程序啟停另有程式測試，不冒稱已在真人模型回合執行。

未測模型推論、付費服務、登入或對外發送；API金鑰模式與代理能力的傳輸／取消測試使用合成回應，真正Codex只建立無推論的隔離暫時對話。installed-dsh是選擇性規劃，本版未實作。

下方保留舊版本歷史，不能作為0.4.0的重新測量。

---

# 0.3.1 調查與修正

交付日期：2026-10-23（台北）。針對前版誤拒與功能失敗做官方對照，並修正版本檢查、大型入口分析與技能資料夾規則。完整新證據、執行界線及釋出檢查見 [本版報告](verification/investigation-031/REPORT.md)。原 100 件批次及 13 次功能呼叫的失敗紀錄完整保留，不改寫成通過。

## 0.3.0 歷史證據

交付日期：2026-10-23（台北）。新增 100 個固定 npm（套件發佈平台）封存來源，來自 98 個程式庫。來源清單附版本、下載網址與 SHA-256（內容雜湊），見 verification/corpus-100/candidates.json。Luna 子代理負責獨立回歸測試、批次轉換及原入口功能實測。

| 驗證層級 | 本版證據 |
|---|---|
| 新增來源分析與轉換 | 100/100 保留報告；2 converted、79 partial、19 unsupported、0 未預期拋錯 |
| 產物結構 | 81/81 合法；17 個現有規則無法轉換，2 個技能名稱/目錄不符被拒絕 |
| 批次程序 | 不執行來源、不安裝來源依賴、不呼叫模型；宿主編譯結果重用 77 次、建立 1 次，未量測速度倍率 |
| 共通行為 | Luna 的 7 項回歸測試通過：延後註冊可在同一連線呼叫、未知白名單診斷、啟動失敗清理及子目錄套件保留上層資源等 |
| 真正官方技能服務 | 動態註冊/讀取、相對資源、拒絕僅供人使用的技能；原 CDP 插件技能與未連線路由通過 |
| 生成包可搬移 | 官方技能亦隨完整產物保留，不依賴 DSH 主程式或轉換器原位置 |

上述 81/100 是結構產生比例，不是功能相容率。原入口功能實測、完整程式測試及 Codex 解析的詳細結果，見 verification/corpus-100/RELEASE-RESULTS.md。舊版證據保留於下方及 verification/expansion，不能把不同版本的工具總數當作本版重新量測。

批次第一次測試包裝器曾把含 `@` 和 `/` 的 npm 名稱直接當成輸出插件名稱；修正包裝器、採用轉換器預設名稱後重跑全部 100 項。正式矩陣為 run2，未把包裝器錯誤算成轉換器失敗。原功能測試亦保留一次漏傳 action（操作類型）的包裝器修正紀錄。

## 0.2.1 歷史證據

本版交付日期：2026-10-22（台北）。測試環境為 Windows、Node.js 24.16.0、Codex CLI 0.160.0。轉換器核心未呼叫模型，也沒有安裝上游插件的依賴、登入或發送內容。

| 驗證層級 | 結果 | 證據 |
|---|---|---|
| 完整程式與整合測試 | 95 項全部通過，0 跳過；含真實 DSH 服務及 Codex 應用服務 | verification/expansion/unit-tests.tap |
| 24 個真實來源 | 40 項檢查全部通過；21 個可產生合法插件包，3 個未產生可用包 | verification/expansion/matrix.json |
| 原工具或路由實際呼叫 | 10 個來源通過至少一項；另有 mcp-test 原觀察器產生基準檔 | matrix.json 的 verify、routeCall、runtimeBehavior |
| 原版對話匯出 | 經原 HTTP 路由從真正 Codex 應用服務讀取合成問答、產生 Markdown（標記式文件）；拒絕其他對話識別碼 | unit-tests.tap 的 original exporter HTTP route |
| 真正 Codex 解析及載入 | 全部 21 個產物解析成功；3 個純工具插件、3 個官方宿主插件與轉換器同時可見，共 36 個工具項目 | verification/expansion/codex-smoke.json |
| 產物搬移 | 含空白路徑，刪除來源後工具、設定、提示內容、HTTP 和事件掛鉤程式仍可用 | unit-tests.tap 的 official host conversion |
| 依賴檢查 | npm audit 回報 0 項已知漏洞，未執行原來源安裝腳本 | verification/expansion/dependency-audit.json |
| 0.2.1 實際安裝副本 | 三個 MCP（工具連接協定）操作完成原來源檢查、官方宿主轉換及實際呼叫，結果 1 kg = 2 斤 | verification/expansion/installed-live.json |

40 項檢查包含發票 XML 路徑應被拒絕的負向案例，不代表 XML 解析已相容。文字 PDF 成功解析金額 100、稅額 13、總額 113。原 XML 回傳含 undefined，官方驗證拒絕；原始碼沒有改寫。詳細功能限制見 [COMPATIBILITY.md](COMPATIBILITY.md)。

21 個產物可被 Codex 解析，只證明結構可讀，不能據此宣稱全部工具或外部服務可用。B 站只呼叫隔離狀態路由，沒有啟動 Python 服務、登入、搜尋或留言。CDP（Chromium 開發者工具協定）只測未連線狀態；防休眠插件使用停用設定。Blender 只做來源及產物解析，未啟動 Blender。Exa、Windows MCP、文獻服務及模型供應鏈未執行。

Codex 歷史只限明確允許識別碼，而且只包含應用服務實際提供的項目。測試中的舊紀錄未提供一般工具輸出；報告保留此限制，不把投影當成完整原生 DSH 重播紀錄。事件掛鉤測試驗證執行程式及活動投影，沒有修改使用者的 Codex 信任設定。

可重現方式：

```powershell
$env:CODEX_INTEGRATION='1'
npm test
node scripts/validate-expansion.mjs --out <全新的證據資料夾>
node scripts/codex-smoke.mjs --corpus <上述資料夾> --reviewed-hosts --out <新證據.json>
```

腳本需要已下載的固定提交目錄；來源清單見 verification/expansion/expanded-source-catalog.json 及 verification/source-catalog.json。舊版 0.1.0 的 15 來源、185 檢查與載入證據保留在 verification/ 根目錄，屬歷史結果。
