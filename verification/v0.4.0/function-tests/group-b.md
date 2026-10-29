# 後半批來源功能驗證

17 個來源已審核：13 個來源的所選安全情境通過，4 個來源受外部服務或執行範圍限制。44/44 個內容斷言案例通過；**不代表 13 個插件全部功能正常** 。

本輪新生成套件使用 strict（嚴格輸出）預設；核心雜湊前後一致：`920b441761f57189629bc6e7bba16dc03979d5f83954344f5a699e8e1039c816`。

| # | 來源 | 結果 | 案例 | 實際覆蓋範圍 |
|---:|---|---|---:|---|
| 52 | @chengzhao-dev/dsh-quarto-book | passed-selected-scenarios | 2/2 | receipt-formatter-only |
| 53 | @copylee/dsh-office | blocked | 0/0 | Primary document operations require helper execution and active user Office documents; excluded by this test authorization. |
| 56 | @banana-peeljj12/dsh-trellis | passed-selected-scenarios | 5/5 | primary-local-task-workflow |
| 62 | pstack-dsh | passed-selected-scenarios | 1/1 | routing-config-read-only |
| 63 | dsh-schedule-later | passed-selected-scenarios | 4/4 | primary-local-queue-no-delivery |
| 74 | dsh-smart-reminder | passed-selected-scenarios | 5/5 | primary-local-reminder-storage |
| 85 | @yolk_vat-y/dsh-project-memory | passed-selected-scenarios | 3/3 | primary-local-memory-write-search |
| 87 | dsh-ledger-memory | passed-selected-scenarios | 4/4 | primary-local-ledger-write-read |
| 88 | dsh-plugin-focus | passed-selected-scenarios | 6/6 | primary-local-focus-board |
| 89 | dsh-memory-recall | passed-selected-scenarios | 7/7 | primary-local-memory-crud |
| 90 | @agentscope-ai/reme-dsh-plugin | blocked | 0/0 | Primary search requires an external service and may require credentials/models; no remote call or fake response used. |
| 92 | dsh-wrapup-guard | passed-selected-scenarios | 3/3 | state-machine-no-command-or-notification |
| 93 | mcmodsdevbridge | passed-selected-scenarios | 1/1 | scenario-discovery-no-gameplay |
| 96 | @aaronandwork/dsh-evidence-gate | passed-selected-scenarios | 2/2 | claim-classification-only |
| 97 | dsh-agentdebugx | passed-selected-scenarios | 1/1 | saved-session-search-only |
| 98 | dsh-win-toolkit | blocked | 0/0 | Primary tools require external command execution, system clipboard, notification or network; excluded. No user/system content inspected. |
| 100 | dsh-vba-bridge | blocked | 0/0 | Primary VBA actions require Python/Office bridge execution and documents; excluded. No active workbook/application inspected. |

主要本機功能已涵蓋：Trellis 任務建立、階段更新與衝突拒絕；排程佇列建立、列出與取消；提醒事項新增、完成、刪除；專案經驗記憶寫入與檢索；台帳初始化、寫入及讀回；Focus 看板 set/get/append/summary/clear；記憶新增、修改、讀取、刪除及失敗批次原子性。

Focus 清除後直接讀取看板、封存檔與 bridge-plugin-events/*.jsonl，確認三筆 plugin:focus/write 自訂紀錄（set、append、clear）及同一橋接識別碼。這是本機插件紀錄，沒有寫入 Codex 對話或重播原生事件。

較小範圍的通過：Quarto 僅回執格式與驗參；pstack 僅合成路由設定讀取；收尾哨兵僅未完成問題狀態機；Minecraft 僅合成場景清單；實證門僅證據分類；AgentDebugX 僅合成已存會話搜尋。

未驗證：模型呼叫、到期訊息傳送、原生通知、真實外部搜尋、網頁或 Office/VBA 操作、遊戲執行，以及完整 UI／原生代理生命週期。Office、ReMe、Windows toolkit、VBA 的主要功能列為 blocked，未呼叫。

所有輸入與狀態位於專屬暫存目錄，未繼承秘密環境變數。排程僅建立隔日合成項目，取消後實際佇列為空；未傳送訊息。來源證據檔、原生成包設定及本輪執行資產雜湊均核對。

目前結果見 group-b.json；可重現驅動為 group-b.mjs --new-core --report=group-b-final-strict，再執行 group-b-finalize.mjs。原批次套件結果保留在 group-b-baseline.json，初期設定錯誤與核心變動中的輪次另列歷史檔案，不混入本輪成績。
