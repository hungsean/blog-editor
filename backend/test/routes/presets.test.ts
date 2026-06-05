/**
 * `routes/presets` 整合測試：translation presets 的 CRUD 與輸入驗證。
 * 遵守 Test bootstrap contract（見 setupRouteEnv）。
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { setupRouteApp, resetDb, cleanupRouteDb } from "../helpers/setupRouteEnv";
import { makeClient, type Client } from "../helpers/http";
import { resetMocks } from "../helpers/mocks";

type Ctx = Awaited<ReturnType<typeof setupRouteApp>>;
let app: Ctx["app"];
let db: Ctx["db"];
let c: Client;

beforeAll(async () => {
  ({ app, db } = await setupRouteApp());
  c = makeClient(app);
});

beforeEach(() => {
  resetDb(db);
  resetMocks();
});

afterAll(async () => {
  await cleanupRouteDb();
});

async function createPreset(body: Record<string, unknown>) {
  const res = await c.post("/api/presets", body);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; keywords: string; translations: string; note: string };
}

test("GET 初始為空陣列", async () => {
  const res = await c.get("/api/presets");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST keywords 非陣列或空陣列回 400", async () => {
  expect((await c.post("/api/presets", {})).status).toBe(400);
  expect((await c.post("/api/presets", { keywords: [] })).status).toBe(400);
});

test("POST 建立 preset（201），keywords/translations 以 JSON 字串存放", async () => {
  const preset = await createPreset({
    keywords: ["foo", "bar"],
    translations: { en: "FOO" },
    note: "hi",
  });
  expect(JSON.parse(preset.keywords)).toEqual(["foo", "bar"]);
  expect(JSON.parse(preset.translations)).toEqual({ en: "FOO" });
  expect(preset.note).toBe("hi");
});

test("GET /:id 取回單筆；不存在回 404", async () => {
  const preset = await createPreset({ keywords: ["k"] });
  expect((await c.get(`/api/presets/${preset.id}`)).status).toBe(200);
  expect((await c.get("/api/presets/missing")).status).toBe(404);
});

test("PATCH 更新；不存在回 404", async () => {
  const preset = await createPreset({ keywords: ["k"], note: "old" });
  const res = await c.patch(`/api/presets/${preset.id}`, { note: "new" });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { note: string }).note).toBe("new");
  expect((await c.patch("/api/presets/missing", { note: "x" })).status).toBe(404);
});

test("DELETE 刪除；不存在回 404", async () => {
  const preset = await createPreset({ keywords: ["k"] });
  expect((await c.del(`/api/presets/${preset.id}`)).status).toBe(200);
  expect((await c.del(`/api/presets/${preset.id}`)).status).toBe(404);
});
