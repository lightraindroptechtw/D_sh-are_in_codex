# DSH-to-Codex 0.4.0 來源啟動批次

本報告把 final2 的完整 100 筆結果作為目前全量基準，並以 peerfix 實際重測的 32 筆覆蓋對應列。另 68 筆仍是 final2 的實測結果，不代表它們在 peerfix 版本重新執行。
時間：2026-10-23T03:30:56.494Z 至 2026-10-23T03:50:46.027Z。固定分母 100；peerfix 覆蓋 32 筆，final2-only 68 筆。
程式雜湊：final2 40ed4c1dc88a1443a4151c31cb2e6ccfa6921fe92e5e4cd55f1f9a2b23681b47；peerfix ab992eb72fbe26af51d89d0dbcea1164d86dd31c7e2f45988255f346a08808ef。每筆資料都有來源報告、執行批次、雜湊及套件目錄。

## 目前完整100筆摘要

| 層級 | 成功 | 部分 | 失敗 | N/A |
|---|---:|---:|---:|---:|
| 生成與結構 | 90 | 0 | 0 | 10 |
| MCP 初始化 | 57 | 0 | 31 | 12 |
| 來源工具清單 | 43 | 0 | 0 | 57 |
| 安全工具呼叫 | 1 | 0 | 4 | 95 |

控制工具：513；來源工具：191。0.3.1 的證據只有 4 個來源、13 次工具呼叫、1 次成功；不可將 87 個靜態來源候選描述為啟動測試。

## 執行版本覆蓋

- peerfix（32 筆）：dsh-hdc-bridge, dsh-armory, dsh-plugin-veriscope, dsh-toolbox-web, dsh-agentmail, @a9i5k4/dsh-ark9canvas, @arcaneorion/dsh-tavily-web, dsh-vision-web, dsh-youreyes, @anionex/dsh-vision-toolkit, @zzerx/dsh-plugin-daily-log, @sakura12/oh-my-deepseekharness, dsh-eteams, dsh-plugin-orchd, @y9931666/dsh-plugin-crossfire, @y9931666/dsh-plugin-roundtable, dsh-cron-panel, dsh-diff-approval, dsh-git-panel, @alpacachen/dsh-simple-worktree, dsh-github-router, dsh-ui-auth, dsh-message-gateway, dsh-messaging-gateway, dsh-auth-tunnel, @benrong/dsh-prompt-polish, @zzerx/dsh-plugin-usage-billing, dsh-api-dashboard, @zzerx/dsh-plugin-memory, @a9i5k4/dsh-auto-memory, dsh-creator-mode-plus, @1e0zj/dsh-plugin-mall
- final2-only（68 筆）：以每列 provenance.report === batch-report-final2.json 判定。
- 32 筆 peerfix 中，31 個 MCP 初始化仍失敗，dsh-armory 因純 DSH UI 不適用；新增 SDK 的匯入測試由主代理另行確認 34 個官方 SDK 均可匯入。

## 審核更正與界線

- `dsh-plugin-adwhispr` 是需 OAuth 的遠端 `npx mcp-remote` 代理。正式連線未執行；原始 ENOENT 啟動嘗試保留於 `originalAttempt`，本次初始化改列 N/A。這是適用性更正，不是啟動修復。
- `HOST_INITIALIZATION_FAILED` 與 `HOST_PLUGIN_INACTIVE` 的未知宿主錯誤列 `other`，保留原 `reportedClassification`；不歸因於來源。
- 安全呼叫失敗的原因碼校正為 `OUTPUT_JSON_UNDEFINED`（3筆）及 `OUTPUT_SCHEMA_VALIDATION`（1筆），不更改測試狀態。
- 純 DSH UI 的 unsupported 列 N/A；沒有 MCP server 或未經審查的來源工具呼叫均不當作成功。
- 初批到目前結果：初始化成功 36→57（21 筆由失敗轉為成功）；失敗 53→31，差額中有 1 筆屬 N/A 分類更正，不算啟動修復。

## 各來源結果與來源版本

