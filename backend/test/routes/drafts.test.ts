/**
 * `routes/drafts` 整合測試：CRUD、batch publish/delete、單篇 publish、resync。
 *
 * @remarks
 * 遵守 Test bootstrap contract：本檔頂端**只** static import `bun:test` 與不碰 db 的 helper；
 * `app` / `db` / repo 全由 `setupRouteApp()` 在設好 `DB_PATH` 與 mock 後 **dynamic import** 取得。
 * GitHub 寫入（openPR / openBatchPR / getGithubFile）一律用 `mocks.ts` 的替身，不打真實網路。
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { setupRouteApp, resetDb, cleanupRouteDb } from "../helpers/setupRouteEnv";
import { makeClient, type Client } from "../helpers/http";
import { github, resetMocks } from "../helpers/mocks";

type Ctx = Awaited<ReturnType<typeof setupRouteApp>>;
let app: Ctx["app"];
let db: Ctx["db"];
let c: Client;
let repo: typeof import("../../src/lib/repos/drafts");

const TODAY = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  ({ app, db } = await setupRouteApp());
  c = makeClient(app);
  // setupRouteApp 已載入 db 單例，此時 dynamic import repo 安全且共用同一 db。
  repo = await import("../../src/lib/repos/drafts");
});

beforeEach(() => {
  resetDb(db);
  resetMocks();
});

afterAll(async () => {
  await cleanupRouteDb();
});

/** 經 API 建一筆草稿，回傳建立後的 draft（含 id）。 */
async function createViaApi(body: Record<string, unknown>) {
  const res = await c.post("/api/drafts", body);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; [k: string]: unknown };
}

