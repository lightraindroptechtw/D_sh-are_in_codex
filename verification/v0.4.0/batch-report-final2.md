# DSH-to-Codex 0.4.0 來源啟動批次

批次：full-100-recheck；固定分母：100；本次實際納入：100；未重測：0。
開始：2026-10-23T03:30:56.494Z；結束：2026-10-23T03:42:55.313Z。

基準報告保留完整 100 筆原始結果；下表只統計本次真正重測的 100 個來源。

| 層級 | 成功 | 部分 | 失敗 | N/A |
|---|---:|---:|---:|---:|
| 生成與結構 | 90 | 0 | 0 | 10 |
| MCP 初始化 | 57 | 0 | 32 | 11 |
| 來源工具清單 | 43 | 0 | 0 | 57 |
| 安全工具呼叫 | 1 | 0 | 4 | 95 |

## 100來源前後比較

| 層級 | 基準成功/失敗/N/A | 重測成功/失敗/N/A |
|---|---|---|
| 生成與結構 | 90/10/0 | 90/0/10 |
| MCP 初始化 | 36/53/11 | 57/32/11 |
| 來源工具清單 | 24/0/76 | 43/0/57 |
| 安全工具呼叫 | 1/3/96 | 1/4/95 |

控制工具與來源工具分開統計；控制工具未用於安全呼叫。純技能、沒有本機 MCP server、或純 DSH UI 因目標平台不提供該 UI 時列為 N/A。

和 0.3.1 對照：0.3.1 had four direct source-tool cases and 13 calls, with 1 success; this is not an 87-source startup result.

