# 官方 DSH 工具 Runtime 直呼對照

日期：2026-10-23。目的：確認前輪 13 個失敗/成功結果是否由轉接層造成，並判斷插件宣告的 `dsh-tools ^0.1.0-rc.6` 相容範圍是否改變結果。

## 結果

我以官方 Cordis `Context`、官方 `ToolRuntime`、官方 `SystemPrompt` 和官方本機檔案服務，直接載入原始 npm 插件匯出並呼叫 `ctx.tools.execute({ callId, name, arguments, signal })`。此為官方 DSH 工具登錄器的同進程直呼 API，沒有使用 `outputs/dsh-to-codex/lib/dsh-host.mjs`，也沒有走 Agent、Session、模型或完整 CLI 流程。

相同的 13 組原始輸入在 `@deepseek-ai/dsh-tools@0.2.1-rc.2` 下重播後，**1 項成功、12 項失敗；13/13 的 `isError` 與錯誤文字都和前輪 adapter 記錄相同**。結果在 [official-tools-0.2-direct-13.json](results/official-tools-0.2-direct-13.json)，每筆同時保存前輪 adapter 回傳與本輪官方 Runtime 原始回傳。

我又用插件宣告範圍內精確版本 `@deepseek-ai/dsh-tools@0.1.0-rc.6` 重播同 13 組輸入，仍是 **1 項成功、12 項失敗，13/13 與前輪 adapter 結果相同**。結果在 [official-tools-0.1-direct-13.json](results/official-tools-0.1-direct-13.json)。代表這批失敗不是由轉接器引入，也不是只因舊測試用了超出插件 peer 範圍的 0.2.1-rc.2 而造成。插件回傳物本身不符合官方 Runtime 輸出規則，或其宣告 schema 與回傳欄位不一致。

已確認的失敗型態：finance 的 `format`、`return`、education 的 `quiz`、`flashcard`、`classstats`、translation 的 `segment`、`check`、`glossary` 在兩個 Runtime 版本都回報 `value is not lossless JSON`；來源 execute 固定回傳含未設定選填欄位的物件。`verify` 的四種 config fixture 在兩版都拒絕 `summary.format/depth/note`，因 schema 把 `summary` 設為 `additionalProperties: false` 卻沒有宣告這些子欄位。finance `ratio` 在兩版都成功，回傳 `value=10`、`text="pe = 10.00"`。沒有移除 `undefined`、放寬 schema 或略過 Runtime 驗證。

## 固定版本、來源及相容性

四個插件均是 registry 上同一發佈版本，tarball SHA-256 與既有語料 snapshot 相同：

| 插件 | 版本 | `dsh-tools` peer 範圍 | tarball SHA-256 |
| --- | --- | --- | --- |
| `dsh-plugin-finance-data` | `0.3.2` | `^0.1.0-rc.6` | `8c260de73a236e891a14b1bda0c33cf236f9620a3cc62dbda6f1d302f063650f` |
| `dsh-plugin-education` | `0.3.2` | `^0.1.0-rc.6` | `0ce52b88950eacb16fb161e66d9441e40ef29e6446a471a96822c9927a536daa` |
| `dsh-plugin-translation` | `0.3.2` | `^0.1.0-rc.6` | `93f51861c943de2b55c791428e9c5f9b7884369a12d8aae6965da602235bb497` |
| `dsh-plugin-verify` | `1.1.1` | `^0.1.0-rc.6` | `09bd1b7354afc887e79cb72d063a12178ef837e483d5c539bce344cc3a9e29b6` |

兩個 Runtime 目錄中 npm 安裝的原包 `lib/index.js`，都逐檔與 `work/dsh-corpus-100/sources` 裡從固定語料 tarball 解出的入口比對；四個套件在兩個環境的入口 bytes 全部一致。語料 tarball SHA 與本輪 registry tarball SHA 也逐包一致：

| 套件入口 | 原包入口 SHA-256（兩個環境） | 已解包語料入口相同 |
| --- | --- | --- |
| finance `lib/index.js` | `4c31845748e0f7f1296034bcc584348dbeac0c1abc78cca276e6ffe4819299b7` | 是 |
| education `lib/index.js` | `3559bc2a02d682f21493ab292415c8fcefff2b63c0c591a43421d657033721de` | 是 |
| translation `lib/index.js` | `823a4ad20f9045bd10ef65dc0c4927fd5119e8bb99a5f74f49c1e31e0cb33916` | 是 |
| verify `lib/index.js` | `dfd3697a16d1a5abea74c632a665d153c0dd98093ba8eee3ba6fe5323d7268cd` | 是 |

兩組隔離安裝採用官方套件精確版本，安裝 source/plugin 時均使用 `--ignore-scripts`；沒有執行插件套件的安裝腳本。工具 Runtime 及它需要的官方服務版本如下：

