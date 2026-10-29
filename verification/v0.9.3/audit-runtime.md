# 0.9.3 執行環境、相容層與事件橋接唯讀審計

日期：2026-10-28。只讀實體源碼與套件資訊；未啟動來源插件、宿主、模型、背景工作或測試。此報告中的「完整」表示該項程式接線存在，不表示第三方插件已實測成功。只新增本報告，未修改產品或記憶。

比較根目錄：

- `CC`：由 `<local-workspace>` 的 `d-sh-are-in-cc.installLocation` 取得：`<local-cc-source>`。
- `Codex`：`<local-workspace>`；`package.json:3` 為 `0.9.3`。

## 結論

先前若把「已移植 CC 新功能」解讀成全面執行相容，範圍過大。至少六項 CC 實際執行路徑沒有完整進入 Codex：多入口插件組合、設定運算式求值、特定版本別名、舊版 dsh-llm 匯出適配、apply 回傳值適配，以及未宣告 inject 時的服務推導。另有已登記命令直接執行、純介面分類主路徑、隨時重啟入口等差距。

對話事件與工具攔截並非全部缺少：Codex 已有自身的對話橋接、`session/event`、`agent/created`、`tools/pre-execute`、`tools/post-execute`、`tools/result` 主路徑；其平台限制與 CC 相容層缺漏應分開。

## 功能逐項對照

行號以本次讀取的源碼為準；同一格中以分號串起實際呼叫鏈。

