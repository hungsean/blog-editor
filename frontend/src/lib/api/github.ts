const BASE = import.meta.env.VITE_API_URL ?? "";

export type GithubPost = {
  path: string;
  sha: string;
  synced: boolean;
};

export type SyncResult = {
  imported: string[];
  updated: string[];
  errors: string[];
};

export async function fetchGithubPosts(): Promise<GithubPost[]> {
  const res = await fetch(`${BASE}/api/github/posts`);
  if (!res.ok) throw new Error("Failed to fetch GitHub posts");
  return res.json();
}

export async function syncFromGithub(paths: string[]): Promise<SyncResult> {
  const res = await fetch(`${BASE}/api/github/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error("Failed to sync from GitHub");
  return res.json();
}
