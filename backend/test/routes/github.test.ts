/**
 * `routes/github` 整合測試：列出遠端文章（含 synced 標記）、sync 匯入 / 更新 / 略過。
 * GitHub REST 以 `lib/github` 的 mock 隔離。遵守 Test bootstrap contract（見 setupRouteEnv）。
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

describe("GET /github/posts", () => {
  test("合併本地 synced 標記", async () => {
    github.listGithubPosts.mockResolvedValueOnce([
      { path: "src/content/blog/en/a.md", sha: "sha-a" },
      { path: "src/content/blog/en/b.md", sha: "sha-b" },
    ]);
    // 已匯入 a.md（github_path 命中），b.md 尚未。
    await repo.createDraft(db, {
      id: "g1", title: "A", lang: "en", slug: "a", description: "", tags: "[]",
      fields: "{}", content: "", status: "published", pr_url: "",
      github_path: "src/content/blog/en/a.md", github_sha: "sha-a",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    });

    const res = await c.get("/api/github/posts");
    expect(res.status).toBe(200);
    const posts = (await res.json()) as Array<{ path: string; synced: boolean }>;
    expect(posts.find((p) => p.path.endsWith("a.md"))!.synced).toBe(true);
    expect(posts.find((p) => p.path.endsWith("b.md"))!.synced).toBe(false);
  });

  test("listGithubPosts 拋錯回 500", async () => {
    github.listGithubPosts.mockRejectedValueOnce(new Error("github down"));
    const res = await c.get("/api/github/posts");
    expect(res.status).toBe(500);
  });
});

describe("POST /github/sync", () => {
  test("缺 paths 回 400", async () => {
    expect((await c.post("/api/github/sync", {})).status).toBe(400);
  });

  test("新檔案被匯入為 published 草稿", async () => {
    const path = "src/content/blog/en/new.md";
    const res = await c.post("/api/github/sync", { paths: [path] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: string[]; updated: string[] };
    expect(body.imported).toEqual([path]);

    const draft = await repo.getDraftByGithubPath(db, path);
    expect(draft).not.toBeNull();
    expect(draft!.status).toBe("published");
    expect(draft!.title).toBe("Remote Post"); // mocks.ts getGithubFile 預設 frontmatter
  });

  test("既有檔案 sha 未變且未 force 時略過", async () => {
    const path = "src/content/blog/en/same.md";
    await c.post("/api/github/sync", { paths: [path] }); // 首次匯入
    const res = await c.post("/api/github/sync", { paths: [path] }); // sha 相同（mock 固定）
    const body = (await res.json()) as { imported: string[]; updated: string[] };
    expect(body.imported).toEqual([]);
    expect(body.updated).toEqual([]);
  });

  test("force=true 強制更新既有檔案", async () => {
    const path = "src/content/blog/en/force.md";
    await c.post("/api/github/sync", { paths: [path] });
    const res = await c.post("/api/github/sync", { paths: [path], force: true });
    const body = (await res.json()) as { imported: string[]; updated: string[] };
    expect(body.updated).toEqual([path]);
  });
});
