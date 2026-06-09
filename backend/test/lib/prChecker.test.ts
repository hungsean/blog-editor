/**
 * `lib/prChecker` 依賴注入測試：`startPRChecker(deps)` 的真實輪詢邏輯。
 *
 * @remarks
 * #03 把 prChecker 從「import db 單例 / GitHub function / 讀 process.env」改成由 caller 注入
 * `{ db, github, intervalMs, isDev }`，但沒有任何測試覆蓋它——這是 reviewer 指出的盲點。
 * prChecker 是 self-host 常駐功能、route 測試完全不會載入它。本檔用真實 in-memory db + 假 github
 * client 注入，並攔截 `setInterval` 取出輪詢 callback 手動觸發（避免常駐 timer 洩漏到測試行程），
 * 直接驗證兩條輪詢路徑（pr_opened 狀態轉移、draft 遠端同步）對 DB 的副作用。
 */
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { startPRChecker } from "../../src/lib/prChecker";
import type { Github } from "../../src/lib/github";
import { makeTestDb } from "../helpers/makeTestDb";
import { createDraft, getDraftById } from "../../src/lib/repos/drafts";
import type { DrizzleDB } from "../../src/lib/db";

let db: DrizzleDB;
let sqlite: ReturnType<typeof makeTestDb>["sqlite"];

const realSetInterval = globalThis.setInterval;
/** 攔截到的輪詢 callback（startPRChecker 在 setInterval 內註冊的那個）。 */
let tick: (() => void) | undefined;
/** 攔截到的 setInterval 間隔，驗證 intervalMs 有被正確帶入。 */
let registeredInterval: number | undefined;

/** 假 github client：只實作 prChecker 用到的 method，其餘以 mock 佔位。 */
function makeFakeGithub(overrides: Partial<Record<keyof Github, unknown>> = {}): Github {
  const base = {
    defaultBranch: "main",
    getPR: mock(async () => ({
      number: 1, state: "open", merged: false, head: { ref: "f" }, base: { ref: "main" },
    })),
    getPRFiles: mock(async () => [] as Array<{ filename: string; sha: string; status: string }>),
    getFileSha: mock(async () => "remote-sha"),
    listGithubPosts: mock(async () => []),
    getGithubFile: mock(async () => ({ content: "", sha: "" })),
    openPR: mock(async () => ({ prUrl: "", filePath: "" })),
    openBatchPR: mock(async () => ({ prUrl: "" })),
  };
  return { ...base, ...overrides } as unknown as Github;
}

/** 種一筆 draft，缺漏欄位補預設，回傳 id。 */
async function seed(partial: Partial<Parameters<typeof createDraft>[1]> & { id: string }): Promise<string> {
  const now = "2026-01-01T00:00:00.000Z";
  await createDraft(db, {
    title: "T", lang: "en", slug: "", description: "", tags: "[]", fields: "{}",
    content: "", status: "draft", pr_url: "", github_path: "", github_sha: "",
    created_at: now, updated_at: now, ...partial,
  });
  return partial.id;
}

/** 手動觸發一次輪詢並等待兩條 async 路徑對 DB 落地（callback 本身不 await 內部 promise）。 */
async function runTickAndWait(predicate: () => Promise<boolean>): Promise<void> {
  tick!();
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => realSetInterval(r, 1));
  }
  throw new Error("輪詢副作用逾時未落地");
}

