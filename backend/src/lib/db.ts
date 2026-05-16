/**
 * ## db
 *
 * SQLite 資料庫初始化與結構定義。
 *
 * ### 資料流
 * 啟動時自動建立 DB → 建立 drafts 表格 → 執行欄位 migration → 建立 translation_presets 表格
 *
 * ### 已知限制
 * - 使用 top-level await（`Bun.write`），此模組只能在 Bun 環境中使用
 * - Migration 策略為 ALTER TABLE ADD COLUMN，僅支援新增欄位，不支援刪除或改型別
 * - DB 路徑預設為 `data/blog-editor.db`，可透過 `DB_PATH` 環境變數覆蓋
 */
import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "../../data/blog-editor.db");

// Ensure data directory exists
const dataDir = join(import.meta.dir, "../../data");
await Bun.write(join(dataDir, ".gitkeep"), "").catch(() => {});

export const db = new Database(DB_PATH, { create: true });

db.exec(`
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

db.exec(`
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
db.exec(`
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
    db.exec(`ALTER TABLE drafts ADD COLUMN ${col} ${def}`);
  } catch {
    // Column already exists, ignore
  }
}
