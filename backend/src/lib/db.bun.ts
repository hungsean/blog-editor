/**
 * ## db.bun
 *
 * self-host 專屬的 `bun:sqlite` Drizzle 工廠與 migration runner。**只**被 `server.bun.ts`、
 * `scripts/migrate.ts` 與測試的 `makeTestDb` 等 Bun-only 情境 import。
 *
 * @remarks
 * 刻意與 `db.ts` 分開：`drizzle-orm/bun-sqlite` 會 import `bun:sqlite`（Bun-only），放在這個
 * 獨立檔可確保 `worker.ts`（只 import `db.ts` 的 D1 工廠）的 Workers bundle 不含 `bun:sqlite`。
 * 共用的 `DrizzleDB` 型別在 {@link import("./db")}；`MIGRATIONS_FOLDER` 與 `node:path` 也留在本檔，
 * 讓 `db.ts` 連 `node:path` 都不 import（worker 端免 `nodejs_compat` 警告）。
 */
import { drizzle as drizzleBunSqlite, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate as migrateBunSqlite } from "drizzle-orm/bun-sqlite/migrator";
import type { Database } from "bun:sqlite";
import { join } from "node:path";
import * as schema from "./schema";

/** `drizzle/` migration 目錄的絕對路徑（self-host migrator 用；與 `db.ts` 同目錄故相對路徑一致）。 */
export const MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

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
