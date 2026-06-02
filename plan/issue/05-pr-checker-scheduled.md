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

## 注意 / 地雷

- Cron 最小間隔 1 分鐘，與現況 60 秒一致，無損失。
- `scheduled` 的 DB binding 從 `env.DB` 取（非 request context），`makeDb` 要支援這條路徑。
- Workers `scheduled` 有 CPU time 上限；若 draft 量大，輪詢迴圈內的多次 GitHub fetch
  要留意總時長，必要時分批。
- `ctx.waitUntil` 確保非同步任務在 handler 返回後仍能完成。
- 依規範同步更新 prChecker 的 JSDoc（輪詢觸發機制改變）。

## 驗收標準

- [ ] self-host：PR 合併後仍會自動標記 published（行為不變）。
- [ ] Workers：`wrangler dev` 可用 `--test-scheduled` 觸發並驗證輪詢邏輯。
- [ ] prChecker 不再 import module 單例 db。
