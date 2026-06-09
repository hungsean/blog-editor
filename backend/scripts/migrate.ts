/**
 * ## scripts/migrate
 *
 * 對 self-host 的 `bun:sqlite` DB 套用 `drizzle/` 下所有尚未套用的 migration。
 *
 * @remarks
 * 與 `server.bun.ts` 啟動路徑一致（建目錄 → 開檔 → {@link runMigrations}），確保 CLI 與 app
 * 啟動走同一條路徑、同一份 migration 來源，避免漂移。#03 起 db.ts 不再有 module-load side
 * effect（單例 / 開檔移到 `server.bun.ts`），故本腳本自行開檔再呼叫 `runMigrations`。
 *
 * **既有資料 DB** 第一次升級前，必須先跑 `bun run db:baseline` 標記初始 migration 已套用
 * （見 `scripts/baseline.ts` / #02 策略 B），否則初始 migration 的 `CREATE TABLE` 會與既有表衝突。
 *
 * 用法：`bun run db:migrate`（可用 `DB_PATH` 覆蓋目標 DB）。
 */
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runMigrations } from "../src/lib/db.bun";

const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "../data/blog-editor.db");
await mkdir(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH, { create: true });
runMigrations(sqlite);
sqlite.close();

console.log("[migrate] self-host schema 已是最新版本。");
