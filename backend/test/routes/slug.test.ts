/**
 * `routes/slug` 整合測試：`GET /api/slug` 的必填驗證、lang 過濾與 TRIM 比對。
 * 遵守 Test bootstrap contract（先設 env/mock 再 dynamic import，見 setupRouteEnv）。
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { setupRouteApp, resetDb, cleanupRouteDb } from "../helpers/setupRouteEnv";
import { makeClient, type Client } from "../helpers/http";
import { resetMocks } from "../helpers/mocks";

type Ctx = Awaited<ReturnType<typeof setupRouteApp>>;
let app: Ctx["app"];
let db: Ctx["db"];
let c: Client;
let repo: typeof import("../../src/lib/repos/drafts");

beforeAll(async () => {
  ({ app, db } = await setupRouteApp());
  c = makeClient(app);
  repo = await import("../../src/lib/repos/drafts");
});

beforeEach(() => {
  resetDb(db);
  resetMocks();
});

afterAll(async () => {
  await cleanupRouteDb();
});

/** seed 一筆指定 lang/slug 的草稿（slug 可帶空白以驗證 TRIM）。 */
async function seedDraft(id: string, lang: string, slug: string) {
  await repo.createDraft(db, {
    id,
    title: id,
    lang,
    slug,
    description: "",
    tags: "[]",
    fields: "{}",
    content: "",
    status: "draft",
    pr_url: "",
    github_path: "",
    github_sha: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

test("缺 slug query 回 400", async () => {
  const res = await c.get("/api/slug");
  expect(res.status).toBe(400);
});

test("回傳同 slug 的草稿（跨語言）", async () => {
  await seedDraft("s1", "en", " same ");
  await seedDraft("s2", "ja", "same");
  const res = await c.get("/api/slug?slug=same");
  expect(res.status).toBe(200);
  const rows = (await res.json()) as Array<{ id: string }>;
  expect([...rows.map((r) => r.id)].sort()).toEqual(["s1", "s2"]);
});

test("帶 lang 時限定語言", async () => {
  await seedDraft("s1", "en", "same");
  await seedDraft("s2", "ja", "same");
  const res = await c.get("/api/slug?slug=same&lang=en");
  const rows = (await res.json()) as Array<{ id: string }>;
  expect(rows.map((r) => r.id)).toEqual(["s1"]);
});

test("slug query 前後空白被 trim 後比對", async () => {
  await seedDraft("s1", "en", "trimmed");
  const res = await c.get("/api/slug?slug=%20trimmed%20");
  const rows = (await res.json()) as Array<{ id: string }>;
  expect(rows.map((r) => r.id)).toEqual(["s1"]);
});
