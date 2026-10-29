# 0.8.0 回歸：12 個固定真實來源

測試條件：全新隔離 Codex 設定資料夾，未複製登入資料，也未登入。僅測試目前 0.8.0 來源的安全可用能力，不做新舊版本前後比較，也不能當作全面相容率。

轉換前以可信測試程式提供合成工作區與安全設定；安裝使用真實 Codex CLI。工具驗證呼叫安裝後的相同產物 MCP，沒有用模型啟動新聊天。圖片或字型只列出與綁定雜湊，未逐行審查。

|階段|插件|轉換完成|真實安裝|來源工具／路由成功|結果|
|---|---|---|---|---|---|
|after|dsh-pace-calc|是|是|pace_calc|partial|
|after|dsh-tool-encoding|是|是|encoding|partial|
|after|dsh-rf-toolkit|是|是|rf_shannon_capacity|partial|
|after|dsh-plugin-local-life|是|是|local_life|partial|
|after|dsh-bili-scroll|否|否|無|Python 依賴含混淆內容；明確選擇強制繼續後可重試|
|after|dsh-cdp|是|是|source HTTP GET /api/dsh-cdp?cmd=status|partial|
|after|dsh-keep-awake|是|是|source HTTP GET /dsh-keep-awake/state|本案例啟動前在隔離設定中明確加入 PowerShell 路徑的額外讀取資料夾；enabled=false，沒有啟動防休眠程序。本輪沒有另測未加入該資料夾的預設啟動。|
|after|dsh-exa-mcp|是|是|external web_search_exa (anonymous public endpoint)|partial|
|after|dsh-deepseek-vision|是|是|無|來源為模型供應者註冊，沒有原生工具；不發送模型/圖片請求，不以 host describe 宣稱功能成功。|
|after|dsh-folder-timemachine|是|是|folder_timemachine|partial|
|after|dsh-obsidian|是|是|obsidian_read|partial|
|after|dsh-invoice-tools|是|是|invoice_parse|partial|

所有準備均使用 forceObfuscated:false；若遇到混淆阻擋，逐筆記錄原因，不自動強制繞過。
固定來源、提交、掃描位置、強制選項、安裝輸出及工具回覆見相鄰 JSON。沒有執行登入、留言、付費 API 或模型呼叫。

<!-- v080-final-notes -->

回歸結果：12 個固定來源中，11 個完成轉換與真實隔離安裝；10 個安全工具／路由實際呼叫成功。deepseek-vision 沒有工具，供應者模型請求依測試範圍略過。bili-scroll 在 Python 依賴掃描被擋，沒有強制繼續。

bili-scroll 的規則命中如下；這是規則判斷，不能據此直接宣稱來源惡意：

- Cryptodome/SelfTest/Util/test_asn1.py:1：十六進位跳脫字元（\x..）有 1670 個，占檔案 21%。
- PIL/WalImageFile.py:1：十六進位跳脫字元（\x..）有 768 個，占檔案 51%。

完整審查檔案與命中數據已逐筆保留在 JSON 的 obfuscationBlock。隔離設定資料夾最後仍無 auth.json。Exa 僅匿名呼叫公開搜尋一次；沒有登入、發文、模型請求或付費服務請求。
