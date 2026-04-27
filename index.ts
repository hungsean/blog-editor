import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import "./src/lib/db"; // init DB
import { startPRChecker } from "./src/lib/prChecker";
import api from "./src/routes/api";
import pages from "./src/routes/pages";

const app = new Hono();

app.route("/api", api);
app.use("/css/*", serveStatic({ root: "./public" }));
app.use("/js/*", serveStatic({ root: "./public" }));
app.route("/", pages);

const port = Number(process.env.PORT ?? 3000);

startPRChecker();
console.log(`Blog Editor running at http://localhost:${port}`);

export default { port, fetch: app.fetch };
