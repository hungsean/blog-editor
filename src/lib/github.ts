const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "";
const GITHUB_DEFAULT_BRANCH = process.env.GITHUB_DEFAULT_BRANCH ?? "main";

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.warn("[github] GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO 未設定，GitHub 功能將無法使用");
}

const BASE_URL = "https://api.github.com";

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

const DEFAULT_SCHEMA = {
  version: 1,
  fields: [
    { key: "title", type: "string", required: true },
    { key: "lang", type: "enum", options: ["zh-tw", "en"], required: true },
    { key: "description", type: "string", required: false },
    { key: "tags", type: "tags", required: false },
    { key: "persona", type: "enum", options: ["表", "裏"], required: false },
    { key: "nsfw", type: "boolean", default: false },
  ],
};

let schemaCache: unknown = null;

async function fetchPostSchema(): Promise<unknown> {
  try {
    const data = await githubFetch(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/post-schema.json`
    ) as { content: string };
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return JSON.parse(content);
  } catch {
    return DEFAULT_SCHEMA;
  }
}

export async function getPostSchema(): Promise<unknown> {
  if (schemaCache) {
    // Background refresh without blocking
    fetchPostSchema().then((s) => { schemaCache = s; }).catch(() => {});
    return schemaCache;
  }
  schemaCache = await fetchPostSchema();
  return schemaCache;
}

export async function forceRefreshSchema(): Promise<unknown> {
  schemaCache = await fetchPostSchema();
  return schemaCache;
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

export async function openPR(params: {
  title: string;
  slug: string;
  date: string;
  frontmatter: string;
  content: string;
  /** If set, update this existing file instead of creating a new one */
  githubPath?: string;
  /** Required when githubPath is set — the current file SHA */
  githubSha?: string;
}): Promise<{ prUrl: string; filePath: string }> {
  const { title, slug, date, frontmatter, content, githubPath, githubSha } = params;
  const [year, monthDay] = [date.slice(0, 4), date.slice(5, 10)];
  const branch = `blog/${date}-${slug}`;
  const filePath = githubPath ?? `src/content/blog/${year}/${monthDay}/${slug}.md`;
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
