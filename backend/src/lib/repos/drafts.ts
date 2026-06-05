/**
 * ## repos/drafts
 *
 * `drafts` 表的資料存取層（repository 風格）。所有 DB 操作集中於此，route 與
 * prChecker 只呼叫這些具名函數並把 `db` 當第一參數傳入。
 *
 * @remarks
 * 注入契約：每個函數第一參數皆為 `db: DrizzleDB`，本檔**不 import db 單例**，
 * 只 import `schema.ts` 的 table 定義與型別（見 #01 計畫）。全部 async，內部 `await`。
 * `slug` 衝突判定一律以 `TRIM(slug)` 比對，對齊原 raw SQL（slug 兩端空白不算差異）。
 */
import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db";
import { drafts, type Draft, type NewDraft } from "../schema";

/** slug 衝突 / slug 查詢回傳的精簡欄位。 */
export type DraftSlugInfo = {
  id: string;
  title: string;
  lang: string;
  slug: string;
  status: string;
  github_path: string;
};

const SLUG_INFO_COLUMNS = {
  id: drafts.id,
  title: drafts.title,
  lang: drafts.lang,
  slug: drafts.slug,
  status: drafts.status,
  github_path: drafts.github_path,
} as const;

/**
 * 列出所有草稿（列表用欄位子集），依 pubDate 再 updated_at 由新到舊排序。
 *
 * @remarks
 * 排序對齊原 SQL：`DATE(json_extract(fields, '$.pubDate')) DESC, updated_at DESC`。
 * pubDate 存於 `fields` JSON 內，需用 SQLite 的 `json_extract` 取出。
 */
export async function listDrafts(db: DrizzleDB) {
  return db
    .select({
      id: drafts.id,
      title: drafts.title,
      lang: drafts.lang,
      slug: drafts.slug,
      status: drafts.status,
      pr_url: drafts.pr_url,
      github_path: drafts.github_path,
      github_sha: drafts.github_sha,
      created_at: drafts.created_at,
      updated_at: drafts.updated_at,
      fields: drafts.fields,
    })
    .from(drafts)
    .orderBy(
      sql`DATE(json_extract(${drafts.fields}, '$.pubDate')) DESC`,
      desc(drafts.updated_at),
    );
}

