# 第 A 組來源功能實測

本報告只涵蓋 21 個指定來源；不改寫原批次成績，也不將工具列舉、缺金鑰錯誤或空清單當主要功能成功。
測試使用全新的生成包及自有暫存資料；沒有登入、付費、模型或對外訊息。桌面、NAS、外部程序與未具備外部條件的能力不執行。

開始：2026-10-23T10:26:53.226Z；結束：2026-10-23T10:34:47.754Z。
摘要：{"sourcesReviewed":21,"classification":{"tested":6,"blocked":13,"unsupported":2},"sourcesWithAtLeastOnePrimaryLocalCasePassing":4,"contractOnlySources":1,"cases":{"total":46,"passed":23,"failed":23},"allReviewedFilesUnchanged":true}

分類 tested 只代表已執行列出的案例，可能有失敗；blocked 是主要功能需要本次未具備的條件。每個案例都有獨立 expected（預期）、actual（實際）及 assertions（內容斷言）。

| # | 來源 | 主要功能 | 分類 | 通過／案例 | 審核與限制 |
|---:|---|---|---|---:|---|
| 1 | dsh-plugin-nlbi | MySQL 查詢、自然語言轉 SQL、資料圖表 | tested | 3/3 | 圖表推斷是無外部依賴的主要子功能，可用合成列測試；資料庫查詢和自然語言轉 SQL 仍需資料庫或模型。 |
| 2 | dsh-desktop-uia | Windows 控制項樹、桌面觀察與操作 | blocked | 0/0 | 工具經 DesktopRuntime 呼叫外部 UIA 執行檔，首次使用可能編譯；會讀取真實桌面，不能以合成文字替代。未啟動輔助程序。 |
| 6 | @vfvrpq/dsh-search | DeepSeek 搜尋、正文抓取與整合研究 | tested | 2/2 | 正式搜尋與抓取為付費金鑰端點。只以插件可配置的本機相容端點驗證請求與結果處理，不宣稱已執行真搜尋。 |
| 7 | dsh-zspace | NAS 檔案查詢、讀寫及容器管理 | blocked | 0/0 | 執行路徑使用已登入桌面客戶端的認證或 WebDAV 帳密，操作真 NAS；沒有測試帳號與合成 NAS，未讀取登入態。 |
| 11 | dsh-plugin-finance-data | 十種財務資料格式、計算、風險與配置分析 | tested | 10/32 | 純計算可用獨立預期值驗證；分開測嚴格輸出及 lenientOutput 對照，保留來源文字和結構錯誤。 |
| 13 | dsh-computer-use | 桌面觀察、點擊、輸入與拖曳 | blocked | 0/0 | 觀察和操作經 cua-driver 外部程序，讀取真實畫面／控制桌面；沒有獨立測試桌面，不以 wait 或工具清單當主要功能成功。 |
| 14 | dsh-mcp-tunnel | 建立、觀察與停止公開 MCP 隧道 | blocked | 0/0 | create 執行 Docker Compose 與 cloudflared 並公開本機服務；status 可能也執行 Docker。未啟動容器、隧道或公開端點。 |
| 16 | dsh-cua-drive | 透過 Cua Driver 觀察及控制桌面 | unsupported | 0/0 | README 明確限定 macOS，Windows／Linux 只提供狀態而不啟動電腦操作。此機為 Windows，主要功能不適用；動態工具名列出也不能證明支援。 |
| 18 | dsh-monitor | 監看檔案／命令並喚醒代理 | unsupported | 0/0 | monitor 將 exec.agent 傳入 armWatcher，變更後呼叫 agent.followup／inject；command 使用 /bin/sh。轉接器沒有提供這個 DSH 代理生命週期，未偽造代理或啟動監看。 |
| 19 | @adenxie/dsh-vercel | Vercel MCP 工具探索、載入與執行 | blocked | 0/0 | 工具管理要求活躍 Agent session，實際呼叫經已認證 Vercel MCP；沒有帳號且不偽造代理。未以本機技能文字或清單當部署功能成功。 |
| 20 | dsh-graft-plugin | 程式圖譜查詢、呼叫者、骨架與地圖 | blocked | 0/0 | 五個主要工具是 graft CLI 包裝，會 spawn 外部命令並依賴預建圖譜；未安裝或執行 graft，也沒有以空結果當成功。 |
| 25 | @a9i5k4/dsh-literature | 文獻庫搜尋、詳情、規範引用與筆記 | tested | 5/5 | 自有隔離文獻庫可預置合成書目，搜尋／引用／筆記不連網；外部文獻解析、PDF 下載、Zotero 與模型深讀不在本次範圍。 |
| 26 | dsh-scrape-webpage | 網頁正文、標題、連結與關鍵字分析 | tested | 0/1 | 讀到優先走 web.fetch，圖片為 0 時不進入下載／shell 分支；用本機合成 HTML 實測，若沒有 provider 就明記失敗，不補 shell。 |
| 27 | @memef1f1y/dsh-plugin-tavily | Tavily 搜尋與正文擷取 | blocked | 0/0 | search/extract 請求外部 Tavily／DeepSeek／Firecrawl。README 提到 Tavily 無金鑰模式，但這不是本機合成運算，正式服務仍有額度及供應商條件；未呼叫外部端點。官方 HTTP 工具不是 Tavily 本身已驗證。 |
| 28 | @240xu/dsh-websearch | 多後端網頁搜尋與結果合併 | blocked | 0/0 | 統一搜尋會向 Exa、Parallel、DuckDuckGo、SearXNG 等外部服務送出請求；帶金鑰後端另需帳號。未將官方 HTTP 抓取當來源搜尋功能。 |
| 30 | dsh-read-url | URL 正文／Markdown 擷取、連結與多頁讀取 | tested | 3/3 | 設定明確的本機 directFetchOrigins 並停用 SPA／自動分頁，測試真 HTTP 擷取、解析及快取，不啟動瀏覽器／curl。 |
| 31 | dsh-moli | Moli 真瀏覽器渲染、頁面／圖片／PDF 擷取 | blocked | 0/0 | moli_fetch 使用外部 Moli 執行檔；probe install 會下載執行第三方安裝器。沒有執行或安裝 Moli；probe 不是渲染功能成功。 |
| 32 | dsh-web-search-firecrawl | Firecrawl 多帳號搜尋 | blocked | 0/0 | 搜尋無可用帳號即 WEB_PROVIDER_CREDENTIAL_MISSING，否則 POST 到 Firecrawl；沒有金鑰或付費額度。官方 HTTP web_fetch 不算此來源搜尋成功。 |
| 33 | @anweat/dsh-browser | 瀏覽器導覽、觀察及互動動作 | blocked | 0/0 | browser_call 的主要動作需 Playwright／Patchright 或 OpenCLI 外部程序。未啟動瀏覽器、載入使用者認證或用動作目錄冒充操作成功。 |
| 34 | dsh-web-search-pro | 多引擎搜尋、網頁擷取、規則與持久歷史 | blocked | 0/0 | read.fetch 明確拒絕本機／私有網路 URL；主要搜尋需外部後端，渲染需瀏覽器。規則寫入須核准，未修改政策或用空快取清單當主要功能成功。 |
| 38 | dsh-image2-tool | 文字生圖與參考圖改圖 | blocked | 0/0 | image2_generate 需金鑰並 POST /images/generations 或 /images/edits，為可能計費模型服務；未呼叫、未下載圖片、不以缺金鑰錯誤當功能成功。 |

