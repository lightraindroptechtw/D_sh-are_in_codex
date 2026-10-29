# D_sh-are_in_codex 開發者文件

版本：0.10.0-beta.1。一般使用見 [README.md](README.md)。

## 環境與入口

需要 Node.js 22.19.0 以上、npm 和 Git，目前主要驗證 Windows。執行 `npm ci --ignore-scripts --legacy-peer-deps` 安裝鎖定依賴。Python 僅在插件或測試需要時使用，不一律下載。

| 位置 | 用途 |
|---|---|
| bin/dsh-to-codex.mjs | 檢查、轉換、驗證、本機市場及 MCP 命令入口 |
| lib/inspect.mjs、lib/converter.mjs、lib/codex-package.mjs | 來源辨識、轉換與 Codex 產物生成；不初始化第三方來源 |
| lib/market-server.mjs、lib/market-operations.mjs、web/market | 市場、固定來源、掃描及使用者同意後的安裝 |
| lib/host-build.mjs、lib/dsh-host-worker.mjs、lib/modules | 官方 DSH／Cordis 宿主與 Codex 轉接；停用掛鉤時不編譯掛鉤 |
| lib/plugin-security.mjs、lib/security-package.mjs、lib/permission-broker.mjs | 金鑰、發文、程序及檔案權限與核准流程 |
| ui、lib/ui-*.mjs | 原插件獨立畫面與後端連接，不改 Codex 聊天外觀 |
| .agents/plugins/marketplace.json、.codex-plugin/plugin.json | 市場與插件清單 |

公開名稱為 D_sh-are_in_codex；dsh-to-codex 暫留作註冊識別碼與內部資料相容。不要只為改名就搬動使用者的安裝快取。

## 驗證

結構檢查不啟動插件：

```powershell
node ./bin/dsh-to-codex.mjs verify .
```

宿主清理相關測試：

```powershell
node --test --test-timeout=45000 tests/host-build-selection.test.mjs tests/module-provide-isolation.test.mjs tests/v040-agents-registry.test.mjs tests/runtime-versions.test.mjs
node --test --test-timeout=45000 tests/host-conversion.test.mjs
```

原工作目錄上述 12 項通過，包括合成插件轉換後啟動與工具呼叫；不代表發布副本已在全新電腦完整安裝。歷史紀錄見 verification 的文字報告；不把歷史完整測試數當成本次結果。

`npm test` 是完整測試入口，但部分端對端與 Luna 測試曾無法結束。一般修改先跑相關檔案並設定時限，不自行發真實留言、登入第三方帳號或消耗模型額度。

## 發布

版本同步 package.json、package-lock.json 根項目與 .codex-plugin/plugin.json；Beta 版本格式為 0.10.0-beta.1。保留技能中的版本說明一致。

不提交依賴、本機環境設定、私人對話、個人絕對路徑、生成快取與備份。能力界線見 COMPATIBILITY.md；第三方來源見 THIRD_PARTY_NOTICES.md。
