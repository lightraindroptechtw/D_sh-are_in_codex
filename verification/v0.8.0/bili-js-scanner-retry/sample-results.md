# 0.8.0 回歸重試：bili-scroll 的 Python 依賴掃描

測試條件：全新隔離 Codex 設定資料夾，未複製登入資料，也未登入。僅重試 bili-scroll 在 Python 依賴規則修正後的安全可用能力。原本 12 項回歸與混淆阻擋紀錄保留在上層 sample-results.json；這不是新舊版本的全面前後比較。

轉換前以可信測試程式提供合成工作區與安全設定；安裝使用真實 Codex CLI。工具驗證呼叫安裝後的相同產物 MCP，沒有用模型啟動新聊天。圖片或字型只列出與綁定雜湊，未逐行審查。

|階段|插件|轉換完成|真實安裝|來源工具／路由成功|結果|
|---|---|---|---|---|---|
|after|dsh-bili-scroll|是|是|bili_status|partial|

所有準備均使用 forceObfuscated:false；若遇到混淆阻擋，逐筆記錄原因，不自動強制繞過。
固定來源、提交、掃描位置、強制選項、安裝輸出及工具回覆見相鄰 JSON。沒有執行登入、留言、付費 API 或模型呼叫。

新版掃描器重試結果：同一來源提交與複製檔案樹雜湊，forceObfuscated:false；Python 依賴已通過，真實 Codex CLI 隔離安裝及 bili_status 安全呼叫成功。隔離設定最後仍沒有 auth.json。原本混淆阻擋紀錄保留在上層 sample-results.json。
