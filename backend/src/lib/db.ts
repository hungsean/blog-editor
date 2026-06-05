/**
 * ## db
 *
 * SQLite 資料庫初始化與結構定義。
 *
 * ### 資料流
 * 啟動時自動建立 DB → 建立 drafts 表格 → 執行欄位 migration → 建立 translation_presets 表格
 *
 * ### 已知限制
 * - 使用 top-level await 建立資料目錄，此模組只能在 Bun 環境中使用
 * - Migration 策略為 ALTER TABLE ADD COLUMN，僅支援新增欄位，不支援刪除或改型別
 * - DB 路徑預設為 `data/blog-editor.db`，可透過 `DB_PATH` 環境變數覆蓋；啟動時會以實際
 *   `DB_PATH` 建立父目錄，避免 Docker production 路徑與本機預設路徑不一致
 */
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import * as schema from "./schema";

const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "../../data/blog-editor.db");
const dataDir = dirname(DB_PATH);

// Ensure the directory used by the configured DB path exists.
await mkdir(dataDir, { recursive: true });
await Bun.write(join(dataDir, ".gitkeep"), "").catch(() => {});

const sqlite = new Database(DB_PATH, { create: true });

/**
 * Drizzle 實例的型別（綁定本專案 schema）。
 *
 * @remarks
 * repo 函數一律以 `db: DrizzleDB` 為第一參數，呼叫端注入。#02/#03 會把建立方式
 * 改成 factory（self-host 單例 / Workers 每 request 從 `c.env.DB` 建），屆時此型別
 * 換成涵蓋 bun-sqlite 與 d1 兩種 driver 的聯集即可，repo 簽章不變。
 */
export type DrizzleDB = BunSQLiteDatabase<typeof schema>;

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    lang        TEXT NOT NULL DEFAULT 'zh-tw',
    description TEXT DEFAULT '',
    tags        TEXT DEFAULT '[]',
    fields      TEXT DEFAULT '{}',
    content     TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft',
    pr_url      TEXT DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS translation_presets (
    id           TEXT PRIMARY KEY,
    keywords     TEXT NOT NULL DEFAULT '[]',
    translations TEXT NOT NULL DEFAULT '{}',
    note         TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  )
`);

// 圖片庫：R2 物件的本地快取。
// key 為 R2 物件鍵值（PRIMARY KEY），sync 與 upload 都以此 upsert。
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS images (
    key         TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    size        INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL
  )
`);

// Migrations: add new columns if they don't exist
for (const [col, def] of [
  ["github_path", "TEXT DEFAULT ''"],
  ["github_sha",  "TEXT DEFAULT ''"],
  ["slug",        "TEXT DEFAULT ''"],
] as const) {
  try {
    sqlite.exec(`ALTER TABLE drafts ADD COLUMN ${col} ${def}`);
  } catch {
    // Column already exists, ignore
  }
}

/**
 * 全專案共用的 Drizzle 實例（self-host bun-sqlite 單例）。
 *
 * @remarks
 * #01 階段沿用單例，route / prChecker 取得後當第一參數傳入 repo 函數。
 * #03 會把它正規化成 `c.var.db`（middleware 注入），屆時 repo 簽章不變、只有
 * 「db 怎麼來」改變。
 */
export const db = drizzle(sqlite, { schema });
