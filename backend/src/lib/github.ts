/**
 * ## github
 *
 * 封裝所有 GitHub REST API 操作，供文章同步與發布 PR 使用。
 *
 * ### Factory（#03）
 * 改為 {@link createGithub} factory：傳入 {@link import("./env").GithubEnv} 設定，回傳含所有
 * GitHub 操作 method 的 client。**不再於 module load 時讀 `process.env`**——Workers 上 binding
 * 要等 request 注入，若在 import 期讀就拿不到值。caller 由 `c.var.env.github` 取得設定後建立
 * client（self-host 啟動時建一次即可重用）。
 *
 * ### 資料流
 * - 讀取：`listGithubPosts` → `getGithubFile` → `parseFrontmatter`
 * - 寫入：`openPR` / `openBatchPR` → 建立 blob → tree → commit → branch → PR
 *
 * ### 已知限制
 * - 使用 Git Tree API（recursive）一次取得整棵樹，大型 repo 可能觸發 GitHub 的 100k 節點截斷限制
 * - `openPR` 和 `openBatchPR` 都使用隨機 branch 名稱，若同一篇文章重複發布不會覆蓋既有 PR
 * - `getGithubFile` / `openPR` / `openBatchPR` 用 `Buffer` 做 base64（#03 暫不改 Web API，
 *   Workers 端由 #07 開 `nodejs_compat` 支援）
 */
import type { GithubEnv } from "./env";

const BASE_URL = "https://api.github.com";

export interface GithubPost {
  path: string;
  sha: string;
}

export interface BatchPRFile {
  title: string;
  slug: string;
  lang: string;
  date: string;
  frontmatter: string;
  content: string;
  githubPath?: string;
  githubSha?: string;
}

export interface PRStatus {
  number: number;
  state: string;
  merged: boolean;
  head: { ref: string };
  base: { ref: string };
}

export interface PRFile {
  filename: string;
  sha: string;
  status: string;
}

/** {@link createGithub} 回傳的 GitHub client 型別（含 `defaultBranch` 與所有 REST 操作）。 */
export type Github = ReturnType<typeof createGithub>;

/**
 * 建立綁定特定 repo 設定的 GitHub client。
 *
 * @param env - GitHub 連線設定（token / owner / repo / defaultBranch），來自 `c.var.env.github`
 * @returns 含 `defaultBranch` 與所有 GitHub REST 操作 method 的 client 物件
 *
 * @remarks
 * 所有 method 透過 closure 共用 `env`，因此 client 一旦建立其設定即固定。self-host 可在啟動時
 * 建一次重用；Workers 每 request 建（成本極低，只是綁 closure，無連線）。
 */
