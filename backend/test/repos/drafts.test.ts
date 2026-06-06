/**
 * `lib/repos/drafts` 測試：CRUD、batch、slug 衝突（TRIM 語意）、列表排序與過濾。
 *
 * @remarks
 * 覆蓋 #01 改寫的高風險點：slug 衝突一律以 `TRIM(slug)` 比對、batch delete、
 * `listDrafts` 的 pubDate/updated_at 排序、`listSyncableDrafts`/`listPrOpenedDrafts` 過濾。
 * 用 `makeTestDb()` 的 in-memory DB，每個 test 全新一份，互不污染。
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { makeTestDb } from "../helpers/makeTestDb";
import type { DrizzleDB } from "../../src/lib/db";
import type { NewDraft } from "../../src/lib/schema";
import {
  listDrafts,
  getDraftById,
  getDraftByGithubPath,
  createDraft,
  updateDraft,
  deleteDraft,
  deleteDrafts,
  findSlugConflict,
  findSlugConflictExcludingIds,
  findSlugConflictBrief,
  findDraftsBySlug,
  listSyncedGithubPaths,
  listPrOpenedDrafts,
  listSyncableDrafts,
} from "../../src/lib/repos/drafts";

let db: DrizzleDB;

beforeEach(() => {
  db = makeTestDb().db;
});

let seq = 0;
/** 建立一筆 draft 的 NewDraft，未指定欄位走合理預設；id 自動遞增確保唯一。 */
function draftValues(over: Partial<NewDraft> = {}): NewDraft {
  const now = "2026-01-01T00:00:00.000Z";
  seq += 1;
  return {
    id: `d${seq}`,
    title: "",
    lang: "zh-tw",
    slug: "",
    description: "",
    tags: "[]",
    fields: "{}",
    content: "",
    status: "draft",
    pr_url: "",
    github_path: "",
    github_sha: "",
    created_at: now,
    updated_at: now,
    ...over,
  };
}

describe("CRUD", () => {
  test("createDraft 回傳完整列，getDraftById 取得相同資料", async () => {
    const created = await createDraft(db, draftValues({ id: "c1", title: "Hello", slug: "hello" }));
    expect(created.id).toBe("c1");
    expect(created.title).toBe("Hello");

    const fetched = await getDraftById(db, "c1");
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("Hello");
  });

  test("getDraftById 不存在回傳 null", async () => {
    expect(await getDraftById(db, "missing")).toBeNull();
  });

  test("getDraftByGithubPath 依 path 取得", async () => {
    await createDraft(db, draftValues({ id: "g1", github_path: "src/content/blog/en/a.md" }));
    const found = await getDraftByGithubPath(db, "src/content/blog/en/a.md");
    expect(found!.id).toBe("g1");
    expect(await getDraftByGithubPath(db, "src/content/blog/en/none.md")).toBeNull();
  });

  test("updateDraft 局部更新並回傳更新後列；不存在回傳 null", async () => {
    await createDraft(db, draftValues({ id: "u1", title: "Old", description: "keep" }));
    const updated = await updateDraft(db, "u1", { title: "New", updated_at: "2026-02-02T00:00:00.000Z" });
    expect(updated!.title).toBe("New");
    expect(updated!.description).toBe("keep");
    expect(updated!.updated_at).toBe("2026-02-02T00:00:00.000Z");

    expect(await updateDraft(db, "missing", { title: "x" })).toBeNull();
  });

  test("deleteDraft 回傳是否刪到", async () => {
    await createDraft(db, draftValues({ id: "del1" }));
    expect(await deleteDraft(db, "del1")).toBe(true);
    expect(await deleteDraft(db, "del1")).toBe(false);
    expect(await getDraftById(db, "del1")).toBeNull();
  });
});

describe("deleteDrafts（batch）", () => {
  test("空清單直接回傳空陣列，不刪任何資料", async () => {
    await createDraft(db, draftValues({ id: "k1" }));
    expect(await deleteDrafts(db, [])).toEqual([]);
    expect(await getDraftById(db, "k1")).not.toBeNull();
  });

  test("回傳實際刪除的 id，略過不存在的 id", async () => {
    await createDraft(db, draftValues({ id: "b1" }));
    await createDraft(db, draftValues({ id: "b2" }));
    await createDraft(db, draftValues({ id: "b3" }));

    const deleted = await deleteDrafts(db, ["b1", "nope", "b3"]);
    expect([...deleted].sort()).toEqual(["b1", "b3"]);
    expect(await getDraftById(db, "b2")).not.toBeNull();
    expect(await getDraftById(db, "b1")).toBeNull();
    expect(await getDraftById(db, "b3")).toBeNull();
  });
});

