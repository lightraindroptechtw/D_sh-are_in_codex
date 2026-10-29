# CC → Codex 0.9.3：審查、補寫、市場與下載管理唯讀核對

日期：2026-10-28。此報告只依實際原始碼追查呼叫鏈；沒有啟動插件、模型、網站伺服器或外部服務，也沒有執行第三方插件。報告中的「完整」只表示列出的靜態流程已接通，不能解讀成實機功能通過。

## 核對基準

- CC 根目錄：`<local-workspace>` 的 `d-sh-are-in-cc.installLocation`；本次解析為 `<local-cc-source>`。
- Codex 根目錄：`<local-workspace>`。
- 以下 `CC:`、`Codex:` 都是相對於各自根目錄的檔案與行號。未用其他歷史版本或先前測試結果替代本次讀碼。
- 分類：完整、部分、缺少、平台不適用；另以「設計差異」或「漏接／不足」說明成因。無法由這次靜態核對證明的事情，明確保留。

## 結論

不能稱為整個 CC 流程已完整移植。固定來源審查、主對話領取及提交、補寫準備／完成／套用、使用者同意後安裝、下載清單及來源刪除，皆有真正後端實作；並非只有介面按鈕。但下列項目確實未對齊：

1. CC 以本機型別檔產生的能力摘要，以及目前對話 MCP 伺服器與工具清單，沒有等價地送入 Codex 的初次來源審查。補寫流程只有版本／命令探測加手寫分類摘要。
2. 市場「重新選擇審查範圍」的按鈕傳出的範圍遭後端丟棄；「略過主對話 AI 審查」勾選欄也沒有被後端使用。
3. CC 要求對每個工具確認是否對外發文，並可把修正帶入安裝；Codex 的主對話判斷沒有此結構化修正通道。
4. 補寫結果雖有掃描及固定雜湊，但新掃描沒有合併到正式產物使用的原始 `securityScan`。主對話對補寫內容的判斷也沒有專屬的完成回報／簽章欄位。
5. CC 刪除下載時連帶清理掃描報告與補寫工作目錄；Codex 目前只刪來源與下載收據。市場訊息的多語代碼契約亦未完整保留。

原生 Claude Code 畫面、模型試打與自動開補寫子代理的差異，有明確 Codex 設計說明，不應與上述漏接混稱。

## 逐項對照

