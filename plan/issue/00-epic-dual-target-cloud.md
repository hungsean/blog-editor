# EPIC：雙環境部署（self-host + Cloudflare）

> 終極目標：同一套 codebase 既能 **self-host**（Bun + 本地 SQLite + S3 相容 R2），
> 也能 **deploy on Cloudflare**（Pages + Workers + D1 + R2 binding）。
> 不維護兩份程式，靠抽象層 + 環境變數切換 runtime。

## 為什麼這樣設計

主人的需求是「最後是一個可以 self-host 同時可以 deploy on Cloudflare 的系統」。
要達成這點，核心策略是：

1. **DB 用 Drizzle ORM 抽象** — 同一份 schema 與 query，靠不同 driver
   （`drizzle-orm/bun-sqlite` vs`drizzle-orm/d 1`）對應兩種環境。為了讓兩種 driver 共用同一
   份 query（`d1` 只有 async），**專案約定一律用 async 寫法（`await`）**——這是撰寫約定，
   不是 Drizzle 自動把同步轉非同步（`bun-sqlite` 本身 sync/async 都提供）。
2. **Runtime 行為抽象** — R2 儲存、定時任務、環境變數讀取，各包一層介面，
   依環境注入不同實作。
3. **Hono 是中立框架** — 同一個 `app` 既能 `Bun.serve` 也能當 Workers 的 fetch handler。

## 推進順序（依主人指定：DB → 後端 → 前端）

```
Phase A — DB 層
  #01 Drizzle 導入 + schema + 全面 async 化（仍跑 self-host bun:sqlite，先確保不退化）
  #02 D1 driver + drizzle-kit migrations + dual-driver 切換

Phase B — 後端 Workers 化（同時保留 self-host）
  #03 Runtime 抽象層：入口 / env / Hono 雙 adapter
  #04 R2 儲存抽象：aws-sdk(S3) ⇄ R2 binding
  #05 PR 輪詢：setInterval ⇄ Cron Triggers
  #06 OG 圖片上雲：@resvg/resvg-js → resvg-wasm + 字型策略（最硬的一塊）
  #07 D1 建立 + 資料遷移 + wrangler 部署

Phase C — 前端
  #08 前端上 Pages + 同源 /api + 部署收尾文件
```

每個 Phase 結束都應能獨立驗證、不破壞 self-host。

## 雙環境對照總表

| 能力 | self-host | Cloudflare | 抽象方式 | Issue |
| --- | --- | --- | --- | --- |
| DB | `bun:sqlite` | D1 | Drizzle driver | #01 #02 |
| Migration | drizzle-kit (local) | drizzle-kit + `wrangler d1 migrations` | drizzle-kit | #02 |
| 入口 | `Bun.serve` | Workers `fetch` | 共用 Hono `app` | #03 |
| 環境變數 | `process.env` | `c.env` binding | env provider | #03 |
| 物件儲存 | aws-sdk → R2 (S3 API) | R2 binding | Storage 介面 | #04 |
| 定時任務 | `setInterval` | Cron Triggers `scheduled()` | job runner | #05 |
| OG 渲染 | resvg-wasm（或保留 native） | resvg-wasm | 字型走 Storage | #06 |
| 暫存檔 | 磁碟 / R2 | R2 / KV | Storage 介面 | #04 #06 |
| 前端託管 | nginx static | Pages | — | #08 |

## 完成定義（DoD）

- [ ] `bun run dev` self-host 模式所有功能與現況等價（零退化）。
- [ ] `wrangler dev` 在本地以 D1 + R2 binding 跑通同一套後端。
- [ ] 前端在 Pages 上線，`/api` 同源轉發到 Worker，無 CORS 設定。
- [ ] OG 圖片在 Workers 上能生成（或有明確的替代策略並落地）。
- [ ] 一份 README 說明兩種部署方式與所需環境變數 / binding。
- [ ] 既有 SQLite 資料能匯入 D1。

## 相關文件

- 可行性分析：[../cloudflare-migration-feasibility.md](../cloudflare-migration-feasibility.md)
