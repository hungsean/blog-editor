/**
 * ## test/helpers/makeTestDb
 *
 * 建立一個完全隔離的 Drizzle 實例供 repo 層測試使用。
 *
 * @remarks
 * 用 in-memory（`:memory:`）SQLite，**不碰** production `data/blog-editor.db`，
 * 也不觸發 `db.ts` 的 top-level side effect（mkdir / 開檔）。建表呼叫 production 同一份
 * `applySchema()`，確保測試 schema 與正式 DDL 不漂移（含 #01 的 slug / github_path /
 * github_sha migration 欄位）。
 *
 * 每次呼叫都是全新的空 DB，repo 測試在 `beforeEach` 呼叫即可達成互不污染。
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { applySchema } from "../../src/lib/applySchema";
import type { DrizzleDB } from "../../src/lib/db";
import * as schema from "../../src/lib/schema";

/**
 * 建立一個套用完整 schema 的 in-memory 測試 DB。
 *
 * @returns `{ db, sqlite }` — `db` 為 repo 函數要傳入的 Drizzle 實例；`sqlite` 為底層連線，
 *   測試結束若需釋放可呼叫 `sqlite.close()`（in-memory DB 在連線關閉後即消失）。
 */
export function makeTestDb(): { db: DrizzleDB; sqlite: Database } {
  const sqlite = new Database(":memory:");
  applySchema(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
