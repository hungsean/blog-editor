# #05 PR 輪詢：setInterval ⇄ Cron Triggers

**Phase B — 後端 Workers 化** ｜ 相依：#03 ｜ 後續：無

## 背景

`src/lib/prChecker.ts` 的 `startPRChecker()` 用 `setInterval` 每 60 秒輪詢 GitHub
（`checkOnce` 檢查 pr_opened；`checkDraftsExistOnGithub` 同步 draft 狀態），在 `index.ts`
啟動時呼叫。Workers **沒有常駐 process**，`setInterval` 不適用，要改用 **Cron Triggers**
的 `scheduled()` handler。self-host 仍保留 setInterval。

## 目標

- 把輪詢邏輯抽成不綁 runtime 的純函式 `runPrChecks(db, env)`。
- self-host：`server.bun.ts` 啟動時用 `setInterval` 呼叫。
- Cloudflare：`worker.ts` 的 `scheduled(event, env, ctx)` 呼叫，`wrangler.toml` 設 cron。

## 實作步驟

1. 重構 `prChecker.ts`：
   - `checkOnce` / `checkDraftsExistOnGithub` 改成接收 `db`（來自 context，呼應 #02/#03）
     與 env，不再 import module 單例 db。
   - export 一個 `runPrChecks(db, env)` 同時跑兩個檢查。
2. self-host：`startPRChecker(db, env)` 內部 `setInterval(runPrChecks, INTERVAL_MS)`，
   在 `server.bun.ts` 呼叫。
3. Workers：`worker.ts` 加 `async scheduled(event, env, ctx) { ctx.waitUntil(runPrChecks(makeDb(env), env)); }`。
4. `wrangler.toml`：`[triggers] crons = ["* * * * *"]`（每分鐘，對齊現有 60 秒）。

## 順手修掉既有 N+1（review 點 6）

`prChecker.ts:65` 目前對 **每篇 draft 各打一次 GitHub API**（`getPR`/`getPRFiles`）。
**batch PR 一個 `pr_url` 對應多篇 draft**，現況會讓同一個 PR 被重複查詢——self-host 靠
process 慢慢跑沒事，但搬到 Cron 後受 CPU time 與 GitHub rate-limit 雙重壓力，這個 N+1
必須一併修掉，否則 draft 量一大就會超時或被限流。

改寫重點：

- 先把 `pr_opened` 的 draft 依 `pr_url` **分組**，每個 PR 只 `getPR` / `getPRFiles` 一次，
  再把結果套用到該組所有 draft（用既有 `github_path` 對應各自的 .md）。
- 每次 scheduled 限制處理筆數 / PR 數（batch size），超過的留待下次。
- 防重疊：避免前一輪未跑完又被觸發（self-host 用旗標；Cron 兩次觸發間隔足夠，但仍加保護）。

## 注意 / 地雷

- Cron 最小間隔 1 分鐘，與現況 60 秒一致，無損失。
- `scheduled` 的 DB binding 從 `env.DB` 取（非 request context），`makeDb` 要支援這條路徑。
- GitHub rate-limit：分組後請求數大幅下降，但仍要處理 403 / rate-limit 回應（退避、留待下輪）。
- `ctx.waitUntil` 確保非同步任務在 handler 返回後仍能完成。
- 依規範同步更新 prChecker 的 JSDoc（輪詢觸發機制 + 分組行為都變了）。

## 驗收標準

- [ ] self-host：PR 合併後仍會自動標記 published（行為不變）。
- [ ] Workers：`wrangler dev` 可用 `--test-scheduled` 觸發並驗證輪詢邏輯。
- [ ] 同一 `pr_url` 的多篇 draft 在一輪內 **只查該 PR 一次**（N+1 已消除）。
- [ ] 有 batch size 上限與防重疊機制；遇 GitHub rate-limit 會退避而非硬打。
- [ ] prChecker 不再 import module 單例 db。
