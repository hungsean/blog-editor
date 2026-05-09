const BASE = import.meta.env.VITE_API_URL ?? "";

export type Draft = {
  id: string;
  title: string;
  lang: string;
  slug: string;
  status: string;
  pr_url: string;
  github_path: string;
  github_sha: string;
  created_at: string;
  updated_at: string;
};

export async function fetchDrafts(): Promise<Draft[]> {
  const res = await fetch(`${BASE}/api/drafts`);
  if (!res.ok) throw new Error("Failed to fetch drafts");
  return res.json();
}