| # | 來源 | 來源批次 | 結構 | MCP 初始化 | 來源工具 | 安全呼叫 | 原因碼 |
|---:|---|---|---|---|---|---|---|
| 1 | dsh-plugin-nlbi@0.2.1 | final2 | success | success | success | not-applicable | — |
| 2 | dsh-desktop-uia@1.1.3 | final2 | success | success | success | not-applicable | — |
| 3 | dsh-hdc-bridge@0.10.2 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 4 | dsh-armory@2.1.0 | peerfix | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 5 | dsh-obsidian-board@0.2.5 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 6 | @vfvrpq/dsh-search@0.1.0 | final2 | success | success | success | not-applicable | — |
| 7 | dsh-zspace@0.4.0 | final2 | success | success | success | not-applicable | — |
| 8 | dsh-plugin-veriscope@0.6.0 | peerfix | success | failed | not-applicable | not-applicable | upstream-error/SDK_VERSION_MISMATCH |
| 9 | dsh-plugin-academic-writing@0.3.2 | final2 | success | success | success | failed | other/OUTPUT_JSON_UNDEFINED |
| 10 | dsh-plugin-education@0.3.2 | final2 | success | success | success | failed | other/OUTPUT_JSON_UNDEFINED |
| 11 | dsh-plugin-finance-data@0.3.2 | final2 | success | success | success | success | — |
| 12 | dsh-plugin-translation@0.3.2 | final2 | success | success | success | failed | other/OUTPUT_JSON_UNDEFINED |
| 13 | dsh-computer-use@0.3.1 | final2 | success | success | success | not-applicable | — |
| 14 | dsh-mcp-tunnel@0.1.0 | final2 | success | success | success | not-applicable | — |
| 15 | @czf1995/dsh-waste-market@0.8.2 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 16 | dsh-cua-drive@0.2.1 | final2 | success | success | success | not-applicable | — |
| 17 | dsh-toolbox-web@0.1.29 | peerfix | success | failed | not-applicable | not-applicable | upstream-error/DSH_API_EXPORT_MISSING |
| 18 | dsh-monitor@0.1.1 | final2 | success | success | success | not-applicable | — |
| 19 | @adenxie/dsh-vercel@0.4.0 | final2 | success | success | success | not-applicable | — |
| 20 | dsh-graft-plugin@0.2.1 | final2 | success | success | success | not-applicable | — |
| 21 | dsh-plugin-adwhispr@0.1.0 | final2 | success | not-applicable | not-applicable | not-applicable | EXTERNAL_OAUTH_PROXY_NOT_EXECUTED |
| 22 | dsh-agentmail@0.1.0 | peerfix | success | failed | not-applicable | not-applicable | other/HOST_INITIALIZATION_FAILED |
| 23 | @mtl-academic/dsh-patent@0.1.6-alpha.7 | final2 | success | success | not-applicable | not-applicable | — |
| 24 | @a9i5k4/dsh-ark9canvas@0.4.1 | peerfix | success | failed | not-applicable | not-applicable | upstream-error/CORDIS_INVALID_EFFECT |
| 25 | @a9i5k4/dsh-literature@0.3.6 | final2 | success | success | success | not-applicable | — |
| 26 | dsh-scrape-webpage@1.0.0 | final2 | success | success | success | not-applicable | — |
| 27 | @memef1f1y/dsh-plugin-tavily@0.7.0 | final2 | success | success | success | not-applicable | — |
| 28 | @240xu/dsh-websearch@2.8.8 | final2 | success | success | success | not-applicable | — |
| 29 | dsh-verify@0.9.6 | final2 | success | success | success | not-applicable | — |
| 30 | dsh-read-url@1.9.3 | final2 | success | success | success | not-applicable | — |
| 31 | dsh-moli@1.1.19 | final2 | success | success | success | not-applicable | — |
| 32 | dsh-web-search-firecrawl@0.1.5 | final2 | success | success | success | not-applicable | — |
| 33 | @anweat/dsh-browser@0.2.1 | final2 | success | success | success | not-applicable | — |
| 34 | dsh-web-search-pro@0.2.1 | final2 | success | success | success | not-applicable | — |
| 35 | @arcaneorion/dsh-tavily-web@0.2.2 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 36 | dsh-vision-fallback@0.10.0 | final2 | success | success | not-applicable | not-applicable | — |
| 37 | dsh-vision-proxy-route@0.1.4 | final2 | success | success | not-applicable | not-applicable | — |
| 38 | dsh-image2-tool@0.4.1 | final2 | success | success | success | not-applicable | — |
| 39 | dsh-vision-web@0.1.0 | peerfix | success | failed | not-applicable | not-applicable | upstream-error/DSH_API_EXPORT_MISSING |
| 40 | dsh-youreyes@0.1.0 | peerfix | success | failed | not-applicable | not-applicable | upstream-error/DSH_API_EXPORT_MISSING |
| 41 | dsh-image-conatiner@0.2.3 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 42 | @anionex/dsh-vision-toolkit@0.1.47 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 43 | @lp181818/dsh-vision-plugin@1.2.3 | final2 | success | success | not-applicable | not-applicable | — |
| 44 | @memef1f1y/dsh-plugin-tts@0.6.7 | final2 | success | success | not-applicable | not-applicable | — |
| 45 | @ai-galaxy/dsh-sound@0.4.1 | final2 | success | success | not-applicable | not-applicable | — |
| 46 | dsh-speak@1.8.2 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 47 | dsh-dictation-hotkey@0.3.0 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 48 | @chenjh12/dsh-capmap-viz@0.2.4 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 49 | dsh-client-ui-second-brain@1.0.2 | final2 | success | success | not-applicable | not-applicable | — |
| 50 | dsh-md-studio@1.2.0 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 51 | dsh-consistency-guard@0.1.0 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 52 | @chengzhao-dev/dsh-quarto-book@0.4.3 | final2 | success | success | success | not-applicable | — |
| 53 | @copylee/dsh-office@1.1.3 | final2 | success | success | success | not-applicable | — |
| 54 | @zzerx/dsh-plugin-daily-log@0.4.3 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 55 | @sakura12/oh-my-deepseekharness@0.4.9 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 56 | @banana-peeljj12/dsh-trellis@0.4.2 | final2 | success | success | success | not-applicable | — |
| 57 | dsh-eteams@0.2.22 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 58 | dsh-plugin-orchd@0.1.0 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 59 | @y9931666/dsh-plugin-crossfire@0.1.3 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 60 | @y9931666/dsh-plugin-roundtable@1.0.0-rc.3 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 61 | dsh-cron-panel@0.1.13 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 62 | pstack-dsh@0.2.3 | final2 | success | success | success | not-applicable | — |
| 63 | dsh-schedule-later@0.6.0 | final2 | success | success | success | not-applicable | — |
| 64 | dsh-diff-approval@0.36.1 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 65 | dsh-git-panel@0.1.20 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 66 | @alpacachen/dsh-simple-worktree@1.1.3 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 67 | dsh-github-router@0.4.1 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 68 | dsh-telemetry-redactor@0.1.0 | final2 | success | success | not-applicable | not-applicable | — |
| 69 | dsh-verification-receipt@0.1.0 | final2 | success | success | not-applicable | not-applicable | — |
| 70 | qiushi-dsh-evidence-audit@0.1.0 | final2 | success | success | not-applicable | not-applicable | — |
| 71 | dsh-ui-auth@0.7.1 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 72 | dsh-jev-guard@0.5.7 | final2 | success | success | not-applicable | not-applicable | — |
| 73 | dsh-message-gateway@0.1.35 | peerfix | success | failed | not-applicable | not-applicable | other/HOST_INITIALIZATION_FAILED |
| 74 | dsh-smart-reminder@0.1.29 | final2 | success | success | success | not-applicable | — |
| 75 | dsh-messaging-gateway@0.2.4 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 76 | dsh-notch-focus@0.1.4 | final2 | not-applicable | not-applicable | not-applicable | not-applicable | — |
| 77 | dsh-web-lan-access@1.3.2 | final2 | success | success | not-applicable | not-applicable | — |
| 78 | dsh-auth-tunnel@0.2.0-rc.2 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 79 | dsh-vps@1.16.1 | final2 | success | success | not-applicable | not-applicable | — |
| 80 | @anonyjcy/dsh-j-space@1.2.4 | final2 | success | not-applicable | not-applicable | not-applicable | other/OTHER |
| 81 | @benrong/dsh-prompt-polish@0.2.4 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 82 | @zzerx/dsh-plugin-usage-billing@1.3.0 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 83 | dsh-api-dashboard@1.7.0 | peerfix | success | failed | not-applicable | not-applicable | missing-dependency/SOURCE_DEPENDENCY_MISSING |
| 84 | dsh-tokenrhythm-bill@0.6.1 | final2 | success | success | not-applicable | not-applicable | — |
| 85 | @yolk_vat-y/dsh-project-memory@0.6.3 | final2 | success | success | success | not-applicable | — |
| 86 | @zzerx/dsh-plugin-memory@0.4.3 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 87 | dsh-ledger-memory@1.3.0 | final2 | success | success | success | not-applicable | — |
| 88 | dsh-plugin-focus@1.1.1 | final2 | success | success | success | not-applicable | — |
| 89 | dsh-memory-recall@0.2.0 | final2 | success | success | success | not-applicable | — |
| 90 | @agentscope-ai/reme-dsh-plugin@0.1.2 | final2 | success | success | success | not-applicable | — |
| 91 | @a9i5k4/dsh-auto-memory@3.3.15 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 92 | dsh-wrapup-guard@0.1.0 | final2 | success | success | success | not-applicable | — |
| 93 | mcmodsdevbridge@1.0.3 | final2 | success | success | success | not-applicable | — |
| 94 | dsh-plugin-verify@1.1.1 | final2 | success | success | success | failed | other/OUTPUT_SCHEMA_VALIDATION |
| 95 | dsh-creator-mode-plus@0.3.13 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 96 | @aaronandwork/dsh-evidence-gate@0.2.1 | final2 | success | success | success | not-applicable | — |
| 97 | dsh-agentdebugx@0.1.0 | final2 | success | success | success | not-applicable | — |
| 98 | dsh-win-toolkit@0.1.3 | final2 | success | success | success | not-applicable | — |
| 99 | @1e0zj/dsh-plugin-mall@0.4.17 | peerfix | success | failed | not-applicable | not-applicable | missing-module/HOST_REQUIRED_SERVICE_UNAVAILABLE |
| 100 | dsh-vba-bridge@0.1.1 | final2 | success | success | success | not-applicable | — |

## 來源報告

- final2 完整批次與逐筆原始安全診斷：`batch-report-final2.json`（`recheckResults`）。
- peerfix 子集與逐筆原始安全診斷：`batch-report-peerfix.json`（`recheckResults`）。
- 修正前完整批次：`v040-before-fixes.batch-report.json`。
- 修正前 canonical 快照：`v040-before-canonical.batch-report.json`。

報告不保存原始 worker stdout/stderr；來源錯誤只保存安全原因碼及已遮蔽第一行。
