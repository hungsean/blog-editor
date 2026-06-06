/**
 * ## applySchema
 *
 * 建立本專案三張表（drafts / translation_presets / images）並補上後續新增欄位的
 * **純結構函式**（無 module-level side effect）。
 *
 * @remarks
 * 自 #01.1 從 `db.ts` 的 top-level DDL 抽離至此，目的是讓 production 的 `db.ts`
 * 與測試的 `makeTestDb()` **共用單一份 DDL**，避免兩處各抄一份建表語句而漂移
 * （slug / github_path / github_sha 等 migration 欄位最容易漏）。
 *
 * 刻意放在**獨立、無 side effect 的模組**：`makeTestDb()` 只 import 此檔即可建表，
 * 不會像 import `db.ts` 那樣觸發 `mkdir` / 開啟 production DB 檔的 top-level side effect。
 *
 * Migration 策略沿用原 `db.ts`：以 try/catch 包裹 `ALTER TABLE ADD COLUMN`，
 * column 已存在時靜默忽略（僅支援新增欄位，不支援刪除或改型別）。
 */
import type { Database } from "bun:sqlite";

/**
 * 在傳入的 SQLite 連線上建立全部表格並執行欄位 migration。
 *
 * @param sqlite - 已開啟的 `bun:sqlite` 連線（production 單例或測試 in-memory 皆可）
 *
 * @remarks
 * 建表一律 `CREATE TABLE IF NOT EXISTS`，對已存在的 DB 為 no-op；ALTER 以 try/catch
 * 容錯，因此本函式可重複呼叫而不報錯。呼叫順序需在開檔之後、任何查詢之前。
 */
export function applySchema(sqlite: Database): void {
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
}