| 功能 | CC 證據 | Codex 證據 | 分類及性質 | 使用者影響 |
|---|---|---|---|---|
| 不開市場也能直接指定來源審查／安裝 | `skills/install/SKILL.md:33-53`、`skills/scan/SKILL.md:15-17` | `skills/scan/SKILL.md:6-16`、`skills/install/SKILL.md:6-15`；`lib/market-conversation.mjs:48-66`；`bin/dsh-plugin.mjs:16-23` | 完整：入口及後端都存在；平台適配 | npm、GitHub、本機資料夾可沿同一來源識別續做；尚未實測所有來源格式 |
| 固定來源、不重抓另一版 | `skills/install/SKILL.md:31,47,65,121`；`lib/rewrite.mjs:359-360` | `lib/market-operations.mjs:226-245,270-278,346-350,451-457`；`lib/rewrite.mjs:138-143,180-184` | 完整：靜態鏈完整 | 審查後來源／補寫產物變更會使完整性核對失敗，不以同名最新版替代 |
| 固定掃描原文與 AI 意見分開 | `skills/install/SKILL.md:26-29,49-58` | `skills/scan/SKILL.md:10-13`；`lib/market-operations.mjs:264-268`；`lib/market-conversation.mjs:53-55`；`web/market/app.js:870-882` | 部分；長文呈現是明示設計差異 | 有原始 Markdown／JSON 報告路徑，來源直接審查也保存 CC 掃描表格；但技能允許長報告只連結，沒有保留 CC「整份表格完整貼進對話」的硬性格式 |
| 審查交回主對話並保留覆蓋範圍 | CC 以 `hooks/register.tsx:174-175` 呼叫 install 技能，`skills/install/SKILL.md:71-98` 開唯讀審查子代理 | `lib/cc-market-adapter.mjs:124-127` → `lib/codex-desktop-conversation.mjs:32-41`；`lib/market-conversation.mjs:18-41`；`lib/security-review-engine.mjs:76-92` | 完整：主對話適配鏈存在；設計差異 | 市場完成掃描後派送回開市場的主對話；派送失敗明確標示並提供手動接續。審查沿用主對話模型，不自動啟動額外模型；實際桌面派送本報告未驗證 |
| CC 型別檔產生能力摘要 | `lib/capabilities.mjs:20-32,76-120,127-136`；`skills/install/SKILL.md:68,89-94` | `lib/codex-capabilities.mjs:9-16,23-32`；`lib/market-operations.mjs:324-335` | 部分；等價能力不足 | Codex 只讀 `--version`、`app-server --help`，再回傳固定 skills/MCP/browser/hooks/DSH UI 分類，沒有解析本機協定型別／綱要；不能當完整能力目錄 |
| 初次來源審查取得能力、缺失及目前 MCP 工具 | `skills/install/SKILL.md:65-96` 明列 targets、摘要檔、型別檔、每個目前伺服器及工具 | `lib/market-operations.mjs:247-268`；`lib/market-conversation.mjs:24-31,48-55`；`skills/install/SKILL.md:8-9` | 缺少於初次審查；之後補寫 check 有部分補足；漏接 | 初次主對話只領代表片段、掃描路徑、雜湊及審查估算。要到額外呼叫 rewrite check 才取得固定摘要及 targets；沒有目前伺服器／工具清單可供判斷哪些外部能力已可用 |
| 補寫任務知道現有已轉工具與目前環境工具 | `lib/rewrite.mjs:174-188` 列轉換工具；`skills/rewrite/rewrite-prompt.md:30-31` 指明工具查詢與 `$.mcp.call` | `lib/rewrite.mjs:90,115-124`；`skills/install/references/rewrite.md:6` | 部分；資料不足 | 任務有 targets、授權與固定能力摘要，但沒有 CC task.tools 的等價靜態工具名稱表，也沒有目前工具快照。`allowedMcpServers:['rewrite']` 是新增服務名稱白名單，並非目前對話工具清單；技能文字要求自行核對，不等於後端已接上跨服務呼叫 |
| 每個對外發文工具的確認與安裝修正 | `skills/install/SKILL.md:83,106,123-127` | `lib/security-review.mjs:20`；`lib/security-review-engine.mjs:80-88`；`lib/market-operations.mjs:393-394`；`lib/security-package.mjs:75` | 部分；具體修正通道缺少 | Codex 有固定掃描及發文管制設定，但主對話 judgment 只收 verdict/risk/summary/findings/sourceDigest/coveredFiles；沒有逐工具確認欄或把人工修正傳進安裝的 include/exclude。安裝政策採原掃描；不能聲稱完整保留 CC 審查後修正效果 |
| 審查閱讀量／模型選擇 | `skills/install/SKILL.md:73,83,98` 以唯讀子代理審查並逐工具確認 | `skills/scan/SKILL.md:6,10-13`；`data/security-review-prompt.md:6-15`；`lib/market-conversation.mjs:24-31` | 部分；明示設計差異 | Codex 改為代表片段及主對話，保留已讀／未讀聲明；無法把這種較小閱讀範圍說成已做 CC 原流程相同完整度的程式確認 |
| 人類同意才轉換及安裝，混淆另行明確強制 | `skills/install/SKILL.md:28,58,113-134`；`skills/rewrite/SKILL.md:109-119` | `skills/install/SKILL.md:10-12`；`lib/market-conversation.mjs:57-61`；`lib/cc-market-adapter.mjs:100-102,123`；`lib/market-operations.mjs:270-278,343-350` | 完整：靜態安裝鏈完整；AI 非門檻是設計差異 | 同意與來源識別有明確參數；混淆預設停止，需另一個 force 選項。AI 意見及不可用不再當安裝硬門檻，不能誤寫成 CC 相同判斷政策 |
| 補寫準備與來源隔離 | `skills/rewrite/SKILL.md:66-83`；`lib/rewrite.mjs:157-188` | `lib/market-operations.mjs:318-336`；`lib/rewrite.mjs:88-128` | 完整：靜態準備鏈存在；實作方式已適配 | 可建立來源快照、未安裝預覽、限定可寫位置及任務檔；Codex 不自動啟動指定模型，model/effort 是紀錄，技能明確要求由主對話或明確授權子代理實作 |
| 模型試打與補寫子代理 | `skills/rewrite/SKILL.md:36-39,74-81`；`hooks/rewrite.ts:48-75` | `skills/install/references/rewrite.md:3,7`；`lib/rewrite.mjs:120-123` | 平台適配的明示設計差異；未保留 CC 行為 | 不做試打，避免為能力檢查消耗模型用量；沒有宣稱 model/effort 會切換當前模型。不屬漏接，但不應聲稱與 CC 原流程逐步相同 |
| 補寫完成檢查、格式及能力回報 | `skills/rewrite/SKILL.md:85-105`；`lib/rewrite.mjs:193-231,329-350` | `lib/rewrite.mjs:145-174`；`lib/market-operations.mjs:299-316`；`skills/install/references/rewrite.md:8-10` | 部分；已有掃描，但結果資訊精度降低 | 有完整性檢查、結構驗證、掃描與密封雜湊。CC 結果要求逐項 feature/status/how/why 且檢查總結一致；Codex 只要 implemented/limitations 字串與 conclusion，沒有逐一綁回 targets，不能程式化確認每個缺失都有交代。內層 finish 的 abilitySummary 有產生，但 operations.finish 未直接回傳此欄，須讀 reportPath |
| 補寫碼納入正式審查／權限摘要 | CC `lib/rewrite.mjs:346-350` 產生 abilities/domains，技能 `:103` 要安裝前逐項顯示 | Codex `lib/rewrite.mjs:166-173` 有新掃描；`lib/market-operations.mjs:303-316,356-394,439-446` | 部分；新掃描未合併／意見記錄不足 | 完成時能把代表片段交主對話閱讀，產物雜湊有簽章；但沒有用於補寫內容的 complete-review 識別與意見收據。正式 report.securityScan 又指定為原來源 scan，不包括新掃描。此處只證明資料流不足，未證明發文防護可被繞過 |
| 補寫併入正式插件並保留既有轉換 | CC `lib/install-local.mjs:144-153`；`lib/rewrite.mjs:354-370` | Codex `lib/market-operations.mjs:355-366`；`lib/rewrite.mjs:180-220` | 完整：限定資源與 MCP 宣告的靜態套用鏈 | 先重做正常轉換，再核對來源及補寫雜湊，僅複製允許目錄，保留既有服務與技能註冊並拒絕同名衝突。原來源依賴仍走一般 prepare 流程；這不表示新增補寫依賴會自動備妥 |
| 補寫新增依賴與原生事件 | CC 補寫以原生 register 入口接 hooks：`lib/rewrite.mjs:302-325` | Codex `lib/rewrite.mjs:16,120-124,201-214`；`skills/install/references/rewrite.md:8` | 部分；原生 register 屬平台不適用，hooks 未掛載是明示限制 | Codex 可新增技能／MCP／資源，但 hooks/rewrite 只存檔不掛載；禁止更動原 package.json，也沒有新增補寫依賴的專屬準備路徑。不能將所有 runtime 檔已保存或 MCP 名稱已登記稱為功能可執行 |
| 市場基本資料與各功能路由 | CC `market-web/app.js:438-525,556,699,719,732` → `lib/market-web.mjs:355-389` | Codex `web/market/app.js:58-64,447-535,567,712,732,745` → `lib/market-server.mjs:88-93` → `lib/cc-market-adapter.mjs:105-127` | 完整：靜態前後端路由有接 | 目錄、收藏、下載次數、圖示、自述文件、工作、開資料夾及管理不是空按鈕。Codex 增加存取權杖／CSRF；網頁請求轉到 /api/cc，prepared/review-settings 保留 /api 路徑 |
| 重新選擇審查範圍 | CC 沒有同款範圍按鈕；原流程見 `skills/install/SKILL.md:71-98` | Codex `web/market/app.js:874`、`lib/cc-market-adapter.mjs:123` | 缺少有效行為；明確前後端漏接 | 按鈕送 code/all/none，後端固定 aiScope:none 且 skipAI:true，不採傳入選擇，也不為 review-again 新建派送主對話的 handoff。三個按鈕不能產生其文字宣稱的不同審查範圍 |
| 略過主對話審查勾選欄 | CC 審查與同意政策見 `skills/install/SKILL.md:71-98,113-117` | Codex `web/market/app.js:875-878`、`lib/cc-market-adapter.mjs:123` | 缺少有效行為；明確前後端漏接 | 瀏覽器傳 skipMainReview，後端完全不讀；未勾與勾選效果相同。AI 可選擇略過本身是設計，但此控制沒有實際作用 |
| 下載清單／已下載未安裝篩選及刪除 | CC `lib/downloads.mjs:16-43`；`lib/market-web.mjs:168-192`；`market-web/app.js:168-171,211-215` | Codex `lib/market-downloads.mjs:20-68`；`lib/market-operations.mjs:184-186,191-217`；`lib/cc-market-installed.mjs:25-47,56-62`；`web/market/app.js:176-179,219-223,506-507` | 部分；核心接通，清理範圍不同 | 簽章下載收據、來源路徑／雜湊核對、已安裝排除及刪除都有後端；但只刪 sources 與 downloaded-sources 收據，不刪 scans/reviews/reviewed-sources/rewrites/rewrite-previews/rewrite-records。使用者按刪除後仍留報告與補寫副本 |
| 直接指定本機來源也進下載管理 | CC 本來主要只列 npm；`lib/downloads.mjs:16-25` | Codex `lib/market-operations.mjs:251-263` 將本機 acquired 直接交 review；只有 downloadSource `:211` 呼叫 record | 部分；保留限制／新本機副本未登記 | 本機來源固定副本在市場 sources 中，但 reviewSource 的本機分支沒有寫下載收據；不能透過已下載未安裝清單及 deleteDownloaded 找到這份副本。npm／GitHub 走 downloadSource 則會登記 |
| 工作訊息與錯誤多語顯示 | CC `lib/market-web.mjs:210,275-287,299-308`；`hooks/register.tsx:183,192,386`；`market-web/app.js:65-71` | Codex `web/market/app.js:73-79` 保留翻譯入口；`lib/cc-market-adapter.mjs:88-89,97,102,114,120-127`、`lib/cc-market-installed.mjs:57-77` 大多只給中文 text | 部分；代碼／參數契約未保留 | 原先 msg.*+params 可按介面語言翻譯，Codex 後端多數只回繁中 fallback；9 語介面文字仍在，不代表工作進度及管理結果完整多語。新轉換結果區也含硬編碼中文 `web/market/app.js:850-888` |

