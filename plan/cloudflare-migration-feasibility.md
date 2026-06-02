# Cloudflare 全家桶遷移可行性報告

> 目標架構：前端 → **Cloudflare Pages**、後端 → **Workers**、資料庫 → **D1**
> 撰寫日期：2026-06-02
> 對象 commit：`404d343`（branch `43-frontend-add-context`）

> **更新（依主人確認的方向）**
> - 終極目標是一套程式 **同時 self-host 與 deploy on Cloudflare**，非單向遷移。
> - DB 採 **Drizzle ORM** 抽象（`bun-sqlite` ⇄ `d1` 雙 driver），順便解決同步/非同步改寫。
> - 推進順序：**DB → 後端 → 前端**。
> - **OG 圖片生成仍在後端**（satori + `@resvg/resvg-js`），尚未遷移；已列為高風險 issue。
> - 詳細執行拆解見 → [`issue/`](./issue/)（`00-epic` 為總覽）。

---

## TL;DR（結論先講）

| 子系統 | 目標平台 | 可行性 | 工作量 |
| --- | --- | --- | --- |
| 前端 React + Vite | Pages | ✅ 幾乎零改動 | 0.5 天 |
| 後端 Hono API | Workers | ⚠️ 可行但要改寫 | 3 ~ 5 天 |
| SQLite | D1 | ⚠️ 全部 query 要改 async | 後端工作量的大宗 |
| R2 圖片上傳 | R2 binding | ✅ 反而更乾淨 | 0.5 天 |
| OG 圖片生成 | — | ❌ 有原生相依，需取捨 | 視決策而定 |
| PR 輪詢 | Cron Triggers | ⚠️ 架構要換 | 1 天 |

**整體結論：可行，而且很適合**。前端搬上 Pages 幾乎是免費午餐；後端因為大量使用 Bun 原生同步 API（`bun:sqlite`、`Bun.file`、`setInterval` 常駐輪詢），需要一輪有計劃的改寫才能跑在 Workers 的 request/response 模型上。最大的硬骨頭是 **OG 圖片生成用到的 `@resvg/resvg-js` 原生模組**，這在 Workers 上跑不動，需要單獨決策。

---

## 一、前端 → Cloudflare Pages

### 現況

- `frontend/` 是純 React 19 + Vite 7 SPA，`bun run build` 產出靜態 `dist/`。
- 目前用 nginx 提供靜態檔案 + 反向代理 `/api`（見 `frontend/nginx.conf`、`docker-compose.yml`）。
- API base URL 透過 `VITE_API_URL` 環境變數注入，docker 部署時留空 → 走相對路徑 `/api`。

### 評估：✅ 最沒有懸念的一塊

Pages 天生就是給這種 Vite SPA 用的：

1. 直接連 GitHub repo，build command 設 `cd frontend && bun install && bun run build`，輸出目錄 `frontend/dist`。
2. `/api` 的代理改用 **Pages Functions 的 `_routes.json`** 或設一條 rewrite，把 `/api/*` 轉發到 Workers（或讓前端直接打 Workers 的 custom domain）。
3. SPA fallback（所有路由回 `index.html`）Pages 內建支援，不需要像 nginx 那樣手寫 `try_files`。

### 要注意的小地方

- 目前 `VITE_API_URL` 的注入方式可以沿用，但建議遷移後讓前端與 Worker **同源**（同一個 domain 下 `/api` 走 Pages → Worker binding），就能完全免掉 CORS 設定（`index.ts` 裡那段 CORS 邏輯在同源下不會觸發）。
- nginx.conf 與 frontend 的 Dockerfile 遷移後可以退役。

---

## 二、後端 → Workers（重頭戲）

後端是 Bun + Hono。Hono **本來就是為 Workers 設計的框架**，所以路由層幾乎可以無痛搬遷——`app.fetch` 的 export 形式跟 Workers 的 `fetch` handler 完全契合。問題不在 Hono，而在我們大量依賴的 **Bun 原生 API**，這些在 Workers runtime（workerd）上不存在。

### 2.1 阻礙點盤點

#### 🔴 阻礙 A — `bun:sqlite` 是同步 API，D1 是非同步（最大工作量）

目前全專案的 DB 操作都是 **同步** 風格（`bun:sqlite` 特性）：

```ts
// 現在（同步）
const draft = db.query("SELECT * FROM drafts WHERE id = ?").get(id) as Draft;
db.query("UPDATE drafts SET ...").run(...);
```

D1 的 API 是 **非同步** 且綁定在 request 的 `env` 上：

```ts
// D1（非同步，binding 從 env 取得）
const draft = await env.DB.prepare("SELECT * FROM drafts WHERE id = ?").bind(id).first<Draft>();
await env.DB.prepare("UPDATE drafts SET ...").bind(...).run();
```