## 1 dsh-plugin-nlbi

圖表推斷是無外部依賴的主要子功能，可用合成列測試；資料庫查詢和自然語言轉 SQL 仍需資料庫或模型。

所列案例通過，僅限明確範圍

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "已選擇，實際結果看案例",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-plugin-nlbi_0.2.1/README.md`（SHA-256：`4bdb664b0b887aac60dbb2b904aae62aab7c80497b20787f430c610cfe118332`）
- `work/dsh-corpus-100/sources/dsh-plugin-nlbi_0.2.1/lib/index.js`（SHA-256：`efbd6690526475a6ad342b5ba64d53875edfcf5f536bad7a5210214979293c0b`）
- `work/dsh-corpus-100/sources/dsh-plugin-nlbi_0.2.1/lib/chart.js`（SHA-256：`a35645203fb426d8e97f0e79937fd6aace688b4246c64c51dbbcebf3a2ec2a4c`）
- `work/dsh-corpus-100/sources/dsh-plugin-nlbi_0.2.1/lib/text2sql.js`（SHA-256：`b380aff95ab6f7ddd1f8e68dcdfea27efa194d1d2d863764ebc01b17267dc517`）

### 單數值欄統計卡：passed

```json
{
  "tool": "sql_to_chart",
  "arguments": {
    "columns": [
      "amount"
    ],
    "rows": [
      {
        "amount": 10
      },
      {
        "amount": 20
      },
      {
        "amount": 30
      }
    ],
    "title": "Synthetic total"
  },
  "expected": {
    "type": "stat",
    "stats": {
      "sum": 60,
      "avg": 20,
      "min": 10,
      "max": 30,
      "count": 3
    }
  },
  "actual": {
    "ok": true,
    "type": "stat",
    "title": "Synthetic total",
    "field": "amount",
    "stats": {
      "sum": 60,
      "avg": 20,
      "max": 30,
      "min": 10,
      "count": 3
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "無錯誤且 ok=true",
      "passed": true
    },
    {
      "label": "統計卡類型",
      "passed": true
    },
    {
      "label": "獨立加總與平均",
      "passed": true
    },
    {
      "label": "最小最大與筆數",
      "passed": true
    }
  ]
}
```

### 時間欄折線圖：passed

```json
{
  "tool": "sql_to_chart",
  "arguments": {
    "columns": [
      "day",
      "amount"
    ],
    "rows": [
      {
        "day": "2026-01-01",
        "amount": 12
      },
      {
        "day": "2026-01-02",
        "amount": 18
      }
    ]
  },
  "expected": {
    "type": "line",
    "xField": "day",
    "yFields": [
      "amount"
    ],
    "rows": 2
  },
  "actual": {
    "ok": true,
    "type": "line",
    "title": "查询结果",
    "xField": "day",
    "yFields": [
      "amount"
    ],
    "data": [
      {
        "day": "2026-01-01",
        "amount": 12
      },
      {
        "day": "2026-01-02",
        "amount": 18
      }
    ]
  },
  "isError": false,
  "assertions": [
    {
      "label": "時間軸推斷",
      "passed": true
    },
    {
      "label": "數值欄",
      "passed": true
    },
    {
      "label": "原資料保留",
      "passed": true
    }
  ]
}
```

### 字串欄頻次計算：passed

```json
{
  "tool": "sql_to_chart",
  "arguments": {
    "columns": [
      "fruit"
    ],
    "rows": [
      {
        "fruit": "apple"
      },
      {
        "fruit": "pear"
      },
      {
        "fruit": "apple"
      }
    ]
  },
  "expected": {
    "apple": 2,
    "pear": 1
  },
  "actual": {
    "ok": true,
    "type": "bar",
    "title": "查询结果（频次统计）",
    "xField": "fruit",
    "yFields": [
      "count"
    ],
    "data": [
      {
        "fruit": "apple",
        "count": 2
      },
      {
        "fruit": "pear",
        "count": 1
      }
    ]
  },
  "isError": false,
  "assertions": [
    {
      "label": "頻次欄",
      "passed": true
    },
    {
      "label": "合成資料頻次",
      "passed": true
    }
  ]
}
```

## 2 dsh-desktop-uia

工具經 DesktopRuntime 呼叫外部 UIA 執行檔，首次使用可能編譯；會讀取真實桌面，不能以合成文字替代。未啟動輔助程序。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "主要功能需要外部程序；未執行"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-desktop-uia_1.1.3/README.md`（SHA-256：`60c3611e746706eea393a8ac5a31fca937feadaba0095c5ad2c66d8fd1dd6e57`）
- `work/dsh-corpus-100/sources/dsh-desktop-uia_1.1.3/lib/tools.js`（SHA-256：`f7bb49f9b0c8ebf6ee261c021093fd928f36b62db66b444777ec725c7e2429f1`）
- `work/dsh-corpus-100/sources/dsh-desktop-uia_1.1.3/lib/service.js`（SHA-256：`7d59040650cc83931adbbd408f1cde186d3a445284decd396e7e11bb7e6b18f5`）
- `work/dsh-corpus-100/sources/dsh-desktop-uia_1.1.3/lib/sidecar.js`（SHA-256：`037102529a4dd8bf6df6a2bba4cbec072a479ddc149e30453df1945bdae1063d`）

## 6 @vfvrpq/dsh-search

正式搜尋與抓取為付費金鑰端點。只以插件可配置的本機相容端點驗證請求與結果處理，不宣稱已執行真搜尋。
兩例只驗證本機相容服務的傳輸與結果處理；沒有向 DeepSeek 搜尋、沒有費用，回傳 billed 為來源對非空結果的推定，不能解讀成實際扣款或真搜尋成功。

