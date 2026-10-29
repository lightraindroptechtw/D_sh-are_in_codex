# CC 指定清單核對與修改

依使用者提供的 CC 清理清單處理，只比對列出的檔案及必要的直接相連處，不做全專案逐檔調查。CC 來源取本機已登記的 `d-sh-are-in-cc` 安裝位置，僅讀取。沒有修改 CC、Codex 使用者設定、已安裝插件或版本號；沒有下載套件。

## 已修改

1. `lib/modules/index.mjs`：參照 CC 的服務註冊處理，在 `provide` 內攔下單個服務的讀取／註冊失敗，記錄固定的 `SERVICE_PROVIDE_FAILED` 診斷，不輸出可能含有金鑰的原始錯誤，讓後續模組繼續。這只涵蓋該註冊函式，不表示所有其他 `root.get` 都不會拋錯。
2. `lib/host-build.mjs`：借用 CC「不要編譯不需要的產物」的做法。`hooks:false` 不再編譯掛鉤，快取依是否產生掛鉤區分。Codex 的 MCP 入口、工作程序及背景入口仍保留，沒有生成後再刪除它們。
3. `.gitignore`：採用 CC 同一份規則，忽略依賴、測試暫存、日誌、系統雜項及 `backups/`。這只影響未追蹤檔案，不會替使用者從 Git 移除已追蹤內容。
4. README.md 與 lib/README.md：補上這次實際修改、保留理由和驗證範圍。

## 清單逐項處置

| CC 的處理 | Codex 這邊的處置與理由 |
|---|---|
| 刪 bin/dsh-to-codex.mjs、lib/converter.mjs、lib/codex-package.mjs | 保留；這些是 Codex 轉換及產物生成入口，不能套用 CC 的死碼判斷。 |
| 刪 lib/daemon-control.mjs | 保留；它控制 Codex 生成插件的背景宿主，並非 Claude 專用殘留。 |
| 刪 lib/http-proxy.mjs | 保留；Codex 對外部 HTTP MCP 的轉接仍需自己的實作，CC 刪檔理由不適用。 |
| 刪 Codex 專用測試與文件 | 不照刪；Codex 版仍需相關測試、模組表及技術說明。本輪也不重新跑已知會卡住的 Luna 或端對端測試。 |
| 套件名稱與指令入口改成 CC | 不搬；package.json、鎖檔和 Codex 插件清單的名稱／版本屬 Codex，仍為 dsh-to-codex 0.10.0。 |
| host-build 只編工作程序 | 不直接照搬；Codex 的 MCP、背景宿主、掛鉤仍有用途。僅移植按需編譯的原則，關閉掛鉤時不編掛鉤。 |
| worker 刪掉 Codex 模式，只接 bridge/* | 不搬；本機 Codex worker 的指定部分沒有 Claude 模式。codex/* 事件、對話查詢、掛鉤仍是它的必要功能。 |
| 模組登記表只留 Claude 模組、刪最低 Codex 版本欄位 | 不搬 Claude 登記表；保留 Codex 的模組、版本及能力判斷，只移植單個服務註冊失敗的隔離。 |
| 刪 Codex 控制、事件、對話、能力及宿主服務 | 保留；這些提供本版的實際平台連接。未為這一項重新做全專案刪檔調查。 |
| state-paths 刪預設寫入 ~/.codex 的函式 | 保留 resolvePluginState 和 migrateLegacyState；它們是 Codex 自己的持久狀態定位與舊資料遷移功能，刪掉會破壞既有插件。 |
| 把內部 dsh-to-codex 名稱改成 d-sh-are-in-cc | 不搬；在 Codex 版這些是正確名稱。既有狀態目錄名稱也不任意改動。 |
| 更新 DEVELOPMENT.md、lib/claude-host/README.md | Codex 這邊對應維護 README.md、lib/README.md，記錄自己的保留理由，不引入 Claude 專用文件或過時檔案列表。 |

CC 新增的未知服務候選分類會改變掃描、報告與宿主之間的資料約定；這不屬於此次刪除其他平台程式的清單，未另外搬入或展開調查，不能算成已同步。

## 驗證

```powershell
node --test --test-timeout=45000 tests/host-build-selection.test.mjs tests/module-provide-isolation.test.mjs tests/v040-agents-registry.test.mjs tests/runtime-versions.test.mjs
# 10 passed, 0 failed, 0 skipped
node --test --test-timeout=45000 tests/host-conversion.test.mjs
# 2 passed, 0 failed, 0 skipped
```

合計 12 項全部通過；先前單獨重跑的兩項包含在這 12 項中，不重複加總。掛鉤測試用缺少掛鉤依賴的合成專案確認停用時確實不編譯，再切換開啟確認快取不會錯用。服務測試故意讓一個註冊失敗，確認另一個仍成功且診斷不含合成秘密值。

另以合成插件執行真正轉換，移動產物後啟動 MCP、呼叫工具、讀寫設定、呼叫本機 HTTP 路由及執行掛鉤，確認必要 Codex 功能未因清理消失。沒有登入外部帳號、呼叫真實模型、發文、下載依賴、安裝真實第三方插件或更新已安裝快取。沒有跑完整測試、Luna 測試或 CC 端對端測試。
