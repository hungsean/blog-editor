const BASE = import.meta.env.VITE_API_URL ?? "";

/** 查詢後端 AI 翻譯功能是否啟用（後端需設定 `OPENAI_API_KEY`）。 */
export async function fetchTranslationStatus(): Promise<{ enabled: boolean }> {
  const res = await fetch(`${BASE}/api/translation/status`);
  if (!res.ok) throw new Error("Failed to fetch translation status");
  return res.json();
}

export interface TranslateParams {
  title: string;
  description: string;
  content: string;
  sourceLang: string;
  targetLang: string;
}

/**
 * 請後端把文章翻譯成目標語言，回傳翻譯結果。
 *
 * @remarks
 * 後端只負責翻譯、不建立草稿；呼叫端拿到結果後需自行 `createDraft`。
 * 翻譯走 OpenAI API，通常需要 10～30 秒，呼叫端應顯示 loading。
 */
export async function translateContent(
  body: TranslateParams,
): Promise<{ title: string; description: string; content: string }> {
  const res = await fetch(`${BASE}/api/translation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    throw new Error(msg?.error ?? "Failed to translate content");
  }
  return res.json();
}
