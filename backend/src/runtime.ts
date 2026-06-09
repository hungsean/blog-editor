/**
 * ## runtime
 *
 * Runtime 抽象的**無路由**核心：Hono 環境型別、provider 介面、與安裝 middleware 的
 * {@link installRuntime}。刻意與 `app.ts`（會 import 完整 `routes/api`）分開，讓 `worker.ts`
 * 能只 import 本檔 + 它想掛的少數 route，**不會**透過 `installRuntime` 連帶把 `upload` / `og`
 * （Bun-only / native 相依）拉進 Workers bundle。
 *
 * @remarks
 * 本檔只 import `hono` / `hono/cors` 與 type-only 的 `DrizzleDB` / `Env`，不碰任何 Bun-only 模組，
 * 也不 import 任何 route——這是 worker 煙霧 bundle 能成立的關鍵（見 `app.ts` / `worker.ts` 說明）。
 */
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { DrizzleDB } from "./lib/db";
import type { Env } from "./lib/env";

/**
 * Hono 的 generic 環境型別：把每 request 的 `db` 與設定 `env` 掛在 `c.var`。
 *
 * @remarks
 * `Bindings` 是 runtime 注入的原始 binding（Workers 的 `c.env`，含 D1 binding 與字串變數；
 * self-host 為空物件）。route handler 一律經 `c.var.db` / `c.var.env` 取用，不直接碰 `Bindings`。
 */
export type AppEnv = {
  Bindings: Record<string, unknown>;
  Variables: { db: DrizzleDB; env: Env };
};

/**
 * 兩種 runtime 各自提供的「db / env 怎麼來」。在 middleware 內每 request 呼叫一次。
 */
export interface RuntimeProviders {
  /** 取得這個 request 要用的 Drizzle 實例（self-host 回單例 / Workers 從 `c.env.DB` 建）。 */
  makeDb: (c: Context<AppEnv>) => DrizzleDB;
  /** 讀取這個 request 的設定（self-host 讀 `process.env` / Workers 讀 `c.env`）。 */
  readEnv: (c: Context<AppEnv>) => Env;
}

/**
 * 在 app 上安裝 runtime middleware（env → db → CORS），不掛任何路由。
 *
 * @param app - 目標 Hono 實例
 * @param providers - runtime 注入的 db / env 來源
 *
 * @remarks
 * 兩個 middleware 都掛在 `/api/*`：
 * 1. **runtime context**：先 `c.set("env")` 再 `c.set("db")`（db 的取得可能依賴 env），
 *    讓後續 route handler 經 `c.var.db` / `c.var.env` 取用。
 * 2. **CORS**：origin 動態取自 `c.var.env.corsOrigins`（同源部署不觸發；只有 self-host dev
 *    跨來源時才放行）。比對命中回該 origin、否則回清單第一個（等同舊 `cors({ origin: array })` 行為）。
 *
 * 供 {@link import("./app").createApp}（完整 app）與 `worker.ts`（精簡煙霧 app）共用，
 * 避免兩入口的 middleware 漂移。
 */
export function installRuntime(app: Hono<AppEnv>, providers: RuntimeProviders): void {
  app.use("/api/*", async (c, next) => {
    c.set("env", providers.readEnv(c));
    c.set("db", providers.makeDb(c));
    await next();
  });

  app.use("/api/*", cors({
    origin: (origin, c) => {
      const allowed = c.var.env.corsOrigins;
      if (allowed.includes(origin)) return origin;
      return allowed[0] ?? null;
    },
  }));
}
