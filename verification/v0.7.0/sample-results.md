# 12 個固定真實來源的條件比較

同一隔離 Codex 設定資料夾，未複製登入資料，也未登入。舊版取自已安裝 0.6.2，新版取自目前來源。這是舊版登入／資產門檻與新版告知流程的條件測試，不能解讀成全面相容率。

來源為既有固定本機快照，附倉庫網址、提交與複製樹雜湊；未宣稱這次重新從網路下載。新版必須符合舊版測試的逐檔雜湊。可信測試程式在轉換前注入合成工作區、安全設定及明確 TypeScript 入口，沒有修改來源程式或竄改已簽章產物。

每項安裝都使用真實 Codex CLI 的 plugin marketplace add 與 plugin add。工具驗證直接呼叫該安裝產物的相同 MCP 程式，沒有用模型啟動新 Codex 聊天。供應者註冊、工具列舉、主機描述不算來源功能成功。

新版全部明確提供 forceObfuscated:true；真正有不可讀來源或依賴的情況列在 JSON。這不代表預設未強制也能得到相同結果。既有固定 Python 環境先逐發行檔校驗，再複製並比對整棵樹雜湊；沒有重新下載，也沒有執行上游安裝腳本。

|階段|插件|完成轉換|真實安裝|成功來源工具或路由|具體結果／限制|
|---|---|---|---|---|---|
|before|dsh-pace-calc|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|before|dsh-tool-encoding|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|before|dsh-rf-toolkit|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|before|dsh-plugin-local-life|否|否|無|來源含非文字內容，需人工審查：.npm-cache-pub/_cacache/content-v2/sha512/1a/6a/67480262126e908446f40deb84379af86ecd05986eea9d22babecb0217280edeeb52996fd403bea3a8d52c68fc8c7339989a334346433066981795d1839c|
|before|dsh-bili-scroll|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|before|dsh-cdp|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|before|dsh-keep-awake|否|否|無|來源含非文字內容，需人工審查：screenshot.png|
|before|dsh-exa-mcp|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|before|dsh-deepseek-vision|否|否|無|來源含非文字內容，需人工審查：docs/images/chat.png|
|before|dsh-folder-timemachine|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|before|dsh-obsidian|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|before|dsh-invoice-tools|否|否|無|需要現有 ChatGPT Codex 登入；不改用 API 金鑰或其他付費方式|
|after|dsh-pace-calc|是|是|pace_calc|通過：5 公里／30 分鐘 = 10 公里時速；通過：配速 6 分／公里|
|after|dsh-tool-encoding|是|是|encoding|通過：hello 的 Base64 編碼|
|after|dsh-rf-toolkit|是|是|rf_shannon_capacity|通過：1 MHz、0 dB 容量 = 1 Mbps|
|after|dsh-plugin-local-life|是|是|local_life|通過：1 公斤 = 2 斤|
|after|dsh-cdp|是|是|source HTTP GET /api/dsh-cdp?cmd=status|通過：來源本機狀態路由 HTTP 200|
|after|dsh-keep-awake|是|是|source HTTP GET /dsh-keep-awake/state|預設啟動先失敗：檢查 PowerShell 路徑需要額外讀取資料夾。此案例在隔離設定中明確加入該資料夾；enabled=false，沒有啟動防休眠程序。|
|after|dsh-exa-mcp|是|是|external web_search_exa (anonymous public endpoint)||
|after|dsh-deepseek-vision|是|是|無|來源為模型供應者註冊，沒有原生工具；不發送模型/圖片請求，不以 host describe 宣稱功能成功。|
|after|dsh-folder-timemachine|是|是|folder_timemachine|通過：合成空狀態沒有快照|
|after|dsh-obsidian|是|是|obsidian_read, obsidian_write|通過：讀到指定合成筆記；通過：來源工具在工作資料夾寫入後讀回完全相同內容|
|after|dsh-invoice-tools|是|是|invoice_parse|通過：合成發票筆數；通過：合成發票 100 + 13 = 113；通過：合成發票檢查失敗數|
|after|dsh-bili-scroll|是|是|bili_status|通過：來源狀態成功；通過：沒有複製個人登入憑證；通過：自動留言已關閉|

初次驗收發現的同名市集來源衝突、模組載入及程序回傳契約問題，保留於 JSON 的 attempts，修正後重新產生並真實安裝，不以手改簽章產物代替驗證。

沒有執行登入、真實留言、付費 API 或模型呼叫。圖片、字型與二進位只列出及綁定雜湊，未逐行審查。來源工具呼叫成功只涵蓋表內列出的合成案例，不代表該插件所有功能均相容。
