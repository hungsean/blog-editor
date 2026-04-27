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
};

function extractPrNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function checkOnce() {
  const drafts = db
    .query("SELECT id, title, pr_url FROM drafts WHERE status = 'pr_opened' AND pr_url != ''")
    .all() as PrOpenedDraft[];

  if (drafts.length === 0) return;

  for (const draft of drafts) {
    const prNumber = extractPrNumber(draft.pr_url);
    if (!prNumber) {
      console.warn(`[prChecker] 無法解析 PR URL: ${draft.pr_url}`);
      continue;
    }

    try {
      const pr = await getPR(prNumber);

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

      if (!pr.merged) continue;

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
         SET status = 'published', pr_url = '', source = 'github',
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
  const drafts = db
    .query(
      "SELECT id, title, lang, slug FROM drafts WHERE status = 'draft' AND slug != '' AND lang != '' AND github_path = ''"
    )
    .all() as LocalDraft[];

  for (const draft of drafts) {
    const path = `src/content/blog/${draft.lang}/${draft.slug}.md`;
    try {
      const sha = await getFileSha(path);
      const now = new Date().toISOString();
      db.query(
        `UPDATE drafts
         SET status = 'published', source = 'github',
             github_path = ?, github_sha = ?, updated_at = ?
         WHERE id = ?`
      ).run(path, sha, now, draft.id);
      console.log(`[prChecker] "${draft.title}" 在遠端已存在，標記為 published`);
    } catch {
      // 404 = 遠端尚無此檔案，正常情況，略過
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
