# 後半批來源功能驗證

本批 17/17 個來源；已完成。只對合成資料做內容斷言；通過不代表全部插件功能相容。

| # | 來源 | 結果 | 斷言通過/總數 | 驗證功能或阻礙 |
|---:|---|---|---:|---|
| 52 | @chengzhao-dev/dsh-quarto-book | passed-selected-scenarios | 2/2 | quarto_pass_report execute calls the pure buildPassReport formatter with closed enums and matching edit totals. render_check can spawn Quarto/Python. |
| 53 | @copylee/dsh-office | blocked | 0/0 | Primary document operations require helper execution and active user Office documents; excluded by this test authorization. |
| 56 | @banana-peeljj12/dsh-trellis | passed-selected-scenarios | 5/5 | trellis_task_create validates args then createTaskRecord writes task.json/templates/runtime pointers through ctx.fs. trellis_state reads pointers/task and resolves workflow phase. |
| 62 | pstack-dsh | passed-selected-scenarios | 1/1 | pstack_overlay_read reads/validates $DSH_HOME/pstack-dsh.json. catalog/overlay_write enumerate configured routes; pstack_spawn invokes model subagents. |
| 63 | dsh-schedule-later | passed-selected-scenarios | 4/4 | schedule_message checks chat identity, content/time bounds, then persists a scheduler task; list/cancel scope by agent.id. A synthetic next-day task is persisted but never allowed to reach due time; queue is cleared after host shutdown. |
| 74 | dsh-smart-reminder | passed-selected-scenarios | 5/5 | set_reminder parses dueTime and writes ReminderStore; list/cancel/complete operate on that store. Scheduler notification/push paths are avoided using year 2099 and deleting synthetic reminders before close. |
| 85 | @yolk_vat-y/dsh-project-memory | passed-selected-scenarios | 3/3 | remember saves experience through ProjectMemoryStore/GlobalStore; query_memory uses lexical recall when llmQueryExpansion=false and no vectorDir. All files/root/global path point at synthetic workspace. |
| 87 | dsh-ledger-memory | passed-selected-scenarios | 4/4 | ledger_init registers caller-designed paths and initial contents; gitInit/gitignore/autoGitAdd=false avoid command paths. ledger_write/read operate on synthetic ledger files. |
| 88 | dsh-plugin-focus | passed-selected-scenarios | 6/6 | focus execute reads exec.agent.session.header.cwd, then resolves workspace-owned file through ctx.fs, applies tagged entries, writes and summarizes board. |
| 89 | dsh-memory-recall | passed-selected-scenarios | 7/7 | memory tool dispatches add/replace/remove/read to MemoryStore. config.dir is isolated and recall=false disables historical-session search. |
| 90 | @agentscope-ai/reme-dsh-plugin | blocked | 0/0 | Primary search requires an external service and may require credentials/models; no remote call or fake response used. |
| 92 | dsh-wrapup-guard | passed-selected-scenarios | 3/3 | wrapup_check start/status/report/abort update a local state machine. check executes project commands and completion may notify. Only start, unresolved-problem report and abort selected, no completion or command invocation. |
| 93 | mcmodsdevbridge | passed-selected-scenarios | 1/1 | mcdev_scenarios reads scenarios/*.json and formats name/description/step counts; mcdev_devrun spawns game/build orchestration and is blocked. |
| 96 | @aaronandwork/dsh-evidence-gate | passed-selected-scenarios | 2/2 | evidence_gate_switch reads per-session identity and toggles persisted state; evidence_gate classifies evidence and checks local durable index, with no network fetch. |
| 97 | dsh-agentdebugx | passed-selected-scenarios | 1/1 | agentdebug_list_sessions deterministically reads only configured sessions root; diagnoses/capabilities invoke PythonBridge/dashboard and are excluded. |
| 98 | dsh-win-toolkit | blocked | 0/0 | Primary tools require external command execution, system clipboard, notification or network; excluded. No user/system content inspected. |
| 100 | dsh-vba-bridge | blocked | 0/0 | Primary VBA actions require Python/Office bridge execution and documents; excluded. No active workbook/application inspected. |

所有套件均複製到專屬暫存目錄；依賴目錄以唯讀用途的目錄連結重用。未改原批次套件、來源或使用者 HOME。未呼叫模型、付費 API、發送訊息、外部服務或任意命令工具。

各來源參數、預期、實際回傳、斷言與未驗證限制見 group-b.json。成功只指所列合成情境，不可推論整個插件正常。
