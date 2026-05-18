const BASE = import.meta.env.VITE_API_URL ?? "";

/** 與某個 slug 相符的草稿摘要，欄位對應後端 `/api/slug` 的回傳。 */
export type SlugMatch = {
  id: string;
  title: string;
  lang: string;
  slug: string;
  status: string;
  github_path: string;
};

/**
 * 查詢與指定 slug 同語言的草稿。
 *
 * @remarks
 * 後端 `/api/slug` 以 `TRIM(slug)` 比對，前後空白會被忽略。回傳結果可能包含
 * 「正在編輯的草稿自己」，呼叫端需自行用 id 排除，否則草稿會與自己衝突。
 */
export async function fetchSlugMatches(slug: string, lang: string): Promise<SlugMatch[]> {
  const params = new URLSearchParams({ slug, lang });
  const res = await fetch(`${BASE}/api/slug?${params}`);
  if (!res.ok) throw new Error("Failed to check slug");
  return res.json();
}
