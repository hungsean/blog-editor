<div align="center">

# Blog Editor

**一站式部落格草稿管理工具 — 寫作、預覽、翻譯、發佈，一氣呵成**

從 Markdown 編輯到開 GitHub PR 發佈，全流程在同一個編輯器內完成。

<br />

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-000000?logo=bun&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-API-E36002?logo=hono&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%7C%20R2%20%7C%20D1-F38020?logo=cloudflare&logoColor=white)

</div>

---

## 這是什麼

Blog Editor 是一個自架的部落格草稿管理後台。你在這裡寫 Markdown、即時預覽、管理 frontmatter，
完稿後一鍵翻譯成多語版本，並直接對你的部落格 Git repo 開 Pull Request 發佈 —— 不必離開編輯器，
也不必手動 commit。

適合用 **GitHub repo 存放文章原始碼**（如 Astro / Hugo / 11ty 之類的 static site）的部落格作者。

## 特色

- 📝 **Markdown 編輯器** — CodeMirror 6 驅動，語法高亮、即時雙欄預覽（marked + highlight.js）
- 🗂️ **Frontmatter 欄位面板** — 標題、日期、標籤等結構化欄位，非預期欄位自動保留在 `fields`
- 🖼️ **圖片庫** — 上傳至 Cloudflare R2，對話框挑圖直接插入，支援與既有圖片同步
- 🌐 **AI 翻譯** — 透過 OpenAI 相容 API 一鍵翻譯，可自訂翻譯 preset
- 🎨 **OG 圖片生成** — 以 Satori 動態產生社群分享預覽圖
- 🚀 **GitHub PR 發佈** — 用低階 Git Object API 直接開 PR，並自動輪詢 PR 狀態（merged → 更新草稿）
- ☁️ **雙運行環境** — 同一份程式碼可跑在 self-host（Bun + SQLite）或 Cloudflare Workers（D1）
- 🔒 **安全部署** — 預設只綁 `127.0.0.1`，對外存取一律經 Cloudflare Access

## 技術棧

| 層級         | 技術 |
| ------------ | ---- |
| **前端**     | React 19、TypeScript、Vite 7、Tailwind CSS v4、shadcn/ui、wouter、CodeMirror 6 |
| **後端**     | Bun、Hono、Drizzle ORM、SQLite（self-host）/ D1（Workers） |
| **外部服務** | GitHub REST API、OpenAI API、Cloudflare R2 |
| **部署**     | Docker Compose（nginx + Bun）、Cloudflare Access |

## 專案結構

```text
blog-editor/
├── frontend/          # React + Vite + Tailwind，編輯器 UI
├── backend/           # Bun + Hono REST API（亦可部署為 Cloudflare Worker）
├── docker-compose.yml # nginx（唯一入口）+ backend API
└── plan/              # issue 規劃與 review 規範
```

> 子專案各有獨立的開發說明，請見 [`frontend/CLAUDE.md`](frontend/CLAUDE.md) 與 [`backend/CLAUDE.md`](backend/CLAUDE.md)。

## 快速開始

### 需求

- [Bun](https://bun.sh)（兩個子專案皆用 Bun 管理）
- 一個用來存放文章的 GitHub repo + Personal Access Token
- （選用）Cloudflare R2 與 OpenAI API 金鑰

### 本機開發

```bash
# 1. 後端
cd backend
bun install
cp .env.example .env       # 填入 GitHub / R2 / OpenAI 設定
bun run dev                # http://localhost:3000

# 2. 前端（另開一個終端機）
cd frontend
bun install
cp .env.example .env       # 預設指向 http://localhost:3000
bun run dev                # Vite dev server
```

### 環境變數

後端的主要設定（完整清單見 [`backend/.env.example`](backend/.env.example)）：

| 變數 | 說明 |
| ---- | ---- |
| `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` | 文章發佈目標 repo |
| `R2_*` | Cloudflare R2 圖片上傳設定 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | AI 翻譯設定 |
| `CORS_ORIGIN` | 允許的前端來源（docker 部署同源代理時可留空） |

## Docker 部署

根目錄的 `docker-compose.yml` 定義兩個服務：

- **frontend** — nginx 提供 Vite 靜態檔案，並反向代理 `/api` 至 backend（唯一對外入口）
- **backend** — Bun + Hono API，僅在 compose 內網開放，資料持久化於 `blog-editor-data` volume

```bash
# 先依 backend/.env.example 填好 backend/.env
docker compose up -d --build
```

服務只綁 `127.0.0.1:3000`，預期對外存取一律透過 Cloudflare Access（同主機的 `cloudflared` 連入）。

## 常用指令

**後端**（`backend/`）

```bash
bun run dev            # 熱重載開發（Bun self-host）
bun run start          # 正式啟動（self-host）
bun run dev:worker     # 以 Cloudflare Workers 入口開發（wrangler dev）
bun test               # 執行測試
bun run db:generate    # 改 schema 後產生 migration
bun run db:migrate     # 套用 migration（self-host）
```

**前端**（`frontend/`）

```bash
bun run dev            # Vite dev server
bun run build          # 產生靜態檔案
bun run preview        # 預覽 build 結果
```

## 架構亮點

- **Runtime 抽象** — `src/app.ts` / `src/runtime.ts` 提供 runtime-中立的 app，db 與 env 來源由入口注入；
  self-host 走 `bun:sqlite` 單例，Workers 走 D1 binding 每 request 建立。
- **Repository 分層** — 所有 Drizzle query 集中在 `lib/repos/`，route 只呼叫具名函數、不自組 SQL。
- **版本化 migration** — schema 變更走 `drizzle-kit generate`，self-host / 測試 / D1 共用同一批 migration。
- **factory 而非單例** — GitHub / R2 / translator client 每 request 由設定建立，確保 Workers bundle 純淨。


