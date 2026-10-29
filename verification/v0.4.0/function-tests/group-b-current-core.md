# 後半批來源功能驗證

本批 4/4 個來源；已完成。只對合成資料做內容斷言；通過不代表全部插件功能相容。

| # | 來源 | 結果 | 斷言通過/總數 | 驗證功能或阻礙 |
|---:|---|---|---:|---|
| 56 | @banana-peeljj12/dsh-trellis | passed-selected-scenarios | 2/2 | trellis_task_create validates args then createTaskRecord writes task.json/templates/runtime pointers through ctx.fs. trellis_state reads pointers/task and resolves workflow phase. |
| 88 | dsh-plugin-focus | failed | 2/4 | focus execute reads exec.agent.session.header.cwd, then resolves workspace-owned file through ctx.fs, applies tagged entries, writes and summarizes board. |
| 92 | dsh-wrapup-guard | passed-selected-scenarios | 3/3 | wrapup_check start/status/report/abort update a local state machine. check executes project commands and completion may notify. Only start, unresolved-problem report and abort selected, no completion or command invocation. |
| 96 | @aaronandwork/dsh-evidence-gate | passed-selected-scenarios | 2/2 | evidence_gate_switch reads per-session identity and toggles persisted state; evidence_gate classifies evidence and checks local durable index, with no network fetch. |

所有套件均複製到專屬暫存目錄；依賴目錄以唯讀用途的目錄連結重用。未改原批次套件、來源或使用者 HOME。未呼叫模型、付費 API、發送訊息、外部服務或任意命令工具。

各來源參數、預期、實際回傳、斷言與未驗證限制見 group-b.json。成功只指所列合成情境，不可推論整個插件正常。
