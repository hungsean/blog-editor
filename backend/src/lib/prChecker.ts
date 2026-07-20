/**
 * ## PR reconcile service
 *
 * 將 PR 狀態對帳與遠端檔案偵測集中為 runtime-neutral service：self-host 的 interval、
 * Cloudflare Cron 與手動 endpoint 都呼叫 {@link runPrChecks}。
 *
 * @remarks
 * 同一個 `pr_url` 的草稿會分組後只查一次 PR / files，避免 batch publish 的 N+1 GitHub 請求。
 * 只在 GitHub 明確回傳 404 時清除 stale `github_path` / `github_sha`；認證、rate limit、
 * 網路等其他失敗會保留資料並收進摘要，避免把暫時故障誤判成遠端刪檔。
 */
import type { DrizzleDB } from "./db";
import {
  findSlugConflictBrief,
  listPrOpenedDrafts,
  listSyncableDrafts,
  updateDraft,
} from "./repos/drafts";
import { GithubApiError, type Github, type PRFile } from "./github";

type DevLog = (...args: unknown[]) => void;

export interface PRCheckerDeps {
  db: DrizzleDB;
  github: Github;
  intervalMs: number;
  isDev: boolean;
}

export interface ReconcileOptions {
  /** 每輪最多處理多少個不同 PR；其餘留到下一輪。 */
  maxPrs?: number;
  /** 每輪最多處理多少篇可同步 draft；其餘留到下一輪。 */
  maxDrafts?: number;
  /** 自訂詳細 log；未提供時不輸出 verbose log。 */
  devLog?: DevLog;
}

export interface ReconcileResult {
  published: string[];
  returnedToDraft: string[];
  clearedRemoteState: string[];
  errors: string[];
  skipped: boolean;
}

const DEFAULT_MAX_PRS = 25;
const DEFAULT_MAX_DRAFTS = 100;
let isReconciling = false;

function emptyResult(skipped = false): ReconcileResult {
  return { published: [], returnedToDraft: [], clearedRemoteState: [], errors: [], skipped };
}

/** PR 內屬於部落格文章、且非刪除狀態的 .md 檔案。 */
function isBlogMd(file: PRFile): boolean {
  return file.status !== "removed"
    && file.filename.startsWith("src/content/blog/")
    && file.filename.endsWith(".md");
}

function extractPrNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isNotFound(error: unknown): error is GithubApiError {
  return error instanceof GithubApiError && error.status === 404;
}

async function reconcilePrOpenedDrafts(
  db: DrizzleDB,
  github: Github,
  result: ReconcileResult,
  maxPrs: number,
  devLog: DevLog,
): Promise<void> {
  const groups = new Map<string, Awaited<ReturnType<typeof listPrOpenedDrafts>>>();
  for (const draft of await listPrOpenedDrafts(db)) {
    const existing = groups.get(draft.pr_url) ?? [];
    existing.push(draft);
    groups.set(draft.pr_url, existing);
  }

  for (const [prUrl, drafts] of Array.from(groups.entries()).slice(0, maxPrs)) {
    const prNumber = extractPrNumber(prUrl);
    if (!prNumber) {
      result.errors.push(`無法解析 PR URL: ${prUrl}`);
      continue;
    }

    try {
      const pr = await github.getPR(prNumber);
      if (pr.state === "closed" && !pr.merged) {
        const now = new Date().toISOString();
        for (const draft of drafts) {
          await updateDraft(db, draft.id, { status: "draft", pr_url: "", updated_at: now });
          result.returnedToDraft.push(draft.id);
        }
        continue;
      }

      if (pr.merged && pr.base.ref !== github.defaultBranch) {
        const now = new Date().toISOString();
        for (const draft of drafts) {
          await updateDraft(db, draft.id, { status: "draft", pr_url: "", updated_at: now });
          result.returnedToDraft.push(draft.id);
        }
        continue;
      }

      if (!pr.merged) continue;

      const files = await github.getPRFiles(prNumber);
      const fallback = files.find(isBlogMd);
      const now = new Date().toISOString();
      for (const draft of drafts) {
        const file = draft.github_path
          ? files.find((candidate) => isBlogMd(candidate) && candidate.filename === draft.github_path)
          : fallback;
        if (!file) {
          result.errors.push(`PR #${prNumber} 找不到對應 ${draft.id} 的 blog markdown 檔案`);
          continue;
        }
        await updateDraft(db, draft.id, {
          status: "published",
          pr_url: "",
          github_path: file.filename,
          github_sha: file.sha,
          updated_at: now,
        });
        result.published.push(draft.id);
      }
    } catch (error) {
      const message = `PR #${prNumber} 對帳失敗: ${String(error)}`;
      result.errors.push(message);
      devLog(`[prChecker] ${message}`);
    }
  }
}

