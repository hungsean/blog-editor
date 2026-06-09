/**
 * `lib/github` 真實 factory 邊界測試：`createGithub(env)` 回傳的真實 client。
 *
 * @remarks
 * route 測試用 `mock.module("../../src/lib/github")` 把整個 factory 換成假 client，因此**真實的**
 * `createGithub`（githubFetch 認證標頭、錯誤處理、tree 過濾、base64 解碼、PR 流程）在 route 測試
 * 裡完全沒被執行到——這正是「有改到但沒測到」的盲點。本檔不碰 `mock.module`，改 mock 全域
 * `fetch`，直接驗證真實 client 的行為與發出的 HTTP 請求。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createGithub } from "../../src/lib/github";

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string };

const env = { token: "tok-123", owner: "me", repo: "blog", defaultBranch: "main" };

let calls: Recorded[] = [];
const realFetch = globalThis.fetch;

/** 路由式 fetch 替身：依 (method, url 子字串) 比對，回傳對應 JSON / 狀態碼，並記錄每次呼叫。 */
function routeFetch(
  routes: Array<{ method?: string; match: string; status?: number; json?: unknown; text?: string }>,
) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, headers, body: init?.body as string | undefined });

    const route = routes.find(
      (r) => url.includes(r.match) && (r.method ?? "GET").toUpperCase() === method,
    );
    if (!route) throw new Error(`未預期的 fetch: ${method} ${url}`);

    const status = route.status ?? 200;
    const responseBody = route.text ?? JSON.stringify(route.json ?? {});
    return new Response(responseBody, { status });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("githubFetch（認證標頭與錯誤處理）", () => {
  test("帶上 Bearer token 與 GitHub API 標頭", async () => {
    routeFetch([
      { method: "GET", match: "/branches/main", json: { commit: { commit: { tree: { sha: "t" } } } } },
      { method: "GET", match: "/git/trees/", json: { tree: [] } },
    ]);
    await createGithub(env).listGithubPosts();

    expect(calls[0]!.headers.Authorization).toBe("Bearer tok-123");
    expect(calls[0]!.headers.Accept).toBe("application/vnd.github+json");
    expect(calls[0]!.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(calls[0]!.url).toBe("https://api.github.com/repos/me/blog/branches/main");
  });

  test("非 2xx 回應會丟出含狀態碼與 body 的錯誤", async () => {
    routeFetch([{ method: "GET", match: "/branches/main", status: 404, text: "Not Found" }]);
    await expect(createGithub(env).listGithubPosts()).rejects.toThrow(
      "GitHub API error 404: Not Found",
    );
  });
});

describe("listGithubPosts", () => {
  test("只回傳 src/content/blog 下的 .md blob", async () => {
    routeFetch([
      { method: "GET", match: "/branches/main", json: { commit: { commit: { tree: { sha: "tree-sha" } } } } },
      {
        method: "GET",
        match: "/git/trees/tree-sha",
        json: {
          tree: [
            { path: "src/content/blog/en/a.md", sha: "sha-a", type: "blob" },
            { path: "src/content/blog/en", sha: "dir", type: "tree" }, // 目錄，濾掉
            { path: "src/content/blog/en/img.png", sha: "sha-img", type: "blob" }, // 非 .md，濾掉
            { path: "README.md", sha: "sha-readme", type: "blob" }, // 不在 blog 目錄，濾掉
          ],
        },
      },
    ]);

    const posts = await createGithub(env).listGithubPosts();
    expect(posts).toEqual([{ path: "src/content/blog/en/a.md", sha: "sha-a" }]);
    // recursive=1 有帶上
    expect(calls[1]!.url).toContain("recursive=1");
  });
});

describe("getGithubFile", () => {
  test("base64 內容會被解碼成 utf-8", async () => {
    const raw = "---\ntitle: Hello\n---\n本文";
    routeFetch([
      {
        method: "GET",
        match: "/contents/src/content/blog/en/a.md",
        json: { content: Buffer.from(raw).toString("base64"), sha: "file-sha" },
      },
    ]);

    const file = await createGithub(env).getGithubFile("src/content/blog/en/a.md");
    expect(file).toEqual({ content: raw, sha: "file-sha" });
    expect(calls[0]!.url).toContain("ref=main");
  });
});

describe("getPR / getPRFiles / getFileSha", () => {
  test("getPR 直接回傳 PR 狀態", async () => {
    const pr = { number: 7, state: "open", merged: false, head: { ref: "f" }, base: { ref: "main" } };
    routeFetch([{ method: "GET", match: "/pulls/7", json: pr }]);
    expect(await createGithub(env).getPR(7)).toEqual(pr);
  });

  test("getPRFiles 回傳檔案清單", async () => {
    const files = [{ filename: "src/content/blog/en/a.md", sha: "s", status: "added" }];
    routeFetch([{ method: "GET", match: "/pulls/7/files", json: files }]);
    expect(await createGithub(env).getPRFiles(7)).toEqual(files);
  });

  test("getFileSha 取出 contents API 的 sha", async () => {
    routeFetch([{ method: "GET", match: "/contents/path/to.md", json: { sha: "abc" } }]);
    expect(await createGithub(env).getFileSha("path/to.md")).toBe("abc");
  });
});

describe("openPR（新檔案）", () => {
  test("建立 branch → 建檔 → 開 PR，回傳 prUrl 與 filePath", async () => {
    routeFetch([
      { method: "GET", match: "/git/ref/heads/main", json: { object: { sha: "base-sha" } } },
      { method: "POST", match: "/git/refs", json: {} },
      { method: "PUT", match: "/contents/src/content/blog/en/hello.md", json: {} },
      { method: "POST", match: "/pulls", json: { html_url: "https://github.com/me/blog/pull/9" } },
    ]);

    const result = await createGithub(env).openPR({
      title: "Hello",
      slug: "hello",
      lang: "en",
      date: "2026-06-09",
      frontmatter: "title: Hello\n",
      content: "本文",
    });

    expect(result).toEqual({
      prUrl: "https://github.com/me/blog/pull/9",
      filePath: "src/content/blog/en/hello.md",
    });

    // 新檔案不帶 sha（PUT body 不含 sha 欄位）
    const put = calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(put.body!)).not.toHaveProperty("sha");
    // branch 名稱格式 blog/{date}-{lang}-{slug}
    const refPost = calls.find((c) => c.url.endsWith("/git/refs"))!;
    expect(JSON.parse(refPost.body!).ref).toBe("refs/heads/blog/2026-06-09-en-hello");
  });
});

