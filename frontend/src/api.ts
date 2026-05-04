export type DraftSummary = {
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

export type Draft = DraftSummary & {
  description: string;
  tags: string;
  fields: string;
  content: string;
};

export type GithubPost = {
  path: string;
  sha: string;
  synced: boolean;
};

export type TranslationPreset = {
  id: string;
  keywords: string;
  translations: string;
  note: string;
  created_at: string;
  updated_at: string;
};

export type TranslationLink = {
  id: string;
  lang: string;
  title: string;
  status: string;
};

const BASE = import.meta.env.VITE_API_URL ?? "";
const jsonHeaders = { "Content-Type": "application/json" };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data as T;
}

export const api = {
  get: (path: string) => fetch(`${BASE}${path}`),
  post: (path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
  patch: (path: string, body: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
  delete: (path: string) => fetch(`${BASE}${path}`, { method: "DELETE" }),

  listDrafts: () => json<DraftSummary[]>("/api/drafts"),
  createDraft: () => json<Draft>("/api/drafts", { method: "POST", headers: jsonHeaders, body: "{}" }),
  getDraft: (id: string) => json<Draft>(`/api/drafts/${id}`),
  updateDraft: (id: string, body: Partial<Draft>) =>
    json<Draft>(`/api/drafts/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteDraft: (id: string) => json<{ success: true }>(`/api/drafts/${id}`, { method: "DELETE" }),
  publishDraft: (id: string) =>
    json<{ success?: boolean; pr_url?: string; error?: string; reason?: string; conflict?: DraftSummary }>(
      `/api/drafts/${id}/publish`,
      { method: "POST" },
    ),
  resyncDraft: (id: string) => json<Draft>(`/api/drafts/${id}/resync`, { method: "POST" }),
  translations: (id: string) => json<TranslationLink[]>(`/api/drafts/${id}/translations`),
  slugCheck: (id: string, lang: string, slug: string) =>
    json<{ ok: boolean; reason: string; conflict: DraftSummary | null }>(
      `/api/drafts/${id}/slug-check?lang=${encodeURIComponent(lang)}&slug=${encodeURIComponent(slug)}`,
    ),
  translationStatus: () => json<{ enabled: boolean }>("/api/translation-status"),
  createTranslation: (id: string, targetLang: string, ai = false) =>
    json<Draft>(`/api/drafts/${id}/${ai ? "ai-translate" : "translate"}`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ targetLang }),
    }),
  batchDelete: (draftIds: string[]) =>
    json<{ success: true; deleted: string[]; count: number }>("/api/batch-delete", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ draftIds }),
    }),
  batchPublish: (draftIds: string[]) =>
    json<{ success: true; pr_url: string; count: number }>("/api/batch-publish", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ draftIds }),
    }),
  githubPosts: () => json<GithubPost[]>("/api/github/posts"),
  syncPosts: (paths: string[]) =>
    json<{ imported?: string[]; updated?: string[]; errors?: string[] }>("/api/sync", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ paths }),
    }),
  presets: () => json<TranslationPreset[]>("/api/presets"),
  savePreset: (body: { keywords: string[]; translations: Record<string, string>; note: string }, id?: string | null) =>
    json<TranslationPreset>(id ? `/api/presets/${id}` : "/api/presets", {
      method: id ? "PATCH" : "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    }),
  deletePreset: (id: string) => json<{ ok: true }>(`/api/presets/${id}`, { method: "DELETE" }),
  uploadImage: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return json<{ url: string }>("/api/upload", { method: "POST", body: fd }).then((d) => d.url);
  },
  uploadOgHero: async (draftId: string, file: File) => {
    const fd = new FormData();
    fd.append("heroImage", file);
    return json<{ heroToken: string }>(`/api/drafts/${draftId}/og-hero`, { method: "POST", body: fd });
  },
  generateOg: (draftId: string, heroToken?: string | null) =>
    json<{ success: true; ogImageUrl: string; draft: Draft }>(`/api/drafts/${draftId}/generate-og`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(heroToken ? { heroToken } : {}),
    }),
};
