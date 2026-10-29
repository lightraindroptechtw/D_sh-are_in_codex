# DSH 原插件功能實測

執行日期：2026-10-23（Asia/Taipei）

## 結果

我用最新版 `outputs/dsh-to-codex/lib/dsh-host.mjs` 啟動 npm 封存中的原插件入口，並經實際 `@deepseek-ai/dsh-tools` 登錄器呼叫工具。9個已核准的合成輸入分支中，1個通過、8個在輸出驗證時失敗。沒有直接呼叫抽出的 helper 來冒稱原插件通過，也沒有改寫或繞過輸出驗證。

唯一通過的是 `finance_data` 的 `ratio`：輸入 `action=ratio, type=pe, price=50, eps=5`，工具回傳 `value=10`、`text="pe = 10.00"`，並通過 DSH 的輸出檢查。

另外8個分支都進入了原插件 execute；DSH 回報 `returned invalid output: value is not lossless JSON`。原因可從來源回傳物確認：插件回傳的物件包含值為 `undefined` 的選填欄位，而真實 DSH 登錄器要求結果是可無損 JSON。例子包括 finance 的 `format` 回傳 `value`、`values` 未設定；education 與 translation 每個 action 都回傳多個與該 action 無關、未設定的選填欄位。失敗原文及每筆輸入、預期斷言都保存在 `functional-results/functional-results.json`。

這是原插件與目前 DSH 工具輸出驗證的實際不相容訊號。沒有移除 `undefined` 欄位、略過 DSH schema/output validation 或修補上游原始碼。

## 初始化與政策檢查

執行前完整讀過三個 Cordis 入口、它們引用的純計算/文字 helper，以及實際 DSH 工具登錄器的前置與後置政策路徑。finance 和 education 的 `apply` 只註冊工具及 system prompt 區段；translation 也只做這兩類註冊，並要求 fs 服務注入。它的 fs 呼叫只出現在記憶、詞彙表與語氣保存/讀取 action；本次只選取 `segment`、`check`、`glossary`，沒有進入那些分支。

DSH 登錄器的 `tools/pre-execute` 無插件 hook，因而採用預設 allow；`tools/post-execute` 無插件 hook，採用預設 accept。通過這兩階段後，DSH 仍會對工具回傳值執行 lossless JSON 快照驗證；8個失敗就是在此輸出檢查被拒。這不是 pre-execute 權限拒絕。

每個插件以空 config 啟動在獨立 host 子程序中，使用獨立 state、HOME、Codex home 和合成 workspace。finance/education 只掛工具與 system prompt；translation 另外掛本機 fs 服務。沒有掛載 LLM/model、網頁伺服器、命令、timer 或登入服務；宿主也沒有傳入模型金鑰或一般使用者環境變數。三個 workspace 在所有呼叫後都保持空目錄。沒有模型、網路工具 action、登入或外部訊息呼叫。這個子程序不是 OS 級的網路/檔案沙箱，因此安全界線依賴已讀過的初始化與這9個不含外部 I/O 的 action 分支，不能解讀成已封鎖任意程式的網路或檔案存取。

## 固定來源與執行版本

原始發佈封存與固定資訊如下；每筆來源 SHA、npm URL、註冊工具 schema、完整原始回傳及 workspace 結果均在 `functional-results/` JSON 中。

| 插件 | npm 版本 | DSH 工具 | 註冊結果 |
| --- | --- | --- | --- |
| `dsh-plugin-finance-data` | `0.3.2` | `finance_data` | active |
| `dsh-plugin-education` | `0.3.2` | `edu_kit` | active |
| `dsh-plugin-translation` | `0.3.2` | `translate_kit` | active |

宿主版本：Cordis `4.0.5`；`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-app-boot` 均為 `0.2.1-rc.2`。Node.js `v24.16.0`。

## 來源位置

- finance execute 回傳物：[lib/index.js](../dsh-corpus-100/sources/dsh-plugin-finance-data_0.3.2/lib/index.js) 第116–185行；純函式位於同套件 `lib/finance.js`。
- education execute 回傳物：[lib/index.js](../dsh-corpus-100/sources/dsh-plugin-education_0.3.2/lib/index.js) 第116–159行；純函式位於同套件 `lib/education.js`。
- translation execute 回傳物：[lib/index.js](../dsh-corpus-100/sources/dsh-plugin-translation_0.3.2/lib/index.js) 第126–223行；純函式位於同套件 `lib/translation.js`。
- DSH 輸出快照驗證：[dsh-tools/lib/index.js](../../outputs/dsh-to-codex/node_modules/@deepseek-ai/dsh-tools/lib/index.js) 第3321、3600、3638行。

首次執行測試包裝時曾漏把 `action` 合併進 arguments，真實 DSH schema 因缺少必要欄位在 execute 前拒絕；修正後重新以獨立 state 執行9個分支。這個包裝錯誤不計入9項功能結果，過程記於 `attempt-notes.md`。
