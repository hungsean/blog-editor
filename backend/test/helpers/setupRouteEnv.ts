/**
 * ## test/helpers/setupRouteEnv
 *
 * route 整合測試的 **bootstrap**：封裝「先註冊外部 mock → 再 dynamic import 受測模組」的
 * 載入順序，並用 #03 的 {@link createApp} 把一個隔離的 in-memory 測試 db 與測試設定注入成
 * runtime provider，回傳已就緒的 `app` 與 `db`。
 *
 * ### 為什麼仍需 dynamic import（Test bootstrap contract）
 * route → `lib/github` / `lib/r2` / `lib/translator` 的 factory 必須被 `mock.module()` 替換掉，
 * 而 `mock.module()` 只對「之後才 import 的模組」生效。ESM static import 會在測試檔 body 執行
 * **之前**就解析，因此受測模組（`src/app` → `routes/api` → 各 route → 各 lib）一律以 **dynamic
 * import** 取得，且必須在 `registerMocks()` 之後。
 *
 * ### db 隔離（#03 後大幅簡化）
 * #03 起 `lib/db.ts` 不再有 module-load side effect / 單例（開檔、migrate 都移到 `server.bun.ts`），
 * route 也不再 import db 單例、改吃 `c.var.db`。因此測試**不需要**再操作 `DB_PATH`、共用檔、
 * 或處理「跨檔共用 sqlite 連線不能刪檔」的地雷。改為每次 `setupRouteApp()` 用 {@link makeTestDb}
 * 開一個全新的 **in-memory** db，經 provider 注入；測試之間用 {@link resetDb} 清表隔離。
 */
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { AppEnv } from "../../src/app";
import type { DrizzleDB } from "../../src/lib/db";
import { registerMocks } from "./mocks";

/**
 * 註冊 mock 後 dynamic import，回傳已就緒的測試 app 與其 in-memory db。
 *
 * @remarks
 * 嚴格順序：`registerMocks()` → dynamic import（`makeTestDb` 開 in-memory db → `src/app`
 * 的 `createApp` 注入 provider）。在 route 測試的 `beforeAll` 呼叫一次即可。回傳的 `db` 供
 * `resetDb()` 清表與斷言 DB 副作用。測試設定以 `readEnv({})` 取預設值即可——對外服務（github /
 * r2 / translator）都已被 mock，env 實際值不影響行為。
 */
export async function setupRouteApp(): Promise<{ app: Hono<AppEnv>; db: DrizzleDB }> {
  registerMocks();

  const { makeTestDb } = await import("./makeTestDb");
  const { db } = makeTestDb();

  const { createApp } = await import("../../src/app");
  const { readEnv } = await import("../../src/lib/env");
  const env = readEnv({});

  const app = createApp({
    makeDb: () => db,
    readEnv: () => env,
  });

  return { app, db };
}

/**
 * 清空三張表（`drafts` / `translation_presets` / `images`），在每個 route 測試的
 * `beforeEach` 呼叫，避免測試之間互相污染。
 */
export function resetDb(db: DrizzleDB): void {
  db.run(sql`DELETE FROM drafts`);
  db.run(sql`DELETE FROM translation_presets`);
  db.run(sql`DELETE FROM images`);
}

/**
 * route 測試檔的 `afterAll` 收尾。
 *
 * @remarks
 * in-memory db 在 test process 結束時自動消失、不落地，故此處無需刪檔；保留此函式做為各檔
 * `afterAll` 的明確收尾點，並與舊測試的呼叫介面相容。
 */
export async function cleanupRouteDb(): Promise<void> {
  // in-memory db 隨 process 結束釋放，無需額外清理。
}
