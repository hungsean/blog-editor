/**
 * ## worker.ts
 *
 * Cloudflare Workers 入口。與 `server.bun.ts` 共用 `src/app.ts` 的 runtime 抽象，但 db / env
 * 來源不同：
 * - `makeDb`：每 request 從 `c.env.DB`（D1 binding）用 {@link createD1Db} 建（Workers 無常駐單例）。
 * - `readEnv`：每 request 讀 `c.env`（binding 在 import 期尚未注入，故不能在 module top-level 讀）。
 *
 * ### ⚠️ #03 範圍：精簡煙霧入口
 * 完整 `app`（{@link createApp}）會 mount `upload` / `og`，它們 transitively import Bun-only
 * （`node:fs`、`Bun.file`）與 native（`@resvg/resvg-js`）模組，現階段無法在 Workers bundle 跑。
 * 因此本入口**刻意只 mount `drafts` / `slug` / `presets`** 這幾個 Worker-safe 的子 router，
 * 用 {@link installRuntime}（與完整 app 同一份 middleware）證明 runtime 抽象成立即可。
 *
 * 完整 Worker 啟動（含 upload/og）要等 #04（storage 去 fs）與 #06（og 去 native）清掉相依，
 * 並由 #07 補上 `nodejs_compat`（github 的 `Buffer` base64）後驗收。`scheduled`（取代
 * self-host 的 prChecker 常駐輪詢）在 #05 補上。
 */
import { Hono } from "hono";
import { installRuntime, type AppEnv } from "./src/runtime";
import { createD1Db } from "./src/lib/db";
import { readEnv } from "./src/lib/env";
import drafts from "./src/routes/drafts";
import slug from "./src/routes/slug";
import presets from "./src/routes/presets";

const app = new Hono<AppEnv>();

installRuntime(app, {
  makeDb: (c) => createD1Db(c.env.DB as D1Database),
  readEnv: (c) => readEnv(c.env),
});

// #03 煙霧子集：只掛不依賴 Bun-only / native 模組的 Worker-safe 路由。
const api = new Hono<AppEnv>();
api.route("/", drafts);
api.route("/", slug);
api.route("/", presets);
app.route("/api", api);

export default {
  fetch: app.fetch,
  // scheduled（取代 self-host 的 prChecker 常駐輪詢）在 #05 補上。
};
