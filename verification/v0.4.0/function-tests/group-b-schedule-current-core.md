# 後半批來源功能驗證

本批 1/1 個來源；已完成。只對合成資料做內容斷言；通過不代表全部插件功能相容。

| # | 來源 | 結果 | 斷言通過/總數 | 驗證功能或阻礙 |
|---:|---|---|---:|---|
| 63 | dsh-schedule-later | passed-selected-scenarios | 4/4 | schedule_message checks chat identity, content/time bounds, then persists a scheduler task; list/cancel scope by agent.id. A synthetic next-day task is persisted but never allowed to reach due time; queue is cleared after host shutdown. |

所有套件均複製到專屬暫存目錄；依賴目錄以唯讀用途的目錄連結重用。未改原批次套件、來源或使用者 HOME。未呼叫模型、付費 API、發送訊息、外部服務或任意命令工具。

各來源參數、預期、實際回傳、斷言與未驗證限制見 group-b.json。成功只指所列合成情境，不可推論整個插件正常。
