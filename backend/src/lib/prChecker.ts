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
 * 輪詢間隔由 caller 注入（self-host 從 `env.prCheckIntervalMs` 帶入，預設 60 秒）。
 *
 * PR 合併後，靠 publish 時保存的 `github_path` 對應 PR 內的 .md 檔案。
 * 批次 PR 一個 `pr_url` 對應多篇 draft，若只抓第一個 .md 會讓每篇 draft 都被
 * 標成同一個檔案，污染 DB。沒有 `github_path` 的舊資料才退回抓第一個 .md。
 *
 * ### 依賴注入（#03）
 * 不再 import db 單例與 GitHub function / 直接讀 `process.env`。改由 {@link startPRChecker}
 * 注入 `{ db, github, intervalMs, isDev }`——self-host 入口（`server.bun.ts`）用啟動時建好的
 * db 單例與 {@link import("./github").createGithub} client 呼叫。prChecker 是 self-host 常駐
 * process 才有的功能；Workers 端對應的 Cron 觸發在 #05 處理。
 */
import type { DrizzleDB } from "./db";
import {
  listPrOpenedDrafts,
  listSyncableDrafts,
  findSlugConflictBrief,
  updateDraft,
} from "./repos/drafts";
import type { Github, PRFile } from "./github";

/** 寫 verbose log 的函式型別（self-host 依 `isDev` 決定是否輸出）。 */
type DevLog = (...args: unknown[]) => void;

/** {@link startPRChecker} 的注入依賴。 */
export interface PRCheckerDeps {
  db: DrizzleDB;
  github: Github;
  /** 輪詢間隔（毫秒）。 */
  intervalMs: number;
  /** 是否輸出 verbose log（`env.isDev`）。 */
  isDev: boolean;
}

/** PR 內屬於部落格文章、且非刪除狀態的 .md 檔案。 */
function isBlogMd(f: PRFile): boolean {
  return (
    f.status !== "removed" &&
    f.filename.startsWith("src/content/blog/") &&
    f.filename.endsWith(".md")
  );
}

function extractPrNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function checkOnce(db: DrizzleDB, github: Github, devLog: DevLog) {
  devLog(`[prChecker] 開始檢查 pr_opened 文章...`);
  const drafts = await listPrOpenedDrafts(db);

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
      const pr = await github.getPR(prNumber);
      devLog(`[prChecker] PR #${prNumber} 狀態: state=${pr.state}, merged=${pr.merged}`);

      if (pr.state === "closed" && !pr.merged) {
        const now = new Date().toISOString();
        await updateDraft(db, draft.id, { status: "draft", pr_url: "", updated_at: now });
        console.log(`[prChecker] "${draft.title}" PR #${prNumber} 已關閉未合併，退回草稿`);
        continue;
      }

      if (pr.merged && pr.base.ref !== github.defaultBranch) {
        const now = new Date().toISOString();
        await updateDraft(db, draft.id, { status: "draft", pr_url: "", updated_at: now });
        console.log(`[prChecker] "${draft.title}" PR #${prNumber} 合併至 ${pr.base.ref} 而非 ${github.defaultBranch}，退回草稿`);
        continue;
      }

      if (!pr.merged) {
        devLog(`[prChecker] PR #${prNumber} 尚未合併，略過`);
        continue;
      }

      const files = await github.getPRFiles(prNumber);
      // 用 publish 時保存的 github_path 精準對應；舊資料無 github_path 才退回第一個 .md。
      const mdFile = draft.github_path
        ? files.find((f) => isBlogMd(f) && f.filename === draft.github_path)
        : files.find(isBlogMd);

      if (!mdFile) {
        console.warn(
          `[prChecker] PR #${prNumber} 找不到對應 "${draft.title}" 的 .md 檔案 (${draft.github_path || "first blog .md"})，跳過`
        );
        continue;
      }

      const now = new Date().toISOString();

      await updateDraft(db, draft.id, {
        status: "published", pr_url: "",
        github_path: mdFile.filename, github_sha: mdFile.sha, updated_at: now,
      });

      console.log(`[prChecker] "${draft.title}" PR #${prNumber} 已合併，標記為 published`);
    } catch (err) {
      console.error(`[prChecker] 檢查 PR #${prNumber} 失敗:`, err);
    }
  }
}

async function checkDraftsExistOnGithub(db: DrizzleDB, github: Github, devLog: DevLog) {
  devLog(`[prChecker] 開始同步 draft 文章...`);
  const drafts = await listSyncableDrafts(db);

  if (drafts.length === 0) {
    devLog(`[prChecker] 無待同步的 draft 文章`);
    return;
  }
  devLog(`[prChecker] 找到 ${drafts.length} 篇待同步 draft 文章`);

  for (const draft of drafts) {
    const slug = (draft.slug ?? "").trim();
    const path = `src/content/blog/${draft.lang}/${slug}.md`;
    devLog(`[prChecker] 檢查遠端是否存在 "${draft.title}" (${path})...`);
    try {
      const sha = await github.getFileSha(path);
      const slugConflict = await findSlugConflictBrief(db, draft.lang, slug, draft.id);

      if (slugConflict && draft.github_path !== path) {
        console.warn(
          `[prChecker] "${draft.title}" 與 "${slugConflict.title}" slug 重複，略過自動標記 published (${path})`
        );
        continue;
      }

      const now = new Date().toISOString();
      await updateDraft(db, draft.id, {
        status: "published", github_path: path, github_sha: sha, updated_at: now,
      });
      console.log(`[prChecker] "${draft.title}" 在遠端已存在，標記為 published`);
    } catch {
      // 404 = 遠端尚無此檔案，清空 github_path / sha 確保狀態乾淨
      const now = new Date().toISOString();
      await updateDraft(db, draft.id, { github_path: "", github_sha: "", updated_at: now });
      devLog(`[prChecker] "${draft.title}" 遠端尚無此檔案，清空 github_path/sha`);
    }
  }
}

/**
 * 啟動 self-host 的 PR 輪詢常駐任務。
 *
 * @param deps - 注入的 db 單例、GitHub client、輪詢間隔與 dev flag（見 {@link PRCheckerDeps}）
 * @remarks 僅 self-host（有常駐 process）呼叫；Workers 端用 Cron 觸發，於 #05 處理。
 */
export function startPRChecker(deps: PRCheckerDeps): void {
  const { db, github, intervalMs, isDev } = deps;
  const devLog: DevLog = (...args) => { if (isDev) console.log(...args); };

  console.log(`[prChecker] 啟動，每 ${intervalMs / 1000} 秒檢查一次`);
  setInterval(() => {
    checkOnce(db, github, devLog).catch((err) => console.error("[prChecker] 輪詢錯誤:", err));
    checkDraftsExistOnGithub(db, github, devLog).catch((err) => console.error("[prChecker] draft 同步錯誤:", err));
  }, intervalMs);
}
