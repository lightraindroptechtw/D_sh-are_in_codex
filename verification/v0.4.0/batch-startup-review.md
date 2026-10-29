# 0.4.0 批次啟動待同意清單

目前未啟動。下列是將要執行的全部100個固定來源；不只做靜態分析。

1. 逐一測試這100個固定版本；原始碼雜湊記錄於清單。
2. 使用獨立狀態與暫存工作目錄，不傳送任何金鑰或登入資料。
3. 依賴只裝正式套件，npm --ignore-scripts --omit=dev，不執行安裝腳本。
4. 初始化會執行第三方程式；這是程序隔離，並非限制檔案與網路的安全沙箱。
5. 安全工具只選合成輸入的唯讀或本機運算；不得登入、發訊息、呼叫模型、付費服務或寫入使用者檔案。
6. 無合適工具則記為無安全測試項目；不當成成功或失敗。
7. 不核准任何操作、不開背景常駐、不修改Codex信任設定。
8. 分別記錄結構、初始化、列工具、安全呼叫四層結果；失敗照規劃分類。

| # | 套件 | 版本 | 原始碼 |
|---|---|---|---|
| 1 | dsh-plugin-nlbi | 0.2.1 | [倉庫](https://github.com/1byteone/dsh-plugin-nlbi) |
| 2 | dsh-desktop-uia | 1.1.3 | [倉庫](https://github.com/1jiegejiayouxuewangan1/dsh-desktop-uia) |
| 3 | dsh-hdc-bridge | 0.10.2 | [倉庫](https://github.com/1na-ko/dsh-hdc-bridge) |
| 4 | dsh-armory | 2.1.0 | [倉庫](https://github.com/2026heshao/dsh-armory) |
| 5 | dsh-obsidian-board | 0.2.5 | [倉庫](https://github.com/2026heshao/dsh-obsidian-board) |
| 6 | @vfvrpq/dsh-search | 0.1.0 | [倉庫](https://github.com/439436269-ctrl/dsh-search) |
| 7 | dsh-zspace | 0.4.0 | [倉庫](https://github.com/439436269-ctrl/dsh-zspace) |
| 8 | dsh-plugin-veriscope | 0.6.0 | [倉庫](https://github.com/4444wjt/dsh-plugin-veriscope) |
| 9 | dsh-plugin-academic-writing | 0.3.2 | [倉庫](https://github.com/863683348/dsh-plugin-academic-writing) |
| 10 | dsh-plugin-education | 0.3.2 | [倉庫](https://github.com/863683348/dsh-plugin-education) |
| 11 | dsh-plugin-finance-data | 0.3.2 | [倉庫](https://github.com/863683348/dsh-plugin-finance-data) |
| 12 | dsh-plugin-translation | 0.3.2 | [倉庫](https://github.com/863683348/dsh-plugin-translation) |
| 13 | dsh-computer-use | 0.3.1 | [倉庫](https://github.com/988hj7tczd-oss/dsh-computer-use) |
| 14 | dsh-mcp-tunnel | 0.1.0 | [倉庫](https://github.com/988hj7tczd-oss/dsh-mcp-tunnel) |
| 15 | @czf1995/dsh-waste-market | 0.8.2 | [倉庫](https://github.com/a23842/dsh-waste-market) |
| 16 | dsh-cua-drive | 0.2.1 | [倉庫](https://github.com/aa2246740/dsh-cuadrive-mac) |
| 17 | dsh-toolbox-web | 0.1.29 | [倉庫](https://github.com/AbcdefgXW/dsh-toolbox-web) |
| 18 | dsh-monitor | 0.1.1 | [倉庫](https://github.com/AbnerAI/dsh-monitor) |
| 19 | @adenxie/dsh-vercel | 0.4.0 | [倉庫](https://github.com/AdenXie/dsh-vercel) |
| 20 | dsh-graft-plugin | 0.2.1 | [倉庫](https://github.com/adithyanraj03/dsh-graft-plugin) |
| 21 | dsh-plugin-adwhispr | 0.1.0 | [倉庫](https://github.com/adwhispr/dsh-plugin-adwhispr) |
| 22 | dsh-agentmail | 0.1.0 | [倉庫](https://github.com/agentmail-to/dsh-agentmail) |
| 23 | @mtl-academic/dsh-patent | 0.1.6-alpha.7 | [倉庫](https://github.com/ai-tools-mtl/Aurify) |
| 24 | @a9i5k4/dsh-ark9canvas | 0.4.1 | [倉庫](https://github.com/Aik358/dsh-ark9canvas) |
| 25 | @a9i5k4/dsh-literature | 0.3.6 | [倉庫](https://github.com/Aik358/dsh-literature) |
| 26 | dsh-scrape-webpage | 1.0.0 | [倉庫](https://github.com/131CDA1/dsh-scrape-webpage) |
| 27 | @memef1f1y/dsh-plugin-tavily | 0.7.0 | [倉庫](https://github.com/1624318455/dsh-plugin-tavily) |
| 28 | @240xu/dsh-websearch | 2.8.8 | [倉庫](https://github.com/240xu/dsh-websearch) |
| 29 | dsh-verify | 0.9.6 | [倉庫](https://github.com/263311487-ux/dsh-verify) |
| 30 | dsh-read-url | 1.9.3 | [倉庫](https://github.com/2672243194/dsh-read-url) |
| 31 | dsh-moli | 1.1.19 | [倉庫](https://github.com/27painter/dsh-moli) |
| 32 | dsh-web-search-firecrawl | 0.1.5 | [倉庫](https://github.com/aa2246740/dsh-firecrawl) |
| 33 | @anweat/dsh-browser | 0.2.1 | [倉庫](https://github.com/anweat/dsh-browser) |
| 34 | dsh-web-search-pro | 0.2.1 | [倉庫](https://github.com/anweat/dsh-web-search-pro) |
| 35 | @arcaneorion/dsh-tavily-web | 0.2.2 | [倉庫](https://github.com/ArcaneOrion/dsh-tavily-web) |
| 36 | dsh-vision-fallback | 0.10.0 | [倉庫](https://github.com/1HelloMan1/dsh-vision-fallback) |
| 37 | dsh-vision-proxy-route | 0.1.4 | [倉庫](https://github.com/314857493/dsh-vision) |
| 38 | dsh-image2-tool | 0.4.1 | [倉庫](https://github.com/544244857/dsh-image2-plugin) |
| 39 | dsh-vision-web | 0.1.0 | [倉庫](https://github.com/54xkeee/dsh-vision) |
| 40 | dsh-youreyes | 0.1.0 | [倉庫](https://github.com/54xkeee/dsh-youreyes) |
| 41 | dsh-image-conatiner | 0.2.3 | [倉庫](https://github.com/aa2246740/dsh-image-conatiner) |
| 42 | @anionex/dsh-vision-toolkit | 0.1.47 | [倉庫](https://github.com/Anionex/dsh-vision-toolkit) |
| 43 | @lp181818/dsh-vision-plugin | 1.2.3 | [倉庫](https://github.com/bug-huntter/dsh-vision-plugin) |
| 44 | @memef1f1y/dsh-plugin-tts | 0.6.7 | [倉庫](https://github.com/1624318455/dsh-plugin-tts) |
| 45 | @ai-galaxy/dsh-sound | 0.4.1 | [倉庫](https://github.com/AI-Galaxy-GPU/dsh-sound) |
| 46 | dsh-speak | 1.8.2 | [倉庫](https://github.com/Alan2Z/dsh-speak) |
| 47 | dsh-dictation-hotkey | 0.3.0 | [倉庫](https://github.com/AndyYang12345/dsh-dictation-hotkey) |
| 48 | @chenjh12/dsh-capmap-viz | 0.2.4 | [倉庫](https://github.com/1741505640/capmap-skills) |
| 49 | dsh-client-ui-second-brain | 1.0.2 | [倉庫](https://github.com/aduo-111/second-brain) |
| 50 | dsh-md-studio | 1.2.0 | [倉庫](https://github.com/BioAIEvolu/dsh-md-studio) |
| 51 | dsh-consistency-guard | 0.1.0 | [倉庫](https://github.com/bycall/dsh-consistency-guard) |
| 52 | @chengzhao-dev/dsh-quarto-book | 0.4.3 | [倉庫](https://github.com/chengzhao-dev/dsh-quarto-book) |
| 53 | @copylee/dsh-office | 1.1.3 | [倉庫](https://github.com/copylee711/dsh-office) |
| 54 | @zzerx/dsh-plugin-daily-log | 0.4.3 | [倉庫](https://github.com/0x7A7A6572/dsh-forge-studio) |
| 55 | @sakura12/oh-my-deepseekharness | 0.4.9 | [倉庫](https://github.com/1225Sakura/oh-my-deepseekharness) |
| 56 | @banana-peeljj12/dsh-trellis | 0.4.2 | [倉庫](https://github.com/1264459640/dsh-trellis) |
| 57 | dsh-eteams | 0.2.22 | [倉庫](https://github.com/2507483326/dsh-eteams) |
| 58 | dsh-plugin-orchd | 0.1.0 | [倉庫](https://github.com/7bder/dsh-plugin-orchd) |
| 59 | @y9931666/dsh-plugin-crossfire | 0.1.3 | [倉庫](https://github.com/9931666/dsh-plugin-crossfire) |
| 60 | @y9931666/dsh-plugin-roundtable | 1.0.0-rc.3 | [倉庫](https://github.com/9931666/dsh-plugin-roundtable) |
| 61 | dsh-cron-panel | 0.1.13 | [倉庫](https://github.com/a792883583/dsh-cron-panel) |
| 62 | pstack-dsh | 0.2.3 | [倉庫](https://github.com/aa2246740/pstack-dsh) |
| 63 | dsh-schedule-later | 0.6.0 | [倉庫](https://github.com/adithyanraj03/dsh-schedule-later) |
| 64 | dsh-diff-approval | 0.36.1 | [倉庫](https://github.com/9087/dsh-diff-approval) |
| 65 | dsh-git-panel | 0.1.20 | [倉庫](https://github.com/a792883583/dsh-git-panel) |
| 66 | @alpacachen/dsh-simple-worktree | 1.1.3 | [倉庫](https://github.com/alpacachen/dsh-worktree) |
| 67 | dsh-github-router | 0.4.1 | [倉庫](https://github.com/AngelosZou/dsh-github-router) |
| 68 | dsh-telemetry-redactor | 0.1.0 | [倉庫](https://github.com/030611/dsh-telemetry-redactor) |
| 69 | dsh-verification-receipt | 0.1.0 | [倉庫](https://github.com/030611/dsh-verification-receipt) |
| 70 | qiushi-dsh-evidence-audit | 0.1.0 | [倉庫](https://github.com/030611/qiushi-dsh-evidence-audit) |
| 71 | dsh-ui-auth | 0.7.1 | [倉庫](https://github.com/0QwQ0/dsh-ui-auth) |
| 72 | dsh-jev-guard | 0.5.7 | [倉庫](https://github.com/7starsseeker/dsh-jev-guard) |
| 73 | dsh-message-gateway | 0.1.35 | [倉庫](https://github.com/a792883583/dsh-message-gateway) |
| 74 | dsh-smart-reminder | 0.1.29 | [倉庫](https://github.com/a792883583/dsh-smart-reminder) |
| 75 | dsh-messaging-gateway | 0.2.4 | [倉庫](https://github.com/aa2246740/dsh-gateway) |
| 76 | dsh-notch-focus | 0.1.4 | [倉庫](https://github.com/aa2246740/dsh-notch) |
| 77 | dsh-web-lan-access | 1.3.2 | [倉庫](https://github.com/AcidGr/dsh-web-lan-access) |
| 78 | dsh-auth-tunnel | 0.2.0-rc.2 | [倉庫](https://github.com/ai-eks/dsh-auth-tunnel) |
| 79 | dsh-vps | 1.16.1 | [倉庫](https://github.com/AIcivilization/dsh-vps) |
| 80 | @anonyjcy/dsh-j-space | 1.2.4 | [倉庫](https://github.com/AnonyJcy/dsh-j-space) |
| 81 | @benrong/dsh-prompt-polish | 0.2.4 | [倉庫](https://github.com/benrong2048-boop/dsh-prompt-polish) |
| 82 | @zzerx/dsh-plugin-usage-billing | 1.3.0 | [倉庫](https://github.com/0x7A7A6572/dsh-forge-studio) |
| 83 | dsh-api-dashboard | 1.7.0 | [倉庫](https://github.com/133563825as-ai/dsh-api-dashboard) |
| 84 | dsh-tokenrhythm-bill | 0.6.1 | [倉庫](https://github.com/162568316/dsh-tokenrhythm-bill) |
| 85 | @yolk_vat-y/dsh-project-memory | 0.6.3 | [倉庫](https://github.com/00080000/dsh-project-memory) |
| 86 | @zzerx/dsh-plugin-memory | 0.4.3 | [倉庫](https://github.com/0x7A7A6572/dsh-forge-studio) |
| 87 | dsh-ledger-memory | 1.3.0 | [倉庫](https://github.com/18477514055/dsh-ledger-memory) |
| 88 | dsh-plugin-focus | 1.1.1 | [倉庫](https://github.com/863683348/dsh-plugin-focus) |
| 89 | dsh-memory-recall | 0.2.0 | [倉庫](https://github.com/adithyanraj03/dsh-memory-recall) |
| 90 | @agentscope-ai/reme-dsh-plugin | 0.1.2 | [倉庫](https://github.com/agentscope-ai/ReMe) |
| 91 | @a9i5k4/dsh-auto-memory | 3.3.15 | [倉庫](https://github.com/Aik358/dsh-auto-memory) |
| 92 | dsh-wrapup-guard | 0.1.0 | [倉庫](https://github.com/566001/dsh-wrapup-guard) |
| 93 | mcmodsdevbridge | 1.0.3 | [倉庫](https://github.com/7starsseeker/MCModsDevBridge) |
| 94 | dsh-plugin-verify | 1.1.1 | [倉庫](https://github.com/863683348/dsh-plugin-verify) |
| 95 | dsh-creator-mode-plus | 0.3.13 | [倉庫](https://github.com/aa2246740/dsh-creator-mode-plus) |
| 96 | @aaronandwork/dsh-evidence-gate | 0.2.1 | [倉庫](https://github.com/AaronandWork/dsh-evidence-gate) |
| 97 | dsh-agentdebugx | 0.1.0 | [倉庫](https://github.com/AgentDebugX/AgentDebugX) |
| 98 | dsh-win-toolkit | 0.1.3 | [倉庫](https://github.com/Edge-Echo/dsh-win-toolkit) |
| 99 | @1e0zj/dsh-plugin-mall | 0.4.17 | [倉庫](https://github.com/1e0zj/dsh-plugin-mall) |
| 100 | dsh-vba-bridge | 0.1.1 | [倉庫](https://github.com/alexltr/dsh-vba-bridge) |

完整路徑與SHA-256見相鄰JSON清單。