describe("openPR（更新既有檔案）", () => {
  test("帶 githubPath / githubSha 時更新原檔，PUT body 含 sha", async () => {
    routeFetch([
      { method: "GET", match: "/git/ref/heads/main", json: { object: { sha: "base-sha" } } },
      { method: "POST", match: "/git/refs", json: {} },
      { method: "PUT", match: "/contents/src/content/blog/en/existing.md", json: {} },
      { method: "POST", match: "/pulls", json: { html_url: "https://github.com/me/blog/pull/10" } },
    ]);

    const result = await createGithub(env).openPR({
      title: "Existing",
      slug: "new-slug",
      lang: "en",
      date: "2026-06-09",
      frontmatter: "title: Existing\n",
      content: "更新內容",
      githubPath: "src/content/blog/en/existing.md",
      githubSha: "old-sha",
    });

    expect(result.filePath).toBe("src/content/blog/en/existing.md");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(put.body!).sha).toBe("old-sha");
  });
});

describe("openBatchPR", () => {
  test("建立多個 blob → tree → commit → branch → PR，回傳 prUrl", async () => {
    routeFetch([
      { method: "GET", match: "/git/ref/heads/main", json: { object: { sha: "base-sha" } } },
      { method: "GET", match: "/git/commits/base-sha", json: { tree: { sha: "base-tree" } } },
      { method: "POST", match: "/git/blobs", json: { sha: "blob-sha" } },
      { method: "POST", match: "/git/trees", json: { sha: "new-tree" } },
      { method: "POST", match: "/git/commits", json: { sha: "new-commit" } },
      { method: "POST", match: "/git/refs", json: {} },
      { method: "POST", match: "/pulls", json: { html_url: "https://github.com/me/blog/pull/11" } },
    ]);

    const result = await createGithub(env).openBatchPR([
      { title: "A", slug: "a", lang: "en", date: "2026-06-09", frontmatter: "title: A\n", content: "甲" },
      { title: "B", slug: "b", lang: "en", date: "2026-06-09", frontmatter: "title: B\n", content: "乙" },
    ]);

    expect(result).toEqual({ prUrl: "https://github.com/me/blog/pull/11" });
    // 兩篇 → 兩個 blob
    expect(calls.filter((c) => c.url.endsWith("/git/blobs"))).toHaveLength(2);
    // tree 以 base_tree 為基底
    const treePost = calls.find((c) => c.url.endsWith("/git/trees"))!;
    expect(JSON.parse(treePost.body!).base_tree).toBe("base-tree");
  });
});
