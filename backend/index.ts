import { Hono } from "hono";
import { cors } from "hono/cors";
import "./src/lib/db";
import { startPRChecker } from "./src/lib/prChecker";
import api from "./src/routes/api";
import pages from "./src/routes/pages";

const app = new Hono();

app.use("/api/*", cors());
app.route("/api", api);
app.route("/", pages);

const port = Number(Bun.env.PORT ?? 3000);

startPRChecker();
console.log(`Blog Editor running at http://localhost:${port}`);

export default { port, fetch: app.fetch };