async function reconcileRemoteDrafts(
  db: DrizzleDB,
  github: Github,
  result: ReconcileResult,
  maxDrafts: number,
  devLog: DevLog,
): Promise<void> {
  const drafts = (await listSyncableDrafts(db)).slice(0, maxDrafts);
  for (const draft of drafts) {
    const slug = (draft.slug ?? "").trim();
    const path = `src/content/blog/${draft.lang}/${slug}.md`;
    try {
      const sha = await github.getFileSha(path);
      const conflict = await findSlugConflictBrief(db, draft.lang, slug, draft.id);
      if (conflict && draft.github_path !== path) {
        result.errors.push(`草稿 ${draft.id} 與 ${conflict.id} slug 衝突，略過自動發布`);
        continue;
      }
      await updateDraft(db, draft.id, {
        status: "published",
        github_path: path,
        github_sha: sha,
        updated_at: new Date().toISOString(),
      });
      result.published.push(draft.id);
    } catch (error) {
      if (isNotFound(error)) {
        await updateDraft(db, draft.id, {
          github_path: "",
          github_sha: "",
          updated_at: new Date().toISOString(),
        });
        result.clearedRemoteState.push(draft.id);
        continue;
      }
      const message = `草稿 ${draft.id} 遠端同步失敗: ${String(error)}`;
      result.errors.push(message);
      devLog(`[prChecker] ${message}`);
    }
  }
}

/**
 * 執行一次 GitHub PR / draft 對帳，並回傳可供 Cron 與手動 endpoint 顯示的摘要。
 *
 * @remarks
 * 同 process / isolate 同時只允許一輪，避免 self-host interval 或重疊 Cron 對同一份草稿重複寫入。
 * 跨 isolate 的全域互斥不在本 issue 範圍；處理本身為 idempotent，且每輪有 PR / draft 上限。
 */
export async function runPrChecks(
  db: DrizzleDB,
  github: Github,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  if (isReconciling) return emptyResult(true);
  isReconciling = true;
  const result = emptyResult();
  const devLog = options.devLog ?? (() => {});
  try {
    await reconcilePrOpenedDrafts(db, github, result, options.maxPrs ?? DEFAULT_MAX_PRS, devLog);
    await reconcileRemoteDrafts(db, github, result, options.maxDrafts ?? DEFAULT_MAX_DRAFTS, devLog);
    return result;
  } finally {
    isReconciling = false;
  }
}

/** 啟動 self-host 常駐 timer；每一輪呼叫同一份 reconcile service。 */
export function startPRChecker(deps: PRCheckerDeps): void {
  const devLog: DevLog = (...args) => { if (deps.isDev) console.log(...args); };
  console.log(`[prChecker] 啟動，每 ${deps.intervalMs / 1000} 秒檢查一次`);
  setInterval(() => {
    void runPrChecks(deps.db, deps.github, { devLog }).catch((error) => {
      console.error("[prChecker] 輪詢錯誤:", error);
    });
  }, deps.intervalMs);
}