describe("GET / POST /drafts", () => {
  test("初始為空陣列", async () => {
    const res = await c.get("/api/drafts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("POST 建立草稿（201），未帶 fields 時預設今日 pubDate", async () => {
    const res = await c.post("/api/drafts", {});
    expect(res.status).toBe(201);
    const draft = (await res.json()) as { id: string; status: string; fields: string };
    expect(draft.id).toBeTruthy();
    expect(draft.status).toBe("draft");
    expect(JSON.parse(draft.fields).pubDate).toBe(TODAY);
  });

  test("POST 帶欄位時 slug 會 trim", async () => {
    const draft = await createViaApi({ title: "T", slug: "  spaced  ", lang: "en" });
    expect(draft.slug).toBe("spaced");
  });

  test("GET 列出已建立的草稿", async () => {
    await createViaApi({ title: "One" });
    await createViaApi({ title: "Two" });
    const res = await c.get("/api/drafts");
    const rows = (await res.json()) as Array<{ title: string }>;
    expect(rows).toHaveLength(2);
  });
});

describe("GET / PATCH / DELETE /drafts/:id", () => {
  test("GET 不存在回 404", async () => {
    const res = await c.get("/api/drafts/nope");
    expect(res.status).toBe(404);
  });

  test("GET 存在回 200 並帶回該草稿", async () => {
    const draft = await createViaApi({ title: "Fetch Me", slug: "fetch-me" });
    const res = await c.get(`/api/drafts/${draft.id}`);
    expect(res.status).toBe(200);
    const got = (await res.json()) as { id: string; title: string };
    expect(got.id).toBe(draft.id);
    expect(got.title).toBe("Fetch Me");
  });

  test("PATCH 更新欄位、slug 被 trim；不存在回 404", async () => {
    const draft = await createViaApi({ title: "Old" });
    const res = await c.patch(`/api/drafts/${draft.id}`, { title: "New", slug: "  s  " });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { title: string; slug: string };
    expect(updated.title).toBe("New");
    expect(updated.slug).toBe("s");

    expect((await c.patch("/api/drafts/missing", { title: "x" })).status).toBe(404);
  });

  test("DELETE 單篇：存在回 200，再刪回 404", async () => {
    const draft = await createViaApi({ title: "Del" });
    expect((await c.del(`/api/drafts/${draft.id}`)).status).toBe(200);
    expect((await c.del(`/api/drafts/${draft.id}`)).status).toBe(404);
  });
});

describe("DELETE /drafts（batch）", () => {
  test("缺 draftIds 回 400", async () => {
    const res = await c.del("/api/drafts", {});
    expect(res.status).toBe(400);
  });

  test("回傳實際刪除的 id 與數量", async () => {
    const a = await createViaApi({ title: "A" });
    const b = await createViaApi({ title: "B" });
    const res = await c.del("/api/drafts", { draftIds: [a.id, "ghost", b.id] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: string[]; count: number };
    expect(body.count).toBe(2);
    expect([...body.deleted].sort()).toEqual([a.id, b.id].sort());
  });
});

describe("POST /drafts/:id/publish（單篇）", () => {
  test("draft 不存在回 404", async () => {
    expect((await c.post("/api/drafts/nope/publish")).status).toBe(404);
  });

  test("slug 為空（純 CJK 標題）回 400 reason=required", async () => {
    const draft = await createViaApi({ title: "你好世界", lang: "zh-tw" });
    const res = await c.post(`/api/drafts/${draft.id}/publish`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe("required");
    expect(github.openPR).not.toHaveBeenCalled();
  });

  test("slug 格式不合法回 400 reason=invalid", async () => {
    const draft = await createViaApi({ title: "X", slug: "Bad Slug", lang: "en" });
    const res = await c.post(`/api/drafts/${draft.id}/publish`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe("invalid");
  });

  test("pubDate 格式不合法回 400 reason=invalid", async () => {
    const draft = await createViaApi({
      title: "X", slug: "bad-date-fmt", lang: "en",
      fields: JSON.stringify({ pubDate: "2026/01/01" }),
    });
    const res = await c.post(`/api/drafts/${draft.id}/publish`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string; error: string };
    expect(body.reason).toBe("invalid");
    expect(body.error).toContain("YYYY-MM-DD");
  });

  test("pubDate 非真實日曆日期回 400 reason=invalid", async () => {
    const draft = await createViaApi({
      title: "X", slug: "bad-date-cal", lang: "en",
      fields: JSON.stringify({ pubDate: "2026-02-30" }),
    });
    const res = await c.post(`/api/drafts/${draft.id}/publish`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string; error: string };
    expect(body.reason).toBe("invalid");
    expect(body.error).toContain("不是有效日期");
  });

  test("同 lang 已有相同 slug 回 400 reason=conflict", async () => {
    await createViaApi({ title: "A", slug: "dup", lang: "en" });
    const b = await createViaApi({ title: "B", slug: "dup", lang: "en" });
    const res = await c.post(`/api/drafts/${b.id}/publish`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe("conflict");
    expect(github.openPR).not.toHaveBeenCalled();
  });

  test("happy path：呼叫 openPR，draft 轉為 pr_opened 並寫回 pr_url / github_path", async () => {
    const draft = await createViaApi({ title: "Good Post", slug: "good-post", lang: "en" });
    const res = await c.post(`/api/drafts/${draft.id}/publish`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; pr_url: string };
    expect(body.success).toBe(true);
    expect(body.pr_url).toBe("https://github.com/owner/repo/pull/1");

    expect(github.openPR).toHaveBeenCalledTimes(1);
    const arg = github.openPR.mock.calls[0]![0] as { slug: string; lang: string };
    expect(arg.slug).toBe("good-post");
    expect(arg.lang).toBe("en");

    const after = await repo.getDraftById(db, draft.id);
    expect(after!.status).toBe("pr_opened");
    expect(after!.pr_url).toBe("https://github.com/owner/repo/pull/1");
    expect(after!.github_path).toBe("src/content/blog/en/good-post.md");
  });

  test("openPR 拋錯時回 500", async () => {
    github.openPR.mockRejectedValueOnce(new Error("github down"));
    const draft = await createViaApi({ title: "Boom", slug: "boom", lang: "en" });
    const res = await c.post(`/api/drafts/${draft.id}/publish`);
    expect(res.status).toBe(500);
  });
});

describe("POST /drafts/publish（batch）", () => {
  test("缺 draftIds 回 400", async () => {
    expect((await c.post("/api/drafts/publish", {})).status).toBe(400);
  });

  test("draftIds 全部不存在回 404", async () => {
    const res = await c.post("/api/drafts/publish", { draftIds: ["x", "y"] });
    expect(res.status).toBe(404);
  });

  test("有 draft 缺 slug 回 400 reason=slug_required", async () => {
    const cjk = await createViaApi({ title: "純中文", lang: "zh-tw" });
    const res = await c.post("/api/drafts/publish", { draftIds: [cjk.id] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe("slug_required");
  });

  test("批次內 slug 重複回 400 reason=slug_conflicts（duplicate_in_batch）", async () => {
    const a = await createViaApi({ title: "A", slug: "dup", lang: "en" });
    const b = await createViaApi({ title: "B", slug: "dup", lang: "en" });
    const res = await c.post("/api/drafts/publish", { draftIds: [a.id, b.id] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string; conflicts: Array<{ type: string }> };
    expect(body.reason).toBe("slug_conflicts");
    expect(body.conflicts[0]!.type).toBe("duplicate_in_batch");
    expect(github.openBatchPR).not.toHaveBeenCalled();
  });

  test("與既有 draft slug 衝突回 400（existing_draft）", async () => {
    await createViaApi({ title: "Existing", slug: "dup", lang: "en" });
    const b = await createViaApi({ title: "B", slug: "dup", lang: "en" });
    const res = await c.post("/api/drafts/publish", { draftIds: [b.id] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string; conflicts: Array<{ type: string }> };
    expect(body.reason).toBe("slug_conflicts");
    expect(body.conflicts[0]!.type).toBe("existing_draft");
  });

  test("有 draft 的 pubDate 不合法回 400 reason=invalid_fields", async () => {
    const ok = await createViaApi({ title: "OK", slug: "ok-post", lang: "en" });
    const bad = await createViaApi({
      title: "Bad", slug: "bad-post", lang: "en",
      fields: JSON.stringify({ pubDate: "2026-02-30" }),
    });
    const res = await c.post("/api/drafts/publish", { draftIds: [ok.id, bad.id] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string; drafts: Array<{ id: string }> };
    expect(body.reason).toBe("invalid_fields");
    expect(body.drafts.map((d) => d.id)).toEqual([bad.id]);
    expect(github.openBatchPR).not.toHaveBeenCalled();
  });

  test("openBatchPR 拋錯時回 500", async () => {
    github.openBatchPR.mockRejectedValueOnce(new Error("github down"));
    const a = await createViaApi({ title: "P One", slug: "p-one", lang: "en" });
    const res = await c.post("/api/drafts/publish", { draftIds: [a.id] });
    expect(res.status).toBe(500);
  });

  test("happy path：呼叫 openBatchPR，全部轉 pr_opened", async () => {
    const a = await createViaApi({ title: "P One", slug: "p-one", lang: "en" });
    const b = await createViaApi({ title: "P Two", slug: "p-two", lang: "en" });
    const res = await c.post("/api/drafts/publish", { draftIds: [a.id, b.id] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; count: number; pr_url: string };
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(body.pr_url).toBe("https://github.com/owner/repo/pull/2");
    expect(github.openBatchPR).toHaveBeenCalledTimes(1);

    for (const id of [a.id, b.id]) {
      const after = await repo.getDraftById(db, id);
      expect(after!.status).toBe("pr_opened");
      expect(after!.pr_url).toBe("https://github.com/owner/repo/pull/2");
    }
  });
});

describe("POST /drafts/:id/resync", () => {
  test("不存在回 404", async () => {
    expect((await c.post("/api/drafts/nope/resync")).status).toBe(404);
  });

  test("無 GitHub 來源回 400", async () => {
    const draft = await createViaApi({ title: "No Source" });
    const res = await c.post(`/api/drafts/${draft.id}/resync`);
    expect(res.status).toBe(400);
  });

  test("happy path：以 getGithubFile 內容覆蓋本地草稿", async () => {
    // resync 需要 github_path，API 無法設定，故以 repo 直接 seed。
    await repo.createDraft(db, {
      id: "rsync1",
      title: "Local",
      lang: "zh-tw",
      slug: "local",
      description: "",
      tags: "[]",
      fields: "{}",
      content: "old",
      status: "published",
      pr_url: "",
      github_path: "src/content/blog/en/remote.md",
      github_sha: "old-sha",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const res = await c.post("/api/drafts/rsync1/resync");
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { title: string; github_sha: string };
    // mocks.ts 的 getGithubFile 預設回傳 title "Remote Post" / sha "remote-sha"。
    expect(updated.title).toBe("Remote Post");
    expect(updated.github_sha).toBe("remote-sha");
    expect(github.getGithubFile).toHaveBeenCalledWith("src/content/blog/en/remote.md");
  });

  test("getGithubFile 拋錯時回 500", async () => {
    github.getGithubFile.mockRejectedValueOnce(new Error("github down"));
    await repo.createDraft(db, {
      id: "rsync2",
      title: "Local",
      lang: "zh-tw",
      slug: "local2",
      description: "",
      tags: "[]",
      fields: "{}",
      content: "old",
      status: "published",
      pr_url: "",
      github_path: "src/content/blog/en/remote.md",
      github_sha: "old-sha",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const res = await c.post("/api/drafts/rsync2/resync");
    expect(res.status).toBe(500);
  });
});
