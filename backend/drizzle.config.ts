import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit 設定：以 `src/lib/schema.ts` 為唯一 schema 來源，產出版本化 migration 至 `drizzle/`。
 *
 * @remarks
 * - `dialect: "sqlite"`：self-host（bun:sqlite）與 Cloudflare D1 共用同一份 SQLite migration，
 *   drizzle-kit 產的 SQL 與 D1 相容，確保兩邊 schema 永遠一致（見 #02 計畫）。
 * - 這裡刻意**不設 `dbCredentials`**：本專案不靠 `drizzle-kit migrate` 連線套用，
 *   self-host 改用 `drizzle-orm/bun-sqlite/migrator`（見 `db.ts` / `scripts/migrate.ts`），
 *   D1 則用 `wrangler d1 migrations apply`。drizzle-kit 在此只負責 `generate`。
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
});
