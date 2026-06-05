/**
 * `routes/og` 整合測試。
 *
 * @remarks
 * OG 圖片生成（satori/resvg）以 `lib/ogImage` 的 mock 隔離，不做真實渲染、不下載字型；
 * R2 上傳以 `lib/r2` mock 隔離。聚焦驗證 / 錯誤路徑，並涵蓋 mock 後的 happy path。
 * 遵守 Test bootstrap contract（見 setupRouteEnv）。
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { setupRouteApp, resetDb, cleanupRouteDb } from "../helpers/setupRouteEnv";
import { makeClient, type Client } from "../helpers/http";
import { r2, ogImage, resetMocks } from "../helpers/mocks";

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

describe("POST /og/preview", () => {
  test("缺 title 回 400", async () => {
    expect((await c.post("/api/og/preview", {})).status).toBe(400);
    expect((await c.post("/api/og/preview", { title: "  " })).status).toBe(400);
  });

  test("happy path：回傳 PNG bytes（image/png）", async () => {
    const res = await c.post("/api/og/preview", { title: "Hello", tags: ["a"] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(ogImage.generateArticleOg).toHaveBeenCalledTimes(1);
  });

  test("generateArticleOg 拋錯回 500", async () => {
    ogImage.generateArticleOg.mockRejectedValueOnce(new Error("render failed"));
    const res = await c.post("/api/og/preview", { title: "Boom" });
    expect(res.status).toBe(500);
  });
});

describe("POST /og/upload", () => {
  test("R2 未設定回 503", async () => {
    r2.isR2Enabled.mockReturnValueOnce(false);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "og.png", { type: "image/png" }));
    form.set("draftId", "draft1");
    expect((await c.form("/api/og/upload", "POST", form)).status).toBe(503);
  });

  test("無 file 回 400", async () => {
    const form = new FormData();
    form.set("draftId", "draft1");
    expect((await c.form("/api/og/upload", "POST", form)).status).toBe(400);
  });

  test("draftId 含非法字元回 400", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "og.png", { type: "image/png" }));
    form.set("draftId", "bad/id");
    expect((await c.form("/api/og/upload", "POST", form)).status).toBe(400);
  });

  test("happy path：上傳 PNG 到 R2 並回傳 URL", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0x89, 0x50])], "og.png", { type: "image/png" }));
    form.set("draftId", "draft1");
    const res = await c.form("/api/og/upload", "POST", form);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe("https://cdn.example.com/og/draft1.png");
    expect(r2.uploadToR2).toHaveBeenCalledWith("og/draft1.png", expect.anything(), "image/png");
  });
});
