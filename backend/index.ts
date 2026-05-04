import { Hono } from "hono";
import { cors } from "hono/cors";
import "./src/lib/db";
import { startPRChecker } from "./src/lib/prChecker";
import api from "./src/routes/api";

const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  }),
);
app.route("/api", api);

const port = Number(process.env.PORT ?? 3000);

startPRChecker();
Bun.serve({ port, fetch: app.fetch });
console.log(`Blog Editor API running at http://localhost:${port}`);