| # | 來源 | 生成/結構 | MCP 初始化 | 來源工具 | 安全呼叫 | 分類/原因碼 |
|---:|---|---|---|---|---|---|
| 1 | dsh-plugin-nlbi@0.2.1 | success | success | success | not-applicable | — |
| 2 | dsh-desktop-uia@1.1.3 | success | success | success | not-applicable | — |
| 3 | dsh-hdc-bridge@0.10.2 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 4 | dsh-armory@2.1.0 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 5 | dsh-obsidian-board@0.2.5 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 6 | @vfvrpq/dsh-search@0.1.0 | success | success | success | not-applicable | — |
| 7 | dsh-zspace@0.4.0 | success | success | success | not-applicable | — |
| 8 | dsh-plugin-veriscope@0.6.0 | success | failed | not-applicable | not-applicable | upstream-error/SDK_VERSION_MISMATCH |
| 9 | dsh-plugin-academic-writing@0.3.2 | success | success | success | failed | other/OTHER |
| 10 | dsh-plugin-education@0.3.2 | success | success | success | failed | other/OTHER |
| 11 | dsh-plugin-finance-data@0.3.2 | success | success | success | success | — |
| 12 | dsh-plugin-translation@0.3.2 | success | success | success | failed | other/OTHER |
| 13 | dsh-computer-use@0.3.1 | success | success | success | not-applicable | — |
| 14 | dsh-mcp-tunnel@0.1.0 | success | success | success | not-applicable | — |
| 15 | @czf1995/dsh-waste-market@0.8.2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 16 | dsh-cua-drive@0.2.1 | success | success | success | not-applicable | — |
| 17 | dsh-toolbox-web@0.1.29 | success | failed | not-applicable | not-applicable | upstream-error/HOST_INITIALIZATION_FAILED |
| 18 | dsh-monitor@0.1.1 | success | success | success | not-applicable | — |
| 19 | @adenxie/dsh-vercel@0.4.0 | success | success | success | not-applicable | — |
| 20 | dsh-graft-plugin@0.2.1 | success | success | success | not-applicable | — |
| 21 | dsh-plugin-adwhispr@0.1.0 | success | failed | not-applicable | not-applicable | other/OTHER |
| 22 | dsh-agentmail@0.1.0 | success | failed | not-applicable | not-applicable | upstream-error/HOST_INITIALIZATION_FAILED |
| 23 | @mtl-academic/dsh-patent@0.1.6-alpha.7 | success | success | not-applicable | not-applicable | — |
| 24 | @a9i5k4/dsh-ark9canvas@0.4.1 | success | failed | not-applicable | not-applicable | upstream-error/CORDIS_INVALID_EFFECT |
| 25 | @a9i5k4/dsh-literature@0.3.6 | success | success | success | not-applicable | — |
| 26 | dsh-scrape-webpage@1.0.0 | success | success | success | not-applicable | — |
| 27 | @memef1f1y/dsh-plugin-tavily@0.7.0 | success | success | success | not-applicable | — |
| 28 | @240xu/dsh-websearch@2.8.8 | success | success | success | not-applicable | — |
| 29 | dsh-verify@0.9.6 | success | success | success | not-applicable | — |
| 30 | dsh-read-url@1.9.3 | success | success | success | not-applicable | — |
| 31 | dsh-moli@1.1.19 | success | success | success | not-applicable | — |
| 32 | dsh-web-search-firecrawl@0.1.5 | success | success | success | not-applicable | — |
| 33 | @anweat/dsh-browser@0.2.1 | success | success | success | not-applicable | — |
| 34 | dsh-web-search-pro@0.2.1 | success | success | success | not-applicable | — |
| 35 | @arcaneorion/dsh-tavily-web@0.2.2 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 36 | dsh-vision-fallback@0.10.0 | success | success | not-applicable | not-applicable | — |
| 37 | dsh-vision-proxy-route@0.1.4 | success | success | not-applicable | not-applicable | — |
| 38 | dsh-image2-tool@0.4.1 | success | success | success | not-applicable | — |
| 39 | dsh-vision-web@0.1.0 | success | failed | not-applicable | not-applicable | upstream-error/HOST_INITIALIZATION_FAILED |
| 40 | dsh-youreyes@0.1.0 | success | failed | not-applicable | not-applicable | upstream-error/HOST_INITIALIZATION_FAILED |
| 41 | dsh-image-conatiner@0.2.3 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 42 | @anionex/dsh-vision-toolkit@0.1.47 | success | failed | not-applicable | not-applicable | missing-dependency/SOURCE_DEPENDENCY_MISSING |
| 43 | @lp181818/dsh-vision-plugin@1.2.3 | success | success | not-applicable | not-applicable | — |
| 44 | @memef1f1y/dsh-plugin-tts@0.6.7 | success | success | not-applicable | not-applicable | — |
| 45 | @ai-galaxy/dsh-sound@0.4.1 | success | success | not-applicable | not-applicable | — |
| 46 | dsh-speak@1.8.2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 47 | dsh-dictation-hotkey@0.3.0 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 48 | @chenjh12/dsh-capmap-viz@0.2.4 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 49 | dsh-client-ui-second-brain@1.0.2 | success | success | not-applicable | not-applicable | — |
| 50 | dsh-md-studio@1.2.0 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 51 | dsh-consistency-guard@0.1.0 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 52 | @chengzhao-dev/dsh-quarto-book@0.4.3 | success | success | success | not-applicable | — |
| 53 | @copylee/dsh-office@1.1.3 | success | success | success | not-applicable | — |
| 54 | @zzerx/dsh-plugin-daily-log@0.4.3 | success | failed | not-applicable | not-applicable | missing-dependency/SOURCE_DEPENDENCY_MISSING |
| 55 | @sakura12/oh-my-deepseekharness@0.4.9 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 56 | @banana-peeljj12/dsh-trellis@0.4.2 | success | success | success | not-applicable | — |
| 57 | dsh-eteams@0.2.22 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 58 | dsh-plugin-orchd@0.1.0 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 59 | @y9931666/dsh-plugin-crossfire@0.1.3 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 60 | @y9931666/dsh-plugin-roundtable@1.0.0-rc.3 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 61 | dsh-cron-panel@0.1.13 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 62 | pstack-dsh@0.2.3 | success | success | success | not-applicable | — |
| 63 | dsh-schedule-later@0.6.0 | success | success | success | not-applicable | — |
| 64 | dsh-diff-approval@0.36.1 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 65 | dsh-git-panel@0.1.20 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 66 | @alpacachen/dsh-simple-worktree@1.1.3 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 67 | dsh-github-router@0.4.1 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 68 | dsh-telemetry-redactor@0.1.0 | success | success | not-applicable | not-applicable | — |
| 69 | dsh-verification-receipt@0.1.0 | success | success | not-applicable | not-applicable | — |
| 70 | qiushi-dsh-evidence-audit@0.1.0 | success | success | not-applicable | not-applicable | — |
| 71 | dsh-ui-auth@0.7.1 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 72 | dsh-jev-guard@0.5.7 | success | success | not-applicable | not-applicable | — |
| 73 | dsh-message-gateway@0.1.35 | success | failed | not-applicable | not-applicable | missing-dependency/SOURCE_DEPENDENCY_MISSING |
| 74 | dsh-smart-reminder@0.1.29 | success | success | success | not-applicable | — |
| 75 | dsh-messaging-gateway@0.2.4 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 76 | dsh-notch-focus@0.1.4 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 77 | dsh-web-lan-access@1.3.2 | success | success | not-applicable | not-applicable | — |
| 78 | dsh-auth-tunnel@0.2.0-rc.2 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 79 | dsh-vps@1.16.1 | success | success | not-applicable | not-applicable | — |
| 80 | @anonyjcy/dsh-j-space@1.2.4 | success | not-applicable | not-applicable | not-applicable | other/OTHER |
| 81 | @benrong/dsh-prompt-polish@0.2.4 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 82 | @zzerx/dsh-plugin-usage-billing@1.3.0 | success | failed | not-applicable | not-applicable | missing-dependency/SOURCE_DEPENDENCY_MISSING |
| 83 | dsh-api-dashboard@1.7.0 | success | failed | not-applicable | not-applicable | missing-dependency/SOURCE_DEPENDENCY_MISSING |
| 84 | dsh-tokenrhythm-bill@0.6.1 | success | success | not-applicable | not-applicable | — |
| 85 | @yolk_vat-y/dsh-project-memory@0.6.3 | success | success | success | not-applicable | — |
| 86 | @zzerx/dsh-plugin-memory@0.4.3 | success | failed | not-applicable | not-applicable | missing-dependency/SOURCE_DEPENDENCY_MISSING |
| 87 | dsh-ledger-memory@1.3.0 | success | success | success | not-applicable | — |
| 88 | dsh-plugin-focus@1.1.1 | success | success | success | not-applicable | — |
| 89 | dsh-memory-recall@0.2.0 | success | success | success | not-applicable | — |
| 90 | @agentscope-ai/reme-dsh-plugin@0.1.2 | success | success | success | not-applicable | — |
| 91 | @a9i5k4/dsh-auto-memory@3.3.15 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 92 | dsh-wrapup-guard@0.1.0 | success | success | success | not-applicable | — |
| 93 | mcmodsdevbridge@1.0.3 | success | success | success | not-applicable | — |
| 94 | dsh-plugin-verify@1.1.1 | success | success | success | failed | other/OTHER |
| 95 | dsh-creator-mode-plus@0.3.13 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 96 | @aaronandwork/dsh-evidence-gate@0.2.1 | success | success | success | not-applicable | — |
| 97 | dsh-agentdebugx@0.1.0 | success | success | success | not-applicable | — |
| 98 | dsh-win-toolkit@0.1.3 | success | success | success | not-applicable | — |
| 99 | @1e0zj/dsh-plugin-mall@0.4.17 | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 100 | dsh-vba-bridge@0.1.1 | success | success | success | not-applicable | — |

## 寬鬆輸出獨立比較

此欄只比較 A10 opt-in 寬鬆輸出；不併入預設 strict 四層統計。

| 來源 | 生成/結構 | MCP 初始化 | 工具列表 | 安全呼叫 | 分類/原因碼 |
|---|---|---|---|---|---|
| dsh-plugin-academic-writing@0.3.2 | success | success | success | success | — |
| dsh-plugin-education@0.3.2 | success | success | success | success | — |
| dsh-plugin-translation@0.3.2 | success | success | success | success | — |

失敗訊息只在記憶體中分類；報告僅保留原因碼、失敗分類及經遮蔽的第一行。
