# #01 導入 Drizzle ORM 並全面 async 化（self-host 先跑通）

**Phase A — DB 層** ｜ 相依：無（起點）｜ 後續：#02

## 背景

目前 DB 操作全部用 `bun:sqlite` 的 **同步** API（`db.query().get()/.all()/.run()`），
散布在 `src/routes/` 與 `src/lib/prChecker.ts`。要支援 Cloudflare D1，query 介面必須是
**非同步**，而且最好用一層抽象同時相容兩種 driver。主人已選定 **Drizzle ORM**。

> 📝 **精準說明（避免誤解）**：Drizzle 並非「自動把同步變非同步」。`drizzle-orm/bun-sqlite`
> 本身 **同時提供 sync 與 async API**（見官方文件 <https://orm.drizzle.team/docs/connect-bun-sqlite>）；
> 而 `drizzle-orm/d1` **只有 async**。為了讓同一份 query code 兩種 driver 共用，本專案
> **統一規定一律用 `await`（async 寫法）**——這是我們的撰寫約定，不是 Drizzle 的魔法。

本 issue 只做第一步：**導入 Drizzle、定義 schema、把所有 query 改寫成 Drizzle async 風格，
但 driver 仍用 `bun-sqlite`**。目的是在不改變部署方式的前提下完成最大宗的程式改寫，
並確保 self-host 行為零退化。D1 driver 留到 #02。

> 🎯 **同時做 DB lib 化（主人指定）**：不讓 route / prChecker 直接操作 SQL 或 Drizzle
> query builder，而是把所有 DB 存取包成一層**資料存取函數（repository 風格）**。
> **採純函數 + 硬規定，不做 class / 介面抽象（YAGNI）。**

## DB / repo 依賴注入契約（#01–#05 共用，主人已拍板）

這是貫穿整個 DB 層的核心約定，**#01 建立、#02/#03/#05 一律遵循，不得各做各的**：

- **repo 函數一律把 `db` 當第一參數**：`getDraftById(db, id)`、`createDraft(db, values)`…
  repo 檔案**不靜態 import 任何 db 單例**，只 import `schema.ts` 的 table 定義與型別。
- **呼叫端負責提供 `db`**：
  - 本 issue（#01，仍 self-host bun-sqlite）：route 從一個啟動時建立的 db（暫時可由
    `db.ts` export 的單例，或經 Hono context 取得——#03 會把它正規化成 `c.var.db`）取得後
    傳入 repo。**關鍵是 repo 簽章 `(db, ...)` 從現在就定好，之後不再變。**
  - #03 之後：route 用 `getDraftById(c.var.db, id)`；`c.var.db` 由 middleware 依環境注入
    （self-host 單例 / Workers 每 request 從 `c.env.DB` 建）。
  - #05 之後：prChecker / scheduled 用 `runPrChecks(makeDb(env), github, opts)`，
    內部同樣以 `db` 參數呼叫 repo 函數。
- **為什麼這樣設計（給 implementer）**：D1 binding 是 **request/env scoped**，不能在 module
  load 時建好一個全域 db 單例。把 `db` 當參數傳遞，Worker 路徑才能每 request 從 `c.env.DB`
  建 driver；同一份 repo 函數在 self-host（單例）與 Workers（per-request）兩邊都不用改。
  這就是「#02 換 D1 driver 時 repo 與 route 的 query 邏輯不用改，只有 db 的建立方式變」的
  正確版本——**改的是「db 怎麼來」，不是「repo 怎麼寫」**。

## 目標

- 用 Drizzle 定義 `drafts`、`translation_presets`、`images` 三張表的 schema。
- `src/lib/db.ts` 先包 `drizzle-orm/bun-sqlite` 建出 Drizzle 實例（#02/#03 會改成 factory）。
- 新增**資料存取層（repo 層）**：把所有 DB 操作包成具名 async 函數，**`db` 為第一參數**，全面 `await`。
- route / prChecker 改呼叫 repo 函數並把 `db` 傳入，**不再直接寫 Drizzle query builder / SQL**。
- 受影響的 Hono handler 全部 async 化。

## 範圍（影響檔案）

