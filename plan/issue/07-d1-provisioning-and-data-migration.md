# #07 D1 建立、資料遷移與 wrangler 部署

**Phase B — 後端 Workers 化** ｜ 相依：#02 ~ #06 ｜ 後續：#08

## 背景

前面的 issue 讓程式碼具備雙環境能力。本 issue 實際在 Cloudflare 建出資源、把既有
SQLite 資料搬進 D1，並完成 Worker 的首次部署。

## 目標

- 建立 D1、R2 bucket、設定 secrets 與 binding。
- 既有 `backend/data/blog-editor.db` 資料匯入 D1。
- `wrangler deploy` 把後端上線。

## 實作步驟

1. **建資源**
   - `wrangler d1 create blog-editor` → 取得 database_id。
   - R2 bucket（若沿用現有 R2 帳號，建立 binding 指向同 bucket）。
2. **wrangler.toml**
   - `[[d1_databases]]` binding `DB`、`[[r2_buckets]]` binding `BUCKET`、`[triggers] crons`（#05）。
   - `main = "src/worker.ts"`、`compatibility_date`、`compatibility_flags = ["nodejs_compat"]`
     （**必開，非「視相依而定」**）。原因：`src/lib/github.ts:87` 與 `:139` 用 `Buffer.from`
     做 base64，Worker 不開 `nodejs_compat` 會直接壞。本 plan 採「開 `nodejs_compat`」路徑而
     **不**改寫成 Web API；因此 `nodejs_compat` 是硬性需求，並須在驗收項實測 GitHub sync/publish。
3. **secrets**（`wrangler secret put`）
   - `GITHUB_TOKEN`、`OPENAI_API_KEY`，其餘非敏感設定走 `[vars]`：
     `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_DEFAULT_BRANCH` / `OPENAI_MODEL` /
     `OPENAI_BASE_URL` / `R2_PUBLIC_URL` / `PR_CHECK_INTERVAL_MS` 等。
4. **schema**：`wrangler d1 migrations apply blog-editor`（用 #02 的 drizzle migration）。
5. **資料遷移**
   - `sqlite3 backend/data/blog-editor.db .dump > dump.sql`
   - 清掉 `CREATE TABLE` / PRAGMA / transaction 包裹等 D1 不需要或不相容的語句，
     只保留 `INSERT`（schema 已由 migration 建好）。
   - `wrangler d1 execute blog-editor --file=dump.sql --remote`
6. **部署**：`wrangler deploy`，驗證 API 與 Cron。

## 注意 / 地雷

- `.dump` 會含 schema，務必只保留 INSERT，避免與 migration 重複建表。
- 字型也要上傳到 R2（#06 的前置），否則 OG 在雲端會失敗。
- 先在 D1 的 **local**（`wrangler dev`）跑通再推 remote，降低風險。
- 確認 secrets 不外洩、不進 repo；`wrangler.toml` 不放敏感值。
- 資料量大時 `d1 execute` 可能要分批。

## 驗收標準

- [ ] D1 / R2 binding、secrets、cron 都設定完成。
- [ ] D1 schema 由 migration 建立，既有草稿 / presets / images 資料完整匯入。
- [ ] `wrangler deploy` 後，線上 Worker 的 drafts / OG / 上傳 / 翻譯 / Cron 全部正常。
- [ ] `nodejs_compat` 已開啟，並在線上 Worker **實測 GitHub sync 與 publish 成功**
      （`github.ts` 的 `Buffer.from` base64 路徑在 Worker 上不報錯）。
- [ ] self-host 仍可用（資料來源各自獨立，互不影響）。
