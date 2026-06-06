# Blog Editor Backend

Bun + Hono 的 REST API 伺服器。架構與設計決策見 [`CLAUDE.md`](./CLAUDE.md)。

## 執行

```sh
bun install
bun run dev    # bun --hot index.ts（開發，熱重載）
bun run start  # bun index.ts（正式）
```

Bun 會自動載入 `.env`，啟動前請依 `.env.example` 設好環境變數。

## 測試

測試以 Bun 內建測試器（`bun test`）撰寫，全部離線、互不汙染，不打真實外部服務
（GitHub / OpenAI / R2 一律 mock），斷網也能跑過。

| 用途 | 指令 | 行為 |
| --- | --- | --- |
| 本地快速跑（預設） | `bun test` | 跑全部測試，不算覆蓋率（最快） |
| 看覆蓋率 | `bun run test:coverage` | 跑測試 + 印覆蓋率摘要表（text reporter） |

覆蓋率**只是報告**：CI 也是跑 `bun run test:coverage`，但**只有測試失敗才會紅燈**，
覆蓋率數字不設門檻、不因覆蓋率不足而擋 PR。

### 測試分層

測試統一放在 `test/`（不使用 `src/**/__tests__`），分三層：

- **純函式單元**（`test/*.test.ts`）：`slugify`、`frontmatter`、`translator`
  （以 mock `fetch` 測，不打 OpenAI）。
- **repo 層**（`test/repos/*.test.ts`）：用 `makeTestDb()` 的 in-memory SQLite 隔離，
  驗證 query 語意（slug 衝突 TRIM、排序、過濾等）。
- **route 整合**（`test/routes/*.test.ts`）：透過 Hono `app.request()` 打 `/api/*`，
  驗證 status code / 回傳 JSON / DB 副作用。

### 怎麼加一個測試

- **純函式**：直接 `import` 受測函式，table-driven 測邊界即可。
- **repo 函式**：`beforeEach` 用 `makeTestDb()` 建乾淨 db，呼叫 repo 函式後斷言回傳與 DB 狀態。
- **route**：照 `test/helpers/setupRouteEnv.ts` 的 **bootstrap 契約**——
  route 測試檔頂端**只** static import `bun:test` 與 `test/helpers/*`（不碰 db 的 helper），
  在 `beforeAll` 呼叫 `setupRouteApp()` 取得 `app` / `db`（它會先設 `DB_PATH`、註冊外部
  mock，再 **dynamic import** 受測模組），`beforeEach` 呼叫 `resetDb(db)` 清空三表。
  外部依賴的替身集中在 `test/helpers/mocks.ts`，需要自訂單次行為時用
  `mockResolvedValueOnce` / `mockRejectedValueOnce`。

> [!NOTE]
> route 測試共用同一個 db 單例（Bun 在同一 test process 共用 module registry），
> 故隔離靠 `beforeEach` 清表、而非每檔刪 DB 檔。詳細地雷見 `setupRouteEnv.ts` 的註解。

### 目前未涵蓋（deferred）

- D1 driver 路徑（屬 #02）、frontend 測試（屬 #08 或另開 issue）。
