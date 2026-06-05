/**
 * `routes/upload` 整合測試。
 *
 * @remarks
 * 本 issue 對 upload 聚焦**參數驗證 / 錯誤路徑**與 R2（mock）happy path；
 * `/upload/temp` 的寫檔 happy-path（會落地 `data/og-temp/`）與 `GET /upload/temp/:token`
 * 的成功讀取**明確 deferred 到後續 issue**，此處只測其驗證與 not-found 路徑。
 * 遵守 Test bootstrap contract（見 setupRouteEnv）。
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { setupRouteApp, resetDb, cleanupRouteDb } from "../helpers/setupRouteEnv";
import { makeClient, type Client } from "../helpers/http";
import { r2, resetMocks } from "../helpers/mocks";

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

describe("POST /upload/r2", () => {
  test("R2 未設定回 503", async () => {
    r2.isR2Enabled.mockReturnValueOnce(false);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    expect((await c.form("/api/upload/r2", "POST", form)).status).toBe(503);
  });

  test("非 multipart body 回 400（Invalid form data）", async () => {
    const res = await c.post("/api/upload/r2", { not: "multipart" });
    expect(res.status).toBe(400);
  });

  test("無 file 回 400", async () => {
    expect((await c.form("/api/upload/r2", "POST", new FormData())).status).toBe(400);
  });

  test("happy path：上傳到 R2 並回傳公開 URL", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "pic.png", { type: "image/png" }));
    const res = await c.form("/api/upload/r2", "POST", form);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^https:\/\/cdn\.example\.com\/uploads\/.+\.png$/);
    expect(r2.uploadToR2).toHaveBeenCalledTimes(1);
  });
});

describe("POST /upload/temp（驗證路徑）", () => {
  test("無 file 回 400", async () => {
    expect((await c.form("/api/upload/temp", "POST", new FormData())).status).toBe(400);
  });

  test("非 JPEG/PNG/WebP 回 415", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "a.txt", { type: "text/plain" }));
    expect((await c.form("/api/upload/temp", "POST", form)).status).toBe(415);
  });
});

describe("GET /upload/temp/:token（驗證路徑）", () => {
  test("token 含非法字元回 400", async () => {
    const res = await c.get("/api/upload/temp/bad%20token");
    expect(res.status).toBe(400);
  });

  test("合法格式但不存在回 404", async () => {
    const res = await c.get("/api/upload/temp/nonexistent.png");
    expect(res.status).toBe(404);
  });
});
