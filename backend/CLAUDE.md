## 執行

```sh
bun run dev         # bun --hot server.bun.ts（self-host 開發，熱重載）
bun run start       # bun server.bun.ts（self-host 正式）
bun run dev:worker  # wrangler dev（Cloudflare Workers 入口 worker.ts）
```

兩個入口共用 `src/app.ts` 的 runtime 抽象（#03）：

- `server.bun.ts` — self-host（Bun）。開 `bun:sqlite` → migrate → 建 db 單例，讀一次 `process.env`，
  起 `Bun.serve`，啟動 `startPRChecker` 常駐輪詢。Bun-only / 常駐的東西只能放這裡。
- `worker.ts` — Cloudflare Workers。每 request 從 `c.env.DB`（D1 binding）建 db、讀 `c.env`。
  **#03 為精簡煙霧子集**：只 mount `drafts` / `slug` / `presets`（其餘 `upload` / `og` 因 Bun-only /
  native 相依，待 #04 / #06 清掉後才掛；完整啟動 + `nodejs_compat` 在 #07）。

## DB schema / migrations（#02）

schema 由 `drizzle/` 下版本化的 migration 管理，不再 inline `CREATE TABLE` / `ALTER TABLE`。

```sh
bun run db:generate     # 改 schema.ts 後產生新 migration（commit 進 repo）
bun run db:baseline     # 既有資料 DB 首次升級前：標記初始 migration 已套用（空庫自動略過）
bun run db:migrate      # self-host：套用尚未套用的 migration（= server.bun.ts 啟動的 runMigrations 路徑）
bun run db:migrate:d1   # D1（遠端）：wrangler d1 migrations apply --remote（需先 wrangler d1 create + 填 wrangler.toml）
bun run db:migrate:d1:local  # D1（本地模擬，--local）：開發測試 schema 用，不碰雲端
```

- **既有 self-host DB 必須先 `db:baseline`**，否則初始 migration 的 `CREATE TABLE` 會與既有表衝突（策略 B，見 `scripts/baseline.ts`）。docker-entrypoint 已自動 baseline → migrate。
- migration 為**唯一 schema 來源**：production（`server.bun.ts` → `db.bun.ts` 的 `runMigrations`）、
  測試（`makeTestDb`）、D1 共用同一批檔。

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
server.bun.ts          # self-host（Bun）入口：開 bun:sqlite → migrate → 建單例 + Bun.serve + prChecker
worker.ts              # Cloudflare Workers 入口：每 request 用 c.env.DB / c.env（#03 為精簡煙霧子集）
src/
├── app.ts             # createApp：runtime middleware + 全部 /api 路由（self-host / 測試用，import 完整 api）
├── runtime.ts         # AppEnv 型別 / RuntimeProviders / installRuntime（無路由、無 Bun-only，worker 也用）
├── types.ts           # 共用型別：Draft、TranslationPreset（再匯出 lib/schema 的推導型別）
├── lib/
│   ├── env.ts         # readEnv(source) provider：把 process.env / c.env 解析成 Env（GitHub/OpenAI/R2/CORS…）
│   ├── db.ts          # runtime-中立：DrizzleDB 型別 + createD1Db（D1）。不 import bun:sqlite / node:path
│   ├── db.bun.ts      # self-host 專屬：createBunSqliteDb + runMigrations + MIGRATIONS_FOLDER（import bun:sqlite）
│   ├── schema.ts      # Drizzle table 定義（drafts / translation_presets / images）與推導型別
│   ├── repos/         # 資料存取層（repository 風格，純函數，db 為第一參數）
│   │   ├── drafts.ts  # drafts 的 CRUD / slug 衝突 / batch / prChecker 查詢
│   │   ├── presets.ts # translation_presets 的 CRUD
│   │   └── images.ts  # images 的 list / upsert / insert
│   ├── frontmatter.ts # Markdown frontmatter 解析與轉換（純函式，無 side effect）
│   ├── github.ts      # createGithub(env) factory：GitHub REST API（讀文章、開 PR）
│   ├── ogImage.ts     # Satori OG 圖片生成
│   ├── prChecker.ts   # startPRChecker(deps)：PR 狀態輪詢（merged → 更新 draft status），依賴注入
│   ├── r2.ts          # createR2(env) factory：Cloudflare R2 圖片上傳（S3 相容 API）
│   ├── slugify.ts     # URL-safe slug 轉換（publish/translate 共用）
│   └── translator.ts  # createTranslator(env) factory：OpenAI API 翻譯功能
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

route 不再 import db 單例 / lib function；DB 經 `c.var.db`、設定經 `c.var.env`、外部服務經
factory（`createGithub` / `createR2` / `createTranslator`）每 request 建。型別 `AppEnv` 由
`src/app.ts`（route）/ `src/runtime.ts`（worker）提供，皆為 `import type`（erased，不進 runtime bundle）。