影響範圍：`src/routes/` 下 `drafts.ts`、`slug.ts`、`github.ts`、`translate.ts`、`images.ts`、`presets.ts` 與 `lib/prChecker.ts`，幾乎每個檔案都有 DB 呼叫（後端共 ~2300 行）。每一處 `.get()/.all()/.run()` 都要：

1. 改成 `await`，連帶 handler 全部 async 化（多數 Hono handler 已可直接 async，改動不算傷筋動骨，但量大）。
2. `db` 不能再是 `import` 進來的 module 單例——D1 binding 只在 request context 的 `env` 裡。需要透過 Hono 的 context（`c.env.DB`）傳遞，或用中介層注入。

> ⚠️ 連帶問題：`src/lib/db.ts` 用了 **top-level await** 建 DB 與 migration。Workers **沒有** top-level 持久狀態，也不能在 module 載入時碰 binding。Migration 要改用 **Wrangler migrations**（`wrangler d1 migrations`）在部署時跑，而非啟動時 `ALTER TABLE`。

SQL 語法本身相容性高（D1 底層就是 SQLite），`CREATE TABLE`、`ALTER TABLE ADD COLUMN` 都支援，schema 可以幾乎原封不動轉成 migration 檔。

#### 🔴 阻礙 B — OG 圖片生成相依原生模組

`src/lib/ogImage.ts` 用了：

- `satori`（純 JS，**Workers 可跑**）
- `@resvg/resvg-js`（**原生 Node addon，Workers 跑不動**）
- `Bun.file` / `Bun.write` / `mkdir` 做字型快取到 `data/fonts/`（**Workers 無檔案系統**）

**已查證（更正）**：OG 生成 **仍在後端**——`api.ts` 有 `api.route("/", og)`，`og.ts`
的 `/og/preview`、`/og/upload` 呼叫 `generateArticleOg()`，前端 `lib/api/og.ts` 只是打這兩個
endpoint。**尚未遷移**。

決議：採 **`@resvg/resvg-wasm` + satori**，字型改存 R2、lazy load 後在 isolate 記憶體快取，
移除 `data/fonts/` 磁碟依賴。self-host 走同一條 wasm 路徑，維持單一程式碼。
（注意 Worker bundle 大小上限與 CJK 字型體積——必要時 subset。）
→ 詳見 [`issue/06-og-image-on-workers.md`](./issue/06-og-image-on-workers.md)。

#### 🟡 阻礙 C — `prChecker` 用 `setInterval` 常駐輪詢

`startPRChecker()` 在 `index.ts` 啟動時呼叫，用 `setInterval` 每 60 秒輪詢 GitHub PR 狀態。Workers **沒有常駐 process**，`setInterval` 不適用。

**解法：改用 Cron Triggers**（Workers 內建排程）。把 `checkOnce()` 與 `checkDraftsExistOnGithub()` 搬進 Worker 的 `scheduled(event, env, ctx)` handler，`wrangler.toml` 設 `crons = ["* * * * *"]`（每分鐘）。這反而比 setInterval 更穩，不會因為 Worker 重啟而漏掉。

> 注意：Cron handler 也吃同一份 D1 binding，所以阻礙 A 的改寫一樣涵蓋它。

#### 🟡 阻礙 D — 臨時檔案系統使用

`src/routes/upload.ts` 用 `Bun.file` / `Bun.write` / `node:fs` 把 OG 暫存檔寫到 `OG_TEMP_DIR`。Workers 無檔案系統。

**解法**：暫存檔改放 **R2**（或短 TTL 的 **KV**）。若 OG 已移前端，`/upload/temp` 可能也能一併退役，需確認前端是否還呼叫。

#### 🟢 阻礙 E（其實是升級）— R2 改用原生 binding

`src/lib/r2.ts` 現在用 `@aws-sdk/client-s3` 走 S3 相容 API。Workers 有 **原生 R2 binding**（`env.BUCKET.put()` / `.get()`），更輕、更快、免金鑰管理。

**解法**：把 `r2.ts` 改寫成用 binding。這是「順手變更好」的改動，不是阻礙。`@aws-sdk/client-s3` 那包 dependency 也能移除，bundle 變小。

#### 🟢 環境變數

`process.env` / `Bun.env` 要改成 Workers 的 `env` binding（secrets 用 `wrangler secret put`）。GitHub token、OpenAI key 等改成 secrets，R2 改 binding。Hono 透過 `c.env` 取用即可。

### 2.2 外部 API 呼叫（無痛）

`lib/github.ts`（GitHub REST）、`lib/translator.ts`（OpenAI）都是標準 `fetch`，Workers 原生支援 `fetch`，**完全不用改**。這部分是好消息。

---

## 三、SQLite → D1

### 資料模型相容性：✅ 高

三張表 `drafts`、`translation_presets`、`images` 都是單純的 TEXT/INTEGER 欄位，沒有用到 SQLite 擴充功能，D1 完全支援。

### 遷移步驟

