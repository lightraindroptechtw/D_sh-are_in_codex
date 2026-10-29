# 0.2.1 獨立回歸與 100 個新來源靜態轉換

日期：2026-10-23（台北）

這份報告記錄修復後的合成回歸測試，以及額外 100 個 DSH npm 套件的固定規則轉換與產物結構檢查。來源程式沒有初始化，沒有啟動產生的 MCP 服務，也沒有安裝來源依賴。

## 測試結果

完整工作區測試以 `CODEX_INTEGRATION=1 npm test` 執行：102 項全部通過，0 失敗、0 跳過。Codex 應用服務案例使用隔離合成對話，不啟動模型回合。新加的 7 項 Luna 回歸測試也全部通過，見 [luna-validation.test.mjs](../../outputs/dsh-to-codex/tests/luna-validation.test.mjs)。

- `setTimeout` 會觸發 `SCHEDULER` 診斷；自動選擇官方 DSH 宿主。測試沿用同一條 MCP 連線輪詢工具清單，等到延遲註冊的 `late` 出現後呼叫成功，回傳 `2`。
- 未知 `allowTools` 名稱會產生 `TOOL_ALLOWLIST_UNCONFIRMED`，轉換狀態為 `partial`。純工具服務啟動時清楚報出 `Requested source tools are not registered: typo`，不改成開放其他來源工具。
- 官方宿主也會在狀態的 `toolSelection.missing` 列出不存在的名稱；MCP 工具清單只公開允許且實際註冊的來源工具。
- 合成 monorepo 測試指定 `packageDir: packages/plugin`，確認轉換器保留整個倉庫中的根層資源，轉換後的工具讀到根目錄 `shared/message.txt` 並回傳原文。
- 來源目錄內入口、越界入口拒絕、白名單呼叫限制、初始化失敗清理和可搬移性測試均通過。

## 100 個來源的前置核對

清單來自 `work/dsh-corpus-100/candidates.json`。核對結果：100 個套件名稱唯一、100 個識別碼唯一、共 98 個 GitHub 儲存庫；`0x7a7a6572/dsh-forge-studio` 含 3 個獨立套件。它們與舊 24 個樣本的識別碼及儲存庫都不重複。所有本機路徑、套件子目錄、`package.json`、清單版本和宣告入口檔均存在且相符；封存 SHA-256 欄位都是 64 位十六進位字串。前置核對證據在 [preflight.json](preflight.json)。封存檔未列在本次來源目錄中，因此未重新計算 archive digest；矩陣保留清單提供的 SHA-256。

批次使用目前 `convert` API，傳入各項確認過的 `localPath` 和 `packageSubdir`，每次轉換後呼叫 `validateCodexPackage` 檢查輸出結構。以 2 個工作者執行，全數 100 項納入分母，結果如下：

| 結果 | 數量 | 說明 |
|---|---:|---|
| `converted` | 2 | 完整轉換且沒有省略診斷 |
| `partial` | 79 | 有合法插件包，同時有相容性診斷或省略項 |
| `unsupported` | 19 | 沒有可用的插件包；原因見下方及逐項報告 |
| 轉換程式未預期拋錯 | 0 | 每個候選都有逐項結果 |
| 結構有效的生成插件包 | 81 / 81 | 所有生成的插件包均通過結構驗證 |
| 保留的 `conversion-report.json` | 100 / 100 | 不支援來源也保留轉換報告 |

19 個 `unsupported` 中，17 個由結構分析判定沒有可轉換介面；主要診斷為原生介面、未支援宿主服務、延遲或排程行為，或入口補丁目標無法解析。另有 2 個來源本身可轉換，但包裝器依結構驗證拒絕來源技能資料：`dsh-cua-drive` 的 `skill` 技能名稱與目錄不符，`dsh-schedule-later` 的 `source` 技能名稱與目錄不符。轉換器回報 `PACKAGE_INVALID` 並移除無效插件清單，沒有把這兩個產物算成成功。

最常見的非互斥診斷為：需要 DSH 宿主服務 84 次、原生介面 71 次、計時器或延遲註冊 64 次、原宿主範圍與 Codex 的界線說明 78 次、無法靜態解析的動態匯入 11 次。邊界說明是相容性限制提示，不等同於轉換失敗。所有逐項診斷與來源副本統計見 [matrix.json](matrix.json)；19 個不支援項目另列於 [unsupported-details.json](unsupported-details.json)。

## 版本與安全邊界

批次期間 `lib/*.mjs`、`bin/dsh-to-codex.mjs` 和 `package.json` 的起始與結束 SHA-256 相同。版本化證據在 [implementation-start.json](implementation-start.json) 與 [implementation-end.json](implementation-end.json)。官方宿主範本快取在這次批次中命中 77 次、未命中 1 次；每份產物仍各自附上獨立的完整宿主依賴。

批次沒有使用 `executeSource`、沒有啟動來源或生成服務、沒有安裝來源依賴，也沒有呼叫模型。轉換器的編譯步驟會解析並打包程式碼，但不會初始化來源程式。另有一次初跑因測試驅動把 `@scope/package` 當成 Codex 目標名稱而被 Codex 名稱格式拒絕；該輪保留在 `work/dsh-luna-validation-100-v0.2.1-20261023-attempt1-harness-error`，不列入以上統計。正式重跑改用轉換器預設目標名稱，100 項全數完成。
