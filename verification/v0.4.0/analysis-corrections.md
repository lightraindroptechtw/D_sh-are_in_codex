# 0.4.0：版本範圍更正與靜態分析

這次只讀取固定 100 來源的清單、套件宣告與語法樹，沒有匯入或初始化來源，沒有呼叫模型。

以完整 0.3.1 備份的相同官方套件為基準，舊規則至少一項不符合的套件為 57/100；採用 semver（語意化版本）的 includePrerelease: true 後是 26/100。這是刻意採用較寬鬆的相容範圍規則，並不是來源已經成功執行的證據。0.2.1-rc.2 可符合 ^0.2.0-rc.2 與 *，仍不符合 ^0.1。逐項資料見 range-correction.json。

原 investigation-031/inspect-100.json 的 57 保留作歷史紀錄。0.4.0 只增加官方網頁套件的中間環境，套用舊規則曾得到 58；這不是最終環境數字。後續補齊七項官方依賴後，舊規則為 60、新規則為 26。最後另補 `dsh-subprocess`、`dsh-http-proxy`、`dsh-host-plugin-inventory`、`dsh-storage`，在 34 個官方 SDK（軟體開發套件）的完整環境重新只讀分析全部 100 來源，統計仍為 60／26。跨環境不能直接比較；用相同 0.3.1 備份證明規則變更效果的基準仍是 57 → 26。

最後 34 套件環境的逐項結果見 [static-analysis-100.json](static-analysis-100.json)，包含檢查時間、固定官方依賴版本及 `sdk34Verification`（本次確認）。補套件前快照保存在 [static-analysis-100-before-sdk34.json](static-analysis-100-before-sdk34.json)。雖然不符合範圍的來源總數沒有改變，四個來源的依賴明細已由「未內附」變成「符合宣告範圍」：`@anionex/dsh-vision-toolkit`、`dsh-cron-panel`、`dsh-git-panel` 的 `dsh-subprocess`，以及 `@sakura12/oh-my-deepseekharness` 的 `dsh-storage`。未內附屬未確認項目，原本就未計入「版本超出範圍」總數；這次仍未匯入或初始化來源。

新語法樹分析僅聚合入口可達檔案：51 個來源有可靜態辨識的 process.env 變數名稱，56 個有 os.homedir 或 HOME、USERPROFILE、APPDATA、LOCALAPPDATA、XDG_* 讀取證據。報告只保存名稱與位置，不讀取環境變數值；主目錄證據不代表需要開啟真實主目錄。服務名稱依注入宣告、apply 第一參數、別名、解構與 inject 回呼辨認，未知名稱另列 uncertainServices（未確認服務）。逐項資料見 static-analysis-100.json。跨檔案任意函式傳參與動態服務名稱仍無法完整判定。

依賴安裝另用合成套件宣告實測公開 npm：is-odd@3.0.1 與傳遞依賴 is-number@6.0.0。無來源鎖定檔時先只解析套件資訊、過濾依賴樹，再使用 npm ci（依鎖定檔安裝）；有可信鎖定檔時直接使用過濾後的鎖定檔 npm ci。兩路都帶 --ignore-scripts、--omit=dev、--legacy-peer-deps、--no-audit、--no-fund；官方與開發依賴未安裝，來源 package.json／package-lock.json 未改變，來源安裝腳本標記不存在。這不是第三方插件的啟動或功能測試。證據見 dependency-*.json。

## A8 複查後更正

先前分析誤把 Cordis 的 inject、provide、emit 等 API（程式呼叫介面）當作待補服務，會造成內建存取器衝突。修正後，這些名稱只列在 host.contextApi，不列入 host.services。服務清單選取與安裝皆阻擋 Cordis 內建名稱，安裝時另檢查實際宿主已宣告的存取器，舊報告也不能覆寫它們。

固定 100 來源重新純分析：原本 79 個來源的服務清單含 Cordis 內建名稱，修正後為 0。逐項比較見 a8-cordis-context-correction.json，新資料見 static-analysis-100.json。只含事件 API 的插件仍保留宿主候選，不會因移除服務雜訊而整包略過。這不是第三方來源的初始化成功率。
