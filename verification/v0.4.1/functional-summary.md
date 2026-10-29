# 43 個來源的功能調查與實測

23 個來源至少有一項具體本機功能通過，共 99 個不同功能案例；財務插件另以寬鬆模式重測 30 例也通過。這不是 23 個插件全部功能通過。
另有 17 個需要帳號、外部服務、真實桌面或使用者文件；2 個受平台或原生 DSH 代理流程限制；1 個只驗證本機傳輸契約，不算真搜尋成功。

## 證據版本

A／B 組保留各自 0.4.0 實測的版本與雜湊；四個原失敗來源、財務私有副本、網頁分析與瀏覽器宿主另以 0.4.1 重測。沒有把整個 100 來源批次重跑，也不把過去結果改成最後版本的新成績。
財務以修正副本的 30 個嚴格模式案例計入 99；另 30 個寬鬆模式是設定比較，不重複灌入。兩個本機搜尋服務契約案例也不計入功能成功數。

## 逐來源範圍

| 來源 | 結果 | 通過／案例 | 實測範圍及限制 |
|---|---|---:|---|
| dsh-plugin-nlbi | 所列功能通過 | 3/3 | MySQL 查詢、自然語言轉 SQL、資料圖表；圖表推斷是無外部依賴的主要子功能，可用合成列測試；資料庫查詢和自然語言轉 SQL 仍需資料庫或模型。 |
| dsh-desktop-uia | 外部條件未具備 | 0/0 | Windows 控制項樹、桌面觀察與操作；工具經 DesktopRuntime 呼叫外部 UIA 執行檔，首次使用可能編譯；會讀取真實桌面，不能以合成文字替代。未啟動輔助程序。 |
| @vfvrpq/dsh-search | 只驗證本機傳輸契約 | 0/0 | DeepSeek 搜尋、正文抓取與整合研究；正式搜尋與抓取為付費金鑰端點。只以插件可配置的本機相容端點驗證請求與結果處理，不宣稱已執行真搜尋。 |
| dsh-zspace | 外部條件未具備 | 0/0 | NAS 檔案查詢、讀寫及容器管理；執行路徑使用已登入桌面客戶端的認證或 WebDAV 帳密，操作真 NAS；沒有測試帳號與合成 NAS，未讀取登入態。 |
| dsh-plugin-finance-data | 所列功能通過 | 30/30 | 十種財務資料格式、計算、風險與配置分析；私有來源修正副本；不是原版成功 |
| dsh-computer-use | 外部條件未具備 | 0/0 | 桌面觀察、點擊、輸入與拖曳；觀察和操作經 cua-driver 外部程序，讀取真實畫面／控制桌面；沒有獨立測試桌面，不以 wait 或工具清單當主要功能成功。 |
| dsh-mcp-tunnel | 外部條件未具備 | 0/0 | 建立、觀察與停止公開 MCP 隧道；create 執行 Docker Compose 與 cloudflared 並公開本機服務；status 可能也執行 Docker。未啟動容器、隧道或公開端點。 |
| dsh-cua-drive | 平台或代理流程不支援 | 0/0 | 透過 Cua Driver 觀察及控制桌面；README 明確限定 macOS，Windows／Linux 只提供狀態而不啟動電腦操作。此機為 Windows，主要功能不適用；動態工具名列出也不能證明支援。 |
| dsh-monitor | 平台或代理流程不支援 | 0/0 | 監看檔案／命令並喚醒代理；monitor 將 exec.agent 傳入 armWatcher，變更後呼叫 agent.followup／inject；command 使用 /bin/sh。轉接器沒有提供這個 DSH 代理生命週期，未偽造代理或啟動監看。 |
| @adenxie/dsh-vercel | 外部條件未具備 | 0/0 | Vercel MCP 工具探索、載入與執行；工具管理要求活躍 Agent session，實際呼叫經已認證 Vercel MCP；沒有帳號且不偽造代理。未以本機技能文字或清單當部署功能成功。 |
| dsh-graft-plugin | 外部條件未具備 | 0/0 | 程式圖譜查詢、呼叫者、骨架與地圖；五個主要工具是 graft CLI 包裝，會 spawn 外部命令並依賴預建圖譜；未安裝或執行 graft，也沒有以空結果當成功。 |
| @a9i5k4/dsh-literature | 所列功能通過 | 5/5 | 文獻庫搜尋、詳情、規範引用與筆記；自有隔離文獻庫可預置合成書目，搜尋／引用／筆記不連網；外部文獻解析、PDF 下載、Zotero 與模型深讀不在本次範圍。 |
| dsh-scrape-webpage | 所列功能通過 | 1/1 | 網頁正文、標題、連結與關鍵字分析；只測文字網頁，不含圖片下載、瀏覽器渲染 |
| @memef1f1y/dsh-plugin-tavily | 外部條件未具備 | 0/0 | Tavily 搜尋與正文擷取；search/extract 請求外部 Tavily／DeepSeek／Firecrawl。README 提到 Tavily 無金鑰模式，但這不是本機合成運算，正式服務仍有額度及供應商條件；未呼叫外部端點。官方 HTTP 工具不是 Tavily 本身已驗證。 |
| @240xu/dsh-websearch | 外部條件未具備 | 0/0 | 多後端網頁搜尋與結果合併；統一搜尋會向 Exa、Parallel、DuckDuckGo、SearXNG 等外部服務送出請求；帶金鑰後端另需帳號。未將官方 HTTP 抓取當來源搜尋功能。 |
| dsh-read-url | 所列功能通過 | 3/3 | URL 正文／Markdown 擷取、連結與多頁讀取；設定明確的本機 directFetchOrigins 並停用 SPA／自動分頁，測試真 HTTP 擷取、解析及快取，不啟動瀏覽器／curl。 |
| dsh-moli | 外部條件未具備 | 0/0 | Moli 真瀏覽器渲染、頁面／圖片／PDF 擷取；moli_fetch 使用外部 Moli 執行檔；probe install 會下載執行第三方安裝器。沒有執行或安裝 Moli；probe 不是渲染功能成功。 |
| dsh-web-search-firecrawl | 外部條件未具備 | 0/0 | Firecrawl 多帳號搜尋；搜尋無可用帳號即 WEB_PROVIDER_CREDENTIAL_MISSING，否則 POST 到 Firecrawl；沒有金鑰或付費額度。官方 HTTP web_fetch 不算此來源搜尋成功。 |
| @anweat/dsh-browser | 外部條件未具備 | 0/0 | 瀏覽器導覽、觀察及互動動作；browser_call 的主要動作需 Playwright／Patchright 或 OpenCLI 外部程序。未啟動瀏覽器、載入使用者認證或用動作目錄冒充操作成功。 |
| dsh-web-search-pro | 外部條件未具備 | 0/0 | 多引擎搜尋、網頁擷取、規則與持久歷史；read.fetch 明確拒絕本機／私有網路 URL；主要搜尋需外部後端，渲染需瀏覽器。規則寫入須核准，未修改政策或用空快取清單當主要功能成功。 |
| dsh-image2-tool | 外部條件未具備 | 0/0 | 文字生圖與參考圖改圖；image2_generate 需金鑰並 POST /images/generations 或 /images/edits，為可能計費模型服務；未呼叫、未下載圖片、不以缺金鑰錯誤當功能成功。 |
| @chengzhao-dev/dsh-quarto-book | 所列功能通過 | 2/2 | 報告文字格式；未執行 Quarto 渲染；報告文字格式；未執行 Quarto 渲染 |
| @copylee/dsh-office | 外部條件未具備 | 0/0 | 需 Office（辦公軟體）文件與輔助程序，未操作使用者文件；需 Office（辦公軟體）文件與輔助程序，未操作使用者文件 |
| @banana-peeljj12/dsh-trellis | 所列功能通過 | 5/5 | 本機任務建立、狀態更新、跨次讀取與衝突拒絕；本機任務建立、狀態更新、跨次讀取與衝突拒絕 |
| pstack-dsh | 所列功能通過 | 1/1 | 讀取路由設定；未建立模型子代理；讀取路由設定；未建立模型子代理 |
| dsh-schedule-later | 所列功能通過 | 4/4 | 本機排程建立、列舉、取消；未測到期送出；本機排程建立、列舉、取消；未測到期送出 |
| dsh-smart-reminder | 所列功能通過 | 5/5 | 本機提醒資料的建立、讀取、更新、刪除；未發通知；本機提醒資料的建立、讀取、更新、刪除；未發通知 |
| @yolk_vat-y/dsh-project-memory | 所列功能通過 | 3/3 | 本機文字記憶寫入與詞彙搜尋；無模型擴寫或向量服務；本機文字記憶寫入與詞彙搜尋；無模型擴寫或向量服務 |
| dsh-ledger-memory | 所列功能通過 | 4/4 | 本機台帳寫入與讀取；未執行 Git；本機台帳寫入與讀取；未執行 Git |
| dsh-plugin-focus | 所列功能通過 | 6/6 | 專注板設定、讀取、附加、摘要、封存、清除及實際插件紀錄；專注板設定、讀取、附加、摘要、封存、清除及實際插件紀錄 |
| dsh-memory-recall | 所列功能通過 | 7/7 | 本機記憶新增、更新、讀取、搜尋與刪除；關閉模型回憶；本機記憶新增、更新、讀取、搜尋與刪除；關閉模型回憶 |
| @agentscope-ai/reme-dsh-plugin | 外部條件未具備 | 0/0 | 需外部記憶服務；未連線或提供憑證；需外部記憶服務；未連線或提供憑證 |
| dsh-wrapup-guard | 所列功能通過 | 3/3 | 收尾狀態與中止；未執行專案命令或通知；收尾狀態與中止；未執行專案命令或通知 |
| mcmodsdevbridge | 所列功能通過 | 1/1 | 列出合成情境；未啟動遊戲或建置模組；列出合成情境；未啟動遊戲或建置模組 |
| @aaronandwork/dsh-evidence-gate | 所列功能通過 | 2/2 | 主張登記與分類；未驗證真人工具掛鉤阻擋；主張登記與分類；未驗證真人工具掛鉤阻擋 |
| dsh-agentdebugx | 所列功能通過 | 1/1 | 搜尋自有合成對話資料；未讀其他聊天；搜尋自有合成對話資料；未讀其他聊天 |
| dsh-win-toolkit | 外部條件未具備 | 0/0 | 需系統命令、剪貼簿或通知，未操作真實系統；需系統命令、剪貼簿或通知，未操作真實系統 |
| dsh-vba-bridge | 外部條件未具備 | 0/0 | 需 Python／Office 橋接及文件，未操作真實文件；需 Python／Office 橋接及文件，未操作真實文件 |
| dsh-plugin-academic-writing | 所列功能通過 | 3/3 | academic-citation、academic-check-clean、academic-check-boundary；明確開啟 lenientOutput 與 allowUndeclaredOutput，僅所列本機功能 |
| dsh-plugin-education | 所列功能通過 | 3/3 | education-classstats、education-quiz-valid、education-quiz-invalid；明確開啟 lenientOutput 與 allowUndeclaredOutput，僅所列本機功能 |
| dsh-plugin-translation | 所列功能通過 | 3/3 | translation-segment-boundary、translation-qa-valid、translation-qa-mismatch；明確開啟 lenientOutput 與 allowUndeclaredOutput，僅所列本機功能 |
| dsh-plugin-verify | 所列功能通過 | 2/2 | verify-json-valid、verify-json-invalid；明確開啟 lenientOutput 與 allowUndeclaredOutput，僅所列本機功能 |
| dsh-verify | 所列功能通過 | 2/2 | 真瀏覽器在本機網頁導覽、按鈕點擊、文字比對及故障偵測；使用合成 data 網頁與隔離 Chromium（瀏覽器）；未登入或造訪外站 |

## 詳細證據

- [四個原失敗來源：11／11](four-functional.json)
- [財務修正：嚴格與寬鬆各 30／30](finance-repair.md)
- [網頁分析：1／1，含九項內容檢查](scrape-functional.json)
- [瀏覽器操作與故障偵測：2／2](browser-package-041.json)
- [A 組：來源閱讀與原始功能結果](../v0.4.0/function-tests/group-a.md)
- [B 組：13 個來源、44／44 個所選功能案例](../v0.4.0/function-tests/group-b.md)
- [逐來源套件路徑、版本及資料](functional-summary.json)
