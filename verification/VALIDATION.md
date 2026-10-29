# DSH 真實語料驗證

本輪 15 個真實插件：15 通過、0 失敗。

產生時間：2026-10-22T12:17:40.043Z。語料清單：<local-workspace>

「可生成」只指產物結構合法；「部分生成」仍有列出的差異。「不支援」是有效的誠實拒絕，不算測試失敗。只有配速、射頻計算、字串編碼三個預先審查的純工具允許啟動與呼叫；配速另驗證搬至含空格目錄。其他來源、Python、Windows MCP 與 Exa 都未啟動。沒有安裝上游依賴、登入或發送外部訊息。

| 來源 | 固定提交 | 生成結果 | 實際執行 | 技能與資源 | 驗證 |
|---|---|---|---|---|---|
| dsh-bili-scroll | eab82bb749bd | 不支援 | 未啟動；僅靜態檢查 | 0 個技能原檔比對；29 檔案雜湊比對 | 通過 |
| dsh-pace-calc | f2953e60d9ad | 可生成 | 純工具已列舉並實際呼叫；搬移重測通過 | 0 個技能原檔比對；7 檔案雜湊比對 | 通過 |
| dsh-exa-mcp | be2fe2afddc7 | 部分生成 | 未啟動；僅靜態檢查 | 0 個技能原檔比對；10 檔案雜湊比對 | 通過 |
| dsh-thinking-quips | 87d6b4d33a0a | 不支援 | 未啟動；僅靜態檢查 | 無生成的來源副本 | 通過 |
| agent-useful-skills | 243a02767af4 | 部分生成 | 未啟動；僅靜態檢查 | 13 個技能原檔比對；189 檔案雜湊比對 | 通過 |
| dsh-windows-mcp-lite | 6fae3e24aa2b | 部分生成 | 未啟動；僅靜態檢查 | 0 個技能原檔比對；17 檔案雜湊比對 | 通過 |
| dsh-conversation-exporter | a7375d3ab5ce | 不支援 | 未啟動；僅靜態檢查 | 無生成的來源副本 | 通過 |
| dsh-keep-awake | 41a478fb25a8 | 不支援 | 未啟動；僅靜態檢查 | 無生成的來源副本 | 通過 |
| dsh-deepseek-vision | e44c4c90c96b | 不支援 | 未啟動；僅靜態檢查 | 無生成的來源副本 | 通過 |
| dsh-mcp-test | e5eb0f067368 | 不支援 | 未啟動；僅靜態檢查 | 無生成的來源副本 | 通過 |
| dsh-rf-toolkit | 547d24c01b78 | 可生成 | 純工具已列舉並實際呼叫 | 0 個技能原檔比對；20 檔案雜湊比對 | 通過 |
| dsh-tool-encoding | 9a7aa6f622af | 可生成 | 純工具已列舉並實際呼叫 | 0 個技能原檔比對；21 檔案雜湊比對 | 通過 |
| dsh-plugin-local-life | c7abe0935cea | 不支援 | 未啟動；僅靜態檢查 | 0 個技能原檔比對；24 檔案雜湊比對 | 通過 |
| dsh-devtoolbox | 9cbe5077dcc1 | 不支援 | 未啟動；僅靜態檢查 | 0 個技能原檔比對；55 檔案雜湊比對 | 通過 |
| dsh-plugin-development | 43dd8780a7cc | 部分生成 | 未啟動；僅靜態檢查 | 1 個技能原檔比對；7 檔案雜湊比對 | 通過 |

## 限制與未支援項目

- dsh-bili-scroll：DYNAMIC_IMPORT：lib/hostdeps.mjs:88: 動態匯入路徑不能靜態確認，未當作已載入依賴；NATIVE_UI：DSH 原生介面不轉換，不會出現在 Codex 設定頁；HOST_SERVICES：需要 DSH 宿主服務：settings, get, webServer；SCHEDULER：入口可達程式含常駐定時器；不會自動排程或開啟；RUNTIME_HOST_DEPENDENCY：原工具依賴 DSH 宿主服務，未產生可能繞過宿主限制的替代工具；PYTHON_CANDIDATE_ONLY：內附服務 vendor/bilibili-mcp/mcp_server.py 僅列為候選，未掛載。擷取服務與完整移植原插件不同；須明確指定 pythonEntry 及 allowTools
- dsh-exa-mcp：OPTIONAL_ENV_HEADER：exa: 保留選填環境標頭語意；需要本機 HTTP 代理，不會改成必填環境標頭
- dsh-thinking-quips：NATIVE_UI：DSH 原生介面不轉換，不會出現在 Codex 設定頁
- agent-useful-skills：HOST_SERVICES：需要 DSH 宿主服務：skills；SKILL_HOST_CONTEXT：技能及相對資源保留原目錄；倉庫根指令以 source/ 為工作目錄。未自動把原宿主特有指令改寫成 Codex 工具，技能內容尚未逐項執行驗證
- dsh-windows-mcp-lite：MCP_STARTUP_SEMANTICS_OMITTED：windows: 未移植設定欄位 failOnStartupError
- dsh-conversation-exporter：NATIVE_UI：DSH 原生介面不轉換，不會出現在 Codex 設定頁；HOST_SERVICES：需要 DSH 宿主服務：sessionQuery, webRuntime, webServer
- dsh-keep-awake：NATIVE_UI：DSH 原生介面不轉換，不會出現在 Codex 設定頁；HOST_SERVICES：需要 DSH 宿主服務：get, loader, fiber, timeout, interval, on
- dsh-deepseek-vision：NATIVE_UI：DSH 原生介面不轉換，不會出現在 Codex 設定頁；HOST_SERVICES：需要 DSH 宿主服務：get, attachments, llm, inject
- dsh-mcp-test：HOST_SERVICES：需要 DSH 宿主服務：on
- dsh-plugin-local-life：HOST_SERVICES：需要 DSH 宿主服務：systemPrompt；RUNTIME_HOST_DEPENDENCY：原工具依賴 DSH 宿主服務，未產生可能繞過宿主限制的替代工具
- dsh-devtoolbox：NATIVE_UI：DSH 原生介面不轉換，不會出現在 Codex 設定頁；HOST_SERVICES：需要 DSH 宿主服務：plugin, baseUrl, get, inject；RUNTIME_HOST_DEPENDENCY：原工具依賴 DSH 宿主服務，未產生可能繞過宿主限制的替代工具
- dsh-plugin-development：SKILL_HOST_CONTEXT：技能及相對資源保留原目錄；倉庫根指令以 source/ 為工作目錄。未自動把原宿主特有指令改寫成 Codex 工具，技能內容尚未逐項執行驗證

## 失敗項目

沒有失敗項目。

每個案例的 inspect、convert、靜態結構檢查、資源雜湊，以及允許的純工具呼叫結果保存在 evidence/<來源>/。matrix.json 是本表的完整機器可讀資料。

這不是官方 DSH 宿主或 Codex 官方載入器的端到端驗證。實際呼叫由轉換器的 MCP 驗證路徑完成；外部服務的相容性、認證、網路與完整技能流程都未測試。