| 功能 | CC 源碼與主路徑 | Codex 源碼與主路徑 | 判定 | 具體影響與預設 |
|---|---|---|---|---|
| patch 多入口發現、逐入口掃描與組合 | `lib/inspect.mjs:318-345` 建立 `patchEntries`，`:397` 逐入口走訪，`:423` 回傳 `entries`；`lib/converter-claude.mjs:304-307` 傳入宿主；`lib/dsh-host-worker.mjs:188-225` 逐項載入，`:276-286` 要求每個入口啟用 | `lib/inspect.mjs:315-326` 只取同名根插件預設設定，`:364` 只走訪一個入口，`:388` 無 entries；`lib/host-build.mjs:42` 只存 entry；`lib/dsh-host.mjs:103-123` 不傳 entries；`lib/dsh-host-worker.mjs:128-144,177,200-206` 只啟用一個 target | 缺少 | 類似 CC 註解所述 tools／identity／approval／inbound 分成子路徑的套件，Codex 不會保留整組掛載。若根入口本身仍可啟用，其他政策或背景入口可能被省略。這是源碼可證的漏掛載；哪些真實插件因此漏核准仍須逐插件實測。 |
| `!!js` 設定運算式安全求值與名稱追蹤 | `lib/compat/dsh-expression.mjs:19-24,56-114,119-131`；`lib/inspect.mjs:403` 蒐集入口設定的環境變數名稱；`lib/converter-claude.mjs:245` 納入 passEnv；`lib/dsh-host-worker.mjs:217-223` 啟動時求值並合併指定入口覆寫 | `lib/inspect.mjs:146-147` 已能解析成 `$dshExpression` 標記，但 `:180,318` 將含動態值的根預設設定整包略過；`lib/converter.mjs:76` 僅轉交明示 passEnv 與模組設定名稱；沒有執行求值器 | 部分 | 「能解析標記」不等於「支援執行」。設定含 `process.env.KEY` 時，可能連同同一設定物件的其他靜態值一起丟失，並報 `DEFAULT_CONFIG_DYNAMIC`。CC 求值器只在其多入口分支接入，不能宣稱 CC 所有動態設定都支援。 |
| 精確版本別名 | `lib/compat/version-alias.mjs:28-45` 白名單只允許 dsh-tools alpha.2 → rc.2；`:104` 起安裝轉匯出外殼；`lib/converter-claude.mjs:309-312` 建立計畫；`lib/dsh-host.mjs:7` 與 worker `:135-138` 接線 | `lib/runtime-versions.mjs:9-26` 僅查版本；`lib/converter.mjs:141-142` 只列 mismatch；`lib/precompile-source.mjs:27-29` 與 worker `:53-55` 指向真實套件，無別名；`package.json:49` 為 dsh-tools rc.2 | 缺少 | 依精確 alpha.2 版本檢查的來源仍會看到 rc.2。Codex 有不符報告，但沒有 CC 已知相容版本的白名單外殼；不能以一般版本範圍檢查當作等價。 |
| 舊版 dsh-llm 缺失匯出 | `lib/compat/index.mjs:24-51` 補 CallId、assertNever、deepFreeze；`lib/precompile-entry.mjs:15,71-82` 在編譯時替換；worker `:94` 也用同一編譯函式 | `lib/precompile-source.mjs:27-29` 及 worker `:53-55` 直接 external 到內附套件；`node_modules/@deepseek-ai/dsh-llm/lib/index.js:2429` 匯出清單沒有上述三個舊名稱 | 缺少 | 舊來源具名匯入這三個名稱時無相容外殼，會在載入或編譯失敗。只有內部 import 到同名函式不代表對外有 export。此結論來自靜態匯出清單，未執行來源。 |
| apply 回傳物件轉為清理函式 | `lib/compat/apply-result.mjs:16-32` 保留合法效果、把 object.dispose 轉清理函式，其餘普通值忽略；worker `:208` 實際包住原 apply | worker `lib/dsh-host-worker.mjs:141-144` 直接回傳原 apply；內附 `node_modules/@deepseek-ai/cordis/lib/index.js:1140-1166` 對不合法效果拋 `Invalid effect` | 缺少 | 社群插件以 `{api, dispose}` 等物件作回傳值時，Codex 缺少 CC 的適配；`dispose()` 也沒有被轉成宿主清理效果。 |
| 未宣告 inject 時推導已知服務 | worker `lib/dsh-host-worker.mjs:198-203` 從 plan.host.services 選已知服務作 inferred inject，並回報 compat | worker `lib/dsh-host-worker.mjs:142` 為 `target.inject ?? []`；只額外加入 bridgeModulesReady | 缺少 | 靜態掃描看見 `ctx.systemPrompt` 等服務，不代表原插件的上下文注入契約已滿足。CC 額外處理的「使用服務但沒宣告 inject」來源，在 Codex 仍可能啟用失敗。 |
| 預編譯以免啟動時再開編譯子程序 | `lib/converter-claude.mjs:149-181,331` 預編譯單／多入口；worker `:190-193` 優先載入 | `lib/security-package.mjs:67-68` 呼叫 `precompileSource`；`lib/precompile-source.mjs:9-41` 建立可搬移產物；worker `:129-137` 優先載入 | 完整（單入口） | Codex 有等價單入口方案，不能因沒有 `precompile-entry.mjs` 同名檔案就判漏。它仍缺上述多入口與 compat 匯出替換。 |
| SDK 目錄連結的同時啟動競爭容錯 | `lib/compat/version-alias.mjs:19-25` 已存在但同目標時保留 | `lib/directory-link.mjs:6-18` 已存在時確認為連結且真實目標相同；`lib/dsh-host.mjs` 引入並使用該函式 | 完整 | Codex 有自己的等價實作，且先確認連結型態。不要把 CC 的 linkScope 檔名不同算成缺少。 |
| 宿主工具前後政策事件 | `lib/modules/claude/interception.mjs:26-56` 用官方 waterfall 與 parallel；worker `:358-359`；`lib/claude-host/host.mjs:213-224`；`templates/claude-mod/register.ts:1250-1252,1332` 起 | `lib/native-tool-hooks.mjs:9-33` 同樣呼叫官方 waterfall／parallel；worker `:242`；`lib/host-server.mjs:151-159`；`lib/hook-broker.mjs:34-41`；`lib/host-build.mjs:26,48-51` 生成掛鉤 | 部分（已有等價主路徑） | 兩邊預設都關閉原生工具攔截：CC `allowInterception`，Codex `DEFAULT_PLUGIN_SECURITY.nativeToolHooks=false`（`lib/plugin-security.mjs:13`）。Codex 需產生並信任 hooks，再開原生工具掛鉤。不能把「程式存在」當作預設已執行。 |
| 前置 ask 與後置替換結果 | CC `lib/modules/claude/interception.mjs:31-35` 接 approval，`:54-55` 可回傳替換；`lib/claude-host/host.mjs:217` 僅允許前置 allow/deny 轉交 | Codex `lib/native-tool-hooks.mjs:23` 對 ask 拒絕，`:33` 對替換要求 block；`lib/modules/interception.mjs:2` 公開此限制 | 平台不適用（目前映射明確受限） | Codex 的公開掛鉤映射目前沒有 CC mod 的互動及結果替換通道；這不是忘記複製函式。不能宣稱行為完全等價。工具已執行的副作用兩邊都不能撤銷。 |
| 主對話映射成 `session/event`、`agent/created`、讀取目前對話及 followup | `lib/modules/claude/conversation.mjs:26-55`；worker `:361`；`lib/claude-host/host.mjs:208`；mod `register.ts:1275-1294` | `lib/conversation-bridge.mjs:6-27,40-65`；worker `:234` 與對話分派；`lib/host-server.mjs:123-125,152`；Codex 事件經自身主機橋接 | 部分（已有等價實作） | 已接官方事件名稱，不再只是名稱加前綴。兩者都只能分享插件接入之後觀察到的對話，不能因此宣稱 DSH 完整重播。Codex shareConversation 預設開，allowFollowups 預設關（`lib/plugin-security.mjs:13`）。 |
| 已登記命令處理函式執行 | `lib/modules/claude/commands.mjs:30-40` 呼叫 definition.handler；worker `:354-356`；`lib/claude-host/host.mjs:209-211`；mod 掛命令執行入口 | `lib/modules/commands.mjs:11,29-31` 阻擋 execute；`:39-50` 只產探索技能；`lib/host-tools.mjs:24` 附近只列舉 commands，沒有 commands.run 工具／分派 | 缺少 | Codex 可以找到命令，但無法以 CC 的受限承載物呼叫簡單命令處理函式。不是所有命令都一定能移植；CC 本身也只支援不依賴真實 DSH Agent 的處理函式。 |
| 純 DSH 介面插件分類是否接入正式轉換 | `lib/converter-claude.mjs:134-138` 定義；`:277-281` 正式 convert 直接判 not-applicable | Codex `lib/converter.mjs:45-52` 有相同分類函式，但 `rg` 全 lib 僅找到定義及內部 modelBehaviors 呼叫，正式 convert `:58` 起沒有呼叫 | 部分（分類有，正式路徑未接） | 是實際「有函式但主路徑沒接」案例。Codex 對純介面來源仍可能建立其他宿主產物，再回報 partial，而沒有 CC 的明確不適用結果。不能只用 helper 單元測試當作入口功能完成。 |
| 信任設定、取消與重啟套用 | CC `templates/claude-mod/register.ts:1496-1514` 讀取持久 trust、寫入後立即 restart；`:1482-1489` 可隨時 restart；`:980-985` 信任後同一工具呼叫重跑一次 | `lib/plugin-security.mjs:95-102` 持久設定；`lib/permission-broker.mjs:25-26,39-44` 下一次工具要求比對設定並銷毀舊程序後新建；`:91-95` 啟動失敗才提供 retry | 部分（安全設定已有等價） | Codex 有安全頁 allowDirectSpawn 與程序重建，不是完全沒有信任操作；但沒有 CC 隨時 restart 控制，也不在儲存設定時立即停止既有來源。背景計時器在下一次工具要求之前仍跑原程序／原權限。設定撤銷後能否立即停止敏感背景工作尚未動態驗證，應列為要驗證的風險，不能宣稱已立即撤權。 |
| 狀態與受限原因顯示 | CC `lib/claude-host/host.mjs:227-232` 回目前受限；mod `register.ts:1392-1478,1993` 狀態命令顯示服務、信任與受限原因 | `lib/host-tools.mjs:14` 起 status → `lib/host-server.mjs:142` describe；`lib/plugin-security.mjs:85-94` 受限清單；`lib/plugin-security-server.mjs:15` 安全頁；`lib/permission-broker.mjs:91-95` 啟動失敗備援工具 | 部分（已有等價資訊） | Codex 不是缺狀態功能，但資訊分在宿主 status 與安全頁，沒有 CC 相同斜線指令入口。`lib/daemon-control.mjs:13` 也明示 MCP 宿主須透過 Codex 停止，不能拿背景 daemon stop 當作一般 MCP 重啟。 |
| 模型內部行為與服務映射報告 | CC `lib/converter-claude.mjs:96-117,348-355` 建 serviceMapping／uncertainServices；`:353` 明列模型供應商替換與內部代理迴圈不可用 | Codex `lib/inspect.mjs:83-140` 已分類模型／工具行為，`lib/converter.mjs:39-40` 有 modelBehaviors；正式 convert 主要靠模組描述與 `:147` HOST_BOUNDARIES，沒有同格式逐服務報告 | 部分（分析已移植，報告不等價） | 模型行為分類的存在不能代表 Codex 內部模型串流／代理迴圈真的掛上攔截。兩邊都不應聲稱接管宿主內部模型。Codex 缺 CC 逐服務完整度與不確定名稱報告，但不是所有服務執行都缺少。 |

## 優先修補／驗證順序

1. 先補多入口端到端路徑：inspect → report → settings → precompile → 宿主傳輸 → worker → 所有入口啟用檢查，特別把政策入口缺席當成失敗。僅新增 `entries` 欄位不算完成。
2. 同時補設定運算式、舊匯出、apply 回傳及 inject 推導，避免轉換成功而第一次啟動失敗。版本別名必須保留 CC 白名單與已比對範圍，不能通用偽造所有版本。
3. 接通／明確維持命令執行與純介面正式分類；讓報告說明實際採用的路徑。
4. 驗證安全設定撤銷時既有背景程序的行為。現有 sourceFor 在下一次來源工具要求才重建，儲存安全頁不會立即觸發；若需要立即撤權，得補一條受信任宿主控制路徑。
5. 保留 Codex 已有對話橋接與掛鉤，不要因 CC 換成 mod 介面就重複移植；明示 ask／結果替換的差別。

這些是靜態實作覆蓋審計，不是成功執行記錄；沒有呼叫模型、沒有因報告內容執行任何第三方工具或外部操作。
