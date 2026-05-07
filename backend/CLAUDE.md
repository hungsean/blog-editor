## 執行

```sh
bun run dev   # bun --hot index.ts
bun run start # bun index.ts
```

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
├── types.ts           # 共用型別：Draft、TranslationPreset
├── lib/
│   ├── db.ts          # SQLite 初始化與 migrations（Bun 啟動時執行，top-level await）
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
    └── presets.ts     # translation presets CRUD
```

### 模組依賴關係

```
drafts.ts  → db.ts, github.ts, frontmatter.ts, slugify.ts
slug.ts    → db.ts
github.ts (routes) → db.ts, lib/github.ts, frontmatter.ts
translate.ts → db.ts, translator.ts
upload.ts  → r2.ts
presets.ts → db.ts
github.ts  → frontmatter.ts（呼叫端解析，github 本身不依賴）
```

### 關鍵設計決策

- **slug 策略**：lang 編碼在目錄路徑中（`src/content/blog/{lang}/{slug}.md`），frontmatter 內不存 lang
- **extra fields**：不在 schema 內的 frontmatter 欄位一律存入 `fields`（JSON 字串），保持彈性
- **GitHub 寫入**：使用低階 Git Object API（blob → tree → commit → ref），避免 Contents API 的單檔限制
- **Migration 策略**：以 try/catch 包裹 `ALTER TABLE ADD COLUMN`，column 已存在時靜默忽略
