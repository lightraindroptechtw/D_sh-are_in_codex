# DSH-to-Codex 0.4.0 來源啟動批次

批次：recheck；固定分母：100；本次實際納入：32；未重測：68。
開始：2026-10-23T03:45:20.941Z；結束：2026-10-23T03:50:46.027Z。

基準報告保留完整 100 筆原始結果；下表只統計本次真正重測的 32 個來源。

| 層級 | 成功 | 部分 | 失敗 | N/A |
|---|---:|---:|---:|---:|
| 生成與結構 | 31 | 0 | 0 | 1 |
| MCP 初始化 | 0 | 0 | 31 | 1 |
| 來源工具清單 | 0 | 0 | 0 | 32 |
| 安全工具呼叫 | 0 | 0 | 0 | 32 |

## 100來源前後比較

| 層級 | 基準成功/失敗/N/A | 重測成功/失敗/N/A |
|---|---|---|
| 生成與結構 | 90/10/0 | 31/0/1 |
| MCP 初始化 | 36/53/11 | 0/31/1 |
| 來源工具清單 | 24/0/76 | 0/0/32 |
| 安全工具呼叫 | 1/3/96 | 0/0/32 |

控制工具與來源工具分開統計；控制工具未用於安全呼叫。純技能、沒有本機 MCP server、或純 DSH UI 因目標平台不提供該 UI 時列為 N/A。

和 0.3.1 對照：0.3.1 had four direct source-tool cases and 13 calls, with 1 success; this is not an 87-source startup result.

| # | 來源 | 生成/結構 | MCP 初始化 | 來源工具 | 安全呼叫 | 分類/原因碼 |
|---:|---|---|---|---|---|---|
| 3 | dsh-hdc-bridge@0.10.2 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 4 | dsh-armory@2.1.0 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 8 | dsh-plugin-veriscope@0.6.0 | success | failed | not-applicable | not-applicable | upstream-error/SDK_VERSION_MISMATCH |
| 17 | dsh-toolbox-web@0.1.29 | success | failed | not-applicable | not-applicable | upstream-error/DSH_API_EXPORT_MISSING |
| 22 | dsh-agentmail@0.1.0 | success | failed | not-applicable | not-applicable | other/HOST_INITIALIZATION_FAILED |
| 24 | @a9i5k4/dsh-ark9canvas@0.4.1 | success | failed | not-applicable | not-applicable | upstream-error/CORDIS_INVALID_EFFECT |
| 35 | @arcaneorion/dsh-tavily-web@0.2.2 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 39 | dsh-vision-web@0.1.0 | success | failed | not-applicable | not-applicable | upstream-error/DSH_API_EXPORT_MISSING |
| 40 | dsh-youreyes@0.1.0 | success | failed | not-applicable | not-applicable | upstream-error/DSH_API_EXPORT_MISSING |
| 42 | @anionex/dsh-vision-toolkit@0.1.47 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 54 | @zzerx/dsh-plugin-daily-log@0.4.3 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 55 | @sakura12/oh-my-deepseekharness@0.4.9 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 57 | dsh-eteams@0.2.22 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 58 | dsh-plugin-orchd@0.1.0 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 59 | @y9931666/dsh-plugin-crossfire@0.1.3 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 60 | @y9931666/dsh-plugin-roundtable@1.0.0-rc.3 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 61 | dsh-cron-panel@0.1.13 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 64 | dsh-diff-approval@0.36.1 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 65 | dsh-git-panel@0.1.20 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 66 | @alpacachen/dsh-simple-worktree@1.1.3 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 67 | dsh-github-router@0.4.1 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 71 | dsh-ui-auth@0.7.1 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 73 | dsh-message-gateway@0.1.35 | success | failed | not-applicable | not-applicable | other/HOST_INITIALIZATION_FAILED |
| 75 | dsh-messaging-gateway@0.2.4 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 78 | dsh-auth-tunnel@0.2.0-rc.2 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 81 | @benrong/dsh-prompt-polish@0.2.4 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 82 | @zzerx/dsh-plugin-usage-billing@1.3.0 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 83 | dsh-api-dashboard@1.7.0 | success | failed | not-applicable | not-applicable | missing-dependency/SOURCE_DEPENDENCY_MISSING |
| 86 | @zzerx/dsh-plugin-memory@0.4.3 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 91 | @a9i5k4/dsh-auto-memory@3.3.15 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 95 | dsh-creator-mode-plus@0.3.13 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 99 | @1e0zj/dsh-plugin-mall@0.4.17 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |

失敗訊息只在記憶體中分類；報告僅保留原因碼、失敗分類及經遮蔽的第一行。
