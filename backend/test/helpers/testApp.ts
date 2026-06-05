/**
 * ## test/helpers/testApp
 *
 * 從 `src/routes/api.ts` 組一個測試用 Hono app（`new Hono().route("/api", api)`）。
 *
 * @remarks
 * **只掛 router**，刻意不 import `index.ts`：`index.ts` 的 top-level 會呼叫
 * `startPRChecker()`（開 `setInterval` 輪詢 GitHub），測試不該啟動它。
 *
 * `api.ts` 一經 import 會連帶把各 route → `lib/db.ts` 載入（觸發開檔等 side effect），
 * 因此本檔的 `api` 一律以 **dynamic import** 取得，呼叫端（`setupRouteEnv`）必須先設好
 * `process.env.DB_PATH` 與外部依賴 mock 才呼叫 `makeTestApp()`，順序見 setupRouteEnv 契約。
 */
import { Hono } from "hono";

/** 動態載入 `api` router 並組成 `/api/*` 的測試 app。 */
export async function makeTestApp(): Promise<Hono> {
  const { default: api } = await import("../../src/routes/api");
  return new Hono().route("/api", api);
}
