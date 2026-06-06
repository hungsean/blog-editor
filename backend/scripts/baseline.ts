/**
 * ## scripts/baseline
 *
 * #02 策略 B：對**既有 self-host DB** 把初始 migration 標記為「已套用」，而不真的去跑它的
 * `CREATE TABLE`（那會與既有三張表衝突）。等於宣告「此 DB 的 schema 已是初始版本」，
 * 之後 `db:migrate` 只跑增量。
 *
 * @remarks
 * 安全且 idempotent，可在每次部署前無條件執行（docker-entrypoint 即如此）：
 * - **空庫 / 全新庫**（沒有 `drafts` 表）：略過，交給 `db:migrate` 從頭建立。
 * - **既有資料庫且尚未標記**：把初始 migration 的 hash 寫入 `__drizzle_migrations`。
 * - **已標記過**：略過。
 *
 * hash 與 created_at 直接取自 drizzle 的 `readMigrationFiles`，與 migrator 內部判定
 * （`lastDbMigration.created_at < migration.folderMillis` 才套用）完全一致，確保標記後
 * 初始 migration 會被跳過、後續增量仍會正常套用。
 *
 * 用法：`bun run db:baseline`（可用 `DB_PATH` 覆蓋目標 DB）。
 */
import { Database } from "bun:sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { join } from "node:path";

const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "../data/blog-editor.db");
const MIGRATIONS_FOLDER = join(import.meta.dir, "../drizzle");

const sqlite = new Database(DB_PATH, { create: true });

// 只對「既有資料」的 DB baseline；沒有 drafts 表代表是空庫，應走正常 migrate。
const hasDrafts = sqlite
  .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'drafts'")
  .get();
if (!hasDrafts) {
  console.log("[baseline] 偵測到空庫（無 drafts 表），略過 baseline，交給 db:migrate 建立 schema。");
  sqlite.close();
  process.exit(0);
}

const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
const initial = migrations[0];
if (!initial) {
  console.error("[baseline] drizzle/ 下沒有任何 migration，請先跑 `bun run db:generate`。");
  process.exit(1);
}

// 與 drizzle migrator 完全相同的 __drizzle_migrations DDL（沿用其 IF NOT EXISTS 語意）。
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )
`);

const already = sqlite
  .query("SELECT 1 FROM __drizzle_migrations WHERE hash = ?")
  .get(initial.hash);
if (already) {
  console.log("[baseline] 初始 migration 已標記為套用，無需處理。");
} else {
  sqlite
    .query('INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)')
    .run(initial.hash, initial.folderMillis);
  console.log(`[baseline] 已把初始 migration（${initial.hash.slice(0, 12)}…）標記為套用。`);
}

sqlite.close();
