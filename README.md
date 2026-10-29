# D_sh-are_in_codex

**讓 DSH 社群的插件能夠在 Codex 使用。**

**Use DSH community plugins in Codex.**

[繁體中文](#繁體中文) · [English](#english) · [MIT](LICENSE)

## 繁體中文

版本：`0.10.0-beta.1`。公開測試版，目前主要在 Windows 驗證。

本專案提供 DSH（DeepSeek Harness）社群市場、固定規則掃描、目前 Codex 對話的原始碼審查，以及使用者同意後的轉換安裝。轉換本身不呼叫模型，也不初始化第三方來源。

### 功能

- 搜尋、篩選、收藏與管理 DSH 插件。
- 先下載固定版本並掃描，由目前對話說明風險，使用者決定安裝。
- 接入可相容的工具、技能、正式 MCP（工具連接協定）宣告及部分 DSH 服務。
- 在獨立網頁開啟支援的原插件設定頁、主頁與側欄頁籤，不修改 Codex 聊天外觀。
- 提供金鑰、檔案與程序權限，以及對外發文的確認／自動／禁止設定。

### 安裝

需要 Git、Node.js 22.19.0 以上、npm，以及支援自訂插件市場的 Codex。模型功能使用現有 Codex 登入與額度。

```powershell
git clone https://github.com/lightraindroptechtw/D_sh-are_in_codex.git
cd D_sh-are_in_codex
npm ci --ignore-scripts --legacy-peer-deps
codex plugin marketplace add .
codex plugin add dsh-to-codex@d-sh-are-in-codex
```

新開 Codex 對話，輸入 `$` 選「開啟 DSH 插件市場」，或使用：

```text
$dsh-to-codex:dsh-market
```

`dsh-to-codex` 是目前保留相容的插件識別碼與技能名稱，不是 Claude Code 指令。首次使用需準備 Node 依賴；此 Beta 的發布結構已檢查，但全新電腦的完整安裝流程尚待驗證。

也可在下載的專案目錄執行：

```powershell
node ./bin/dsh-to-codex.mjs market --open
```

### 使用與限制

先選插件、下載掃描，再由目前主對話閱讀代表片段、說明功能與風險；你同意後才轉換安裝。安裝後新開對話載入生成插件。

審查不是安全保證。安裝後執行第三方程式碼，風險高於單純使用 Codex。不是所有 DSH 插件都能原樣運作：不移植聊天外觀或完整內部代理流程；原畫面可顯示，不代表所有按鈕都相容。Python 掃描只列候選，不猜啟動方式或自動解析 pyproject.toml 安裝依賴。Codex 未提供的權限資訊會明示差異。

見 [相容性說明](COMPATIBILITY.md)、[功能限制](功能限制說明.md)、[開發者文件](DEVELOPMENT.md)。根目錄自有程式採 MIT；第三方程式及依賴保留原授權，見 [第三方說明](THIRD_PARTY_NOTICES.md)。請到 GitHub Issues 回報問題，不要公開貼金鑰或私人對話。

## English

Version: `0.10.0-beta.1`. Public beta, primarily verified on Windows.

This project provides a DSH (DeepSeek Harness) community catalog, deterministic source scanning, review in the current Codex conversation, and conversion and installation after user consent. Conversion itself does not call a model or initialize third-party source code.

### Features

- Search, filter, favorite, and manage DSH plugins.
- Download and scan a fixed version before review; users decide whether to install.
- Bridge compatible tools, skills, declared MCP servers, and selected DSH services.
- Open supported original settings pages, home pages, and sidebar tabs in a separate web page without modifying Codex chat appearance.
- Configure credentials, file and process permissions, and confirmation, automatic, or blocked posting modes.

### Installation

Requirements: Git, Node.js 22.19.0 or newer, npm, and Codex with custom marketplace support. Model features use your existing Codex login and quota.

```powershell
git clone https://github.com/lightraindroptechtw/D_sh-are_in_codex.git
cd D_sh-are_in_codex
npm ci --ignore-scripts --legacy-peer-deps
codex plugin marketplace add .
codex plugin add dsh-to-codex@d-sh-are-in-codex
```

Start a new Codex conversation, type `$`, and select the DSH marketplace skill, or invoke:

```text
$dsh-to-codex:dsh-market
```

The plugin identifier and skill namespace remain `dsh-to-codex` for compatibility; this is not a Claude Code command. Prepare Node dependencies before use. The release structure has been checked, but the complete fresh-machine installation flow has not yet been verified for this beta.

Alternatively, open the local marketplace from the cloned project:

```powershell
node ./bin/dsh-to-codex.mjs market --open
```

### Usage and limitations

Select a plugin and download and scan its fixed source. The current conversation reviews representative excerpts and explains behavior and risks. Conversion and installation require your consent. Start a new conversation to load generated plugins.

Review is not a security guarantee. Installed plugins run third-party code and introduce more risk than Codex alone. Not every DSH plugin works unchanged: chat appearance and the full internal agent loop are outside scope; a visible page does not imply every button works. Python discovery does not infer launch commands or automatically install pyproject.toml dependencies. Missing Codex permission information is disclosed.

See [compatibility](COMPATIBILITY.md), [limitations](功能限制說明.md), and [development](DEVELOPMENT.md), currently in Traditional Chinese. Project-owned code is MIT licensed; third-party code and dependencies retain their own licenses, as detailed in [third-party notices](THIRD_PARTY_NOTICES.md). Report issues on GitHub without posting credentials or private conversations.
