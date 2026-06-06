/**
 * ## test/helpers/makeTestDb
 *
 * 建立一個完全隔離的 Drizzle 實例供 repo 層測試使用。
 *
 * @remarks
 * 用 in-memory（`:memory:`）SQLite，**不碰** production `data/blog-editor.db`，
 * 也不觸發 `db.ts` 的 top-level side effect（mkdir / 開檔）——本檔只 type-only import `db.ts`，
 * 建表改用 `drizzle/` 下的 migration 檔（透過 `drizzle-orm/bun-sqlite/migrator`），
 * 與 production / D1 共用同一份 schema 來源，確保測試 schema 不漂移（#02 起 migration 為唯一來源）。
 *
 * 每次呼叫都是全新的空 DB，repo 測試在 `beforeEach` 呼叫即可達成互不污染。
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "node:path";
import type { DrizzleDB } from "../../src/lib/db";
import * as schema from "../../src/lib/schema";

/** `drizzle/` migration 目錄（相對本 helper），與 `db.ts` 的 `MIGRATIONS_FOLDER` 同一份。 */
const MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

/**
 * 建立一個套用完整 schema 的 in-memory 測試 DB。
 *
 * @returns `{ db, sqlite }` — `db` 為 repo 函數要傳入的 Drizzle 實例；`sqlite` 為底層連線，
 *   測試結束若需釋放可呼叫 `sqlite.close()`（in-memory DB 在連線關閉後即消失）。
 */
export function makeTestDb(): { db: DrizzleDB; sqlite: Database } {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, sqlite };
}