## 關鍵資料流與限制

### 能力摘要並未在初次審查自動抵達

Codex 的直接來源路徑是 `review_dsh_plugin → market-conversation.reviewSource → /api/cc/source-review → operations.reviewSource → pending`。`operations.reviewSource` 建立 CC 掃描原文與路徑；`pending` 再從 sourceReview.scan 產生代表片段。這些回傳物件沒有 capabilities、目前 MCP 伺服器／工具清單，或 rewrite targets。

後續 `rewrite_dsh_plugin(check/prepare)` 才呼叫 capabilitySummary。它的資料源是版本與 help 文字，不是型別。即使模型自己看得到當前工具，也不等於補寫產物可在執行時呼叫那些工具，更不等於這個外掛的後端已提供等價 `$.mcp.call`。本報告不把那個等價呼叫能力判成平台不可能；只確認這條能力資料傳遞與使用路徑沒有實作於上述檔案。

### 補寫雜湊綁定做到了，新增程式的審查記錄仍不完整

`finishRewrite` 核對來源、副本、既有檔案與允許變更位置，掃描預覽，固定 artifactHash。operations 把該 artifactHash 放進簽章 rewrite-record；installReviewed 把 rewriteId 帶進 prepare，再用同一 hash 套用。這些是真正資料完整性檢查。

