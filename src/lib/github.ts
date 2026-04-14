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

export async function openPR(params: {
  title: string;
  slug: string;
  date: string;
  frontmatter: string;
  content: string;
}): Promise<{ prUrl: string }> {
  const { title, slug, date, frontmatter, content } = params;
  const [year, monthDay] = [date.slice(0, 4), date.slice(5, 10)];
  const branch = `blog/${date}-${slug}`;
  const filePath = `src/content/blog/${year}/${monthDay}/${slug}.md`;
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

  // Create file
  await githubFetch(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `feat: add post "${title}"`,
        content: Buffer.from(fileContent).toString("base64"),
        branch,
      }),
    }
  );

  // Open PR
  const pr = await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `[Post] ${title}`,
      head: branch,
      base: GITHUB_DEFAULT_BRANCH,
      body: `New blog post: **${title}**`,
    }),
  }) as { html_url: string };

  return { prUrl: pr.html_url };
}
