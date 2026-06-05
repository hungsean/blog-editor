/**
 * ## test/helpers/setupRouteEnv
 *
 * route 整合測試的 **bootstrap**：封裝「先設 `DB_PATH` / 註冊外部 mock → 再 dynamic import
 * 受測模組」這段硬規則的載入順序，讓 route 測試拿到一個已就緒、隔離的 `app` 與 `db`。
 *
 * ### 為什麼非得這樣（Test bootstrap contract）
 * `src/lib/db.ts` 在 **module load 當下**就讀 `process.env.DB_PATH`、`mkdir`、開檔、建表
 * （top-level side effect）。ESM static import 會在測試檔 body 執行**之前**就解析並執行，
 * 因此「在測試檔頂端寫 `process.env.DB_PATH = ...` 再 static import api」**不可靠**——
 * db.ts 早就先用錯誤（甚至 production）的路徑開好檔了。
 *
 * 解法：route 測試檔**只** static import `bun:test` 與本 helper（皆不碰 db），
 * 由 `setupRouteApp()` 在 **dynamic import 之前**設好 env 與 mock。
 *
 * ### 共用 DB_PATH 來源與單例壽命（重要地雷）
 * 匯出固定常數 `ROUTE_TEST_DB_PATH`，所有 route 測試都經由本 helper 看到同一個值、
 * **同一個 db 單例**。Bun 在同一 test process **共用 module registry**（一個模組只評估
 * 一次），故 `db.ts` 的 sqlite 連線在整個 `bun test` 過程只建一次、被所有 route 測試檔共用。
 *
 * 這帶來一個刪檔時機的地雷：**不能在 per-file `afterAll` 刪暫存 DB 檔**。若刪了，後續測試檔
 * 共用的那條開啟中的 sqlite 連線會在下一次查詢爆 `SQLITE_IOERR_VNODE`（macOS 上實測）。
 * 因此暫存檔的清理改為：
 * - **模組載入當下**（早於任何 db 開檔）先刪掉上一輪殘留檔 → 這是**主要保證**：每次
 *   `bun test` 都從乾淨的空 DB 起跑，不會跨次累積、也不碰 production `data/`。
 * - `process.on("exit")` 再補刪一次 → 僅 best-effort：實測 Bun **不會**在 `bun test` 結束時
 *   觸發 exit 事件，故暫存檔會留在 `os.tmpdir()` 直到下次啟動的載入清理把它刪掉（OS 暫存目錄、
 *   非 repo，無污染）。此 handler 主要涵蓋非 test 情境。
 *
 * route 測試之間的隔離改靠 `resetDb()` 在 `beforeEach` 清空三表，不依賴刪檔。
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { DrizzleDB } from "../../src/lib/db";
import { registerMocks } from "./mocks";

/** 所有 route 測試共用的暫存 DB 檔路徑（固定，放 OS 暫存目錄，不落在 repo）。 */
export const ROUTE_TEST_DB_PATH = join(tmpdir(), "blog-editor-route-test.db");

/** 暫存 DB 主檔與 SQLite 可能產生的 -wal / -shm 副檔。 */
const DB_FILES = [ROUTE_TEST_DB_PATH, `${ROUTE_TEST_DB_PATH}-wal`, `${ROUTE_TEST_DB_PATH}-shm`];

/** 同步刪除暫存 DB 全部檔案；不存在時忽略。 */
function removeDbFiles(): void {
  for (const f of DB_FILES) {
    try {
      unlinkSync(f);
    } catch {
      // 檔案不存在，忽略
    }
  }
}

// 模組載入當下（在任何 db 開檔之前）先清掉上一輪可能殘留的暫存 DB，確保乾淨起點。
removeDbFiles();

let exitCleanupRegistered = false;
/** 註冊一次性的 process 結束清理（所有測試檔共用，故只在最後刪檔一次，避免破壞共用連線）。 */
function ensureExitCleanup(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.on("exit", removeDbFiles);
}

/**
 * 設好 env / mock 後 dynamic import，回傳已就緒的測試 app 與 db 單例。
 *
 * @remarks
 * 嚴格順序：設 `DB_PATH` → `registerMocks()` → dynamic import `testApp`（→ api → db）。
 * 在 route 測試的 `beforeAll` 呼叫一次即可。回傳的 `db` 供 `resetDb()` 清表與斷言 DB 副作用。
 */
export async function setupRouteApp(): Promise<{ app: Hono; db: DrizzleDB }> {
  process.env.DB_PATH = ROUTE_TEST_DB_PATH;
  registerMocks();
  ensureExitCleanup();

  const { makeTestApp } = await import("./testApp");
  const app = await makeTestApp();
  const { db } = await import("../../src/lib/db");
  return { app, db };
}

/**
 * 清空三張表（`drafts` / `translation_presets` / `images`），在每個 route 測試的
 * `beforeEach` 呼叫，避免測試之間互相污染。
 *
 * @remarks
 * 共用同一個 db 單例（跨檔在 process 內只建一次），唯一可靠的隔離手段就是每次清表
 * （不能靠刪檔，見本檔頂端的單例壽命說明）。
 */
export function resetDb(db: DrizzleDB): void {
  db.run(sql`DELETE FROM drafts`);
  db.run(sql`DELETE FROM translation_presets`);
  db.run(sql`DELETE FROM images`);
}

/**
 * route 測試檔的 `afterAll` 收尾。
 *
 * @remarks
 * **刻意不在此刪暫存 DB 檔**：db 單例連線被所有測試檔共用，若在某檔的 `afterAll` 刪檔，
 * 後續檔案的查詢會爆 `SQLITE_IOERR_VNODE`。真正的刪檔在「模組載入時」與「process 結束時」
 * （見本檔頂端）。此函式只確保 process 結束清理已註冊，並做為各檔 `afterAll` 的明確收尾點。
 */
export async function cleanupRouteDb(): Promise<void> {
  ensureExitCleanup();
}