但 operations.finish 回傳 awaiting-main-conversation 只是當次工具結果；它沒有新 reviewId 或 complete 路由。既有 completeConversationReview 只核對原來源的 sourceDigest／scan.files，不能拿新增補寫檔案冒充已審原來源。使用者看過補寫新增能力後的同意由技能要求維持，後端則只接一般 consent:true。這與「已取得新程式的結構化審查意見收據」有差別。

此外，applyRewrite 後 `report.securityScan=scan` 的 scan 仍是來源審查 context 的原掃描。security-package 使用該 report.securityScan 建立 postingTools；本報告未測試實際執行時其他工具分類／攔截，因此不能據此宣稱發文保護被繞過。

### 依賴沒有在套用補寫時被整包丟棄

一般轉換仍先執行，applyRewrite 只加入允許的資源與新增 MCP 宣告；原服務、技能註冊、來源依賴後續準備及簽章收據仍存在。`market-operations.mjs:383-420` 還會整理取得的來源依賴、Python 依賴並做完整性核對。

這不等於補寫者新增任意套件匯入就能工作：rewrite 的可寫範圍不含 package.json，任務亦禁止自行安裝依賴。沒有在本次鏈中看到新增補寫依賴宣告、取得及逐項可用性驗證。需依具體補寫內容另外判斷，不能從合成 fixture 的單一成功推廣到任意插件。