describe("slug 衝突（TRIM 語意）", () => {
  test("findSlugConflict：同 lang 同 slug（TRIM 後）且排除自己才算衝突", async () => {
    // 既有 draft 的 slug 兩端帶空白，TRIM 後應與查詢值相等。
    await createDraft(db, draftValues({ id: "s1", lang: "en", slug: "  hello  ", title: "Existing" }));

    const hit = await findSlugConflict(db, "en", "hello", "other");
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("s1");

    // 排除自己 → 無衝突
    expect(await findSlugConflict(db, "en", "hello", "s1")).toBeNull();
    // 不同語言 → 無衝突
    expect(await findSlugConflict(db, "zh-tw", "hello", "other")).toBeNull();
    // 不同 slug → 無衝突
    expect(await findSlugConflict(db, "en", "world", "other")).toBeNull();
  });

  test("findSlugConflictExcludingIds：排除整批，空 excludeIds 時不加排除條件", async () => {
    await createDraft(db, draftValues({ id: "e1", lang: "en", slug: "dup" }));

    // 空 excludeIds → 任何同 lang/slug 都算衝突
    expect((await findSlugConflictExcludingIds(db, "en", "dup", []))!.id).toBe("e1");
    // 把 e1 列入排除 → 無衝突
    expect(await findSlugConflictExcludingIds(db, "en", "dup", ["e1"])).toBeNull();
    // 排除其他 id → 仍是衝突
    expect((await findSlugConflictExcludingIds(db, "en", "dup", ["zzz"]))!.id).toBe("e1");
  });

  test("findSlugConflictBrief：只回傳 id/title，TRIM 後比對", async () => {
    await createDraft(db, draftValues({ id: "p1", lang: "ja", slug: "post ", title: "Brief" }));
    const hit = await findSlugConflictBrief(db, "ja", "post", "other");
    expect(hit).toEqual({ id: "p1", title: "Brief" });
    expect(await findSlugConflictBrief(db, "ja", "post", "p1")).toBeNull();
  });

  test("findDraftsBySlug：帶 lang 限定語言，未帶 lang 跨語言；皆 TRIM 比對", async () => {
    await createDraft(db, draftValues({ id: "f1", lang: "en", slug: " same " }));
    await createDraft(db, draftValues({ id: "f2", lang: "ja", slug: "same" }));

    const enOnly = await findDraftsBySlug(db, "same", "en");
    expect(enOnly.map((r) => r.id)).toEqual(["f1"]);

    const all = await findDraftsBySlug(db, "same");
    expect([...all.map((r) => r.id)].sort()).toEqual(["f1", "f2"]);
  });
});

describe("listDrafts 排序", () => {
  test("依 pubDate DESC 再 updated_at DESC，無 pubDate 者排最後", async () => {
    await createDraft(db, draftValues({
      id: "A", fields: JSON.stringify({ pubDate: "2026-01-01" }), updated_at: "2026-01-01T00:00:00.000Z",
    }));
    await createDraft(db, draftValues({
      id: "B", fields: JSON.stringify({ pubDate: "2026-03-01" }), updated_at: "2026-03-01T00:00:00.000Z",
    }));
    await createDraft(db, draftValues({
      id: "C", fields: JSON.stringify({ pubDate: "2026-03-01" }), updated_at: "2026-03-09T00:00:00.000Z",
    }));
    await createDraft(db, draftValues({
      id: "D", fields: "{}", updated_at: "2026-09-09T00:00:00.000Z",
    }));

    const rows = await listDrafts(db);
    // 同 pubDate(03-01) 時 updated_at 新者(C)在前；01-01(A)居中；無 pubDate(D)最後。
    expect(rows.map((r) => r.id)).toEqual(["C", "B", "A", "D"]);
  });
});

describe("prChecker 用列表過濾", () => {
  test("listSyncedGithubPaths 只列 github_path 非空者", async () => {
    await createDraft(db, draftValues({ id: "h1", github_path: "src/content/blog/en/x.md" }));
    await createDraft(db, draftValues({ id: "h2", github_path: "" }));
    expect(await listSyncedGithubPaths(db)).toEqual(["src/content/blog/en/x.md"]);
  });

  test("listPrOpenedDrafts 只列 status=pr_opened 且 pr_url 非空者", async () => {
    await createDraft(db, draftValues({ id: "o1", status: "pr_opened", pr_url: "https://github.com/o/r/pull/1" }));
    await createDraft(db, draftValues({ id: "o2", status: "pr_opened", pr_url: "" }));
    await createDraft(db, draftValues({ id: "o3", status: "draft", pr_url: "https://github.com/o/r/pull/2" }));

    const rows = await listPrOpenedDrafts(db);
    expect(rows.map((r) => r.id)).toEqual(["o1"]);
  });

  test("listSyncableDrafts：status=draft 且 slug(TRIM)/lang 皆非空", async () => {
    await createDraft(db, draftValues({ id: "y1", status: "draft", lang: "en", slug: "ok" }));
    await createDraft(db, draftValues({ id: "y2", status: "draft", lang: "en", slug: "   " })); // 純空白 slug → 排除
    await createDraft(db, draftValues({ id: "y3", status: "draft", lang: "", slug: "ok" }));     // 空 lang → 排除
    await createDraft(db, draftValues({ id: "y4", status: "published", lang: "en", slug: "ok" })); // 非 draft → 排除

    const rows = await listSyncableDrafts(db);
    expect(rows.map((r) => r.id)).toEqual(["y1"]);
  });
});
