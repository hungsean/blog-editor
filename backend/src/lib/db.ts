/**
 * ## db
 *
 * SQLite 資料庫初始化與 production 共用單例。
 *
 * ### 資料流
 * 啟動時建立資料目錄 → 開啟 DB 連線 → `applySchema()` 建表 / migration → export Drizzle 單例
 *
 * ### 已知限制
 * - 使用 top-level await 建立資料目錄，此模組只能在 Bun 環境中使用
 * - **import 此檔即有 side effect**（mkdir + 開啟 DB 檔），測試請改用 `makeTestDb()`，
 *   勿為了拿建表邏輯而 import 此檔；建表 DDL 已抽到無 side effect 的 `applySchema.ts`
 * - DB 路徑預設為 `data/blog-editor.db`，可透過 `DB_PATH` 環境變數覆蓋；啟動時會以實際
 *   `DB_PATH` 建立父目錄，避免 Docker production 路徑與本機預設路徑不一致
 *
 * @remarks
 * 建表 / migration 邏輯（原本寫死在本檔 top-level）自 #01.1 抽到 `applySchema.ts`，
 * 讓 production 單例與測試的 `makeTestDb()` 共用同一份 DDL，避免漂移。抽離後本檔
 * 的 side effect 順序維持不變：建目錄 → 開檔 → `applySchema` → export db。
 */
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import * as schema from "./schema";
import { applySchema } from "./applySchema";

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

// 建表 / migration 與測試共用單一來源（見 applySchema.ts）。
applySchema(sqlite);

/**
 * 全專案共用的 Drizzle 實例（self-host bun-sqlite 單例）。
 *
 * @remarks
 * #01 階段沿用單例，route / prChecker 取得後當第一參數傳入 repo 函數。
 * #03 會把它正規化成 `c.var.db`（middleware 注入），屆時 repo 簽章不變、只有
 * 「db 怎麼來」改變。
 */
export const db = drizzle(sqlite, { schema });
