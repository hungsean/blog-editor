/**
 * ## github
 *
 * 封裝所有 GitHub REST API 操作，供文章同步與發布 PR 使用。
 *
 * ### 資料流
 * - 讀取：`listGithubPosts` → `getGithubFile` → `parseFrontmatter`
 * - 寫入：`openPR` / `openBatchPR` → 建立 blob → tree → commit → branch → PR
 *
 * ### 已知限制
 * - 使用 Git Tree API（recursive）一次取得整棵樹，大型 repo 可能觸發 GitHub 的 100k 節點截斷限制
 * - `openPR` 和 `openBatchPR` 都使用隨機 branch 名稱，若同一篇文章重複發布不會覆蓋既有 PR
 * - 所有環境變數於模組載入時讀取，執行期間更改無效
 */
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "";
const GITHUB_DEFAULT_BRANCH = process.env.GITHUB_DEFAULT_BRANCH ?? "main";

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.warn("[github] GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 未設定，GitHub 功能將無法使用");
}

const BASE_URL = "https://api.github.com";

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
      Authorization: `Bearer ${GITHUB_TOKEN}`,
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


export interface GithubPost {
  path: string;
  sha: string;
}

/**
 * List all .md files under src/content/blog/ using the Git Tree API.
 */
export async function listGithubPosts(): Promise<GithubPost[]> {
  // Get the HEAD tree SHA
  const branch = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/${GITHUB_DEFAULT_BRANCH}`
  ) as { commit: { commit: { tree: { sha: string } } } };
  const treeSha = branch.commit.commit.tree.sha;

  // Recursively fetch the entire tree
  const tree = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${treeSha}?recursive=1`
  ) as { tree: Array<{ path: string; sha: string; type: string }> };

  return tree.tree
    .filter((item) => item.type === "blob" && item.path.startsWith("src/content/blog/") && item.path.endsWith(".md"))
    .map(({ path, sha }) => ({ path, sha }));
}

/**
 * Fetch a single file's content (decoded) and its SHA.
 */
export async function getGithubFile(path: string): Promise<{ content: string; sha: string }> {
  const data = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`
  ) as { content: string; sha: string };
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
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
export async function openBatchPR(files: BatchPRFile[]): Promise<{ prUrl: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const shortId = Math.random().toString(36).slice(2, 7);
  const branch = `blog/${today}-batch-${shortId}`;

  // Get base commit SHA
  const baseRef = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_DEFAULT_BRANCH}`
  ) as { object: { sha: string } };
  const baseSha = baseRef.object.sha;

  // Get base commit to find base tree SHA
  const baseCommit = await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${baseSha}`
  ) as { tree: { sha: string } };
  const baseTreeSha = baseCommit.tree.sha;

  // Create blobs for all files
  const treeEntries = await Promise.all(files.map(async (f) => {
    const filePath = f.githubPath ?? `src/content/blog/${f.lang}/${f.slug}.md`;
    const fileContent = `---\n${f.frontmatter}---\n\n${f.content}`;

    const blob = await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({
        content: Buffer.from(fileContent).toString("base64"),
        encoding: "base64",
      }),
    }) as { sha: string };

    return { path: filePath, mode: "100644", type: "blob", sha: blob.sha };
  }));

  // Create new tree
  const newTree = await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  }) as { sha: string };

  // Create commit
  const titles = files.map((f) => f.title).filter(Boolean);
  const commitMessage = `feat: add posts "${titles.join('", "')}"`;
  const newCommit = await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: commitMessage, tree: newTree.sha, parents: [baseSha] }),
  }) as { sha: string };

  // Create branch pointing to new commit
  await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommit.sha }),
  });

  // Open PR
  const prBody = `Batch post PR:\n${titles.map((t) => `- **${t}**`).join("\n")}`;
  const pr = await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `[Post] ${titles.length} 篇文章`,
      head: branch,
      base: GITHUB_DEFAULT_BRANCH,
      body: prBody,
    }),
  }) as { html_url: string };

  return { prUrl: pr.html_url };
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
export async function openPR(params: {
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
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_DEFAULT_BRANCH}`
  ) as { object: { sha: string } };
  const baseSha = baseRef.object.sha;

  // Create branch
  await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`, {
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
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: "PUT",
      body: JSON.stringify(putBody),
    }
  );

  // Open PR
  const pr = await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `[Post] ${title}`,
      head: branch,
      base: GITHUB_DEFAULT_BRANCH,
      body: githubPath
        ? `Updated blog post: **${title}**`
        : `New blog post: **${title}**`,
    }),
  }) as { html_url: string };

  return { prUrl: pr.html_url, filePath };
}
