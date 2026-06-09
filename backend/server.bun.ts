/**
 * ## server.bun.ts
 *
 * self-host（Bun）入口。負責所有 Bun-only / 常駐 process 的事：
 * - 開 `bun:sqlite` 連線、跑 migration、建立 db 單例（整個 process 共用一條連線）。
 * - 從 `process.env` 讀一次設定（self-host 啟動即備齊，不需每 request 重讀）。
 * - 用 {@link createApp} 把「db 單例 / 啟動設定」注入成 runtime provider，組出完整 app。
 * - 啟動 {@link startPRChecker} 常駐輪詢（Workers 無常駐 process，對應 Cron 在 #05）。
 * - `export default { port, fetch }` 給 `Bun.serve` 起 HTTP server。
 *
 * @remarks
 * Bun-only 的東西（`bun:sqlite`、`Bun.env`、`Bun.write`、`setInterval` 常駐）**只**能放在這裡，
 * 不可進共用的 `app.ts`，否則 Workers bundle 會被 `bun:sqlite` 等炸掉（見 `app.ts` 開頭說明）。
 */
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createApp } from "./src/app";
import { createBunSqliteDb, runMigrations } from "./src/lib/db.bun";
import { readEnv } from "./src/lib/env";
import { createGithub } from "./src/lib/github";
import { startPRChecker } from "./src/lib/prChecker";

// --- DB：開檔 → migrate → 建立整個 process 共用的單例 ---
const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "data/blog-editor.db");
const dataDir = dirname(DB_PATH);
await mkdir(dataDir, { recursive: true });
await Bun.write(join(dataDir, ".gitkeep"), "").catch(() => {});

const sqlite = new Database(DB_PATH, { create: true });
runMigrations(sqlite);
const db = createBunSqliteDb(sqlite);

// --- 設定：self-host 啟動時讀一次 process.env ---
const env = readEnv(process.env);

if (!env.github.token || !env.github.owner || !env.github.repo) {
  console.warn("[github] GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 未設定，GitHub 功能將無法使用");
}

// --- app：把 self-host 的單例 db 與啟動設定注入 runtime provider ---
const app = createApp({
  makeDb: () => db,
  readEnv: () => env,
});

// --- PR 輪詢常駐任務（self-host only）---
startPRChecker({
  db,
  github: createGithub(env.github),
  intervalMs: env.prCheckIntervalMs,
  isDev: env.isDev,
});

const port = Number(Bun.env.PORT ?? 3000);
console.log(`Blog Editor running at http://localhost:${port}`);
console.log(`[cors] 允許來源: ${env.corsOrigins.join(", ")}`);

export default { port, fetch: app.fetch };