/** 依 id 取得單筆草稿（完整欄位），不存在回傳 `null`。 */
export async function getDraftById(db: DrizzleDB, id: string): Promise<Draft | null> {
  const rows = await db.select().from(drafts).where(eq(drafts.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 依 github_path 取得單筆草稿（完整欄位），不存在回傳 `null`。 */
export async function getDraftByGithubPath(db: DrizzleDB, path: string): Promise<Draft | null> {
  const rows = await db.select().from(drafts).where(eq(drafts.github_path, path)).limit(1);
  return rows[0] ?? null;
}

/** 建立草稿並回傳建立後的完整列。 */
export async function createDraft(db: DrizzleDB, values: NewDraft): Promise<Draft> {
  const rows = await db.insert(drafts).values(values).returning();
  return rows[0]!;
}

/**
 * 局部更新草稿，回傳更新後的完整列；id 不存在回傳 `null`。
 *
 * @remarks
 * 呼叫端負責提供 `updated_at`（與既有 route 行為一致，時間語意留在呼叫端）。
 */
export async function updateDraft(
  db: DrizzleDB,
  id: string,
  patch: Partial<NewDraft>,
): Promise<Draft | null> {
  const rows = await db.update(drafts).set(patch).where(eq(drafts.id, id)).returning();
  return rows[0] ?? null;
}

/** 刪除單筆草稿，回傳是否確實刪到（原本是否存在）。 */
export async function deleteDraft(db: DrizzleDB, id: string): Promise<boolean> {
  const rows = await db.delete(drafts).where(eq(drafts.id, id)).returning({ id: drafts.id });
  return rows.length > 0;
}

/**
 * 批次刪除草稿，回傳實際刪除的 id 清單。
 *
 * @remarks
 * 以 `inArray` 一次刪除並用 `returning` 取得刪到的 id，取代原本逐筆 SELECT + DELETE。
 * 空清單時直接回傳空陣列，避免產生無意義的 `IN ()` 查詢。
 */
export async function deleteDrafts(db: DrizzleDB, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .delete(drafts)
    .where(inArray(drafts.id, ids))
    .returning({ id: drafts.id });
  return rows.map((r) => r.id);
}

/**
 * 找出同 lang、同 slug（TRIM 後）且 id 不等於 `excludeId` 的第一筆衝突草稿。
 *
 * @remarks
 * 對應單篇 publish 的 slug 衝突檢查；無衝突回傳 `null`。
 */
export async function findSlugConflict(
  db: DrizzleDB,
  lang: string,
  slug: string,
  excludeId: string,
): Promise<DraftSlugInfo | null> {
  const rows = await db
    .select(SLUG_INFO_COLUMNS)
    .from(drafts)
    .where(
      and(
        eq(drafts.lang, lang),
        eq(sql`TRIM(${drafts.slug})`, slug),
        ne(drafts.id, excludeId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 找出同 lang、同 slug（TRIM 後）且 id 不在 `excludeIds` 內的第一筆衝突草稿。
 *
 * @remarks
 * 對應批次 publish 的 slug 衝突檢查（要排除整批自己人），對齊原 `id NOT IN (...)`。
 */
export async function findSlugConflictExcludingIds(
  db: DrizzleDB,
  lang: string,
  slug: string,
  excludeIds: string[],
): Promise<DraftSlugInfo | null> {
  const rows = await db
    .select(SLUG_INFO_COLUMNS)
    .from(drafts)
    .where(
      and(
        eq(drafts.lang, lang),
        eq(sql`TRIM(${drafts.slug})`, slug),
        excludeIds.length > 0 ? notInArray(drafts.id, excludeIds) : undefined,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * prChecker 用的精簡 slug 衝突檢查：同 lang、同 slug、id 不等於 `excludeId`。
 *
 * @remarks
 * 只回傳 `{ id, title }`，對齊原 prChecker 子查詢；無衝突回傳 `null`。
 */
export async function findSlugConflictBrief(
  db: DrizzleDB,
  lang: string,
  slug: string,
  excludeId: string,
): Promise<{ id: string; title: string } | null> {
  const rows = await db
    .select({ id: drafts.id, title: drafts.title })
    .from(drafts)
    .where(
      and(
        eq(drafts.lang, lang),
        eq(sql`TRIM(${drafts.slug})`, slug),
        ne(drafts.id, excludeId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 查詢 slug（TRIM 後）相符的草稿（slug 可用性檢查用）；給定 `lang` 時再限定語言。
 *
 * @remarks
 * 回傳精簡欄位，對齊 `/api/slug` 既有輸出（id/title/lang/slug/status/github_path）。
 */
export async function findDraftsBySlug(
  db: DrizzleDB,
  slug: string,
  lang?: string,
): Promise<DraftSlugInfo[]> {
  return db
    .select(SLUG_INFO_COLUMNS)
    .from(drafts)
    .where(
      lang
        ? and(eq(drafts.lang, lang), eq(sql`TRIM(${drafts.slug})`, slug))
        : eq(sql`TRIM(${drafts.slug})`, slug),
    );
}

/** 列出所有已綁定 GitHub 來源（github_path 非空）的草稿 path 清單。 */
export async function listSyncedGithubPaths(db: DrizzleDB): Promise<string[]> {
  const rows = await db
    .select({ github_path: drafts.github_path })
    .from(drafts)
    .where(ne(drafts.github_path, ""));
  return rows.map((r) => r.github_path ?? "").filter((p) => p !== "");
}

/** prChecker：列出待輪詢的 pr_opened 草稿（pr_url 非空）。 */
export async function listPrOpenedDrafts(db: DrizzleDB) {
  return db
    .select({
      id: drafts.id,
      title: drafts.title,
      pr_url: drafts.pr_url,
      github_path: drafts.github_path,
    })
    .from(drafts)
    .where(and(eq(drafts.status, "pr_opened"), ne(drafts.pr_url, "")));
}

/**
 * prChecker：列出可同步偵測的 draft（status=draft、slug 與 lang 皆非空）。
 *
 * @remarks
 * slug 以 `TRIM(slug) != ''` 判定，對齊原 SQL（純空白 slug 視為未設定）。
 */
export async function listSyncableDrafts(db: DrizzleDB) {
  return db
    .select({
      id: drafts.id,
      title: drafts.title,
      lang: drafts.lang,
      slug: drafts.slug,
      github_path: drafts.github_path,
    })
    .from(drafts)
    .where(
      and(
        eq(drafts.status, "draft"),
        ne(sql`TRIM(${drafts.slug})`, ""),
        ne(drafts.lang, ""),
      ),
    );
}