- `backend/src/lib/db.ts` — 建立 Drizzle 實例（bun-sqlite）+ export `DrizzleDB` 型別。
- 新增 `backend/src/lib/schema.ts` — Drizzle table 定義（repo 層 import 它，不 import db 單例）。
- 新增 `backend/src/lib/repos/` — 資料存取層（每張表一檔，純函數，`db` 為第一參數）：
  - `drafts.ts` — `getDraftById(db, id)`、`listDrafts(db)`、`createDraft(db, values)`、
    `updateDraft(db, id, patch)`、`deleteDraft(db, id)`、batch publish/delete、slug 衝突檢查等。
  - `presets.ts` — translation_presets 的 CRUD（同樣 `(db, ...)` 簽章）。
  - `images.ts` — images 的查詢 / 寫入 / 同步列表（同樣 `(db, ...)` 簽章）。
  - 函數簽章用 Drizzle 推導的型別，對外 export domain 型別（取代散落的 `as Draft`）。
- `backend/src/routes/drafts.ts`、`slug.ts`、`github.ts`、`translate.ts`、
  `images.ts`、`presets.ts` — query 改為呼叫 repo 函數。
- `backend/src/lib/prChecker.ts` — query 改為呼叫 repo 函數（仍是 setInterval，#05 才換）。
- `backend/package.json` — 加 `drizzle-orm`、`drizzle-kit`（dev）。

## 實作步驟

1. `bun add drizzle-orm` + `bun add -d drizzle-kit`。
2. 在 `schema.ts` 用 `sqliteTable` 定義三張表，欄位對齊現有 DDL
   （含 migration 加的 `github_path` / `github_sha` / `slug`）。
3. `db.ts` 改成 `drizzle(new Database(DB_PATH), { schema })`，保留建立資料夾邏輯。
4. 在 `repos/` 內把 raw SQL 包成具名函數（用 Drizzle 實作）：
   - `SELECT ... WHERE id = ?` → `getDraftById(id)`，內部 `db.select().from(drafts).where(eq(drafts.id, id))`
   - `INSERT` → `createDraft(values)`，內部 `db.insert(drafts).values(...)`
   - `UPDATE` → `updateDraft(id, patch)`，內部 `db.update(drafts).set(...).where(...)`
   - `DELETE` → `deleteDraft(id)`，內部 `db.delete(drafts).where(...)`
   - 函數一律 async，內部 `await`。
5. route / prChecker 改成呼叫對應 repo 函數並傳入 `db`，handler 補 `async`；**移除 route 內所有
   drizzle / SQL 直接呼叫，route 不再 import `schema.ts` 也不自己組 query builder**。
   route 取得 `db` 的方式在 #01 階段沿用既有單例（#03 後改為 `c.var.db`），但**呼叫 repo 的
   寫法 `getDraftById(db, id)` 從現在就定型、之後不變**。
6. 比對改寫前後的回傳型別，repo 函數回傳 Drizzle 推導型別，移除原本散落的 `as Draft`
   強制轉型（型別由 repo 層單一來源輸出）。

## 注意 / 地雷

- `fields`、`tags` 等欄位目前存 JSON 字串，沿用 `text` 型別即可，序列化邏輯不變。
- batch publish / delete 的多筆操作改用 Drizzle 的 `inArray()`。
- prChecker 的 `slugConflict` 等子查詢要逐一驗證改寫後語意一致。
- 依專案規範：改函式行為要同步更新 JSDoc；repo 函數的 `@remarks` 記錄 query 語意與
  edge case（如 slug 衝突判定、batch 邊界）。
- repo 層保持**純資料存取**，不混入 HTTP / 業務驗證邏輯（那些留在 route）。
- 避免過度抽象：就是一組具名函數，不要做 generic base repository / class 階層。

## 驗收標準

- [ ] `bun run dev` 啟動正常，三張表建立 / migration 行為與現況一致。
- [ ] drafts CRUD、batch publish/delete、slug 檢查、images、presets、翻譯全部功能正常。
- [ ] 程式碼內已無 `bun:sqlite` 的 `db.query()` 同步呼叫。
- [ ] **所有 DB 操作都集中在 `lib/repos/`；route 與 prChecker 內無 drizzle query builder，
      不 import `schema.ts`，也不自組 SQL**（只 import repo 函數並把 `db` 傳入）。
- [ ] **repo 函數一律 `(db, ...)` 簽章，repo 檔案不靜態 import db 單例**（注入契約成立）。
- [ ] TypeScript 編譯無錯，型別由 Drizzle 經 repo 層推導輸出。