```
server.bun.ts → app.ts, lib/db.bun.ts, lib/db.ts, lib/env.ts, lib/github.ts, lib/prChecker.ts
worker.ts     → runtime.ts, lib/db.ts(createD1Db), lib/env.ts, routes/{drafts,slug,presets}
app.ts        → runtime.ts, routes/api.ts（→ 全部 route）
runtime.ts    → hono/cors, type DrizzleDB, type Env（無路由、無 Bun-only）
drafts.ts  → c.var.db→repos/drafts, createGithub, frontmatter.ts, slugify.ts
github.ts (routes) → c.var.db→repos/drafts, createGithub, frontmatter.ts
translate.ts → c.var.db→repos/presets, createTranslator
upload.ts  → createR2（+ node:fs / Bun.file，self-host only）
images.ts  → c.var.db→repos/images, createR2
presets.ts / slug.ts → c.var.db→repos/*
prChecker.ts → 注入 db / github client（不 import db 單例 / lib function）
lib/github|translator|r2.ts → lib/env.ts（型別）；module load 不讀 process.env
repos/*    → schema.ts（只 import table 定義與型別，不 import db 單例）
```

### 關鍵設計決策

- **DB 存取分層（#01）**：所有 SQL / Drizzle query 都集中在 `lib/repos/`，route 與 prChecker
  只呼叫具名 repo 函數，不自組 query。route 不 import `schema.ts`。
- **DB 注入契約**：repo 函數一律 `(db, ...)` 簽章，`db` 由呼叫端傳入；repo 檔不 import db 單例。
  為 #02（D1 driver，request/env scoped）鋪路——換 driver 時只改「db 怎麼來」，repo 不動。
- **async 約定**：`drizzle-orm/bun-sqlite` 同時有 sync/async API，但本專案一律用 `await`，
  讓同一份 query code 之後能直接套用只有 async 的 `drizzle-orm/d1`。
- **Runtime 抽象（#03）**：`src/app.ts` / `src/runtime.ts` 提供 runtime-中立的 app，db / env 來源由
  入口注入 `RuntimeProviders`（`makeDb` / `readEnv`）。middleware 每 request 把 `c.var.db`、`c.var.env`
  掛好，route handler 一律經此取用，**不 import db 單例 / lib function / 讀 `process.env`**。
  self-host（`server.bun.ts`）`makeDb` 回 bun-sqlite 單例、`readEnv` 讀 `process.env`；Workers
  （`worker.ts`）`makeDb` 用 `c.env.DB` D1 binding 每 request 建、`readEnv` 讀 `c.env`。
- **env provider（#03）**：`lib/env.ts` 的 `readEnv(source)` 是唯一的環境變數讀取點（純函數），
  把 `process.env` / `c.env` 解析成 `Env`。**消除「import 即讀 env」**——`github` / `translator` / `r2`
  改成 `createX(env)` factory（module load 不再讀 `process.env`），Workers 上 binding 才來得及注入。
- **factory 而非單例（#03）**：外部服務 client（GitHub / R2 / translator）每 request 由 `c.var.env`
  建（成本只是綁 closure）。`db.ts` 拆成 runtime-中立（`createD1Db` + 型別，**不** import `bun:sqlite` /
  `node:path`）與 self-host 專屬的 `db.bun.ts`（`createBunSqliteDb` / `runMigrations`），確保
  `worker.ts` 的 bundle 不含 `bun:sqlite`。`DrizzleDB` 為涵蓋兩 driver 的共同基底型別
  `BaseSQLiteDatabase<'sync'|'async', any, schema>`（用聯集會讓 `.select()` 多載失效）。
- **Workers bundle 純淨度（#03）**：`runtime.ts` 與 route 的 `AppEnv` 一律 `import type`（erased）；
  `worker.ts` 不 import `app.ts`（否則連帶 `routes/api.ts` → `upload`/`og` 的 `node:fs` / `@resvg/resvg-js`
  native 相依會進 bundle）。`github.ts` 的 `Buffer` base64 留待 #07 開 `nodejs_compat`。
- **schema 欄位 nullable**：`schema.ts` 對有 DEFAULT 的欄位標 `.notNull().default()`，
  讓推導型別為非空字串、insert 仍可省略。實際 DDL 由 `drizzle/` migration 產生（NOT NULL）。
- **slug 策略**：lang 編碼在目錄路徑中（`src/content/blog/{lang}/{slug}.md`），frontmatter 內不存 lang
- **extra fields**：不在 schema 內的 frontmatter 欄位一律存入 `fields`（JSON 字串），保持彈性
- **GitHub 寫入**：使用低階 Git Object API（blob → tree → commit → ref），避免 Contents API 的單檔限制
- **Migration 策略（#02）**：schema 變更走 `bun run db:generate` 產生版本化 migration 並 commit；
  既有 self-host DB 用 baseline（策略 B）標記初始版本後只跑增量。已淘汰原本的 inline `ALTER TABLE` try/catch。
- **舊 DB schema 收斂（`0001`）**：baseline 只標記 `__drizzle_migrations`、不改實體 schema，所以舊
  `applySchema` 建立的 DB 仍與 `0000`（clean DB / D1）有 NOT NULL drift——舊版多數欄位只有 `DEFAULT ''`
  而無 NOT NULL，且 `TEXT PRIMARY KEY` 在 SQLite 會留下 `notnull=0`。`0001_normalize_drafts_not_null.sql`
  以 table rebuild 收斂 `drafts` 八個欄位與 `translation_presets.id` / `images.key` 的 NOT NULL parity
  （`COALESCE` 把殘留 NULL 補回 default）。對 clean DB / D1 為等價重建、安全無副作用，確保三邊 schema 一致。
  注意：因 schema.ts / `0000` 早已是 NOT NULL，此類 drift `db:generate` **不會**產生 diff，需 `--custom` 手寫。
