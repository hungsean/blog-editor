/**
 * ## scripts/migrate
 *
 * 對 self-host 的 `bun:sqlite` DB 套用 `drizzle/` 下所有尚未套用的 migration。
 *
 * @remarks
 * 直接複用 `db.ts` 的啟動 side effect（建目錄 → 開檔 → `runMigrations`），確保 CLI 與 app
 * 啟動走完全同一條路徑、同一份 migration 來源，避免漂移。
 *
 * **既有資料 DB** 第一次升級前，必須先跑 `bun run db:baseline` 標記初始 migration 已套用
 * （見 `scripts/baseline.ts` / #02 策略 B），否則初始 migration 的 `CREATE TABLE` 會與既有表衝突。
 *
 * 用法：`bun run db:migrate`（可用 `DB_PATH` 覆蓋目標 DB）。
 */
import "../src/lib/db";

console.log("[migrate] self-host schema 已是最新版本。");