所列案例通過，僅限明確範圍

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "正式服務需要或可能需要帳號／金鑰；本次不提供",
  "paidOrModelService": "正式服務有供應商／額度／可能費用條件，未呼叫",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/_vfvrpq_dsh-search_0.1.0/README.md`（SHA-256：`665dd757ba1fb7953dcdf8725857fed4de17d95349aa2a09be1886bd40f14edc`）
- `work/dsh-corpus-100/sources/_vfvrpq_dsh-search_0.1.0/lib/index.js`（SHA-256：`1890f0fb56cb70745fc43393b6150673d4fac06e823870d3b85cd47609ce0b8d`）
- `work/dsh-corpus-100/sources/_vfvrpq_dsh-search_0.1.0/lib/tools/search.js`（SHA-256：`cfe376e7fb160627a1dda3a23f5b84f27cca45557355ff71c9e520a7a9858418`）
- `work/dsh-corpus-100/sources/_vfvrpq_dsh-search_0.1.0/lib/tools/fetch.js`（SHA-256：`3d4d01fa7bb241fc3951d4a3db4ce3c66c95a294d0ef8814797d6b0df38aaa5e`）
- `work/dsh-corpus-100/sources/_vfvrpq_dsh-search_0.1.0/lib/tools/research.js`（SHA-256：`0951f742e0ead73a2901d61dd792663f10aa2ed2e17d34825970e6219173feb7`）
- `work/dsh-corpus-100/sources/_vfvrpq_dsh-search_0.1.0/lib/client.js`（SHA-256：`6c7816061bbbdbd55d0b267d310a0ca91f381e8e03a60eabdd21ac2bbcb55269`）
- `work/dsh-corpus-100/sources/_vfvrpq_dsh-search_0.1.0/lib/keys.js`（SHA-256：`a8cdb164ba37ec7ee86416de9b68cb1d609db1492d848c006d646a93357e83b1`）

### 本機相容端點：搜尋請求與結果正規化：passed

```json
{
  "tool": "deepseek_search",
  "arguments": {
    "query": "orchard",
    "count": 1,
    "site": "fixture.invalid",
    "needContent": true
  },
  "expected": {
    "total": 1,
    "title": "Synthetic Orchard Search Hit",
    "good": true
  },
  "actual": {
    "query": "orchard site:fixture.invalid",
    "total": 1,
    "billed": true,
    "results": [
      {
        "rank": 1,
        "title": "Synthetic Orchard Search Hit",
        "url": "https://fixture.invalid/orchard",
        "snippet": "Synthetic snippet",
        "summary": "Orchard fixture summary",
        "content": "Fixture full content",
        "siteName": "Fixture Site",
        "date": "2026-01-02",
        "authority": 3,
        "rerankScore": 1.75,
        "good": true
      }
    ]
  },
  "isError": false,
  "assertions": [
    {
      "label": "一筆合成結果",
      "passed": true
    },
    {
      "label": "分數與權威度保留",
      "passed": true
    },
    {
      "label": "查詢加入網站條件",
      "passed": true
    }
  ]
}
```

### 本機相容端點：正文抓取回傳：passed

```json
{
  "tool": "deepseek_fetch",
  "arguments": {
    "url": "https://fixture.invalid/article"
  },
  "expected": {
    "title": "Fixture API Page",
    "contentMarker": "ORCHARD-42"
  },
  "actual": {
    "url": "https://fixture.invalid/article",
    "title": "Fixture API Page",
    "content": "# Orchard\nSynthetic endpoint content ORCHARD-42.",
    "chars": 48,
    "truncated": false,
    "billed": true
  },
  "isError": false,
  "assertions": [
    {
      "label": "回傳標題及正文",
      "passed": true
    },
    {
      "label": "傳送指定 URL",
      "passed": true
    }
  ]
}
```

## 7 dsh-zspace

執行路徑使用已登入桌面客戶端的認證或 WebDAV 帳密，操作真 NAS；沒有測試帳號與合成 NAS，未讀取登入態。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "正式服務需要或可能需要帳號／金鑰；本次不提供",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-zspace_0.4.0/README.md`（SHA-256：`18c726531619a8fd331f9c3d74d5c36bbe143bfa1b61f6fe04c93dfb55540734`）
- `work/dsh-corpus-100/sources/dsh-zspace_0.4.0/lib/index.js`（SHA-256：`e888542534414458445f085c4ddf6ba2c527ae5a418af9f17fb60b7ef07ad4e7`）
- `work/dsh-corpus-100/sources/dsh-zspace_0.4.0/lib/client.js`（SHA-256：`b8070683fad8ee9e377b2619744e233faf9d0c4b53924287c29ccaf343c74e1a`）
- `work/dsh-corpus-100/sources/dsh-zspace_0.4.0/lib/config.js`（SHA-256：`013731fe3307b9f496c300ee5bc7e309e659b11ae7f592fd2c3bc0a198027f5b`）
- `work/dsh-corpus-100/sources/dsh-zspace_0.4.0/lib/tools.js`（SHA-256：`37db15978c0138ef0737d2b814106cc320df97c1a8fe06c45d812cc3551c124d`）

## 11 dsh-plugin-finance-data

純計算可用獨立預期值驗證；分開測嚴格輸出及 lenientOutput 對照，保留來源文字和結構錯誤。

