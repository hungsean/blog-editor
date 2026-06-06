## 執行

```sh
bun run dev   # bun --hot index.ts
bun run start # bun index.ts
```

## DB schema / migrations（#02）

schema 由 `drizzle/` 下版本化的 migration 管理，不再 inline `CREATE TABLE` / `ALTER TABLE`。

```sh
bun run db:generate     # 改 schema.ts 後產生新 migration（commit 進 repo）
bun run db:baseline     # 既有資料 DB 首次升級前：標記初始 migration 已套用（空庫自動略過）
bun run db:migrate      # self-host：套用尚未套用的 migration（= db.ts 啟動路徑）
bun run db:migrate:d1   # D1（遠端）：wrangler d1 migrations apply --remote（需先 wrangler d1 create + 填 wrangler.toml）
bun run db:migrate:d1:local  # D1（本地模擬，--local）：開發測試 schema 用，不碰雲端
```

- **既有 self-host DB 必須先 `db:baseline`**，否則初始 migration 的 `CREATE TABLE` 會與既有表衝突（策略 B，見 `scripts/baseline.ts`）。docker-entrypoint 已自動 baseline → migrate。
- migration 為**唯一 schema 來源**：production（`db.ts`）、測試（`makeTestDb`）、D1 共用同一批檔。

## Bun APIs

用 Bun 原生 API，不要引入對應的 npm 套件：

- `Bun.serve()` — HTTP server + WebSocket，不用 express
- `bun:sqlite` — SQLite，不用 better-sqlite3
- `Bun.redis` — Redis，不用 ioredis
- `Bun.sql` — Postgres，不用 pg/postgres.js
- `Bun.file` — 檔案讀寫，優先於 node:fs 的 readFile/writeFile
- `Bun.$\`cmd\`` — shell，不用 execa
- `WebSocket` 內建，不用 ws

## 專案架構

```
src/
├── types.ts           # 共用型別：Draft、TranslationPreset（再匯出 lib/schema 的推導型別）
├── lib/
│   ├── db.ts          # dual-driver factory（bun-sqlite / d1）+ runMigrations + DrizzleDB 型別 + transitional 單例
│   ├── schema.ts      # Drizzle table 定義（drafts / translation_presets / images）與推導型別
│   ├── repos/         # 資料存取層（repository 風格，純函數，db 為第一參數）
│   │   ├── drafts.ts  # drafts 的 CRUD / slug 衝突 / batch / prChecker 查詢
│   │   ├── presets.ts # translation_presets 的 CRUD
│   │   └── images.ts  # images 的 list / upsert / insert
│   ├── frontmatter.ts # Markdown frontmatter 解析與轉換（純函式，無 side effect）
│   ├── github.ts      # GitHub REST API 封裝：讀取文章、開 PR
│   ├── ogImage.ts     # Satori OG 圖片生成
│   ├── prChecker.ts   # PR 狀態輪詢（merged → 更新 draft status）
│   ├── r2.ts          # Cloudflare R2 圖片上傳（S3 相容 API）
│   ├── slugify.ts     # URL-safe slug 轉換（publish/translate 共用）
│   └── translator.ts  # OpenAI API 翻譯功能
└── routes/
    ├── api.ts         # 僅 mount 子 router（~15 行）
    ├── drafts.ts      # CRUD + /publish + /resync + /translations（batch delete/publish 也在此）
    ├── slug.ts        # /slug（slug 可用性檢查）
    ├── github.ts      # /github/posts + /github/sync
    ├── translate.ts   # /translation/status + /translation（純翻譯，不建立草稿）
    ├── upload.ts      # /upload/r2 + /upload/temp（OG 圖片生成已移至前端）
    ├── images.ts      # /images + /images/sync + /images/upload（圖片庫）
    └── presets.ts     # translation presets CRUD
```

### 模組依賴關係

```
drafts.ts  → db.ts, repos/drafts, github.ts, frontmatter.ts, slugify.ts
slug.ts    → db.ts, repos/drafts
github.ts (routes) → db.ts, repos/drafts, lib/github.ts, frontmatter.ts
translate.ts → db.ts, repos/presets, translator.ts
upload.ts  → r2.ts
images.ts  → db.ts, repos/images, r2.ts
presets.ts → db.ts, repos/presets
prChecker.ts → db.ts, repos/drafts, lib/github.ts
repos/*    → schema.ts（只 import table 定義與型別，不 import db 單例）
```

### 關鍵設計決策

- **DB 存取分層（#01）**：所有 SQL / Drizzle query 都集中在 `lib/repos/`，route 與 prChecker
  只呼叫具名 repo 函數，不自組 query。route 不 import `schema.ts`。
- **DB 注入契約**：repo 函數一律 `(db, ...)` 簽章，`db` 由呼叫端傳入；repo 檔不 import db 單例。
  為 #02（D1 driver，request/env scoped）鋪路——換 driver 時只改「db 怎麼來」，repo 不動。
- **async 約定**：`drizzle-orm/bun-sqlite` 同時有 sync/async API，但本專案一律用 `await`，
  讓同一份 query code 之後能直接套用只有 async 的 `drizzle-orm/d1`。
- **dual-driver factory（#02）**：`db.ts` 不再 module top-level 開唯一 DB，而是提供
  `createBunSqliteDb` / `createD1Db` / `runMigrations` 工廠；`DrizzleDB` 改為涵蓋兩 driver 的
  共同基底型別 `BaseSQLiteDatabase<'sync'|'async', any, schema>`（用聯集會讓 `.select()` 多載失效）。
  目前仍保留 transitional 單例供 route / prChecker `import { db }`，#03 改 `c.var.db` 後移除。
- **schema 欄位 nullable**：`schema.ts` 對有 DEFAULT 的欄位標 `.notNull().default()`，
  讓推導型別為非空字串、insert 仍可省略。實際 DDL 由 `drizzle/` migration 產生（NOT NULL）。
- **slug 策略**：lang 編碼在目錄路徑中（`src/content/blog/{lang}/{slug}.md`），frontmatter 內不存 lang
- **extra fields**：不在 schema 內的 frontmatter 欄位一律存入 `fields`（JSON 字串），保持彈性
- **GitHub 寫入**：使用低階 Git Object API（blob → tree → commit → ref），避免 Contents API 的單檔限制
- **Migration 策略（#02）**：schema 變更走 `bun run db:generate` 產生版本化 migration 並 commit；
  既有 self-host DB 用 baseline（策略 B）標記初始版本後只跑增量。已淘汰原本的 inline `ALTER TABLE` try/catch。
