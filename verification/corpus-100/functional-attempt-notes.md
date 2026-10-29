# 測試包裝的修正紀錄

- Attempt 1：包裝器只傳了 `safe-test-candidates.json` 的 `arguments`，漏掉同一筆提案另外存放的 `action`。真實 DSH registry 回覆 `missing required property "action"`，拒絕發生在 plugin execute 前。未計入9個功能分支。
- Attempt 2：輸入已合併，但 `finance_data:format` 的原插件 execute 回傳包含 undefined 欄位的物件；真實輸出驗證回覆 `returned invalid output: value is not lossless JSON`。這次驗證了錯誤來源，但包裝器仍在第一個失敗就中止。
- Attempt 3：包裝器改為逐筆記錄原始 registry 回傳並繼續執行其餘已審查分支。結果為9項：1 PASS、8 FAIL；詳細完整結果只以此輪計數，並保存在 `results/functional-results.json`。三次使用彼此獨立的 state/HOME 路徑，沒有清理或覆寫前次隔離目錄。
