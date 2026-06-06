/**
 * `routes/upload` 整合測試。
 *
 * @remarks
 * 涵蓋 `/upload/r2`、`/upload/temp`、`GET /upload/temp/:token` 的驗證 / 錯誤路徑與
 * happy path。`/upload/temp` 的寫檔 happy-path 會真的落地 `data/og-temp/`，因此測試
 * 會追蹤建立的 token 檔並在 `afterAll` 清掉（見 `CREATED_TOKENS` 與清理邏輯）。
 * 遵守 Test bootstrap contract（見 setupRouteEnv）。
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { setupRouteApp, resetDb, cleanupRouteDb } from "../helpers/setupRouteEnv";
import { makeClient, type Client } from "../helpers/http";
import { r2, resetMocks } from "../helpers/mocks";

/** `/upload/temp` 寫檔位置，與 `src/routes/upload.ts` 的 `OG_TEMP_DIR` 常數一致。 */
const OG_TEMP_DIR = "data/og-temp";
/** 本檔測試在 og-temp 內建立的 token，afterAll 逐一刪除以免污染 repo。 */
const CREATED_TOKENS: string[] = [];

/** 建一張指定 MIME 的 multipart form，內容為 size bytes 的零填充。 */
function fileForm(name: string, type: string, size = 4): FormData {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(size)], name, { type }));
  return form;
}

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
  // 清掉 /upload/temp happy-path 寫進 og-temp 的暫存檔，避免污染 repo。
  await Promise.all(
    CREATED_TOKENS.map((t) => rm(`${OG_TEMP_DIR}/${t}`, { force: true })),
  );
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

  test("uploadToR2 拋錯回 500", async () => {
    r2.uploadToR2.mockRejectedValueOnce(new Error("r2 down"));
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "x.png", { type: "image/png" }));
    expect((await c.form("/api/upload/r2", "POST", form)).status).toBe(500);
  });
});

describe("POST /upload/temp", () => {
  test("非 multipart body 回 400（Invalid form data）", async () => {
    const res = await c.post("/api/upload/temp", { not: "multipart" });
    expect(res.status).toBe(400);
  });

  test("無 file 回 400", async () => {
    expect((await c.form("/api/upload/temp", "POST", new FormData())).status).toBe(400);
  });

  test("非 JPEG/PNG/WebP 回 415", async () => {
    const res = await c.form("/api/upload/temp", "POST", fileForm("a.txt", "text/plain"));
    expect(res.status).toBe(415);
  });

  test("超過 30 MB 回 413", async () => {
    const res = await c.form(
      "/api/upload/temp",
      "POST",
      fileForm("big.png", "image/png", 30 * 1024 * 1024 + 1),
    );
    expect(res.status).toBe(413);
  });

  test("happy path：寫入 og-temp 並回傳 {nanoid}.{ext} token", async () => {
    const res = await c.form("/api/upload/temp", "POST", fileForm("hero.webp", "image/webp"));
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    CREATED_TOKENS.push(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.webp$/);
    // 確認檔案真的落地 og-temp。
    expect(await Bun.file(`${OG_TEMP_DIR}/${token}`).exists()).toBe(true);
  });
});

describe("GET /upload/temp/:token", () => {
  test("token 含非法字元回 400", async () => {
    const res = await c.get("/api/upload/temp/bad%20token");
    expect(res.status).toBe(400);
  });

  test("合法格式但不存在回 404", async () => {
    const res = await c.get("/api/upload/temp/nonexistent.png");
    expect(res.status).toBe(404);
  });

  test("happy path：以 base64 data URL 回傳暫存圖片內容", async () => {
    // 先以 /upload/temp 寫入一張 PNG，再讀回確認 data URL。
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const form = new FormData();
    form.set("file", new File([png], "hero.png", { type: "image/png" }));
    const token = ((await (await c.form("/api/upload/temp", "POST", form)).json()) as { token: string }).token;
    CREATED_TOKENS.push(token);

    const res = await c.get(`/api/upload/temp/${token}`);
    expect(res.status).toBe(200);
    const { dataUrl } = (await res.json()) as { dataUrl: string };
    expect(dataUrl).toBe(`data:image/png;base64,${Buffer.from(png).toString("base64")}`);
  });
});
