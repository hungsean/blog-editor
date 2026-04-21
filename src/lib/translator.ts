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

export async function translateDraft(params: {
  title: string;
  description: string;
  content: string;
  sourceLang: string;
  targetLang: string;
}): Promise<{ title: string; description: string; content: string }> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const { title, description, content, sourceLang, targetLang } = params;
  const sourceName = LANG_NAMES[sourceLang] ?? sourceLang;
  const targetName = LANG_NAMES[targetLang] ?? targetLang;

  const systemPrompt = `You are a professional translator specializing in technical blog posts.
Translate from ${sourceName} to ${targetName}.
Rules:
- Preserve all Markdown formatting exactly (headings, bold, italic, lists, etc.)
- Do NOT translate content inside code blocks (\`\`\`...\`\`\`)
- Do NOT translate inline code (\`...\`)
- Do NOT translate URLs, file paths, or technical identifiers
- Return a JSON object with keys: title, description, content`;

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
