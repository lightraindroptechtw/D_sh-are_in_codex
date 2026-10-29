# DSH 插件安全掃描：@zhangfengshun/dsh-remote-ssh 2.4.39

- 來源：`@zhangfengshun/dsh-remote-ssh@2.4.39`
- 原始碼位置：`<local-workspace>`（沒有安裝，也沒有執行）
- 完整掃描結果（JSON，每項附檔案與行號）：`verification/v0.8.3/remote-ssh-scan.json`

固定規則的靜態掃描，沒有呼叫 AI，也沒有執行插件。只標出值得去看的位置，不代表安全，也不代表惡意。

## 一覽

| 項目 | 結果 | 處數 |
|---|---|---|
| 能不能審查 | 可以審查（沒看到混淆過的程式碼） |  |
| 自己開程式 | 會：；1 處看不出程式名稱 | 1 |
| 連網路 | 沒看到 | 2 |
| 寫入或刪除檔案 | 會（45 處） | 66 |
| 用到使用者家目錄 | 會 | 13 |
| 需要金鑰 | 沒看到 |  |
| 用你的帳號對外發文的工具 | 沒有 |  |
| 工具總數 | 13 |  |
| 其他語言的檔案 | 沒有 |  |
| 執行檔或二進位檔（看不到內容） | 沒有 |  |
| 安裝腳本 | 沒有 |  |
| 把整份環境變數交出去 | 沒看到 |  |
| 寫死、看起來像金鑰的字串 | 沒看到 |  |
| 壓縮過的程式（難以閱讀，不算混淆） | 沒有 |  |

## 透過市場安裝後的預設設定

| 功能 | 預設 | 調整方式 |
|---|---|---|
| 插件直接啟動程序 | 關閉 | 插件安全設定 → 允許直接啟動程序（`allowDirectSpawn`）；一般權限下仍可逐次確認指令 |
| 讀寫工作資料夾以外的位置 | 依插件安全設定的可讀／可寫資料夾決定 | 插件安全設定 → 額外讀取／寫入資料夾（`extraReadFolders`／`extraWriteFolders`） |

這裡列出程式目前的預設值，未讀取已安裝插件的個人設定；實際支援情形以轉換報告與宿主回傳的權限為準。

## 逐項位置

### 自己開程式

以下是直接啟動其他程式的位置。轉換後的處理依 Codex 權限與插件安全設定；可在「允許直接啟動程序」調整，設定名稱為 `allowDirectSpawn`。

- `lib/index.js:6032`：child_process.spawn，程式 看不出來（`spec.command`）

### 連網路

以下列出靜態規則辨識到的連線。轉換器不額外限制網路；本報告不測試連線是否成功。

- `lib/client.js:342`（DSH 前端畫面程式）：fetch
- `lib/client.js:822`（DSH 前端畫面程式）：fetch

### 讀寫檔案（只列有寫入、刪除、絕對路徑、家目錄或 .. 往外的）

- `lib/index.js:350`：fs.writeFileSync（寫入），路徑 `join(homeDir, "dsh-remote-ssh-settings-shape.json")`
- `lib/index.js:1792`：fs.mkdirSync（寫入），路徑 `stateDir`
- `lib/index.js:1793`：fs.writeFileSync（寫入），路徑 `file`
- `lib/index.js:2381`：fs/promises.rm（刪除），路徑 `join(mirrorPath, pr.bad)`
- `lib/index.js:2387`：fs/promises.rm（刪除），路徑 `join(mirrorPath, dir)`
- `lib/index.js:2443`：fs/promises.rm（刪除），路徑 `full`
- `lib/index.js:2485`：fs/promises.rename（寫入），路徑 `mirrorPath`
- `lib/index.js:2487`：fs/promises.mkdir（寫入），路徑 `dir`
- `lib/index.js:2488`：fs/promises.rename（寫入），路徑 `tmpDir`
- `lib/index.js:2491`：fs/promises.rm（刪除），路徑 `mirrorPath`
- `lib/index.js:2492`：fs/promises.rename（寫入），路徑 `oldDir`
- `lib/index.js:2495`：fs/promises.rm（刪除），路徑 `oldDir`
- `lib/index.js:2507`：fs/promises.writeFile（寫入），路徑 `join(mirrorPath, ".remote-ssh.json")`
- `lib/index.js:2513`：fs/promises.writeFile（寫入），路徑 `join(mirrorPath, "README.md")`
- `lib/index.js:2621`：fs/promises.rm（刪除），路徑 `tmpDir`
- `lib/index.js:2622`：fs/promises.mkdir（寫入），路徑 `tmpDir`
- `lib/index.js:2643`：fs/promises.rm（刪除），路徑 `tmpDir`
- `lib/index.js:2648`：fs/promises.rm（刪除），路徑 `tmpDir`
- `lib/index.js:2666`：fs/promises.rm（刪除），路徑 `tmpDir`
- `lib/index.js:2679`：fs/promises.rm（刪除），路徑 `tmpDir`
- `lib/index.js:2704`：fs/promises.cp（寫入），路徑 `from`
- `lib/index.js:2706`：fs/promises.rm（刪除），路徑 `tmpDir`
- `lib/index.js:2726`：fs/promises.rm（刪除），路徑 `tmpDir`
- `lib/index.js:2730`：fs/promises.rm（刪除），路徑 `tmpDir`
- `lib/index.js:4228`：fs/promises.rm（刪除），路徑 `ws.mirrorPath`
- ……還有 20 處，見 `verification/v0.8.3/remote-ssh-scan.json`

### 用到使用者家目錄

- `lib/index.js:467`：os.homedir()
- `lib/index.js:468`：os.homedir()
- `lib/index.js:526`：os.homedir()
- `lib/index.js:1168`：os.homedir()
- `lib/index.js:4060`：os.homedir()
- `lib/index.js:4070`：os.homedir()
- `lib/index.js:5190`：os.homedir()
- `lib/index.js:5405`：os.homedir()

### 對外發文

「對外發文」指插件用你的名義把內容送給別人或公開出去（留言、私訊、寄信、發文）。讀取、搜尋、建立草稿不算。透過市場安裝後，這些工具預設每次確認；可在插件安全設定的發文模式調整，設定名稱為 `posting.mode`。判斷依工具名稱與描述，可能誤判；可在安全設定的發文工具清單修正。

- 沒有判定為對外發文的工具

其他工具（判定不是對外發文）：`remote_ssh_profiles`、`remote_ssh_kill`、`remote_ssh_exec`、`remote_ssh_ls`、`remote_ssh_cat`、`remote_ssh_write`、`remote_ssh_sync`、`remote_ssh_push`、`remote_ssh_grep`、`remote_ssh_glob`、`remote_ssh_mkdir`、`remote_ssh_delete`、`remote_ssh_move`
