/**
 * ## db
 *
 * Dual-driver 的 Drizzle 工廠：同一份 `schema.ts` / repo query 既能跑在 self-host 的
 * `bun:sqlite`，也能跑在 Cloudflare D1。
 *
 * ### 為什麼是 factory（#02）
 * #01 階段 `db` 是 module top-level 單例。#02 把「db 怎麼來」抽成工廠函數：
 * - self-host → {@link createBunSqliteDb}（`drizzle-orm/bun-sqlite`）
 * - Cloudflare → {@link createD1Db}（`drizzle-orm/d1`，從 `c.env.DB` binding 建）
 *
 * repo / route 的 query 寫法完全不動（依 #01 的注入契約，repo 簽章已是 `(db, ...)`），
 * 本檔只改變 db 的建立方式。#03 會把 db 經 middleware 掛到 `c.var.db` 再傳進 repo，
 * 屆時移除下方的 transitional 單例即可。
 *
 * ### schema / migration
 * 啟動時不再 inline `CREATE TABLE` / `ALTER TABLE`，schema 一律由 `drizzle/` 下版本化的
 * migration 管理：self-host 用 {@link runMigrations}（`drizzle-orm/bun-sqlite/migrator`），
 * D1 用 `wrangler d1 migrations apply`。兩邊共用同一批 migration 檔，確保 schema 一致。
 *
 * @remarks
 * 仍保留 transitional 單例 {@link db} 與其 top-level side effect（建目錄 → 開檔 → migrate），
 * 因為 route / prChecker 目前仍 `import { db }`。這層耦合會在 #03 Worker 化時拆除。
 */
import { Database } from "bun:sqlite";
import { drizzle as drizzleBunSqlite, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate as migrateBunSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle as drizzleD1, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as schema from "./schema";

/** `drizzle/` migration 目錄的絕對路徑（self-host migrator 與 baseline 腳本共用）。 */
export const MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

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
 * 從既有的 `bun:sqlite` 連線建立 Drizzle 實例（self-host）。
 *
 * @param sqlite - 已開啟的 `bun:sqlite` 連線
 * @remarks 不負責建表 / migration；schema 請先用 {@link runMigrations} 套用。
 */
export function createBunSqliteDb(sqlite: Database): BunSQLiteDatabase<typeof schema> {
  return drizzleBunSqlite(sqlite, { schema });
}

/**
 * 從 Cloudflare D1 binding 建立 Drizzle 實例（Workers，每 request 由 `c.env.DB` 建）。
 *
 * @param binding - Worker request context 的 `c.env.DB`（D1 binding）
 * @remarks D1 的 schema 由部署階段的 `wrangler d1 migrations apply` 套用，不在此處 migrate。
 */
export function createD1Db(binding: D1Database): DrizzleD1Database<typeof schema> {
  return drizzleD1(binding, { schema });
}

/**
 * 對 self-host 的 `bun:sqlite` 連線套用 `drizzle/` 下所有尚未套用的 migration。
 *
 * @param sqlite - 已開啟的 `bun:sqlite` 連線
 * @remarks
 * idempotent：drizzle 以 `__drizzle_migrations` 表記錄已套用的 migration，重複呼叫只跑增量。
 * 既有的 self-host DB 需先跑 baseline（見 `scripts/baseline.ts`）標記初始 migration 已套用，
 * 否則初始 migration 的 `CREATE TABLE` 會與既有表衝突。
 */
export function runMigrations(sqlite: Database): void {
  migrateBunSqlite(createBunSqliteDb(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
}

const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "../../data/blog-editor.db");
const dataDir = dirname(DB_PATH);

// Ensure the directory used by the configured DB path exists.
await mkdir(dataDir, { recursive: true });
await Bun.write(join(dataDir, ".gitkeep"), "").catch(() => {});

const sqlite = new Database(DB_PATH, { create: true });

// schema 由 migration 管理（取代原本的 inline CREATE TABLE / ALTER TABLE）。
runMigrations(sqlite);

/**
 * Transitional 的 self-host 單例（bun-sqlite）。
 *
 * @remarks
 * route / prChecker 目前仍 static import 此單例。#03 Worker 化後改由 middleware 注入
 * `c.var.db`，屆時可移除本單例與上方的 top-level side effect。
 */
export const db = createBunSqliteDb(sqlite);
