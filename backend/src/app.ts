/**
 * ## app
 *
 * 組裝**完整** app：runtime middleware + 全部 `/api/*` 路由。供 self-host 入口（`server.bun.ts`）
 * 與 route 整合測試使用。runtime 中立的型別 / middleware 在 `runtime.ts`，本檔只負責「掛上所有路由」。
 *
 * ### 為什麼用 provider 注入（而非在此判斷 runtime）
 * self-host 的 db 來自 `bun:sqlite`（Bun-only），若在此 import 就會把 `bun:sqlite` 拉進
 * Workers bundle 而炸。因此 db / env 怎麼來一律由兩個入口各自提供 closure（{@link RuntimeProviders}），
 * 在 `runtime.ts` 的 middleware 內呼叫，把結果掛到 `c.var.db` / `c.var.env`。
 *
 * ### 路由前綴
 * 維持 `app.route("/api", api)` 的 `/api` 前綴（沿用舊 `index.ts`），讓兩種 runtime 都接受
 * `/api/*`（#08 的 Pages 轉發不 rewrite path）。
 *
 * @remarks
 * `api` mount 了 `og` 子 router，它 transitively import native（`@resvg/resvg-js`，經 `lib/ogImage`）
 * 模組，故 **import 本檔即會把它拉進 bundle**——完整 app 目前只跑得動 self-host。Workers 端要等
 * #06（og 去 native）；`worker.ts` 因此不 import 本檔，改直接用 `runtime.ts` 的 {@link installRuntime}
 * 掛 Worker-safe 子集（#04 起含已去 aws-sdk 的 `images`）。
 */
import { Hono } from "hono";
import { installRuntime, type AppEnv, type RuntimeProviders } from "./runtime";
import api from "./routes/api";

export type { AppEnv, RuntimeProviders } from "./runtime";

/**
 * 組裝完整 app：runtime middleware + 全部 `/api/*` 路由。
 *
 * @param providers - runtime 注入的 db / env 來源
 * @returns 已就緒、可直接 `app.fetch` 的 Hono 實例
 */
export function createApp(providers: RuntimeProviders): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  installRuntime(app, providers);
  app.route("/api", api);
  return app;
}
