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
2. `/api` 轉發到 Worker 需要 **Pages Function（`functions/api/[[path]].ts`）+ Service binding +
   `_routes.json`** 三件套。注意 **`_routes.json` 只控制哪些路徑觸發 Function、不負責 rewrite**；
   實際轉發是 Function 內 `context.env.API.fetch(context.request)`。詳見
   [`issue/08-frontend-pages-deploy.md`](./issue/08-frontend-pages-deploy.md)。
3. SPA fallback（所有路由回 `index.html`）Pages 內建支援，不需要像 nginx 那樣手寫 `try_files`。

### 要注意的小地方

- 目前 `VITE_API_URL` 的注入方式可以沿用，建議讓前端與 Worker **同源**（Pages Function 同域
  轉發到 Worker），就能免掉 CORS（`index.ts` 那段 CORS 在同源下不觸發）。
- nginx.conf 與 frontend Dockerfile 是 **保留的 self-host 路徑**，不退役；Cloudflare 路徑改用
  Pages，兩者並存。

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

**解法（已查證）**：前端目前 **無人呼叫 `/upload/r2`、`/upload/temp`**（只用 `/images/upload`
與 `/og/*`），故 **預設直接刪除 `upload.ts`**，連同 `node:fs` 暫存邏輯一併移除，Worker 不必做
相容層。僅當確認有外部 caller 才改走 R2 / 短 TTL KV。詳見
[`issue/04-storage-abstraction-r2.md`](./issue/04-storage-abstraction-r2.md)。

#### 🟢 阻礙 E（其實是升級）— R2 改用原生 binding

`src/lib/r2.ts` 現在用 `@aws-sdk/client-s3` 走 S3 相容 API。Workers 有 **原生 R2 binding**（`env.BUCKET.put()` / `.get()`），更輕、更快、免金鑰管理。

**解法**：把 `r2.ts` 改寫成用 binding。這是「順手變更好」的改動，不是阻礙。`@aws-sdk/client-s3` 那包 dependency 也能移除，bundle 變小。

#### 🟢 環境變數

`process.env` / `Bun.env` 要改成 Workers 的 `env` binding（secrets 用 `wrangler secret put`）。GitHub token、OpenAI key 等改成 secrets，R2 改 binding。Hono 透過 `c.env` 取用即可。

### 2.2 外部 API 呼叫（fetch 邏輯不用改，但 env 讀取要改）

**更正先前說法**：`lib/github.ts`、`lib/translator.ts` 的 **fetch / API 呼叫邏輯** 確實
Workers 原生支援、不用改；但它們（與 `prChecker.ts`、`r2.ts`）都在 **module load 時用
top-level `const` 讀 `process.env`**：

- `lib/github.ts:15-18` — `GITHUB_TOKEN/OWNER/REPO/DEFAULT_BRANCH`
- `lib/translator.ts:15-17` — `OPENAI_API_KEY/MODEL/BASE_URL`
- `lib/prChecker.ts:20-21` — `PR_CHECK_INTERVAL_MS`、`NODE_ENV`
- `lib/r2.ts:16-20` — `R2_*`

Workers 的環境變數只在 **request 的 `env` binding** 注入，module 載入時還拿不到，因此
這些模組必須改成 **factory（`createGithub(env)` / `createTranslator(env)` …）**，由 caller
在 request context 內注入設定。**這不是「完全不用改」**——詳見
[`issue/03-runtime-abstraction-layer.md`](./issue/03-runtime-abstraction-layer.md)。

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
- **一致性（更正）**：D1 預設是單一 primary、強一致，**不該一概說成 eventually consistent**。
  只有 **選配啟用 read replication** 後才有副本延遲，屆時需用 **Sessions API** 處理 sequential
  consistency。本專案不啟用 replication 即無此問題。
  （參考：D1 read replication <https://developers.cloudflare.com/d1/best-practices/read-replication/>）
- query 介面需 async——這就是 #01/#02 改寫的根源，務必整輪改寫，不要半套。

---

## 四、建議推進路線（依 EPIC：DB → 後端 → 前端）

> 原則：終極目標是 **self-host 與 Cloudflare 雙環境並存**，不是單向遷移。順序為
> **DB → 後端 → 前端**，每階段都不破壞 self-host。詳細拆解見 [`issue/`](./issue/)。

