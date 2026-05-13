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

export type PublishResult =
  | { success: true; pr_url: string }
  | { success: false; reason: "required" | "conflict"; error: string; conflict?: unknown };

export async function deleteDraft(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/drafts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete draft");
}

export async function bulkDeleteDrafts(draftIds: string[]): Promise<{ deleted: string[]; count: number }> {
  const res = await fetch(`${BASE}/api/drafts`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftIds }),
  });
  if (!res.ok) throw new Error("Failed to bulk delete drafts");
  return res.json();
}

export type BulkPublishResult =
  | { success: true; pr_url: string }
  | { success: false; reason: string; error: string; conflicts?: unknown; drafts?: unknown };

export async function bulkPublishDrafts(draftIds: string[]): Promise<BulkPublishResult> {
  const res = await fetch(`${BASE}/api/drafts/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftIds }),
  });
  const json = await res.json();
  if (!res.ok) return { success: false, reason: json.reason ?? "unknown", error: json.error ?? "Failed to publish drafts", ...json };
  return json;
}

export async function publishDraft(id: string): Promise<PublishResult> {
  const res = await fetch(`${BASE}/api/drafts/${id}/publish`, { method: "POST" });
  const json = await res.json();
  if (!res.ok) return { success: false, reason: json.reason ?? "required", error: json.error ?? "Failed to open PR" };
  return json;
}