### 市場流程是確實接上，但兩個新增控制沒有作用

頁面 api 函式改寫 `/api/` 為 `/api/cc/`；server 再交給 CC adapter，adapter 最終叫實際 operations，這部分可追到安裝、下載及管理。與此同時，review-again 的 aiScope 被固定覆寫成 none，skipMainReview 未被讀取，屬傳出的欄位沒有被消費，不能用「目前採主對話」一語帶過。

## 可保留的設計差異

- 主對話審查替代 CC 自動啟動唯讀審查子代理；模型與思考強度沿用當前對話，額外模型不得偷偷試打。
- AI 意見採輔助、範圍可限縮、不可用可略過，與 CC 的固定「不建議裝」回報規則不同；這是 Codex 技能／提示已明寫的政策，不是程式忘記阻擋。
- Claude Code 的原生 register.tsx、側欄及輸入框不能原樣掛入 Codex；改成技能、MCP 或獨立網頁是合理適配，但要對每個原功能說明完成及限制。
- hooks/rewrite 不自動接原生事件是明寫限制。將它稱為仍待完成才準確，不能把檔案存在當掛鉤已工作。

## 本次未證明的事項

- 沒有實際按市場按鈕、開瀏覽器、呼叫第三方工具、安裝插件或送出任何對外訊息。
- 沒有驗證所有 npm/GitHub／多套件倉庫、模型可用性、動態 MCP 清單或實際桌面對話派送。
- 沒有以自建測試通過取代完整功能核對。本報告列出的程式鏈完整度，與實際插件在使用者環境能否完成全部功能，是兩個不同結論。
- 「新掃描未合併」、「範圍欄位被覆寫」、「略過欄位未讀取」、「刪除未含報告／補寫」、「訊息代碼未傳遞」均是本次讀碼可直接確認；任何安全繞過、實機錯誤率或實際用量後果都未在本報告宣稱已實測。
