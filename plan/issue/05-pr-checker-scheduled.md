# #05 PR 輪詢 → reconcile service（Cron + setInterval + 手動 fallback）

**Phase B — 後端 Workers 化** ｜ 相依：#03 ｜ 後續：無

## 背景

`src/lib/prChecker.ts` 的 `startPRChecker()` 用 `setInterval` 每 60 秒輪詢 GitHub
（`checkOnce` 檢查 pr_opened → merged/closed；`checkDraftsExistOnGithub` 同步 draft 狀態），
在 `index.ts` 啟動時呼叫。Workers **沒有常駐 process**，`setInterval` 不適用。

但 Cron Trigger 不該是唯一觸發點——把核心邏輯抽成一個 **reconcile service**，讓三種觸發
方式共用同一份邏輯，並補一個 **手動 fallback**（list 頁的「Sync from GitHub」按鈕），
這樣 Cron 漏觸發 / 延遲時使用者也能手動對帳。

## 為什麼現有「Sync from GitHub」不能取代輪詢（review 點 1、2）

`TopBar.tsx:101` 的 Sync 呼叫後端 `/github/sync`（`routes/github.ts:47`），但它：

- **只更新文章內容與 SHA**，不檢查 PR 狀態，**無法處理「PR 關閉未合併 → 退回 draft」**。
- 對既有文章，default branch 上可能還是 **PR 開啟前的舊內容**；若只因「檔案存在」就標 published，
  會**提早結束 `pr_opened` 狀態**（review 點 2）。

所以手動按鈕必須改成「呼叫與 Cron 相同的 PR 檢查邏輯（reconcile），再做既有文章同步」。

## 目標

- 把輪詢核心抽成不綁 runtime 的 **`runPrChecks(db, github, opts)`**（reconcile service）。
- 三種觸發共用它：
  - **self-host**：`server.bun.ts` 啟動時 `setInterval`。
  - **Workers**：`worker.ts` 的 `scheduled()` + `wrangler.toml` cron。
  - **手動**：新增 `POST /api/github/reconcile`，兩環境都可呼叫。
- list 頁「Sync from GitHub」：先打 `reconcile` → 再跑既有文章同步 → 最後**無條件 reload drafts**。

## 實作步驟

1. **重構 `prChecker.ts` → reconcile service**
   - `checkOnce` / `checkDraftsExistOnGithub` 改成接收 `db`（呼應 #01 注入契約與 #02/#03）與
     `github` client（#03 的 `createGithub(env)` factory），不再 import 單例。
   - **所有 DB 存取一律經 #01 的 repo 函數並把 `db` 傳入**（如 `listOpenPrDrafts(db)`、
     `updateDraft(db, id, patch)`），prChecker 內**不得**自己寫 drizzle query builder / SQL；
     若 reconcile 需要的查詢 repo 還沒有，就在對應 repo 檔新增具名函數。
   - export `runPrChecks(db, github, opts)` 同時跑兩個檢查，回傳結果摘要（更新了哪些）。
2. **新增 endpoint**：`routes/github.ts` 加 `POST /github/reconcile`，呼叫 `runPrChecks`，回傳摘要。
3. **self-host**：`startPRChecker(db, github)` 內 `setInterval(runPrChecks, INTERVAL_MS)`，於 `server.bun.ts` 呼叫。
4. **Workers**：`worker.ts` 加
   `async scheduled(event, env, ctx) { ctx.waitUntil(runPrChecks(makeDb(env), createGithub(env), {})); }`。
5. **`wrangler.toml`**：`[triggers] crons = ["* * * * *"]`（每分鐘，對齊現有 60 秒）。
6. **前端**：`TopBar.tsx` 的 Sync 流程改為 `POST /github/reconcile` → 既有 `/github/sync` → reload。

## 修掉既有 N+1（review 點 6）

`prChecker.ts:65` 對 **每篇 draft 各打一次** `getPR`/`getPRFiles`，**batch PR（一個 `pr_url`
對應多篇 draft）會重複查同一個 PR**。搬到 Cron 後受 CPU time 與 rate-limit 雙重壓力，必須修：

- `pr_opened` 的 draft 先依 `pr_url` **分組**，每個 PR 只查一次，再套用到該組所有 draft
  （用既有 `github_path` 對應各自 .md）。
- 每次執行限制 PR 數 / 筆數（batch size），超過留待下次。
- 防重疊：前一輪未跑完不重入（self-host 用旗標；Cron 加保護）。

## 修掉「所有錯誤都當 404」（review 點 3）

`prChecker.ts:166` 的 catch 把 **任何** GitHub 錯誤（token 失效、rate limit、暫時故障）
都當成「檔案不存在」而 **清空 `github_path` / `github_sha`**，這會污染資料。搬到 Cron /
手動執行後風險不變，必須一併修：

- `lib/github.ts` 的 `githubFetch()`（目前把 status 塞進 Error 字串，`:46`）改成
  **保留 HTTP status**（丟出帶 `status` 欄位的錯誤，或讓 `getFileSha` 回傳 `null` 表 404）。
- reconcile 邏輯**只允許 404 清空** `github_path`/`github_sha`；其餘錯誤**保留原狀**並回報，
  不可誤判為「遠端無此檔」。

## 注意 / 地雷

- Cron 最小間隔 1 分鐘，與現況 60 秒一致。
- **CPU 上限**：Cron 的 `scheduled` 在 Paid 每次最多 30 秒 CPU；Free 僅 10 ms（基本不夠跑）。
  參考 Workers limits <https://developers.cloudflare.com/workers/platform/limits/>。
- `scheduled` 的 DB binding 從 `env.DB` 取（非 request context），`makeDb` 要支援這條路徑。
- GitHub rate-limit：分組後請求數大降，仍要處理 403 / rate-limit（退避、留待下輪、不清資料）。
- `ctx.waitUntil` 確保非同步任務在 handler 返回後仍能完成。
- 依規範同步更新 prChecker / github.ts 的 JSDoc（觸發機制、分組、錯誤處理都變了）。
- 參考：Cron Triggers <https://developers.cloudflare.com/workers/configuration/cron-triggers/>。

## 驗收標準

- [ ] `runPrChecks` 為共用 service，self-host(setInterval)、Workers(scheduled)、手動(reconcile) 三者共用。
- [ ] `POST /api/github/reconcile` 兩環境可用；list 頁 Sync 改為 reconcile → 同步 → reload。
- [ ] PR **關閉未合併** 能正確退回 draft（手動與 Cron 皆可）。
- [ ] `/github/sync` **不再** 僅因檔案存在就把 `pr_opened` 標 published（review 點 2）。
- [ ] 同一 `pr_url` 的多篇 draft 一輪內 **只查該 PR 一次**（N+1 消除）。
- [ ] **只有 404** 會清空 `github_path`/`github_sha`；token 失效 / rate limit / 故障保留原狀並回報。
- [ ] Workers Cron 測試：啟動 `wrangler dev` 後
      `curl http://localhost:8787/cdn-cgi/handler/scheduled` 觸發並驗證。
- [ ] prChecker 不再 import module 單例 db / client；DB 一律經 `db` 參數 + repo 函數存取
      （符合 #01 注入契約，無自寫 query builder）。