### Phase A — DB 層（#01、#02）
- #01：導入 Drizzle、定義 schema、所有 query 統一改 `await`（driver 仍是 bun-sqlite，self-host 零退化）。
- #02：加 D1 driver + drizzle-kit migrations，dual-driver 依環境切換。

### Phase B — 後端 Workers 化（同時保留 self-host，#03 ~ #07）
- #03：runtime 抽象（入口拆檔、env provider、把 module-load 讀 env 的模組改 factory）。
- #04：物件儲存抽象（aws-sdk S3 ⇄ R2 binding）；確認並刪除廢棄的 `/upload/*`。
- #05：PR 輪詢 setInterval ⇄ Cron，並修掉既有 N+1。
- #06：OG 圖片上雲——**先 spike 驗證 Workers 限制**，再做 resvg-wasm 實作（最高風險）。
- #07：建 D1 / R2 binding / secrets，匯入既有資料，`wrangler deploy`，**此時才驗收完整 Worker 啟動**。

### Phase C — 前端（#08）
- Pages 部署 + `functions/api/[[path]].ts` + Service binding + `_routes.json` 同源轉發。
- 整理雙環境部署文件。

> **Docker / nginx 不退役**：`docker-compose.yml`、nginx、兩個 Dockerfile 是 **保留的
> self-host 部署路徑**，README 標明用途；Cloudflare 路徑不需要它們，但兩者並存。

**合計：約 6 ~ 9 個工作天**（含 #06 spike 的不確定性）；主要成本在 Phase A 的 DB 改寫
與 #06 的 OG 驗證。

---

## 五、風險與取捨總表

| 風險 | 等級 | 緩解 |
| --- | --- | --- |
| DB 全面 async 改寫遺漏某處 → runtime 才爆 | 中 | 改寫後逐路由測；TypeScript 嚴格模式幫忙抓 |
| **OG 原生模組（仍在後端）無法上 Workers** | **高** | 先 spike 驗證 resvg-wasm + satori + CJK 字型；預期至少 Workers Paid（#06） |
| module-load 讀 `process.env` 在 Workers 失效 | 中 | github/translator/prChecker/r2 改 factory，env 從 context 注入（#03） |
| top-level await / module 單例模式不相容 | 中 | DB 改 request context 取得，migration 走 drizzle-kit + wrangler |
| prChecker 對每篇 draft 各打一次 GitHub（N+1） | 中 | 依 `pr_url` 分組、batch size、退避 rate-limit（#05） |
| Cron 最小間隔為 1 分鐘 | 低 | 現況本來就是 60 秒，剛好符合 |
| 既有 SQLite 資料遷移 | 低 | `.dump`（只留 INSERT）→ `wrangler d1 execute` 一次性匯入 |
| Workers bundle 體積 / CPU time 上限 | 中 | Free 僅 10 ms CPU / 3 MB bundle，OG 預期需 Paid；移除 aws-sdk 減重 |

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
- 這是 **Cloudflare 部署路徑** 的樣貌；**self-host 路徑（docker compose + 本地 SQLite +
  S3 相容 R2）並存保留**，兩者共用同一份程式碼，靠環境變數 / binding 切換。

---

## 七、最終建議

**值得做，而且現在做正是時候**——專案規模還小（後端 ~2300 行）、資料模型乾淨、外部呼叫都是標準 fetch、而且我們本來就在用 R2 與 Cloudflare Access，跟整個 Cloudflare 生態超級契合。Hono 是 Workers 原生框架更是加分。

兩個需要主人先拍板 / 注意的關鍵：

1. **OG 圖片生成（最高風險）** — 仍在後端、用原生 `@resvg/resvg-js`。Workers 上需先做
   spike 驗證 CPU / bundle / CJK 字型可行性，且預期 **至少需 Workers Paid**。見 #06。
2. **改寫量比第一版估計略大** — env 讀取要 factory 化、N+1 要修、儲存層要抽象，
   但都是一次性、讓兩環境共用同一份程式碼的投資。

完整執行拆解見 [`issue/`](./issue/)，以 `00-epic` 為總覽起點。