export function createGithub(env: GithubEnv) {
  const { token, owner, repo, defaultBranch } = env;

  /**
   * 帶有 GitHub API 認證標頭的 fetch 封裝。
   *
   * @param path - API 路徑，不含 base URL（例如 `/repos/owner/repo/pulls`）
   * @param options - 標準 `RequestInit`，headers 會被合併而非覆蓋
   * @returns 解析後的 JSON 回應
   * @throws 若 HTTP 狀態碼非 2xx，拋出含錯誤訊息的 `Error`
   */
  async function githubFetch(path: string, options: RequestInit = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${body}`);
    }

    return res.json();
  }

  /**
   * List all .md files under src/content/blog/ using the Git Tree API.
   */
  async function listGithubPosts(): Promise<GithubPost[]> {
    // Get the HEAD tree SHA
    const branch = await githubFetch(
      `/repos/${owner}/${repo}/branches/${defaultBranch}`
    ) as { commit: { commit: { tree: { sha: string } } } };
    const treeSha = branch.commit.commit.tree.sha;

    // Recursively fetch the entire tree
    const tree = await githubFetch(
      `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`
    ) as { tree: Array<{ path: string; sha: string; type: string }> };

    return tree.tree
      .filter((item) => item.type === "blob" && item.path.startsWith("src/content/blog/") && item.path.endsWith(".md"))
      .map(({ path, sha }) => ({ path, sha }));
  }

  /**
   * Fetch a single file's content (decoded) and its SHA.
   */
  async function getGithubFile(path: string): Promise<{ content: string; sha: string }> {
    const data = await githubFetch(
      `/repos/${owner}/${repo}/contents/${path}?ref=${defaultBranch}`
    ) as { content: string; sha: string };
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { content, sha: data.sha };
  }

  /**
   * 將多篇文章以單一 commit 建立一個 PR。
   *
   * @param files - 要發布的文章陣列，每筆含 frontmatter 字串與 markdown 內容
   * @returns `{ prUrl }` — 開啟的 GitHub PR 網址
   * @throws 任何 GitHub API 錯誤會直接往上拋
   *
   * @remarks
   * 實作流程：取得 base commit SHA → 建立所有 blob → 建立新 tree → 建立 commit → 建立 branch → 開 PR。
   * 若 `file.githubPath` 有值，會更新該路徑的既有檔案；否則依 `lang/slug` 建立新路徑。
   * Branch 名稱帶有隨機 suffix，重複呼叫不會衝突，但也不會更新同一個 PR。
   */
  async function openBatchPR(files: BatchPRFile[]): Promise<{ prUrl: string }> {
    const today = new Date().toISOString().slice(0, 10);
    const shortId = Math.random().toString(36).slice(2, 7);
    const branch = `blog/${today}-batch-${shortId}`;

    // Get base commit SHA
    const baseRef = await githubFetch(
      `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`
    ) as { object: { sha: string } };
    const baseSha = baseRef.object.sha;

    // Get base commit to find base tree SHA
    const baseCommit = await githubFetch(
      `/repos/${owner}/${repo}/git/commits/${baseSha}`
    ) as { tree: { sha: string } };
    const baseTreeSha = baseCommit.tree.sha;

    // Create blobs for all files
    const treeEntries = await Promise.all(files.map(async (f) => {
      const filePath = f.githubPath ?? `src/content/blog/${f.lang}/${f.slug}.md`;
      const fileContent = `---\n${f.frontmatter}---\n\n${f.content}`;

      const blob = await githubFetch(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({
          content: Buffer.from(fileContent).toString("base64"),
          encoding: "base64",
        }),
      }) as { sha: string };

      return { path: filePath, mode: "100644", type: "blob", sha: blob.sha };
    }));

    // Create new tree
    const newTree = await githubFetch(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    }) as { sha: string };

    // Create commit
    const titles = files.map((f) => f.title).filter(Boolean);
    const commitMessage = `feat: add posts "${titles.join('", "')}"`;
    const newCommit = await githubFetch(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: commitMessage, tree: newTree.sha, parents: [baseSha] }),
    }) as { sha: string };

    // Create branch pointing to new commit
    await githubFetch(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommit.sha }),
    });

    // Open PR
    const prBody = `Batch post PR:\n${titles.map((t) => `- **${t}**`).join("\n")}`;
    const pr = await githubFetch(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `[Post] ${titles.length} 篇文章`,
        head: branch,
        base: defaultBranch,
        body: prBody,
      }),
    }) as { html_url: string };

    return { prUrl: pr.html_url };
  }

  /**
   * 取得 PR 的狀態，包含是否已合併。
   */
  async function getPR(prNumber: number): Promise<PRStatus> {
    return githubFetch(
      `/repos/${owner}/${repo}/pulls/${prNumber}`
    ) as Promise<PRStatus>;
  }

  /**
   * 取得 PR 變更的檔案清單。
   */
  async function getPRFiles(prNumber: number): Promise<PRFile[]> {
    return githubFetch(
      `/repos/${owner}/${repo}/pulls/${prNumber}/files`
    ) as Promise<PRFile[]>;
  }

  /**
   * 取得指定路徑在預設分支上的目前 SHA。
   */
  async function getFileSha(path: string): Promise<string> {
    const data = await githubFetch(
      `/repos/${owner}/${repo}/contents/${path}?ref=${defaultBranch}`
    ) as { sha: string };
    return data.sha;
  }

  /**
   * 為單篇文章建立（或更新）GitHub PR。
   *
   * @param params.githubPath - 若提供，更新此路徑的既有檔案；否則依 `lang/slug` 建新檔
   * @param params.githubSha - 更新既有檔案時必須提供，否則 GitHub API 會回傳 409 衝突
   * @returns `{ prUrl, filePath }` — PR 網址與檔案路徑
   * @throws 任何 GitHub API 錯誤會直接往上拋
   *
   * @remarks
   * Branch 名稱格式為 `blog/{date}-{lang}-{slug}`，相同文章重複發布會因 branch 已存在而失敗。
   * 這是刻意設計，避免意外覆蓋進行中的 PR。
   */
  async function openPR(params: {
    title: string;
    slug: string;
    lang: string;
    date: string;
    frontmatter: string;
    content: string;
    /** If set, update this existing file instead of creating a new one */
    githubPath?: string;
    /** Required when githubPath is set — the current file SHA */
    githubSha?: string;
  }): Promise<{ prUrl: string; filePath: string }> {
    const { title, slug, lang, date, frontmatter, content, githubPath, githubSha } = params;
    const branch = `blog/${date}-${lang}-${slug}`;
    const filePath = githubPath ?? `src/content/blog/${lang}/${slug}.md`;
    const fileContent = `---\n${frontmatter}---\n\n${content}`;

    // Get base SHA
    const baseRef = await githubFetch(
      `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`
    ) as { object: { sha: string } };
    const baseSha = baseRef.object.sha;

    // Create branch
    await githubFetch(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: baseSha,
      }),
    });

    // Create or update file
    const putBody: Record<string, unknown> = {
      message: githubPath ? `feat: update post "${title}"` : `feat: add post "${title}"`,
      content: Buffer.from(fileContent).toString("base64"),
      branch,
    };
    if (githubSha) putBody.sha = githubSha;

    await githubFetch(
      `/repos/${owner}/${repo}/contents/${filePath}`,
      {
        method: "PUT",
        body: JSON.stringify(putBody),
      }
    );

    // Open PR
    const pr = await githubFetch(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `[Post] ${title}`,
        head: branch,
        base: defaultBranch,
        body: githubPath
          ? `Updated blog post: **${title}**`
          : `New blog post: **${title}**`,
      }),
    }) as { html_url: string };

    return { prUrl: pr.html_url, filePath };
  }

  return {
    defaultBranch,
    listGithubPosts,
    getGithubFile,
    openBatchPR,
    getPR,
    getPRFiles,
    getFileSha,
    openPR,
  };
}
