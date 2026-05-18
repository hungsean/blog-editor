import { Hono } from "hono";
import { cors } from "hono/cors";
import "./src/lib/db";
import { startPRChecker } from "./src/lib/prChecker";
import api from "./src/routes/api";

const app = new Hono();

/**
 * 允許的 CORS 來源。
 *
 * docker 部署時 nginx 代理 `/api` 為同源請求，本身不觸發 CORS；CORS 只在本機
 * 開發（vite :5173 → backend :3000）跨來源時才會用到。因此預設只放行 localhost
 * 開發來源，不再用 `cors()` 預設全開（`*`）。若 frontend 與 backend 部署在不同
 * 來源，用 `CORS_ORIGIN` 環境變數（逗號分隔多個來源）覆寫。
 */
const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : DEFAULT_CORS_ORIGINS;

app.use("/api/*", cors({ origin: corsOrigins }));
app.route("/api", api);

const port = Number(Bun.env.PORT ?? 3000);

startPRChecker();
console.log(`Blog Editor running at http://localhost:${port}`);
console.log(`[cors] 允許來源: ${corsOrigins.join(", ")}`);

export default { port, fetch: app.fetch };
