const BASE = import.meta.env.VITE_API_URL ?? "";

export type TranslationPreset = {
  id: string;
  keywords: string;
  translations: string;
  note: string;
  created_at: string;
  updated_at: string;
};

export async function fetchPresets(): Promise<TranslationPreset[]> {
  const res = await fetch(`${BASE}/api/presets`);
  if (!res.ok) throw new Error("Failed to fetch presets");
  return res.json();
}

export async function createPreset(body: {
  keywords: string[];
  translations: Record<string, string>;
  note: string;
}): Promise<TranslationPreset> {
  const res = await fetch(`${BASE}/api/presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to create preset");
  return res.json();
}

export async function updatePreset(
  id: string,
  body: { keywords?: string[]; translations?: Record<string, string>; note?: string }
): Promise<TranslationPreset> {
  const res = await fetch(`${BASE}/api/presets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update preset");
  return res.json();
}

export async function deletePreset(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/presets/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete preset");
}
