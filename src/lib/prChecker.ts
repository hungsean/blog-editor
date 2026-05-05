/**
 * ## prChecker
 *
 * 定時輪詢兩類文章：
 * 1. status = 'pr_opened'：檢查 PR 是否已合併 → published，或已關閉 → 退回 draft
 * 2. status = 'draft'（有 lang + slug）：檢查遠端是否已存在該檔案 → 若有則更新為 published
 *
 * @remarks
 * `github_sha` 直接使用 PR Files API 回傳的 blob SHA，不再呼叫 Contents API。
 * draft 同步使用 Contents API 取得 SHA；404 視為檔案不存在，靜默略過。
 * 輪詢間隔預設 60 秒，可透過 PR_CHECK_INTERVAL_MS 環境變數調整。
 */
import { db } from "./db";
import { getPR, getPRFiles, getFileSha, GITHUB_DEFAULT_BRANCH } from "./github";

const INTERVAL_MS = Number(process.env.PR_CHECK_INTERVAL_MS ?? 60_000);
const DEV = process.env.NODE_ENV !== "production";
const devLog = (...args: unknown[]) => DEV && console.log(...args);

type PrOpenedDraft = {
  id: string;
  title: string;
  pr_url: string;
};

type LocalDraft = {
  id: string;
  title: string;
  lang: string;
  slug: string;
  github_path: string;
};

function extractPrNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function checkOnce() {
  devLog(`[prChecker] 開始檢查 pr_opened 文章...`);
  const drafts = db
    .query("SELECT id, title, pr_url FROM drafts WHERE status = 'pr_opened' AND pr_url != ''")
    .all() as PrOpenedDraft[];

  if (drafts.length === 0) {
    devLog(`[prChecker] 無待檢查的 pr_opened 文章`);
    return;
  }
  devLog(`[prChecker] 找到 ${drafts.length} 篇待檢查文章`);

  for (const draft of drafts) {
    const prNumber = extractPrNumber(draft.pr_url);
    if (!prNumber) {
      console.warn(`[prChecker] 無法解析 PR URL: ${draft.pr_url}`);
      continue;
    }

    try {
      devLog(`[prChecker] 檢查 "${draft.title}" PR #${prNumber}...`);
      const pr = await getPR(prNumber);
      devLog(`[prChecker] PR #${prNumber} 狀態: state=${pr.state}, merged=${pr.merged}`);

      if (pr.state === "closed" && !pr.merged) {
        const now = new Date().toISOString();
        db.query("UPDATE drafts SET status = 'draft', pr_url = '', updated_at = ? WHERE id = ?")
          .run(now, draft.id);
        console.log(`[prChecker] "${draft.title}" PR #${prNumber} 已關閉未合併，退回草稿`);
        continue;
      }

      if (pr.merged && pr.base.ref !== GITHUB_DEFAULT_BRANCH) {
        const now = new Date().toISOString();
        db.query("UPDATE drafts SET status = 'draft', pr_url = '', updated_at = ? WHERE id = ?")
          .run(now, draft.id);
        console.log(`[prChecker] "${draft.title}" PR #${prNumber} 合併至 ${pr.base.ref} 而非 ${GITHUB_DEFAULT_BRANCH}，退回草稿`);
        continue;
      }

      if (!pr.merged) {
        devLog(`[prChecker] PR #${prNumber} 尚未合併，略過`);
        continue;
      }

      const files = await getPRFiles(prNumber);
      const mdFile = files.find(
        (f) =>
          f.status !== "removed" &&
          f.filename.startsWith("src/content/blog/") &&
          f.filename.endsWith(".md")
      );

      if (!mdFile) {
        console.warn(`[prChecker] PR #${prNumber} 找不到 .md 檔案，跳過`);
        continue;
      }

      const now = new Date().toISOString();

      db.query(
        `UPDATE drafts
         SET status = 'published', pr_url = '',
             github_path = ?, github_sha = ?, updated_at = ?
         WHERE id = ?`
      ).run(mdFile.filename, mdFile.sha, now, draft.id);

      console.log(`[prChecker] "${draft.title}" PR #${prNumber} 已合併，標記為 published`);
    } catch (err) {
      console.error(`[prChecker] 檢查 PR #${prNumber} 失敗:`, err);
    }
  }
}

async function checkDraftsExistOnGithub() {
  devLog(`[prChecker] 開始同步 draft 文章...`);
  const drafts = db
    .query(
      "SELECT id, title, lang, slug, github_path FROM drafts WHERE status = 'draft' AND TRIM(slug) != '' AND lang != ''"
    )
    .all() as LocalDraft[];

  if (drafts.length === 0) {
    devLog(`[prChecker] 無待同步的 draft 文章`);
    return;
  }
  devLog(`[prChecker] 找到 ${drafts.length} 篇待同步 draft 文章`);

  for (const draft of drafts) {
    const slug = draft.slug.trim();
    const path = `src/content/blog/${draft.lang}/${slug}.md`;
    devLog(`[prChecker] 檢查遠端是否存在 "${draft.title}" (${path})...`);
    try {
      const sha = await getFileSha(path);
      const slugConflict = db.query(
        "SELECT id, title FROM drafts WHERE lang = ? AND TRIM(slug) = ? AND id != ? LIMIT 1"
      ).get(draft.lang, slug, draft.id) as { id: string; title: string } | null;

      if (slugConflict && draft.github_path !== path) {
        console.warn(
          `[prChecker] "${draft.title}" 與 "${slugConflict.title}" slug 重複，略過自動標記 published (${path})`
        );
        continue;
      }

      const now = new Date().toISOString();
      db.query(
        `UPDATE drafts
         SET status = 'published',
             github_path = ?, github_sha = ?, updated_at = ?
         WHERE id = ?`
      ).run(path, sha, now, draft.id);
      console.log(`[prChecker] "${draft.title}" 在遠端已存在，標記為 published`);
    } catch {
      // 404 = 遠端尚無此檔案，清空 github_path / sha 確保狀態乾淨
      const now = new Date().toISOString();
      db.query(
        `UPDATE drafts SET github_path = '', github_sha = '', updated_at = ? WHERE id = ?`
      ).run(now, draft.id);
      devLog(`[prChecker] "${draft.title}" 遠端尚無此檔案，清空 github_path/sha`);
    }
  }
}

export function startPRChecker() {
  console.log(`[prChecker] 啟動，每 ${INTERVAL_MS / 1000} 秒檢查一次`);
  setInterval(() => {
    checkOnce().catch((err) => console.error("[prChecker] 輪詢錯誤:", err));
    checkDraftsExistOnGithub().catch((err) => console.error("[prChecker] draft 同步錯誤:", err));
  }, INTERVAL_MS);
}
