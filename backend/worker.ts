/**
 * ## worker.ts
 *
 * Cloudflare Workers 入口。與 `server.bun.ts` 共用 `src/runtime.ts` 的 runtime 抽象
 * （{@link installRuntime} 同一份 middleware），但**不** import `src/app.ts`（避免連帶把 `og` 的 native
 * 相依拉進 bundle），改自行 mount Worker-safe subset。db / env / storage 來源也與 self-host 不同：
 * - `makeDb`：每 request 從 `c.env.DB`（D1 binding）用 {@link createD1Db} 建（Workers 無常駐單例）。
 * - `readEnv`：每 request 讀 `c.env`（binding 在 import 期尚未注入，故不能在 module top-level 讀）。
 * - `makeStorage`：每 request 從 `c.env.BUCKET`（R2 binding）建 {@link R2Storage}（不碰 aws-sdk）。
 *
 * ### ⚠️ Worker 範圍：尚未掛 `og`
 * `og` 子 router transitively import native 的 `@resvg/resvg-js`（`lib/ogImage`），現階段無法
 * 在 Workers bundle 跑，故**刻意不 mount**。#04 起 `images` 已去 aws-sdk（改吃 `c.var.storage`
 * 的 R2 binding 實作），與 `drafts` / `slug` / `presets` 一同掛載。
 *
 * 完整 Worker 啟動（含 `og`）要等 #06（og 去 native）清掉相依，並由 #07 補上 `nodejs_compat`
 * （github 的 `Buffer` base64）後驗收。`scheduled`（取代 self-host 的 prChecker 常駐輪詢）在 #05 補上。
 */
import { Hono } from "hono";
import { installRuntime, type AppEnv } from "./src/runtime";
import { createD1Db } from "./src/lib/db";
import { readEnv } from "./src/lib/env";
import { R2Storage } from "./src/lib/storage/r2";
import drafts from "./src/routes/drafts";
import slug from "./src/routes/slug";
import presets from "./src/routes/presets";
import images from "./src/routes/images";

const app = new Hono<AppEnv>();

installRuntime(app, {
  makeDb: (c) => createD1Db(c.env.DB as D1Database),
  readEnv: (c) => readEnv(c.env),
  // R2 binding 每 request 注入；publicUrl 取自 env provider（R2_PUBLIC_URL）。
  makeStorage: (c) => new R2Storage(c.env.BUCKET as R2Bucket | undefined, c.var.env.r2.publicUrl),
});

// Worker-safe 子集：drafts / slug / presets / images（images 已去 aws-sdk，改走 R2 binding）。
const api = new Hono<AppEnv>();
api.route("/", drafts);
api.route("/", slug);
api.route("/", presets);
api.route("/", images);
app.route("/api", api);

export default {
  fetch: app.fetch,
  // scheduled（取代 self-host 的 prChecker 常駐輪詢）在 #05 補上。
};
