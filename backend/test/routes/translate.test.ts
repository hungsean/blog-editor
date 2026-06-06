/**
 * `routes/translate` 整合測試：翻譯狀態、啟用判斷、輸入驗證、preset 過濾後呼叫 translateDraft。
 * OpenAI 以 `lib/translator` 的 mock 隔離。遵守 Test bootstrap contract（見 setupRouteEnv）。
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { setupRouteApp, resetDb, cleanupRouteDb } from "../helpers/setupRouteEnv";
import { makeClient, type Client } from "../helpers/http";
import { translator, resetMocks } from "../helpers/mocks";

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

const validBody = {
  title: "Hello",
  description: "desc",
  content: "this mentions foo keyword",
  sourceLang: "en",
  targetLang: "ja",
};

test("GET /translation/status 反映 isTranslationEnabled", async () => {
  const res = await c.get("/api/translation/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ enabled: true });

  translator.isTranslationEnabled.mockReturnValueOnce(false);
  expect(await (await c.get("/api/translation/status")).json()).toEqual({ enabled: false });
});

test("POST /translation：未啟用回 503", async () => {
  translator.isTranslationEnabled.mockReturnValueOnce(false);
  const res = await c.post("/api/translation", validBody);
  expect(res.status).toBe(503);
});

test("POST /translation：缺必填欄位回 400", async () => {
  const res = await c.post("/api/translation", { title: "x" });
  expect(res.status).toBe(400);
});

test("POST /translation：happy path 回傳 translateDraft 結果", async () => {
  const res = await c.post("/api/translation", validBody);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { title: string; content: string };
  // mocks.ts translateDraft 預設回 `[targetLang] title` 與附歸因的 content。
  expect(body.title).toBe("[ja] Hello");
  expect(body.content).toContain("Translated by mock");
  expect(translator.translateDraft).toHaveBeenCalledTimes(1);
});

test("POST /translation：只把命中關鍵字的 preset 傳給 translateDraft", async () => {
  // seed 兩個 preset：一個關鍵字命中 content（foo），一個不命中（zzz）。
  await c.post("/api/presets", { keywords: ["foo"], translations: { ja: "フー" } });
  await c.post("/api/presets", { keywords: ["zzz"], translations: { ja: "ズ" } });

  const res = await c.post("/api/translation", validBody);
  expect(res.status).toBe(200);

  const arg = translator.translateDraft.mock.calls[0]![0] as {
    presets?: Array<{ keywords: string[] }>;
  };
  expect(arg.presets).toHaveLength(1);
  expect(arg.presets![0]!.keywords).toEqual(["foo"]);
});

test("POST /translation：translateDraft 拋錯回 500", async () => {
  translator.translateDraft.mockRejectedValueOnce(new Error("openai down"));
  const res = await c.post("/api/translation", validBody);
  expect(res.status).toBe(500);
});
