/**
 * ## db
 *
 * Drizzle 的 runtime-中立核心：共用 `DrizzleDB` 型別、`drizzle/` migration 目錄常數，以及
 * **D1 driver** 的工廠。同一份 `schema.ts` / repo query 既能跑在 self-host 的 `bun:sqlite`，
 * 也能跑在 Cloudflare D1。
 *
 * ### 為什麼把 bun-sqlite 分到 `db.bun.ts`（#03）
 * `drizzle-orm/bun-sqlite` 會 import `bun:sqlite`（Bun-only），若本檔 import 它，則任何 import
 * 本檔的模組（含 `worker.ts` 需要的 {@link createD1Db}）都會把 `bun:sqlite` 拉進 Workers bundle 而炸。
 * 因此 self-host 專屬的 `createBunSqliteDb` / `runMigrations` 移到 {@link import("./db.bun")}，
 * 本檔只保留 D1 與型別——worker 入口只 import 本檔即可，bundle 不含 `bun:sqlite`。
 *
 * ### schema / migration
 * schema 一律由 `drizzle/` 下版本化的 migration 管理：self-host 用 `db.bun.ts` 的 `runMigrations`
 * （`drizzle-orm/bun-sqlite/migrator`），D1 用 `wrangler d1 migrations apply`。兩邊共用同一批
 * migration 檔，確保 schema 一致。
 *
 * @remarks
 * 本檔**無 module-load side effect、無單例**：self-host 的開檔 / migrate / 單例建立在
 * `server.bun.ts`（#03）；Workers 用 {@link createD1Db} 從 `c.env.DB` binding 每 request 建。
 */
import { drizzle as drizzleD1, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

/**
 * Drizzle 實例的型別：涵蓋 self-host（bun-sqlite）與 Cloudflare（d1）兩種 driver。
 *
 * @remarks
 * repo 函數一律以 `db: DrizzleDB` 為第一參數，呼叫端注入。兩個 driver 都繼承
 * `BaseSQLiteDatabase`，query builder API 一致；差別只在 bun-sqlite 同步、d1 非同步——
 * 本專案 repo 全程 `await`（見 backend/CLAUDE.md 的 async 約定），故同一份 query 兩邊通用。
 *
 * 刻意用 `BaseSQLiteDatabase<any, any, …>` 這個共同基底型別、而非兩個 driver 的**聯集**：
 * 聯集會讓 query builder 的多載（如 `.select(columns)`）變得無法呼叫（TS 取到 0 參數多載），
 * 共同基底則保留 schema 泛型（欄位推導不變）又能讓 bun-sqlite / d1 兩種實例都 assignable。
 */
export type DrizzleDB = BaseSQLiteDatabase<"sync" | "async", any, typeof schema>;

/**
 * 從 Cloudflare D1 binding 建立 Drizzle 實例（Workers，每 request 由 `c.env.DB` 建）。
 *
 * @param binding - Worker request context 的 `c.env.DB`（D1 binding）
 * @remarks D1 的 schema 由部署階段的 `wrangler d1 migrations apply` 套用，不在此處 migrate。
 */
export function createD1Db(binding: D1Database): DrizzleD1Database<typeof schema> {
  return drizzleD1(binding, { schema });
}