| 直呼測試 | Cordis | `dsh-tools` | system prompt | fs / fs-local |
| --- | --- | --- | --- | --- |
| 與前輪一致的 Runtime | `4.0.5` | `0.2.1-rc.2` | `0.2.1-rc.2` | `0.2.1-rc.2` |
| 插件宣告範圍內 | `4.0.5` | `0.1.0-rc.6` | `0.1.0-rc.6` | `0.1.0-rc.6` |

官方 `dsh-tools@0.1.0-rc.6` npm tarball SHA-256 為 `B5BC3C89F6FE519C01142E0914E413B8A0E988E4FF43ACB236B89CD96288DF86`；`0.2.1-rc.2` 為 `1BDEEE8A010540178DF0C548CC0D4503F829E3766A2DF3701941D46035960738`。對照用官方 CLI `@deepseek-ai/dsh@0.2.1-rc.2` tarball SHA-256 為 `40E3D025C0240C4316FF42DEE9BEDC7709C0FB38AEA10543B47076ED2AF52E1D`。已下載及檢查的官方 source checkout commit 是 `687f282e8625c6b8d11ff58211a90524be2e4317`，工作樹乾淨。

兩個隔離 Runtime 使用各自精確鎖定的官方模組版本；npm 安裝使用 `--ignore-scripts --legacy-peer-deps`，並在 manifest 明列需要的 DSH 模組版本，避免 npm 把插件的 `^0.1.0-rc.6` peer 自動解析到較新 prerelease。模組完整清單可在兩份原始結果 JSON 的 `runtimeVersions` 查看。插件本身也安裝為 registry 發佈版本；`--ignore-scripts` 是為了不執行來源安裝腳本，不代表沒有安裝套件或沒有執行原插件入口。

因此，0.2.1-rc.2 確實不在這四個插件宣告的 `^0.1.0-rc.6` 範圍內；但有範圍內 0.1.0-rc.6 的完整 13 項直呼結果，且逐項相同，所以此範圍外測試不是這 13 項失敗的解釋。這個結論只涵蓋本次四個插件版本、選定輸入和兩個 Runtime 版本，不外推到所有 DSH API 相容性。

## 無模型呼叫方式及完整 CLI 限制

官方 `ToolRuntime.execute` 是已註冊工具的同進程 API，可用 JSON arguments 執行，不需 Agent/session/model；本輪使用的 `signal` 是新的 `AbortController().signal`。此官方 SDK 直呼實際走完該版本工具 Runtime 的 pre-policy、插件 execute、post-policy 和輸出 materialization/validation 路徑。這不是完整 CLI 啟動，也不是 headless Agent 回合。

我確認 `@deepseek-ai/dsh` 是官方 CLI，bin 是 `lib/bin.js`，其介面是啟動 profile、管理插件和輸出設定。官方 headless profile 接收任務並注入 `agentDefaultModel`，沒有按工具名稱與 arguments 直接呼叫工具的 CLI 子命令；因此沒有啟動會要求模型的 headless 任務。全域 PATH 上也找不到既有 `dsh` 命令。

依指示曾嘗試在專用目錄以 `npm install --ignore-scripts` 建官方 CLI 隔離安裝；npm 在 Windows 清理階段反覆遇到 `ENOTEMPTY`/`EPERM`，安裝未完成。對部分安裝執行 `node .../lib/bin.js --help` 得到缺少 `@deepseek-ai/dsh-app-boot`，所以沒有把它算作 CLI 成功執行。官方 CLI tarball 與 bin 原始碼仍保留在 `archives/`、`extracted/cli/` 供檢視。此安裝限制不影響官方 `ToolRuntime.execute` 的兩版本直呼對照。

## 隔離及副作用

- 測試執行器只在 `work/dsh-native-investigation` 下建立專用 npm runtime、合成 workspace 和結果檔；0.1 和 0.2 分別使用 `synthetic/direct-0.1`、`synthetic/direct-0.2`，避免共用測試資料夾。沒有讀取或修改使用者 DSH 設定、已保存 Session 或真實文件。
- 13 組輸入沿用先前已審查的純數字/文字 action；`verify` 只讀本次建立的四份 JSON/YAML fixture。只掛載官方 Cordis、SystemPrompt、ToolRuntime 和 LocalFileSystem；沒有掛載 LLM/provider、Agent、Session 或模型金鑰。
- 沒有呼叫網路工具 action、登入、外部訊息、UI 或瀏覽器；沒有來源依賴安裝腳本。兩版 `verify` workspace 都只含建立的 fixture。
- 有限度：這是官方 DSH Runtime API 的工具呼叫對照，不代表已跑過官方 CLI/profile boot 或整個 Agent loop。CLI 隔離安裝未完成，原因與命令記於本節。

## 可重現命令

從 workspace 根目錄執行：

```powershell
node work/dsh-native-investigation/tools-0.1-runtime/run-all-13.mjs
node work/dsh-native-investigation/tools-0.2-runtime/run-all-13.mjs
```

完整精確 arguments、schema、每次 `ToolRuntime.execute` 原始結果、相同性比較與 Runtime 版本均在兩個結果 JSON 中。每個腳本都直接匯入隔離環境內的官方 Runtime 與 registry npm 插件，沒有載入轉接器。
