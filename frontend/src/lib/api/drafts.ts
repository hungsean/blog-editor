const BASE = import.meta.env.VITE_API_URL ?? "";

export type Draft = {
  id: string;
  title: string;
  lang: string;
  slug: string;
  description: string;
  tags: string;
  fields: string;
  content: string;
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

export async function fetchDraft(id: string): Promise<Draft> {
  const res = await fetch(`${BASE}/api/drafts/${id}`);
  if (!res.ok) throw new Error("Failed to fetch draft");
  return res.json();
}

export async function createDraft(body: Partial<Draft> = {}): Promise<Draft> {
  const res = await fetch(`${BASE}/api/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to create draft");
  return res.json();
}

export async function updateDraft(id: string, body: Partial<Draft>): Promise<Draft> {
  const res = await fetch(`${BASE}/api/drafts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update draft");
  return res.json();
}