beforeEach(() => {
  ({ db, sqlite } = makeTestDb());
  tick = undefined;
  registeredInterval = undefined;
  globalThis.setInterval = ((cb: () => void, ms?: number) => {
    tick = cb;
    registeredInterval = ms;
    return 0 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  // 靜音 prChecker 的進度 log，保持測試輸出乾淨（斷言對象是 DB，不是 console）。
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.setInterval = realSetInterval;
  mock.restore();
  sqlite.close();
});

describe("startPRChecker 啟動契約", () => {
  test("以注入的 intervalMs 註冊 setInterval", () => {
    startPRChecker({ db, github: makeFakeGithub(), intervalMs: 12345, isDev: false });
    expect(registeredInterval).toBe(12345);
    expect(typeof tick).toBe("function");
  });
});

describe("checkOnce：pr_opened 狀態轉移", () => {
  test("PR 已合併至預設分支 → published，並寫入 PR 檔案的 path/sha", async () => {
    await seed({
      id: "d1", title: "Merged", status: "pr_opened",
      pr_url: "https://github.com/me/blog/pull/5",
      github_path: "src/content/blog/en/merged.md",
    });
    const github = makeFakeGithub({
      getPR: mock(async () => ({
        number: 5, state: "closed", merged: true, head: { ref: "f" }, base: { ref: "main" },
      })),
      getPRFiles: mock(async () => [
        { filename: "src/content/blog/en/merged.md", sha: "new-sha", status: "added" },
      ]),
    });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    await runTickAndWait(async () => (await getDraftById(db, "d1"))?.status === "published");

    const draft = await getDraftById(db, "d1");
    expect(draft!.status).toBe("published");
    expect(draft!.github_sha).toBe("new-sha");
    expect(draft!.pr_url).toBe("");
  });

  test("PR 已關閉但未合併 → 退回 draft、清空 pr_url", async () => {
    await seed({ id: "d2", status: "pr_opened", pr_url: "https://github.com/me/blog/pull/6" });
    const github = makeFakeGithub({
      getPR: mock(async () => ({
        number: 6, state: "closed", merged: false, head: { ref: "f" }, base: { ref: "main" },
      })),
    });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    await runTickAndWait(async () => (await getDraftById(db, "d2"))?.status === "draft");

    expect((await getDraftById(db, "d2"))!.pr_url).toBe("");
  });

  test("PR 合併到非預設分支 → 退回 draft", async () => {
    await seed({ id: "d3", status: "pr_opened", pr_url: "https://github.com/me/blog/pull/7" });
    const github = makeFakeGithub({
      getPR: mock(async () => ({
        number: 7, state: "closed", merged: true, head: { ref: "f" }, base: { ref: "dev" },
      })),
    });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    await runTickAndWait(async () => (await getDraftById(db, "d3"))?.status === "draft");
    expect((await getDraftById(db, "d3"))!.status).toBe("draft");
  });

  test("PR 尚未合併 → 維持 pr_opened（getPRFiles 不被呼叫）", async () => {
    await seed({ id: "d4", status: "pr_opened", pr_url: "https://github.com/me/blog/pull/8" });
    const getPRFiles = mock(async () => [] as Array<{ filename: string; sha: string; status: string }>);
    const github = makeFakeGithub({
      getPR: mock(async () => ({
        number: 8, state: "open", merged: false, head: { ref: "f" }, base: { ref: "main" },
      })),
      getPRFiles,
    });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    await runTickAndWait(async () => (github.getPR as ReturnType<typeof mock>).mock.calls.length > 0);
    // 讓尚未合併分支的後續 microtask 有機會跑完
    await new Promise((r) => realSetInterval(r, 5));

    expect((await getDraftById(db, "d4"))!.status).toBe("pr_opened");
    expect(getPRFiles).not.toHaveBeenCalled();
  });

  test("無法解析的 pr_url → 跳過，狀態不變且不呼叫 getPR", async () => {
    await seed({ id: "d5", status: "pr_opened", pr_url: "not-a-valid-url" });
    const getPR = mock(async () => ({
      number: 0, state: "open", merged: false, head: { ref: "f" }, base: { ref: "main" },
    }));
    const github = makeFakeGithub({ getPR });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    tick!();
    await new Promise((r) => realSetInterval(r, 10));

    expect((await getDraftById(db, "d5"))!.status).toBe("pr_opened");
    expect(getPR).not.toHaveBeenCalled();
  });

  test("PR 已合併但找不到對應 github_path 的 .md → 跳過、維持 pr_opened", async () => {
    await seed({
      id: "d7", status: "pr_opened", pr_url: "https://github.com/me/blog/pull/12",
      github_path: "src/content/blog/en/wanted.md",
    });
    const github = makeFakeGithub({
      // isDev:true 走 devLog 分支（驗證 log 開關不影響流程）。
      getPR: mock(async () => ({
        number: 12, state: "closed", merged: true, head: { ref: "f" }, base: { ref: "main" },
      })),
      // 回傳的檔案 filename 與 github_path 不符 → mdFile 找不到。
      getPRFiles: mock(async () => [
        { filename: "src/content/blog/en/other.md", sha: "x", status: "added" },
      ]),
    });

    startPRChecker({ db, github, intervalMs: 1000, isDev: true });
    await runTickAndWait(async () => (github.getPRFiles as ReturnType<typeof mock>).mock.calls.length > 0);
    await new Promise((r) => realSetInterval(r, 5));

    expect((await getDraftById(db, "d7"))!.status).toBe("pr_opened");
  });

  test("getPR 拋錯被 catch，不影響行程、狀態維持", async () => {
    await seed({ id: "d6", status: "pr_opened", pr_url: "https://github.com/me/blog/pull/9" });
    const github = makeFakeGithub({
      getPR: mock(async () => { throw new Error("github down"); }),
    });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    await runTickAndWait(async () => (github.getPR as ReturnType<typeof mock>).mock.calls.length > 0);
    await new Promise((r) => realSetInterval(r, 5));

    expect((await getDraftById(db, "d6"))!.status).toBe("pr_opened");
  });
});

describe("checkDraftsExistOnGithub：draft 遠端同步", () => {
  test("遠端已存在該檔 → 標記 published，寫入 path/sha", async () => {
    await seed({ id: "s1", status: "draft", lang: "en", slug: "exists" });
    const github = makeFakeGithub({ getFileSha: mock(async () => "remote-sha-1") });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    await runTickAndWait(async () => (await getDraftById(db, "s1"))?.status === "published");

    const draft = await getDraftById(db, "s1");
    expect(draft!.github_path).toBe("src/content/blog/en/exists.md");
    expect(draft!.github_sha).toBe("remote-sha-1");
  });

  test("遠端不存在（getFileSha 404）→ 維持 draft、清空 github_path/sha", async () => {
    await seed({
      id: "s2", status: "draft", lang: "en", slug: "missing",
      github_path: "stale", github_sha: "stale-sha",
    });
    const github = makeFakeGithub({
      getFileSha: mock(async () => { throw new Error("404"); }),
    });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    await runTickAndWait(async () => (await getDraftById(db, "s2"))?.github_path === "");

    const draft = await getDraftById(db, "s2");
    expect(draft!.status).toBe("draft");
    expect(draft!.github_sha).toBe("");
  });

  test("slug 與他篇衝突 → 跳過自動標記、維持 draft", async () => {
    // 另一篇已 published 占用同 lang/slug。
    await seed({
      id: "other", title: "Other", status: "published", lang: "en", slug: "dup",
      github_path: "src/content/blog/en/dup.md",
    });
    await seed({ id: "s3", title: "Mine", status: "draft", lang: "en", slug: "dup" });
    const github = makeFakeGithub({ getFileSha: mock(async () => "remote-sha") });

    startPRChecker({ db, github, intervalMs: 1000, isDev: false });
    tick!();
    await new Promise((r) => realSetInterval(r, 15));

    expect((await getDraftById(db, "s3"))!.status).toBe("draft");
  });
});
