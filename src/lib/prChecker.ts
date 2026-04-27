/**
 * ## prChecker
 *
 * 定時輪詢 status = 'pr_opened' 的文章，檢查 PR 是否已合併。
 * 若已合併，更新為 published，補足 github_path / github_sha，清除 pr_url，source 改為 github。
 *
 * @remarks
 * `github_sha` 直接使用 PR Files API 回傳的 blob SHA，不再呼叫 Contents API。
 * GitHub PR Files 的 `sha` 欄位即為該檔案合併後在 main 上的 blob SHA，兩者相同。
 * 輪詢間隔預設 60 秒，可透過 PR_CHECK_INTERVAL_MS 環境變數調整。
 */
import { db } from "./db";
import { getPR, getPRFiles } from "./github";

const INTERVAL_MS = Number(process.env.PR_CHECK_INTERVAL_MS ?? 60_000);

type PrOpenedDraft = {
  id: string;
  title: string;
  pr_url: string;
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

export function startPRChecker() {
  console.log(`[prChecker] 啟動，每 ${INTERVAL_MS / 1000} 秒檢查一次`);
  setInterval(() => {
    checkOnce().catch((err) => console.error("[prChecker] 輪詢錯誤:", err));
  }, INTERVAL_MS);
}
