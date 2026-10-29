# 新增語料安全功能實測補充

執行日期：2026-10-23（Asia/Taipei）

## 新增實測

本輪只找到一個新插件符合「可隔離啟動、只選本機合成輸入、初始化不觸發外部服務」的條件：`dsh-plugin-verify@1.1.1`。我用其 npm 封存原始入口 `lib/index.js`，經目前 `outputs/dsh-to-codex/lib/dsh-host.mjs` 載入，再用真實 DSH `verify` 工具登錄器呼叫四次 `config` action。四份合成檔案分別是有效 JSON、語法錯誤 JSON、有效 YAML smoke input、引號未閉合 YAML。沒有呼叫同插件的 `url`、`npm`、`repo` 或 `batch` 網路分支，也沒有呼叫模型。

四次 action 都進入插件 execute，但四次都被官方工具輸出驗證拒絕，結果為 **0/4 通過**。實際錯誤指出 `value.summary.format`、`depth`、`note` 是未宣告欄位。插件在 [lib/index.js](../dsh-corpus-100/sources/dsh-plugin-verify_1.1.1/lib/index.js) 第 167–175 行把輸出 schema 的 `summary` 設為 `additionalProperties: false`，卻沒有列出任何 summary 子欄位；同檔第 265–276 行的 config 分支會回傳 `summary.format`，有效 JSON/YAML 還會回傳 `depth`（YAML 另有 `note`）。原始 host 回傳及每個合成輸入、預期值均在 [extra-verify-config.json](functional-results/extra-verify-config.json)。我沒有改插件輸出或放寬官方驗證。

## 候選審查與取捨

| 新語料候選 | 靜態結果 | 本輪決定 |
| --- | --- | --- |
| `dsh-plugin-verify@1.1.1` | 初始化註冊工具並掛上 prompt 區段；config 分支只透過 `ctx.fs` 解析及讀取目標檔案。沒有初始化網路呼叫或插件政策 hook。輸出 schema 與 config 的實際回傳欄位不相容。 | 安全地用 4 個合成 config 輸入實測；均在官方 output schema 驗證失敗。 |
| `dsh-plugin-academic-writing@0.3.2` | 純文字/計算工具，但入口每次都回傳 `{ action, text, issues, passed, items }`，不同 action 會令其中數個欄位保持 `undefined`（`lib/index.js:185`）。本專案前一輪真實 DSH 測試已證明此類值會被 lossless JSON 拒絕。 | 只做靜態篩選，沒有重跑可預知的輸出驗證失敗。 |
| `dsh-graft-plugin@0.2.1` | 初始化路徑包含對 DSH_HOME 持久儲存的讀取/寫入 plumbing、auto-sync 管理及外部 `graft` 子程序啟動能力；入口呼叫 `void loadSavings()`（`src/index.js:594`），並安裝 auto-sync effect（`src/index.js:645–666`）。 | 不符合本輪要求的無背景外部動作與隔離初始化條件，未啟動。 |

因此本輪沒有湊足 3–5 個插件，也沒有把靜態篩選項算成實測。這是公開新語料中目前能以原入口、真實 DSH host 安全驗證的候選數：1 個插件、4 個分支輸入，0 個通過。前一輪 finance/education/translation 的 1 pass、8 fail 記錄保持不變。

## 執行環境與副作用界線

- DSH host：`outputs/dsh-to-codex`；Cordis `4.0.5`、`@deepseek-ai/dsh-tools` / `@deepseek-ai/dsh-system-prompt` / `@deepseek-ai/dsh-app-boot` `0.2.1-rc.2`。
- 插件固定來源：npm `dsh-plugin-verify@1.1.1`，封存 SHA-256 `09bd1b7354afc887e79cb72d063a12178ef837e483d5c539bce344cc3a9e29b6`；入口絕對路徑、host 版本、工具 schema、state/HOME 路徑與完整結果記在 JSON。
- `config: {}`；只掛載 `fs` 服務。專用 state、Codex home 和 workspace 均位於 `work/dsh-luna-functional-100`；workspace 只留下四份本輪建立的合成 fixture，插件未改動它們。
- 來源依賴未安裝；執行使用主專案已存在的官方 DSH runtime。沒有登入、憑證讀取、模型、網路 action、外部訊息或真實資料。
- 這是經靜態初始化審查後挑選分支的子程序測試，不是作業系統層級的網路/檔案沙箱。插件其它網路 action 未執行。
