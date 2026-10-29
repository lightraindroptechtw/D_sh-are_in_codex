# DSH-to-Codex 0.4.0 來源啟動批次

批次：full-100-recheck；固定分母：100；本次實際納入：100；未重測：0。
開始：2026-10-23T03:26:24.490Z；結束：進行中。

基準報告保留完整 100 筆原始結果；下表只統計本次真正重測的 100 個來源。

| 層級 | 成功 | 部分 | 失敗 | N/A |
|---|---:|---:|---:|---:|
| 生成與結構 | 16 | 0 | 0 | 3 |
| MCP 初始化 | 13 | 0 | 3 | 3 |
| 來源工具清單 | 13 | 0 | 0 | 6 |
| 安全工具呼叫 | 1 | 0 | 3 | 15 |

## 100來源前後比較

| 層級 | 基準成功/失敗/N/A | 重測成功/失敗/N/A |
|---|---|---|
| 生成與結構 | 90/10/0 | 16/0/3 |
| MCP 初始化 | 36/53/11 | 13/3/3 |
| 來源工具清單 | 24/0/76 | 13/0/6 |
| 安全工具呼叫 | 1/3/96 | 1/3/15 |

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
| 20 | dsh-graft-plugin@0.2.1 | pending | pending | pending | pending | — |
| 21 | dsh-plugin-adwhispr@0.1.0 | pending | pending | pending | pending | — |
| 22 | dsh-agentmail@0.1.0 | pending | pending | pending | pending | — |
| 23 | @mtl-academic/dsh-patent@0.1.6-alpha.7 | pending | pending | pending | pending | — |
| 24 | @a9i5k4/dsh-ark9canvas@0.4.1 | pending | pending | pending | pending | — |
| 25 | @a9i5k4/dsh-literature@0.3.6 | pending | pending | pending | pending | — |
| 26 | dsh-scrape-webpage@1.0.0 | pending | pending | pending | pending | — |
| 27 | @memef1f1y/dsh-plugin-tavily@0.7.0 | pending | pending | pending | pending | — |
| 28 | @240xu/dsh-websearch@2.8.8 | pending | pending | pending | pending | — |
| 29 | dsh-verify@0.9.6 | pending | pending | pending | pending | — |
| 30 | dsh-read-url@1.9.3 | pending | pending | pending | pending | — |
| 31 | dsh-moli@1.1.19 | pending | pending | pending | pending | — |
| 32 | dsh-web-search-firecrawl@0.1.5 | pending | pending | pending | pending | — |
| 33 | @anweat/dsh-browser@0.2.1 | pending | pending | pending | pending | — |
| 34 | dsh-web-search-pro@0.2.1 | pending | pending | pending | pending | — |
| 35 | @arcaneorion/dsh-tavily-web@0.2.2 | pending | pending | pending | pending | — |
| 36 | dsh-vision-fallback@0.10.0 | pending | pending | pending | pending | — |
| 37 | dsh-vision-proxy-route@0.1.4 | pending | pending | pending | pending | — |
| 38 | dsh-image2-tool@0.4.1 | pending | pending | pending | pending | — |
| 39 | dsh-vision-web@0.1.0 | pending | pending | pending | pending | — |
| 40 | dsh-youreyes@0.1.0 | pending | pending | pending | pending | — |
| 41 | dsh-image-conatiner@0.2.3 | pending | pending | pending | pending | — |
| 42 | @anionex/dsh-vision-toolkit@0.1.47 | pending | pending | pending | pending | — |
| 43 | @lp181818/dsh-vision-plugin@1.2.3 | pending | pending | pending | pending | — |
| 44 | @memef1f1y/dsh-plugin-tts@0.6.7 | pending | pending | pending | pending | — |
| 45 | @ai-galaxy/dsh-sound@0.4.1 | pending | pending | pending | pending | — |
| 46 | dsh-speak@1.8.2 | pending | pending | pending | pending | — |
| 47 | dsh-dictation-hotkey@0.3.0 | pending | pending | pending | pending | — |
| 48 | @chenjh12/dsh-capmap-viz@0.2.4 | pending | pending | pending | pending | — |
| 49 | dsh-client-ui-second-brain@1.0.2 | pending | pending | pending | pending | — |
| 50 | dsh-md-studio@1.2.0 | pending | pending | pending | pending | — |
| 51 | dsh-consistency-guard@0.1.0 | pending | pending | pending | pending | — |
| 52 | @chengzhao-dev/dsh-quarto-book@0.4.3 | pending | pending | pending | pending | — |
| 53 | @copylee/dsh-office@1.1.3 | pending | pending | pending | pending | — |
| 54 | @zzerx/dsh-plugin-daily-log@0.4.3 | pending | pending | pending | pending | — |
| 55 | @sakura12/oh-my-deepseekharness@0.4.9 | pending | pending | pending | pending | — |
| 56 | @banana-peeljj12/dsh-trellis@0.4.2 | pending | pending | pending | pending | — |
| 57 | dsh-eteams@0.2.22 | pending | pending | pending | pending | — |
| 58 | dsh-plugin-orchd@0.1.0 | pending | pending | pending | pending | — |
| 59 | @y9931666/dsh-plugin-crossfire@0.1.3 | pending | pending | pending | pending | — |
| 60 | @y9931666/dsh-plugin-roundtable@1.0.0-rc.3 | pending | pending | pending | pending | — |
| 61 | dsh-cron-panel@0.1.13 | pending | pending | pending | pending | — |
| 62 | pstack-dsh@0.2.3 | pending | pending | pending | pending | — |
| 63 | dsh-schedule-later@0.6.0 | pending | pending | pending | pending | — |
| 64 | dsh-diff-approval@0.36.1 | pending | pending | pending | pending | — |
| 65 | dsh-git-panel@0.1.20 | pending | pending | pending | pending | — |
| 66 | @alpacachen/dsh-simple-worktree@1.1.3 | pending | pending | pending | pending | — |
| 67 | dsh-github-router@0.4.1 | pending | pending | pending | pending | — |
| 68 | dsh-telemetry-redactor@0.1.0 | pending | pending | pending | pending | — |
| 69 | dsh-verification-receipt@0.1.0 | pending | pending | pending | pending | — |
| 70 | qiushi-dsh-evidence-audit@0.1.0 | pending | pending | pending | pending | — |
| 71 | dsh-ui-auth@0.7.1 | pending | pending | pending | pending | — |
| 72 | dsh-jev-guard@0.5.7 | pending | pending | pending | pending | — |
| 73 | dsh-message-gateway@0.1.35 | pending | pending | pending | pending | — |
| 74 | dsh-smart-reminder@0.1.29 | pending | pending | pending | pending | — |
| 75 | dsh-messaging-gateway@0.2.4 | pending | pending | pending | pending | — |
| 76 | dsh-notch-focus@0.1.4 | pending | pending | pending | pending | — |
| 77 | dsh-web-lan-access@1.3.2 | pending | pending | pending | pending | — |
| 78 | dsh-auth-tunnel@0.2.0-rc.2 | pending | pending | pending | pending | — |
| 79 | dsh-vps@1.16.1 | pending | pending | pending | pending | — |
| 80 | @anonyjcy/dsh-j-space@1.2.4 | pending | pending | pending | pending | — |
| 81 | @benrong/dsh-prompt-polish@0.2.4 | pending | pending | pending | pending | — |
| 82 | @zzerx/dsh-plugin-usage-billing@1.3.0 | pending | pending | pending | pending | — |
| 83 | dsh-api-dashboard@1.7.0 | pending | pending | pending | pending | — |
| 84 | dsh-tokenrhythm-bill@0.6.1 | pending | pending | pending | pending | — |
| 85 | @yolk_vat-y/dsh-project-memory@0.6.3 | pending | pending | pending | pending | — |
| 86 | @zzerx/dsh-plugin-memory@0.4.3 | pending | pending | pending | pending | — |
| 87 | dsh-ledger-memory@1.3.0 | pending | pending | pending | pending | — |
| 88 | dsh-plugin-focus@1.1.1 | pending | pending | pending | pending | — |
| 89 | dsh-memory-recall@0.2.0 | pending | pending | pending | pending | — |
| 90 | @agentscope-ai/reme-dsh-plugin@0.1.2 | pending | pending | pending | pending | — |
| 91 | @a9i5k4/dsh-auto-memory@3.3.15 | pending | pending | pending | pending | — |
| 92 | dsh-wrapup-guard@0.1.0 | pending | pending | pending | pending | — |
| 93 | mcmodsdevbridge@1.0.3 | pending | pending | pending | pending | — |
| 94 | dsh-plugin-verify@1.1.1 | pending | pending | pending | pending | — |
| 95 | dsh-creator-mode-plus@0.3.13 | pending | pending | pending | pending | — |
| 96 | @aaronandwork/dsh-evidence-gate@0.2.1 | pending | pending | pending | pending | — |
| 97 | dsh-agentdebugx@0.1.0 | pending | pending | pending | pending | — |
| 98 | dsh-win-toolkit@0.1.3 | pending | pending | pending | pending | — |
| 99 | @1e0zj/dsh-plugin-mall@0.4.17 | pending | pending | pending | pending | — |
| 100 | dsh-vba-bridge@0.1.1 | pending | pending | pending | pending | — |

## 寬鬆輸出獨立比較

此欄只比較 A10 opt-in 寬鬆輸出；不併入預設 strict 四層統計。

| 來源 | 生成/結構 | MCP 初始化 | 工具列表 | 安全呼叫 | 分類/原因碼 |
|---|---|---|---|---|---|

失敗訊息只在記憶體中分類；報告僅保留原因碼、失敗分類及經遮蔽的第一行。