部分本機子功能通過；有失敗，不能稱整包正常

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "已選擇，實際結果看案例",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-plugin-finance-data_0.3.2/README.md`（SHA-256：`2d9c2d534a130783cd469ab343499c5bd791965d9ecfaa43e960df20664f3a02`）
- `work/dsh-corpus-100/sources/dsh-plugin-finance-data_0.3.2/lib/index.js`（SHA-256：`4c31845748e0f7f1296034bcc584348dbeac0c1abc78cca276e6ffe4819299b7`）
- `work/dsh-corpus-100/sources/dsh-plugin-finance-data_0.3.2/lib/finance.js`（SHA-256：`7fd452e02878859f81f225ed73c3b166e9f357d7f1ff3f740ede2be3e0fbc77d`）

### strict format：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "format",
    "value": 1234.5,
    "decimals": 2,
    "thousands": true
  },
  "expected": "1,234.50",
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict return：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "return",
    "start": 100,
    "end": 121,
    "periods": 2,
    "annualized": true,
    "log": true
  },
  "expected": {
    "simpleReturn": 0.21,
    "annualizedReturn": 0.1
  },
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict return annualized：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "return",
    "start": 100,
    "end": 121,
    "periods": 2,
    "annualized": true
  },
  "expected": {
    "simpleReturn": 0.21,
    "annualizedReturn": 0.1
  },
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict return log：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "return",
    "start": 100,
    "end": 121,
    "periods": 2,
    "log": true
  },
  "expected": {
    "simpleReturn": 0.21,
    "logReturn": 0.09531017980432485
  },
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict ratio PE：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "pe",
    "price": 60,
    "eps": 3
  },
  "expected": 20,
  "actual": {
    "action": "ratio",
    "text": "pe = 20.00",
    "value": 20,
    "values": {
      "type": "pe",
      "value": 20
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### strict ratio ROE：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "roe",
    "netIncome": 30,
    "equity": 100
  },
  "expected": {
    "value": 30,
    "textPercent": "30.00%"
  },
  "actual": {
    "action": "ratio",
    "text": "roe = 3000.00%",
    "value": 30,
    "values": {
      "type": "roe",
      "value": 30
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict ratio ROA：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "roa",
    "netIncome": 30,
    "assets": 200
  },
  "expected": {
    "value": 15,
    "textPercent": "15.00%"
  },
  "actual": {
    "action": "ratio",
    "text": "roa = 1500.00%",
    "value": 15,
    "values": {
      "type": "roa",
      "value": 15
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict ratio grossMargin：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "grossMargin",
    "revenue": 100,
    "cogs": 60
  },
  "expected": {
    "value": 40,
    "textPercent": "40.00%"
  },
  "actual": {
    "action": "ratio",
    "text": "grossMargin = 4000.00%",
    "value": 40,
    "values": {
      "type": "grossMargin",
      "value": 40
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict ratio netMargin：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "netMargin",
    "netIncome": 30,
    "revenue": 100
  },
  "expected": {
    "value": 30,
    "textPercent": "30.00%"
  },
  "actual": {
    "action": "ratio",
    "text": "netMargin = 3000.00%",
    "value": 30,
    "values": {
      "type": "netMargin",
      "value": 30
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict value FV：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "value",
    "mode": "fv",
    "present": 100,
    "rate": 0.1,
    "periods": 2
  },
  "expected": {
    "numeric": 121,
    "text": "fv = 121.0000"
  },
  "actual": {
    "action": "value",
    "text": "fv = 121.0,000",
    "value": 121.00000000000001,
    "values": {
      "mode": "fv",
      "value": 121.00000000000001
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict risk：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "risk",
    "returns": [
      0.1,
      -0.1,
      0.1
    ],
    "riskFree": 0
  },
  "expected": {
    "samples": 3,
    "mean": 0.03333333333333333,
    "maxDrawdown": 0.1
  },
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict checklist：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "checklist"
  },
  "expected": "source/date/units",
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict plan：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "plan",
    "principal": 100,
    "contribution": 0,
    "annualRate": 0,
    "years": 1,
    "contributionFrequency": "year",
    "inflation": 0
  },
  "expected": "unchanged100",
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict portfolio：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "portfolio",
    "targets": {
      "equity": 60,
      "bonds": 40
    },
    "values": {
      "equity": 80,
      "bonds": 20
    }
  },
  "expected": {
    "equityPercent": 80,
    "bondsPercent": 20,
    "rebalanceEquity": -20
  },
  "actual": "Error: invalid arguments: \"targets.equity\" is not a declared property (additionalProperties: false); \"targets.bonds\" is not a declared property (additionalProperties: false); \"values.equity\" is not a declared property (additionalProperties: false); \"values.bonds\" is not a declared property (additionalProperties: false)",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict trend：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "trend",
    "metricValues": [
      10,
      20,
      30
    ],
    "labels": [
      "a",
      "b",
      "c"
    ]
  },
  "expected": {
    "mean": 20,
    "min": 10,
    "max": 30
  },
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### strict peer：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "peer",
    "value": 20,
    "peers": [
      10,
      20,
      30
    ],
    "metric": "PE",
    "higherIsBetter": false
  },
  "expected": "median20",
  "actual": "Error: tool \"finance_data\" returned invalid output: value is not lossless JSON",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### lenient format：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "format",
    "value": 1234.5,
    "decimals": 2,
    "thousands": true
  },
  "expected": "1,234.50",
  "actual": {
    "action": "format",
    "text": "1,234.50"
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### lenient return：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "return",
    "start": 100,
    "end": 121,
    "periods": 2,
    "annualized": true,
    "log": true
  },
  "expected": {
    "simpleReturn": 0.21,
    "annualizedReturn": 0.1
  },
  "actual": {
    "action": "return",
    "text": "simple return: 21.0000% | log return: 9.5310%",
    "values": {
      "logReturn": 0.09531017980432485,
      "simpleReturn": 0.21
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### lenient return annualized：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "return",
    "start": 100,
    "end": 121,
    "periods": 2,
    "annualized": true
  },
  "expected": {
    "simpleReturn": 0.21,
    "annualizedReturn": 0.1
  },
  "actual": {
    "action": "return",
    "text": "simple return: 21.0000% | annualized: 10.0000%",
    "values": {
      "simpleReturn": 0.21,
      "annualizedReturn": 0.10000000000000009
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### lenient return log：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "return",
    "start": 100,
    "end": 121,
    "periods": 2,
    "log": true
  },
  "expected": {
    "simpleReturn": 0.21,
    "logReturn": 0.09531017980432485
  },
  "actual": {
    "action": "return",
    "text": "simple return: 21.0000% | log return: 9.5310%",
    "values": {
      "logReturn": 0.09531017980432485,
      "simpleReturn": 0.21
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### lenient ratio PE：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "pe",
    "price": 60,
    "eps": 3
  },
  "expected": 20,
  "actual": {
    "action": "ratio",
    "text": "pe = 20.00",
    "value": 20,
    "values": {
      "type": "pe",
      "value": 20
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### lenient ratio ROE：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "roe",
    "netIncome": 30,
    "equity": 100
  },
  "expected": {
    "value": 30,
    "textPercent": "30.00%"
  },
  "actual": {
    "action": "ratio",
    "text": "roe = 3000.00%",
    "value": 30,
    "values": {
      "type": "roe",
      "value": 30
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### lenient ratio ROA：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "roa",
    "netIncome": 30,
    "assets": 200
  },
  "expected": {
    "value": 15,
    "textPercent": "15.00%"
  },
  "actual": {
    "action": "ratio",
    "text": "roa = 1500.00%",
    "value": 15,
    "values": {
      "type": "roa",
      "value": 15
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### lenient ratio grossMargin：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "grossMargin",
    "revenue": 100,
    "cogs": 60
  },
  "expected": {
    "value": 40,
    "textPercent": "40.00%"
  },
  "actual": {
    "action": "ratio",
    "text": "grossMargin = 4000.00%",
    "value": 40,
    "values": {
      "type": "grossMargin",
      "value": 40
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### lenient ratio netMargin：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "ratio",
    "type": "netMargin",
    "netIncome": 30,
    "revenue": 100
  },
  "expected": {
    "value": 30,
    "textPercent": "30.00%"
  },
  "actual": {
    "action": "ratio",
    "text": "netMargin = 3000.00%",
    "value": 30,
    "values": {
      "type": "netMargin",
      "value": 30
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### lenient value FV：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "value",
    "mode": "fv",
    "present": 100,
    "rate": 0.1,
    "periods": 2
  },
  "expected": {
    "numeric": 121,
    "text": "fv = 121.0000"
  },
  "actual": {
    "action": "value",
    "text": "fv = 121.0,000",
    "value": 121.00000000000001,
    "values": {
      "mode": "fv",
      "value": 121.00000000000001
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### lenient risk：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "risk",
    "returns": [
      0.1,
      -0.1,
      0.1
    ],
    "riskFree": 0
  },
  "expected": {
    "samples": 3,
    "mean": 0.03333333333333333,
    "maxDrawdown": 0.1
  },
  "actual": {
    "action": "risk",
    "text": "mean: 3.3333% | volatility (sample stdev): 11.5470% | max drawdown: 10.00% | historical VaR(95): -8.0000% | Sharpe: 0.289 | samples: 3",
    "values": {
      "mean": 0.03333333333333333,
      "stdev": 0.11547005383792516,
      "maxDrawdown": 0.09999999999999998,
      "var95": -0.08,
      "sharpe": 0.28867513459481287,
      "samples": 3
    }
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### lenient checklist：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "checklist"
  },
  "expected": "source/date/units",
  "actual": {
    "action": "checklist",
    "text": "Financial data checklist:\n- Source identified (exchange, provider, filing) and cited\n- As-of date / period attached — no stale figures presented as current\n- Units stated (currency, shares, thousands/millions, % vs decimal)\n- Seasonality / one-off items flagged where relevant\n- FX basis stated for cross-currency numbers\n- Definition of each ratio matches the context (TTM vs annual, GAAP vs non-GAAP)"
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### lenient plan：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "plan",
    "principal": 100,
    "contribution": 0,
    "annualRate": 0,
    "years": 1,
    "contributionFrequency": "year",
    "inflation": 0
  },
  "expected": "unchanged100",
  "actual": {
    "action": "plan",
    "text": "# Projection\n\nPrincipal: 100, contribution: 0/year, annual rate: 0%, years: 1\n\n| Period | Balance | Real (after inflation) |\n|--------|---------|------------------------|\n| 1 | 100 | 100 |\n\nInvested: 100, final: 100, return: 0 (0%)\nFinal real value: 100"
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### lenient portfolio：failed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "portfolio",
    "targets": {
      "equity": 60,
      "bonds": 40
    },
    "values": {
      "equity": 80,
      "bonds": 20
    }
  },
  "expected": {
    "equityPercent": 80,
    "bondsPercent": 20,
    "rebalanceEquity": -20
  },
  "actual": "Error: invalid arguments: \"targets.equity\" is not a declared property (additionalProperties: false); \"targets.bonds\" is not a declared property (additionalProperties: false); \"values.equity\" is not a declared property (additionalProperties: false); \"values.bonds\" is not a declared property (additionalProperties: false)",
  "isError": true,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": false
    }
  ]
}
```