1. `wrangler d1 create blog-editor` 建資料庫，拿到 binding。
2. 把 `db.ts` 的 `CREATE TABLE` + 三個 `ALTER TABLE` 整理成 `migrations/0001_init.sql`。
3. 既有資料（`backend/data/blog-editor.db`）匯出：`sqlite3 blog-editor.db .dump` → 清掉 sqlite 專屬語句 → `wrangler d1 execute blog-editor --file=dump.sql` 匯入。
4. 程式碼層把所有 query 改 async + 用 `env.DB`（同阻礙 A）。

### D1 限制要留意

- 單一 query 結果與 DB 大小有上限（目前資料量遠遠不會碰到，免擔心）。
- D1 是 **eventually consistent 的分散式**，但對這種單人草稿工具的讀寫模式完全無感。
- 沒有同步 API——這就是阻礙 A 的根源，務必整輪改寫，不要半套。

---

## 四、建議遷移路線（分階段，降低風險）

> 原則：**前端先行、後端後動**，每階段都能獨立驗證。

### Phase 0 — 前置確認（0.5 天）
- 確認 OG 圖片生成是否已完全移至前端（決定阻礙 B / D 的命運）。
- 盤點前端實際呼叫的 API endpoint，標記可退役的路由。

### Phase 1 — 前端上 Pages（0.5 天）
- Pages 連 repo、設 build、設 `/api` 轉發。
- 後端暫時仍跑現有 docker（或 Workers 上線前用既有 backend），前端先驗證。

### Phase 2 — D1 化（後端最大工程，2 ~ 3 天）
- 建 D1、寫 migration、匯入資料。
- 把所有 DB 呼叫改 async + `c.env.DB`，handler 全面 async 化。
- 本地用 `wrangler dev` + local D1 測。

### Phase 3 — Workers 周邊改寫（1 ~ 2 天）
- R2 改 binding、移除 `@aws-sdk/client-s3`。
- 環境變數改 secrets / binding。
- `prChecker` 改 Cron Triggers `scheduled` handler。
- 處理（或刪除）OG / 暫存檔相關程式。

### Phase 4 — 整合與切換（0.5 天）
- 前端 `/api` 指向 Workers，確認同源免 CORS。
- 退役 docker-compose、nginx、兩個 Dockerfile。
- 觀察 Cron、上傳、發 PR 流程。

**合計：約 5 ~ 7 個工作天**，主要成本集中在 Phase 2 的 DB 改寫。

---

## 五、風險與取捨總表

| 風險 | 等級 | 緩解 |
| --- | --- | --- |
| DB 全面 async 改寫遺漏某處 → runtime 才爆 | 中 | 改寫後逐路由測；TypeScript 嚴格模式幫忙抓 |
| OG 原生模組無法上 Workers | 中 | 確認已移前端則無痛；否則用 wasm resvg 或維持前端產圖 |
| top-level await / module 單例模式不相容 | 中 | DB binding 改走 request context，migration 走 wrangler |
| Cron 最小間隔為 1 分鐘 | 低 | 現況本來就是 60 秒，剛好符合 |
| 既有 SQLite 資料遷移 | 低 | `.dump` → `wrangler d1 execute` 一次性匯入 |
| Workers bundle 體積 / CPU time 上限 | 低 | 移除 aws-sdk、satori 等大包後更寬裕 |

---

## 六、遷移後架構（目標）

```
                    ┌──────────────────────────────┐
   使用者 ──HTTPS──► │  Cloudflare Pages (前端 SPA)   │
                    │  /api/* ─► Service binding ──┐ │
                    └──────────────────────────────┼─┘
                                                   ▼
                    ┌──────────────────────────────────────┐
                    │  Worker (Hono API)                     │
                    │  ├ fetch()     ── REST API             │
                    │  └ scheduled() ── PR 輪詢（Cron）       │
                    │     │            │           │         │
                    │   env.DB      env.BUCKET   secrets      │
                    └─────┼────────────┼──────────┼──────────┘
                          ▼            ▼          ▼
                        D1(SQLite)   R2(圖片)   GitHub / OpenAI
```

- Cloudflare Access 仍可掛在 Pages / Worker 前面控管存取（沿用現有部署思路）。
- 整套不再需要自管主機、docker、nginx、cloudflared tunnel。

---

## 七、最終建議

**值得做，而且現在做正是時候**——專案規模還小（後端 ~2300 行）、資料模型乾淨、外部呼叫都是標準 fetch、而且我們本來就在用 R2 與 Cloudflare Access，跟整個 Cloudflare 生態超級契合。Hono 是 Workers 原生框架更是加分。

唯一需要主人先拍板的決策點是 **OG 圖片生成的去留**（阻礙 B）。建議在 Phase 0 先確認它是否已經完全在前端處理——如果是，整個遷移就只剩「DB async 化」這一個主要工程，其餘都是順手變更乾淨的改動。
