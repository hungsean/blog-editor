# #03 Runtime 抽象層：入口 / env / Hono 雙 adapter

**Phase B — 後端 Workers 化** ｜ 相依：#02 ｜ 後續：#04、#05、#06

## 背景

Hono 本身在 Bun 與 Workers 上都能跑，但兩種環境的 **入口形式**、**環境變數來源**、
**DB binding 取得方式** 不同。本 issue 建立一層薄抽象，讓同一個 `app` 兩邊都能用，
這是後續 #04 ~ #06 的地基。

> ⚠️ **重要前提（避免 review 點 1 的陷阱）**：共用 `app` 會 mount `routes/api.ts` 的
> 所有子 router，其中 `upload.ts`（`node:fs` / `Bun.file`）與 `og.ts`（`@resvg/resvg-js`，
> 經 `ogImage.ts`）仍 **transitively import Bun-only / native 模組**。只要 `worker.ts`
> import 到 `app`，Workers bundle 就會把這些拉進來而 build / 啟動失敗。
> 因此本 issue **不要求** `wrangler dev` 跑通完整 app——只要求 runtime 抽象與分檔成立，
> 完整 Worker 啟動驗收移到 #04（storage 去 fs 化）與 #06（og 去 native 化）之後（見 #07）。

## 兩環境差異

| 項目 | self-host (Bun) | Cloudflare (Workers) |
| --- | --- | --- |
| 入口 | `export default { port, fetch: app.fetch }` | `export default { fetch, scheduled }` |
| 環境變數 | `process.env` / `Bun.env`（啟動即有） | `c.env`（每 request 注入） |
| DB | 啟動時建好的 Drizzle 單例 | 每 request 從 `c.env.DB` binding 建 |
| 常駐 | 有 process，可 `setInterval` | 無，靠 Cron（#05） |

## 目標

- 定義 Hono 的 `Bindings` / `Variables` 型別，把 `db` 與設定值掛在 `c.var` / `c.env`。
- 用一個 middleware 在每個 request 初始化 runtime context（self-host 走單例；
  Workers 走 binding）。
- 環境變數讀取集中到一個 `getEnv(c)` provider，移除散落的 `process.env` 直接存取。
- 把 **module-load 時讀 env 的模組改成 factory**（見下方清單），消除「import 即讀 env」。
- 拆出兩個入口檔：`server.bun.ts`（Bun.serve）與 `worker.ts`（Workers fetch+scheduled），
  共用同一個 `app`。

### module-load 讀 env 的模組必須改 factory（review 點 3）

可行性報告原本說「GitHub、translator 完全不用改」是 **錯的**——它們的 fetch 邏輯確實不用改，
但都在 **top-level const** 讀 `process.env`，在 Workers 上 binding 尚未注入即執行：

| 模組 | 現況（top-level 讀取） | 改法 |
| --- | --- | --- |
| `src/lib/github.ts:15-18` | `GITHUB_TOKEN/OWNER/REPO/DEFAULT_BRANCH` | 改成 `createGithub(env)` factory，回傳含這些 method 的物件 |
| `src/lib/translator.ts:15-17` | `OPENAI_API_KEY/MODEL/BASE_URL` | 改成 `createTranslator(env)` factory |
| `src/lib/prChecker.ts:20-21` | `PR_CHECK_INTERVAL_MS`、`NODE_ENV` | 參數化（INTERVAL 給 self-host 用；DEV flag 從 env 傳入），呼應 #05 |
| `src/lib/r2.ts:16-20` | `R2_ACCOUNT_ID/...` | 由 #04 的 Storage factory 接手 |

caller（`routes/github.ts`、`routes/translate.ts`、`drafts.ts` 等）改成從 `c.var.env`
取得設定、用 factory 建立 client。`GITHUB_DEFAULT_BRANCH` 目前是 `export const`，被
`prChecker.ts` import，改 factory 後要一併調整引用點。

## 實作步驟

1. 新增 `src/app.ts`：只建立並 export Hono `app`（路由 mount），不綁特定 runtime。
2. 定義 `type AppEnv = { Bindings: {...}; Variables: { db: DrizzleDB; env: Env } }`。
3. middleware：`app.use("*", async (c, next) => { c.set("db", makeDb(c)); c.set("env", readEnv(c)); })`。
   - self-host：`makeDb` 回傳啟動時建的單例；`readEnv` 讀 `process.env`。
   - Workers：`makeDb` 用 `c.env.DB`；`readEnv` 讀 `c.env`。
4. route handler 改用 `c.var.db` 取代 import 進來的 db（呼應 #02）。
5. `index.ts` → 拆成 `server.bun.ts`（保留 `Bun.serve`、`startPRChecker`）與
   `worker.ts`（`fetch: app.fetch` + `scheduled`，#05 補內容）。
6. `package.json` scripts：`dev` / `start` 指 `server.bun.ts`；新增 `wrangler dev` 指 `worker.ts`。

## 注意 / 地雷

- CORS：同源部署（Pages → Worker）不觸發 CORS；self-host dev（vite:5173）仍需放行。
  把 `CORS_ORIGIN` 邏輯移進 env provider。
- `Bun.env.PORT` 等 Bun 專屬讀取只能留在 `server.bun.ts`，不可進共用 `app.ts`。
- 確保 `app.ts` 不 import 任何 Bun-only 模組（`bun:sqlite`、`Bun.file` 等），
  否則 Workers bundle 會炸。

## 驗收標準

- [ ] `bun run dev` 經由 `server.bun.ts` 啟動，功能與現況一致。
- [ ] `github.ts` / `translator.ts` / `prChecker.ts` / `r2.ts` 已無 top-level `process.env` 讀取，全部改 factory。
- [ ] route handler 不再直接 import `db` / client 或讀 `process.env`，一律走 `c.var`。
- [ ] `app.ts` 自身不含任何 Bun-only import（但其 mount 的 upload/og 仍會，故見下）。
- [ ] ⚠️ **本 issue 不驗收 `wrangler dev` 跑通完整 app**——upload/og 的 Bun-only / native
      相依要等 #04、#06 清掉。可先用一個只 mount drafts/slug/presets 的精簡 worker entry
      做煙霧測試，證明 runtime 抽象成立即可。完整 Worker 啟動驗收在 #07。
