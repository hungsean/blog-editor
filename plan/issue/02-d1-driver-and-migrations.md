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
   - 接收 env / binding，回傳對應 driver 的 Drizzle 實例
     （self-host → `drizzle-orm/bun-sqlite`；Cloudflare → `drizzle-orm/d1` 從 `c.env.DB` 建）。
   - **不再** 在 module top-level 開 DB（為 #03 Worker 化鋪路）。
6. **repo 層的 query 函數不需改動**——依 #01 的 DB/repo 注入契約，repo 函數簽章已是
   `(db, ...)`，本 issue 只改變「`db` 從哪來」（改由 factory 依環境建立），**repo 與 route
   的 query 寫法完全不動**。#03 會把該 `db` 經 middleware 掛到 `c.var.db` 再傳進 repo。
   > 注意：改的是 db 的「建立 / 取得方式」，不是 repo 函數本身。靜態 import db 單例的寫法
   > 在 #01 已禁止，故這裡不會有「repo 抓到舊單例」的問題。

## 既有 self-host DB 的 baseline 策略（review 點 4）

⚠️ 現有的 `backend/data/blog-editor.db` **已經有三張表 + 三個 migration 欄位**。若直接對它
跑「初始 migration」（`CREATE TABLE`），會與既有表衝突或被 drizzle 視為未套用而重跑。
「刪掉 DB 後重建」只驗證了乾淨安裝，**沒驗證既有 DB 的升級路徑**。必須明確決定 baseline：

選一個策略並落地（建議 **B**）：

- **A. 兼容式 initial SQL** — initial migration 全用 `CREATE TABLE IF NOT EXISTS` /
  `ALTER TABLE ... ` 包 try。簡單，但偏離 drizzle-kit 標準產出，之後 diff 容易亂。
- **B. 標記既有 migration 已套用（baseline，推薦）** — 對既有 DB 手動把 initial migration
  寫進 drizzle 的 migration 紀錄表（`__drizzle_migrations`），等於宣告「schema 已是此版本」，
  之後只跑增量。乾淨 DB 則照常從頭跑。
- **C. 一次性升級腳本** — 寫個 idempotent 腳本對齊既有 DB 到 initial 版本後再交給 drizzle。

無論哪個，都要**用一份既有資料的 DB 副本實測升級**，不能只測乾淨重建。

## 注意 / 地雷

- `db` 從「module 單例」變成「依 request 建立 / 注入」，呼叫端取得 db 的方式會變
  （透過 Hono context）。這部分與 #03 緊密相關，建議兩個 issue 接續做。
- 既有資料的匯入（D1 端）在 #07 處理；本 issue 負責 schema / migration 機制 + self-host baseline。
- drizzle-kit 產的 migration 要 commit 進 repo 並納入 code review。
- D1 是全新空庫，直接套 initial migration 即可，**baseline 問題只存在於既有 self-host DB**。

## 驗收標準

- [ ] `drizzle/` 下有版本化 migration，`generate` 可重複執行。
- [ ] self-host：刪掉本地 DB 後跑 migrate 能重建完整 schema。
- [ ] **既有資料 DB 副本** 跑升級路徑成功（資料不損、不重建表），baseline 策略已落地。
- [ ] 能用 `wrangler d1 create` + `migrations apply` 在 D1 建出相同 schema。
- [ ] 啟動程式不再含 inline `CREATE TABLE` / `ALTER TABLE`。
