/**
 * `routes/images` 整合測試：圖片庫列表、儲存 sync、upload。物件儲存全程以注入的 mock 隔離。
 * 遵守 Test bootstrap contract（見 setupRouteEnv）。
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { setupRouteApp, resetDb, cleanupRouteDb } from "../helpers/setupRouteEnv";
import { makeClient, type Client } from "../helpers/http";
import { storage, resetMocks } from "../helpers/mocks";

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

test("GET /images 初始為空陣列（純讀 DB，不碰 R2）", async () => {
  const res = await c.get("/api/images");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /images/sync：儲存未設定回 503", async () => {
  storage.isEnabled.mockReturnValueOnce(false);
  const res = await c.post("/api/images/sync");
  expect(res.status).toBe(503);
});

test("POST /images/sync：upsert 圖片並略過非圖片副檔名", async () => {
  storage.list.mockResolvedValueOnce([
    { key: "uploads/a.png", url: "https://cdn/a.png", size: 10, lastModified: "2026-01-01T00:00:00.000Z" },
    { key: "uploads/readme.txt", url: "https://cdn/readme.txt", size: 5, lastModified: "2026-01-01T00:00:00.000Z" },
    { key: "uploads/b.jpg", url: "https://cdn/b.jpg", size: 20, lastModified: "2026-02-01T00:00:00.000Z" },
  ]);

  const res = await c.post("/api/images/sync");
  expect(res.status).toBe(200);
  expect(((await res.json()) as { synced: number }).synced).toBe(2);

  const rows = (await (await c.get("/api/images")).json()) as Array<{ key: string }>;
  expect([...rows.map((r) => r.key)].sort()).toEqual(["uploads/a.png", "uploads/b.jpg"]);
});

test("POST /images/sync：storage.list 拋錯回 500", async () => {
  storage.list.mockRejectedValueOnce(new Error("r2 down"));
  const res = await c.post("/api/images/sync");
  expect(res.status).toBe(500);
});

test("POST /images/upload：儲存未設定回 503", async () => {
  storage.isEnabled.mockReturnValueOnce(false);
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
  const res = await c.form("/api/images/upload", "POST", form);
  expect(res.status).toBe(503);
});

test("POST /images/upload：無 file 回 400", async () => {
  const res = await c.form("/api/images/upload", "POST", new FormData());
  expect(res.status).toBe(400);
});

test("POST /images/upload：上傳到 R2 並寫入圖片庫", async () => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "pic.png", { type: "image/png" }));
  const res = await c.form("/api/images/upload", "POST", form);
  expect(res.status).toBe(200);

  const body = (await res.json()) as { key: string; url: string; size: number };
  expect(body.key).toMatch(/^uploads\/.+\.png$/);
  expect(body.url).toBe(`https://cdn.example.com/${body.key}`);
  expect(storage.put).toHaveBeenCalledTimes(1);

  const rows = (await (await c.get("/api/images")).json()) as Array<{ key: string }>;
  expect(rows.map((r) => r.key)).toEqual([body.key]);
});

test("POST /images/upload：非 multipart body 回 400", async () => {
  const res = await c.post("/api/images/upload", { not: "multipart" });
  expect(res.status).toBe(400);
});

test("POST /images/upload：storage.put 拋錯回 500（不寫入 DB）", async () => {
  storage.put.mockRejectedValueOnce(new Error("r2 down"));
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "pic.png", { type: "image/png" }));
  const res = await c.form("/api/images/upload", "POST", form);
  expect(res.status).toBe(500);

  // 上傳失敗時不應留下任何圖片列。
  expect(await (await c.get("/api/images")).json()).toEqual([]);
});
