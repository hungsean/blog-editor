# #02 D1 driver 與 drizzle-kit migrations（dual-driver 切換）

**Phase A — DB 層** ｜ 相依：#01 ｜ 後續：#03、#07

## 背景

#01 完成後，DB 已是 Drizzle（bun-sqlite driver）。本 issue 讓 **同一份 schema 與 query**
也能跑在 **Cloudflare D1**，並用 drizzle-kit 管理 migration——這正是主人說的「比較好處理
merge 問題的套件」的價值：schema 變更集中在一份 TypeScript 定義，migration 由工具產生並
版本化，避免手寫 `ALTER TABLE` 在多分支間衝突。

## 「D1 上是否需要」這個套件？

**需要，而且更需要。** 原因：

- self-host 的 `bun:sqlite` 可以在啟動時 `db.exec(CREATE TABLE ...)` 即時建表；
  但 **D1 不能在 Worker 啟動 / module 載入時建表**（Worker 無 top-level 持久狀態，
  binding 只在 request context）。D1 的 schema 必須靠 **`wrangler d1 migrations`** 在
  **部署階段** 套用。
- drizzle-kit 從 `schema.ts` 產生 SQL migration 檔，self-host 與 D1 共用同一批 migration，
  確保兩邊 schema 永遠一致。這就是用 ORM 換來的最大好處。

## 目標

- 設定 `drizzle.config.ts`，產出 migration 檔。
- `db.ts` 依環境選 driver：self-host → `drizzle-orm/bun-sqlite`；
  Cloudflare → `drizzle-orm/d1`（從 `c.env.DB` binding 建）。
- 移除啟動時的 `CREATE TABLE` / `ALTER TABLE`，改由 migration 管理。

## 實作步驟

1. `drizzle.config.ts`：`dialect: "sqlite"`、`schema: ./src/lib/schema.ts`、`out: ./drizzle`。
2. `bunx drizzle-kit generate` 產生初始 migration（對應現有三張表 + 既有欄位）。
3. self-host：啟動腳本跑 `bunx drizzle-kit migrate`（或 `drizzle-orm/bun-sqlite/migrator`）。
4. D1：`wrangler.toml` 設 `[[d1_databases]]` binding；用 `wrangler d1 migrations apply` 套用
   同一批 `drizzle/` migration（drizzle-kit 產的 SQL 與 D1 相容）。
5. `db.ts` 改成 factory：
   - 接收 env / binding，回傳對應 driver 的 Drizzle 實例。
   - **不再** 在 module top-level 開 DB（為 #03 Worker 化鋪路）。
6. query 程式碼因為走 Drizzle 抽象，**理論上不需改動**（#01 已 async 化）。

## 注意 / 地雷

- `db` 從「module 單例」變成「依 request 建立 / 注入」，呼叫端取得 db 的方式會變
  （透過 Hono context）。這部分與 #03 緊密相關，建議兩個 issue 接續做。
- 既有資料的匯入在 #07 處理，本 issue 只負責 schema / migration 機制。
- drizzle-kit 產的 migration 要 commit 進 repo 並納入 code review。

## 驗收標準

- [ ] `drizzle/` 下有版本化 migration，`generate` 可重複執行。
- [ ] self-host：刪掉本地 DB 後跑 migrate 能重建完整 schema。
- [ ] 能用 `wrangler d1 create` + `migrations apply` 在 D1 建出相同 schema。
- [ ] 啟動程式不再含 inline `CREATE TABLE` / `ALTER TABLE`。
