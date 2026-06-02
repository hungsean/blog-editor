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

## 目標

- 用 Drizzle 定義 `drafts`、`translation_presets`、`images` 三張表的 schema。
- `src/lib/db.ts` 改成輸出 Drizzle 實例（先包 `drizzle-orm/bun-sqlite`）。
- 所有 `db.query(...)` 改寫為 Drizzle query builder，全面 `await`。
- 受影響的 Hono handler 全部 async 化。

## 範圍（影響檔案）

- `backend/src/lib/db.ts` — 改為 Drizzle 實例 + schema import。
- 新增 `backend/src/lib/schema.ts` — Drizzle table 定義。
- `backend/src/routes/drafts.ts`、`slug.ts`、`github.ts`、`translate.ts`、
  `images.ts`、`presets.ts` — 全部 query 改寫。
- `backend/src/lib/prChecker.ts` — query 改寫（仍是 setInterval，#05 才換）。
- `backend/package.json` — 加 `drizzle-orm`、`drizzle-kit`（dev）。

## 實作步驟

1. `bun add drizzle-orm` + `bun add -d drizzle-kit`。
2. 在 `schema.ts` 用 `sqliteTable` 定義三張表，欄位對齊現有 DDL
   （含 migration 加的 `github_path` / `github_sha` / `slug`）。
3. `db.ts` 改成 `drizzle(new Database(DB_PATH), { schema })`，保留建立資料夾邏輯。
4. 逐檔把 raw SQL 改 Drizzle：
   - `SELECT ... WHERE id = ?` → `db.select().from(drafts).where(eq(drafts.id, id))`
   - `INSERT` → `db.insert(drafts).values(...)`
   - `UPDATE` → `db.update(drafts).set(...).where(...)`
   - `DELETE` → `db.delete(drafts).where(...)`
   - 全部加 `await`，handler 補 `async`。
5. 比對改寫前後的回傳型別，移除原本散落的 `as Draft` 強制轉型（Drizzle 有型別推導）。

## 注意 / 地雷

- `fields`、`tags` 等欄位目前存 JSON 字串，沿用 `text` 型別即可，序列化邏輯不變。
- batch publish / delete 的多筆操作改用 Drizzle 的 `inArray()`。
- prChecker 的 `slugConflict` 等子查詢要逐一驗證改寫後語意一致。
- 依專案規範：改函式行為要同步更新 JSDoc。

## 驗收標準

- [ ] `bun run dev` 啟動正常，三張表建立 / migration 行為與現況一致。
- [ ] drafts CRUD、batch publish/delete、slug 檢查、images、presets、翻譯全部功能正常。
- [ ] 程式碼內已無 `bun:sqlite` 的 `db.query()` 同步呼叫。
- [ ] TypeScript 編譯無錯，型別由 Drizzle 推導。
