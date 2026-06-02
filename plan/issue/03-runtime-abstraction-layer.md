# #03 Runtime 抽象層：入口 / env / Hono 雙 adapter

**Phase B — 後端 Workers 化** ｜ 相依：#02 ｜ 後續：#04、#05、#06

## 背景

Hono 本身在 Bun 與 Workers 上都能跑，但兩種環境的 **入口形式**、**環境變數來源**、
**DB binding 取得方式** 不同。本 issue 建立一層薄抽象，讓同一個 `app` 兩邊都能用，
這是後續 #04 ~ #06 的地基。

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
- 拆出兩個入口檔：`server.bun.ts`（Bun.serve）與 `worker.ts`（Workers fetch+scheduled），
  共用同一個 `app`。

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
- [ ] `wrangler dev` 經由 `worker.ts` 能啟動並回應基本 API（DB 走 local D1）。
- [ ] route handler 不再直接 import `db` 或讀 `process.env`，一律走 context。
- [ ] `app.ts` 不含任何 Bun-only import。