### lenient trend：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "trend",
    "metricValues": [
      10,
      20,
      30
    ],
    "labels": [
      "a",
      "b",
      "c"
    ]
  },
  "expected": {
    "mean": 20,
    "min": 10,
    "max": 30
  },
  "actual": {
    "action": "trend",
    "text": "# Trend analysis\n\nn=3 | mean=20 | first=10 | last=30\nchange=20 (200%) | direction=up\nmin=10 (idx 0) | max=30 (idx 2)\nslope=10 | stdev=8.16 | avg abs change=10\n\n| i | label | value |\n|---|-------|-------|\n| 0 | a | 10 |\n| 1 | b | 20 |\n| 2 | c | 30 |"
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

### lenient peer：passed

```json
{
  "tool": "finance_data",
  "arguments": {
    "action": "peer",
    "value": 20,
    "peers": [
      10,
      20,
      30
    ],
    "metric": "PE",
    "higherIsBetter": false
  },
  "expected": "median20",
  "actual": {
    "action": "peer",
    "text": "# Peer comparison: PE\n\nvalue=20 | peers=3 | percentile rank=33.33 (below median)\nP10=12 | P50=20 | P90=28\nvs median: 0 (lower is better)\nverdict: favorable"
  },
  "isError": false,
  "assertions": [
    {
      "label": "獨立算式／文字預期一致",
      "passed": true
    }
  ]
}
```

## 13 dsh-computer-use

觀察和操作經 cua-driver 外部程序，讀取真實畫面／控制桌面；沒有獨立測試桌面，不以 wait 或工具清單當主要功能成功。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "主要功能需要外部程序；未執行"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-computer-use_0.3.1/README.md`（SHA-256：`256249be4bdd29b24ae302e6f86cee16d4faa3cba652a15d6862b2d0b637cc28`）
- `work/dsh-corpus-100/sources/dsh-computer-use_0.3.1/index.js`（SHA-256：`62c47e0db2c2d332566afbb8c7a50d3fa1cfb2b235fef8b4ffa01b22bfc1ce1e`）
- `work/dsh-corpus-100/sources/dsh-computer-use_0.3.1/lib/observe.js`（SHA-256：`01e2436267237daa7f6c298ca62d78b02a5a6438f2f73e001d19cd175ea3bfac`）
- `work/dsh-corpus-100/sources/dsh-computer-use_0.3.1/lib/cua.js`（SHA-256：`52168c379f7b4b4cab2bcb35ccbf866970e1bcf180544448ee423dd746606d35`）
- `work/dsh-corpus-100/sources/dsh-computer-use_0.3.1/lib/actions.js`（SHA-256：`50372dd5f8a70fa1af9286bc010a971d416d57594bd58756678247f0c457ec04`）
- `work/dsh-corpus-100/sources/dsh-computer-use_0.3.1/lib/guard.js`（SHA-256：`51b4b1edfc03b6653444b51b4c3a7fe1d9c1925e63dd5aae4ce9a27f3b254b04`）

## 14 dsh-mcp-tunnel

create 執行 Docker Compose 與 cloudflared 並公開本機服務；status 可能也執行 Docker。未啟動容器、隧道或公開端點。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "主要功能需要外部程序；未執行"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-mcp-tunnel_0.1.0/README.md`（SHA-256：`2bfde34d42f7e50279ccd7b56212533ed5389854001b7abe5d30db9ea2b11a24`）
- `work/dsh-corpus-100/sources/dsh-mcp-tunnel_0.1.0/lib/index.js`（SHA-256：`266dd88ee57b1d52865cfdde3437c07e7ea6ad28f66e3f9462d3c42ef865b42d`）

## 16 dsh-cua-drive

README 明確限定 macOS，Windows／Linux 只提供狀態而不啟動電腦操作。此機為 Windows，主要功能不適用；動態工具名列出也不能證明支援。

目前平台／橋接語義不支援主要功能

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "主要功能需要外部程序；未執行"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-cua-drive_0.2.1/README.md`（SHA-256：`3340366e393e287a21f00d8d86f909a450b13d515a957b6c73ded6e255d566b4`）
- `work/dsh-corpus-100/sources/dsh-cua-drive_0.2.1/lib/index.mjs`（SHA-256：`61886f4a7739d993d01a1cada814f71b2fca76be4bb72633560fd4d1e9f32869`）

## 18 dsh-monitor

monitor 將 exec.agent 傳入 armWatcher，變更後呼叫 agent.followup／inject；command 使用 /bin/sh。轉接器沒有提供這個 DSH 代理生命週期，未偽造代理或啟動監看。

目前平台／橋接語義不支援主要功能

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "主要功能會向代理送入回合；未執行",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-monitor_0.1.1/README.md`（SHA-256：`aeca6267518cf9cf4f4f11fd7da707218e95b62fca97999a0ce60e7a7ca293e8`）
- `work/dsh-corpus-100/sources/dsh-monitor_0.1.1/lib/index.js`（SHA-256：`54eda2ef4e14168de58f57a01f20e8354e65970e522996a7afe74a4e2a1656f6`）

## 19 @adenxie/dsh-vercel

工具管理要求活躍 Agent session，實際呼叫經已認證 Vercel MCP；沒有帳號且不偽造代理。未以本機技能文字或清單當部署功能成功。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "正式服務需要或可能需要帳號／金鑰；本次不提供",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/_adenxie_dsh-vercel_0.4.0/README.md`（SHA-256：`e9331e7681ce395ec4433cfbbbaf85aba9d48980abf52d69f0acf2e4cc8ea00d`）
- `work/dsh-corpus-100/sources/_adenxie_dsh-vercel_0.4.0/lib/index.js`（SHA-256：`01876bb25d2733c0b6ce10f14013b09a5cbd674a37d22b559932a07b944de306`）

## 20 dsh-graft-plugin

五個主要工具是 graft CLI 包裝，會 spawn 外部命令並依賴預建圖譜；未安裝或執行 graft，也沒有以空結果當成功。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "主要功能需要外部程序；未執行"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-graft-plugin_0.2.1/README.md`（SHA-256：`763c919061b97bf64a6a8a244790b195de21538c6c55b89f4becfcdc0cfc9136`）
- `work/dsh-corpus-100/sources/dsh-graft-plugin_0.2.1/src/index.js`（SHA-256：`3e49c5ef09cf0bedae80cf18fe2a2b8477daba22c537ba70d86ea141ec9500ce`）
- `work/dsh-corpus-100/sources/dsh-graft-plugin_0.2.1/src/graft-tools.js`（SHA-256：`52e4b2e2bb664169ba600522c77c622f92bc555dc2bf0a74bd85b347b8f21f2c`）
- `work/dsh-corpus-100/sources/dsh-graft-plugin_0.2.1/src/auto-sync.js`（SHA-256：`b424f84457fa6f563df29ffc6382adefc228c36f3d166d06c29841221b9e9eaa`）

## 25 @a9i5k4/dsh-literature

自有隔離文獻庫可預置合成書目，搜尋／引用／筆記不連網；外部文獻解析、PDF 下載、Zotero 與模型深讀不在本次範圍。

所列案例通過，僅限明確範圍

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "已選擇，實際結果看案例",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/_a9i5k4_dsh-literature_0.3.6/README.md`（SHA-256：`c43d757e62317a19fcfee14ff8c838e61d8f3458f82445de206836da22bf2e6a`）
- `work/dsh-corpus-100/sources/_a9i5k4_dsh-literature_0.3.6/lib/index.js`（SHA-256：`8f4c5599c744a96e6e270da52a781109bba08cf2ac0ac15ad80fe2d5ecc8355b`）

### 本機文獻庫關鍵字搜尋：passed

```json
{
  "tool": "literature_search",
  "arguments": {
    "query": "orchard"
  },
  "expected": {
    "contains": [
      "fixture-orchard",
      "Synthetic Orchard Study"
    ]
  },
  "actual": "命中 1 条：\n- Synthetic Orchard Study | Chen | 2024 | Fixture Journal  [key=fixture-orchard]\n    Synthetic orchard marker ORCHARD-42\n[下一步] literature_get(key=…) 看详情 · literature_cite 生成引用 · literature_search 继续检索",
  "isError": false,
  "assertions": [
    {
      "label": "找到合成書目及鍵值",
      "passed": true
    }
  ]
}
```

### 合成書目完整詳情：passed

```json
{
  "tool": "literature_get",
  "arguments": {
    "key": "fixture-orchard"
  },
  "expected": {
    "contains": [
      "Ada",
      "2024",
      "ORCHARD-42"
    ]
  },
  "actual": "标题：Synthetic Orchard Study\n作者：Chen Ada\n年份：2024\n期刊/会议：Fixture Journal\nDOI：10.0000/fixture-only\n状态：saved（无全文）\n摘要：Synthetic orchard marker ORCHARD-42\n[下一步] literature_cite 生成引用 · literature_note 记录关系",
  "isError": false,
  "assertions": [
    {
      "label": "作者年份摘要一致",
      "passed": true
    }
  ]
}
```

### APA 文內引用：passed

```json
{
  "tool": "literature_cite",
  "arguments": {
    "key": "fixture-orchard",
    "style": "apa",
    "mode": "intext"
  },
  "expected": {
    "citation": "(Chen, 2024)"
  },
  "actual": "(Chen, 2024)\n（apa · intext）\n[下一步] literature_verify 核验引用真实性 · literature_note 记录它和当前写作的关系",
  "isError": false,
  "assertions": [
    {
      "label": "獨立預期作者年份",
      "passed": true
    }
  ]
}
```

### BibTeX 書目生成：passed

```json
{
  "tool": "literature_cite",
  "arguments": {
    "key": "fixture-orchard",
    "style": "bibtex",
    "mode": "reference"
  },
  "expected": {
    "title": "Synthetic Orchard Study",
    "year": 2024
  },
  "actual": "@misc{Chen2024Synthetic,\n  author = {Chen, Ada},\n  title = {Synthetic Orchard Study},\n  journal = {Fixture Journal},\n  year = {2024},\n  volume = {2},\n  number = {1},\n  pages = {10-20},\n  doi = {10.0000/fixture-only}\n}\n\n（bibtex · reference）\n[下一步] literature_verify 核验引用真实性 · literature_note 记录它和当前写作的关系",
  "isError": false,
  "assertions": [
    {
      "label": "標題與年份",
      "passed": true
    },
    {
      "label": "書目區塊",
      "passed": true
    }
  ]
}
```

### 寫入自有合成書目筆記：passed

```json
{
  "tool": "literature_note",
  "arguments": {
    "key": "fixture-orchard",
    "note": "Synthetic local note NOTE-42"
  },
  "expected": {
    "savedNotes": 1
  },
  "actual": "已记录到条目 fixture-orchard（共 1 条笔记）。",
  "isError": false,
  "assertions": [
    {
      "label": "回報已記錄",
      "passed": true
    }
  ]
}
```

持久化檢查：
```json
{
  "expected": "NOTE-42 retained only in synthetic store",
  "actual": [
    {
      "text": "Synthetic local note NOTE-42",
      "at": "2026-10-23T10:34:47.693Z"
    }
  ],
  "passed": true
}
```

## 26 dsh-scrape-webpage

讀到優先走 web.fetch，圖片為 0 時不進入下載／shell 分支；用本機合成 HTML 實測，若沒有 provider 就明記失敗，不補 shell。

已嘗試，但尚未證明主要功能成功

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "已選擇，實際結果看案例",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-scrape-webpage_1.0.0/README.md`（SHA-256：`f93d9e0fa4ffb7ce1f1ab3bdb1e573173fdb0e5d7ab96fcd5ba577dda4d65046`）
- `work/dsh-corpus-100/sources/dsh-scrape-webpage_1.0.0/lib/index.js`（SHA-256：`013dc2d6b52ab0c94ada1fcb5d4ed134ecbed25be800f5da10c215888a0d1090`）
- `work/dsh-corpus-100/sources/dsh-scrape-webpage_1.0.0/lib/fetch.js`（SHA-256：`a7707b6e64c6ed1cb58762ccfff8f404ec166d8398e482e426c1f418ecb15408`）
- `work/dsh-corpus-100/sources/dsh-scrape-webpage_1.0.0/lib/html.js`（SHA-256：`2c153aec91e4a00c0c8ebef5bfe937bbc50072c87a232a785359584fb6923991`）
- `work/dsh-corpus-100/sources/dsh-scrape-webpage_1.0.0/lib/analyze.js`（SHA-256：`8383b9efaaf4230bd88fbd6d804d44ebf954551c6e1cd9d28c91c4d59355a472`）

### 本機合成網頁擷取與分析：failed

```json
{
  "tool": "scrape_webpage",
  "arguments": {
    "url": "http://127.0.0.1:63473/article",
    "images": 0,
    "maxChars": 10000
  },
  "expected": {
    "title": "Fixture Orchard Study",
    "heading": "Orchard Study",
    "link": "/details",
    "marker": "ORCHARD-42"
  },
  "actual": {
    "error": "当前环境既没有可用的 web 抓取 provider，也没有 shell 服务，无法抓取网页",
    "url": "http://127.0.0.1:63473/article"
  },
  "isError": false,
  "assertions": [
    {
      "label": "標題與正文",
      "passed": false
    },
    {
      "label": "標題結構與連結",
      "passed": false
    },
    {
      "label": "統計對實際正文",
      "passed": false
    },
    {
      "label": "無圖片下載",
      "passed": false
    }
  ]
}
```

## 27 @memef1f1y/dsh-plugin-tavily

search/extract 請求外部 Tavily／DeepSeek／Firecrawl。README 提到 Tavily 無金鑰模式，但這不是本機合成運算，正式服務仍有額度及供應商條件；未呼叫外部端點。官方 HTTP 工具不是 Tavily 本身已驗證。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "正式服務需要或可能需要帳號／金鑰；本次不提供",
  "paidOrModelService": "正式服務有供應商／額度／可能費用條件，未呼叫",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/_memef1f1y_dsh-plugin-tavily_0.7.0/README.md`（SHA-256：`c14a2f5824db51ad4a9eb60e4a9decec1dfe2ba14bde835c2372eab829131115`）
- `work/dsh-corpus-100/sources/_memef1f1y_dsh-plugin-tavily_0.7.0/lib/index.mjs`（SHA-256：`f481c75320e3ae8599ec65a230c3480e3d0c6adc58f5e60495a50d92ca0a0945`）

## 28 @240xu/dsh-websearch

統一搜尋會向 Exa、Parallel、DuckDuckGo、SearXNG 等外部服務送出請求；帶金鑰後端另需帳號。未將官方 HTTP 抓取當來源搜尋功能。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/_240xu_dsh-websearch_2.8.8/README.md`（SHA-256：`98c1a19ac492580c01e678401ec3ab6ed3ac25e62c7a9f4c8d1f2cd8cc3bfe3f`）
- `work/dsh-corpus-100/sources/_240xu_dsh-websearch_2.8.8/lib/index.js`（SHA-256：`c9f2a75789d4347b1312aee436c278323fce1db7ee9a3bf80aaed1a53811dee6`）
- `work/dsh-corpus-100/sources/_240xu_dsh-websearch_2.8.8/lib/provider.js`（SHA-256：`428616798a5e4d935324c5ff2bca626323daba18b3e1aa585772f3d63d593c69`）

## 30 dsh-read-url

設定明確的本機 directFetchOrigins 並停用 SPA／自動分頁，測試真 HTTP 擷取、解析及快取，不啟動瀏覽器／curl。

所列案例通過，僅限明確範圍

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "已選擇，實際結果看案例",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-read-url_1.9.3/README.md`（SHA-256：`792316f3f3184e2d75fafa3351da918df73886e27f059d8e57b8231d1ce883e2`）
- `work/dsh-corpus-100/sources/dsh-read-url_1.9.3/index.js`（SHA-256：`83d08ce88404371e8d2c82bf2939cbe67bc34d55f32db439ccb9a39b33a6581e`）
- `work/dsh-corpus-100/sources/dsh-read-url_1.9.3/spa.js`（SHA-256：`682b7b4ab58bc9dbda8856f061ea4eff0b20409595ba45a262d0162116a4e121`）
- `work/dsh-corpus-100/sources/dsh-read-url_1.9.3/proxy-fallback.js`（SHA-256：`b0bed080a4cd8f5233e6b67f1d237d84b1bb9ee1a2515d73dfdd736e4a7c8955`）

### 本機 HTML 轉 Markdown 主文：passed

```json
{
  "tool": "read_url",
  "arguments": {
    "url": "http://127.0.0.1:63473/article",
    "mode": "markdown",
    "includeLinks": true,
    "maxChars": 6000
  },
  "expected": {
    "title": "Fixture Orchard Study",
    "marker": "ORCHARD-42",
    "link": "/details"
  },
  "actual": {
    "url": "http://127.0.0.1:63473/article",
    "title": "Fixture Orchard Study",
    "siteName": "127.0.0.1",
    "lang": "en",
    "charset": "utf-8",
    "mode": "markdown",
    "truncated": false,
    "charsTotal": 1889,
    "charsReturned": 1889,
    "charsStart": 0,
    "text": "# Orchard Study\n\nSynthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification.\n\n## Measured harvest\n\nApple marker ORCHARD-42. No account or external service exists.[Fixture details](/details)",
    "links": [
      {
        "title": "Fixture details",
        "url": "http://127.0.0.1:63473/details"
      }
    ]
  },
  "isError": false,
  "assertions": [
    {
      "label": "標題與正文",
      "passed": true
    },
    {
      "label": "Markdown 標題",
      "passed": true
    },
    {
      "label": "連結保留",
      "passed": true
    },
    {
      "label": "未走瀏覽器渲染",
      "passed": true
    }
  ]
}
```

### 第二次讀取使用快取：passed

```json
{
  "tool": "read_url",
  "arguments": {
    "url": "http://127.0.0.1:63473/article",
    "mode": "markdown",
    "includeLinks": true,
    "maxChars": 6000
  },
  "expected": {
    "cached": true,
    "additionalHttpRequests": 0
  },
  "actual": {
    "url": "http://127.0.0.1:63473/article",
    "title": "Fixture Orchard Study",
    "siteName": "127.0.0.1",
    "lang": "en",
    "charset": "utf-8",
    "mode": "markdown",
    "truncated": false,
    "charsTotal": 1889,
    "charsReturned": 1889,
    "charsStart": 0,
    "text": "# Orchard Study\n\nSynthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification. Synthetic orchard research records apple yield and rainfall. Apples grow in the north field. Rainfall is measured every morning. Harvest values are 12 and 18. This document exists only for local extraction verification.\n\n## Measured harvest\n\nApple marker ORCHARD-42. No account or external service exists.[Fixture details](/details)",
    "links": [
      {
        "title": "Fixture details",
        "url": "http://127.0.0.1:63473/details"
      }
    ],
    "cached": true
  },
  "isError": false,
  "assertions": [
    {
      "label": "回報快取",
      "passed": true
    },
    {
      "label": "沒有再次請求本機頁面",
      "passed": true
    }
  ]
}
```

### JSON 內容原生解析：passed

```json
{
  "tool": "read_url",
  "arguments": {
    "url": "http://127.0.0.1:63473/data.json",
    "maxChars": 6000
  },
  "expected": {
    "contains": [
      "ORCHARD-42",
      "30"
    ]
  },
  "actual": {
    "url": "http://127.0.0.1:63473/data.json",
    "title": "",
    "siteName": "127.0.0.1",
    "lang": "",
    "charset": "json",
    "mode": "json",
    "truncated": false,
    "charsTotal": 58,
    "charsReturned": 58,
    "charsStart": 0,
    "text": "{\"fixture\":\"ORCHARD-42\",\"apples\":12,\"pears\":18,\"total\":30}"
  },
  "isError": false,
  "assertions": [
    {
      "label": "包含合成資料",
      "passed": true
    },
    {
      "label": "無抓取錯誤",
      "passed": true
    }
  ]
}
```

## 31 dsh-moli

moli_fetch 使用外部 Moli 執行檔；probe install 會下載執行第三方安裝器。沒有執行或安裝 Moli；probe 不是渲染功能成功。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "主要功能需要外部程序；未執行"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-moli_1.1.19/README.md`（SHA-256：`05440a4626d313be5ebb67e828ec4b6fbc72ab2d93293a0848f9e4a92753e7f4`）
- `work/dsh-corpus-100/sources/dsh-moli_1.1.19/index.js`（SHA-256：`0b8b29426e26def0c4d67a9561054fbff442d8033e0db36f471130d3c36bdc23`）
- `work/dsh-corpus-100/sources/dsh-moli_1.1.19/lib/moli.js`（SHA-256：`04c9bbc1ac3ad6df59b5b2cf5196f8489bf4f42ee05f7b1047e8157a40bc5894`）
- `work/dsh-corpus-100/sources/dsh-moli_1.1.19/lib/install.js`（SHA-256：`b0e0c0adc4fff92daf0facae5fe87a42cdddda394c235810b6c89e8e1d711c18`）

## 32 dsh-web-search-firecrawl

搜尋無可用帳號即 WEB_PROVIDER_CREDENTIAL_MISSING，否則 POST 到 Firecrawl；沒有金鑰或付費額度。官方 HTTP web_fetch 不算此來源搜尋成功。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "正式服務需要或可能需要帳號／金鑰；本次不提供",
  "paidOrModelService": "正式服務有供應商／額度／可能費用條件，未呼叫",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-web-search-firecrawl_0.1.5/README.md`（SHA-256：`6bc2cd5b42fa1f20acb1fd1efe8fa7a177c08a48d4a841117c1c49c4935e7ec4`）
- `work/dsh-corpus-100/sources/dsh-web-search-firecrawl_0.1.5/lib/dsh-web-search-firecrawl.js`（SHA-256：`dd3f353a87d4d6259612ea10dfb99ed7c52cbfb480890687528108acb08112cb`）

## 33 @anweat/dsh-browser

browser_call 的主要動作需 Playwright／Patchright 或 OpenCLI 外部程序。未啟動瀏覽器、載入使用者認證或用動作目錄冒充操作成功。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "主要功能需要外部程序；未執行"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/_anweat_dsh-browser_0.2.1/README.md`（SHA-256：`f3a4883fe9b8d68dbb463a992e5f301443d200582d686f60addca3a137d51fb4`）
- `work/dsh-corpus-100/sources/_anweat_dsh-browser_0.2.1/lib/index.js`（SHA-256：`8a188cb6e515fddd701223b0f017c605275158de4103b6ccf1d278d9a893dca3`）
- `work/dsh-corpus-100/sources/_anweat_dsh-browser_0.2.1/lib/actions/registry.js`（SHA-256：`7234489197983c3a980dbb132cae59810e56b5ef75162e483871e3d499c60c01`）

## 34 dsh-web-search-pro

read.fetch 明確拒絕本機／私有網路 URL；主要搜尋需外部後端，渲染需瀏覽器。規則寫入須核准，未修改政策或用空快取清單當主要功能成功。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "本次選擇的路徑不需要登入",
  "paidOrModelService": "未呼叫付費服務或模型",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-web-search-pro_0.2.1/README.md`（SHA-256：`286b96f01a23aff24ede03e612d6e785d7eccf96ba5b2aa199635083a5a3c0a1`）
- `work/dsh-corpus-100/sources/dsh-web-search-pro_0.2.1/lib/index.js`（SHA-256：`912207ac3f3790bc24c34e83f5c2fa26fd4b39ce08360fd9c5598b3403653184`）
- `work/dsh-corpus-100/sources/dsh-web-search-pro_0.2.1/lib/actions/read.js`（SHA-256：`d190c3b9cf2c8101114b0afd39940a7c8eff9be124721abaf50646f3bf710fab`）
- `work/dsh-corpus-100/sources/dsh-web-search-pro_0.2.1/lib/actions/rules.js`（SHA-256：`3ca720fa58434bc472dc0e28a719bf5373943cbf385724ca711ac342d815c99a`）
- `work/dsh-corpus-100/sources/dsh-web-search-pro_0.2.1/lib/actions/approval.js`（SHA-256：`c6ee556ab665550f475765977ccbce5eb0cc25350a61ed38e93841987049ffed`）
- `work/dsh-corpus-100/sources/dsh-web-search-pro_0.2.1/lib/fetch.js`（SHA-256：`ee7851ac548cfc6ef0f95ce0342f97c692aacca4e4646ceeccbf5ad73c904cd5`）
- `work/dsh-corpus-100/sources/dsh-web-search-pro_0.2.1/lib/safe-http.js`（SHA-256：`f8152b5c501ba3ea03fb9b7f1a76f3e7dd65d85649a81e9c14aee5f3dac3e720`）

## 38 dsh-image2-tool

image2_generate 需金鑰並 POST /images/generations 或 /images/edits，為可能計費模型服務；未呼叫、未下載圖片、不以缺金鑰錯誤當功能成功。

外部條件未具備，主要功能未驗證

是否能不登入、不付費、不呼叫模型、不發訊息：
```json
{
  "localSyntheticPrimaryPath": "沒有可在本次條件下代表主要功能的本機路徑",
  "loginOrCredentials": "正式服務需要或可能需要帳號／金鑰；本次不提供",
  "paidOrModelService": "正式服務有供應商／額度／可能費用條件，未呼叫",
  "agentMessages": "本次不發訊息",
  "externalHelperProcesses": "本次案例不執行來源外部輔助程序"
}
```

已讀說明與執行路徑：
- `work/dsh-corpus-100/sources/dsh-image2-tool_0.4.1/README.md`（SHA-256：`29f993126bbed69bf022972f43b64f468d2a788bcfe40a26f4ce37510c002130`）
- `work/dsh-corpus-100/sources/dsh-image2-tool_0.4.1/index.js`（SHA-256：`e0fcb29e4c98942709bb92d599f6765ef248e108279e19ebd15fb6e9cf0fae83`）

重跑：
```powershell
node verification/v0.4.0/function-tests/group-a-driver.mjs
```

驅動會拒絕覆寫既有生成包；再次執行前應改用新暫存目錄保留原證據。完整結構資料見 [group-a.json](group-a.json)。
