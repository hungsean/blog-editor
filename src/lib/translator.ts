/**
 * ## translator
 *
 * 使用 OpenAI Chat Completion API 將文章翻譯為目標語言。
 *
 * ### 資料流
 * Draft 內容 → system prompt + JSON payload → OpenAI API → 解析 JSON 回應 → 翻譯後的 title/description/content
 *
 * ### 已知限制
 * - 回傳的 content 末尾會自動附加 `Translated by {model}` 歸因說明
 * - 若 OpenAI 回應的 JSON 缺少某個欄位，會 fallback 為原始值（title/description/content 不會是 undefined）
 * - `OPENAI_BASE_URL` 支援自訂 endpoint（例如 Azure OpenAI 或 local proxy），預設為官方 API
 * - 溫度設定為 0.3，在一致性與自然度之間取得平衡
 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com";

const LANG_NAMES: Record<string, string> = {
  "zh-tw": "Traditional Chinese (Taiwan)",
  "en": "English",
  "ja": "Japanese",
};

export function isTranslationEnabled(): boolean {
  return !!OPENAI_API_KEY;
}

type TranslationPreset = {
  keywords: string[];
  translations: Record<string, string>;
  note: string;
};

/**
 * 呼叫 OpenAI API 翻譯文章的 title、description 與 markdown content。
 *
 * @param params.sourceLang - 來源語言代碼（`zh-tw` / `en` / `ja`）
 * @param params.targetLang - 目標語言代碼，若不在 `LANG_NAMES` 中會直接傳給 API
 * @param params.presets - 常用翻譯設定，有出現在文章中的 keyword 才傳入，注入至 system prompt
 * @returns 翻譯後的 `{ title, description, content }`；content 末尾附有歸因說明
 * @throws 若 `OPENAI_API_KEY` 未設定，或 API 回傳非 2xx，或回應沒有 content
 *
 * @remarks
 * System prompt 指示 AI 保留所有 Markdown 格式與 code block 內容不翻譯。
 * 翻譯結果為 JSON 格式（`response_format: json_object`），需手動解析。
 * 若 AI 漏掉某欄位，各欄位有獨立的 fallback 為原始值，不會整筆失敗。
 */
export async function translateDraft(params: {
  title: string;
  description: string;
  content: string;
  sourceLang: string;
  targetLang: string;
  presets?: TranslationPreset[];
}): Promise<{ title: string; description: string; content: string }> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const { title, description, content, sourceLang, targetLang, presets } = params;
  const sourceName = LANG_NAMES[sourceLang] ?? sourceLang;
  const targetName = LANG_NAMES[targetLang] ?? targetLang;

  let glossarySection = "";
  if (presets && presets.length > 0) {
    const lines = presets.map((p) => {
      const kwList = p.keywords.join(", ");
      const transEntries = Object.entries(p.translations)
        .map(([lang, val]) => `${lang}: "${val}"`)
        .join(", ");
      const notePart = p.note ? `\n  Note: ${p.note}` : "";
      return `- Keywords: [${kwList}] → ${transEntries}${notePart}`;
    });
    glossarySection = `\nFixed Translation Glossary (MUST follow exactly):\n${lines.join("\n")}\n`;
  }

  const systemPrompt = `You are a professional translator specializing in technical blog posts.
Translate from ${sourceName} to ${targetName}.
Rules:
- Preserve all Markdown formatting exactly (headings, bold, italic, lists, etc.)
- Do NOT translate content inside code blocks (\`\`\`...\`\`\`)
- Do NOT translate inline code (\`...\`)
- Do NOT translate URLs, file paths, or technical identifiers
- Return a JSON object with keys: title, description, content${glossarySection}`;

  const userPayload = JSON.stringify({ title, description, content });

  const res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Translate the following blog post to ${targetName}. Return valid JSON with keys: title, description, content.\n\n${userPayload}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const choice = data.choices?.[0];
  if (!choice?.message?.content) {
    throw new Error("No content in OpenAI API response");
  }
  const result = JSON.parse(choice.message.content) as {
    title?: string;
    description?: string;
    content?: string;
  };

  const translatedContent = result.content ?? content;
  const attribution = `\n\n---\n\nTranslated by ${OPENAI_MODEL}`;

  return {
    title: result.title ?? title,
    description: result.description ?? description,
    content: translatedContent + attribution,
  };
}
