
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## 文件規範

- 修改任何函式的行為時，必須同步更新該函式的 JSDoc
- `@remarks` 區塊用來記錄 **why**，不只是 what（限制、地雷、設計決策）
- edge case 和注意事項必須寫在最靠近程式碼的地方，不要只放在 README
- 架構層級的決策和模組關係記錄在此 CLAUDE.md 的「專案架構」章節
- 顯而易見的函式（純 getter、簡單映射）不需要 JSDoc

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
    ├── drafts.ts      # CRUD + /resync + /translations + /slug-check
    ├── github.ts      # /github/posts + /github/sync
    ├── publish.ts     # /publish + /batch-publish + /batch-delete
    ├── translate.ts   # /translate + /ai-translate + /translation-status
    ├── upload.ts      # /upload + /og-hero + /generate-og
    └── presets.ts     # translation presets CRUD
```

### 模組依賴關係

```
drafts.ts  → db.ts, github.ts, frontmatter.ts
github.ts (routes) → db.ts, lib/github.ts, frontmatter.ts
publish.ts → db.ts, github.ts, slugify.ts
translate.ts → db.ts, translator.ts, slugify.ts
upload.ts  → db.ts, r2.ts, ogImage.ts
presets.ts → db.ts
github.ts  → frontmatter.ts（呼叫端解析，github 本身不依賴）
```

### 關鍵設計決策

- **slug 策略**：lang 編碼在目錄路徑中（`src/content/blog/{lang}/{slug}.md`），frontmatter 內不存 lang
- **extra fields**：不在 schema 內的 frontmatter 欄位一律存入 `fields`（JSON 字串），保持彈性
- **GitHub 寫入**：使用低階 Git Object API（blob → tree → commit → ref），避免 Contents API 的單檔限制
- **Migration 策略**：以 try/catch 包裹 `ALTER TABLE ADD COLUMN`，column 已存在時靜默忽略
