/**
 * `lib/translator` 測試。
 *
 * @remarks
 * #03 起 translator 改為 {@link createTranslator} factory，設定由參數（`OpenAIEnv`）注入，
 * 不再於 module load 讀 `process.env`。因此測不同設定只要用不同 env 物件 `createTranslator(env)`，
 * 不需再靠 dynamic import + query-string 重載模組、也不碰 `process.env`。
 *
 * 翻譯不打真實 OpenAI：覆寫 `globalThis.fetch` 攔截 `/v1/chat/completions` 呼叫，
 * 用假回應驗證解析、fallback、錯誤路徑與 glossary 注入。
 */
import { describe, test, expect, afterEach, mock } from "bun:test";
import { createTranslator } from "../src/lib/translator";
import type { OpenAIEnv } from "../src/lib/env";

const ORIGINAL_FETCH = globalThis.fetch;

/** 預設啟用、官方 endpoint、gpt-4o-mini 的測試設定。 */
const ENABLED_ENV: OpenAIEnv = {
  apiKey: "test-key",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com",
};

/** 覆寫 `globalThis.fetch` 為一個帶參數型別的 spy，回傳該 spy 供斷言呼叫內容。 */
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = mock(impl);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

/** 組一個 OpenAI chat.completions 風格的成功回應。 */
function okResponse(payload: { title?: string; description?: string; content?: string }): Response {
  const body = { choices: [{ message: { content: JSON.stringify(payload) } }] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("isTranslationEnabled — 未設定 API key", () => {
  const mod = createTranslator({ apiKey: "", model: "gpt-4o-mini", baseUrl: "https://api.openai.com" });

  test("isTranslationEnabled() 回傳 false", () => {
    expect(mod.isTranslationEnabled()).toBe(false);
  });

  test("translateDraft 在未設定 key 時拋錯", async () => {
    await expect(
      mod.translateDraft({
        title: "t",
        description: "",
        content: "c",
        sourceLang: "zh-tw",
        targetLang: "en",
      }),
    ).rejects.toThrow("OPENAI_API_KEY is not configured");
  });
});

describe("translateDraft — 已啟用", () => {
  const mod = createTranslator(ENABLED_ENV);

  test("isTranslationEnabled() 回傳 true", () => {
    expect(mod.isTranslationEnabled()).toBe(true);
  });

  test("happy path：回傳翻譯結果，content 末尾附歸因說明", async () => {
    stubFetch(async () => okResponse({ title: "標題", description: "描述", content: "翻譯內文" }));

    const result = await mod.translateDraft({
      title: "Title",
      description: "Desc",
      content: "Content",
      sourceLang: "en",
      targetLang: "zh-tw",
    });

    expect(result.title).toBe("標題");
    expect(result.description).toBe("描述");
    expect(result.content).toBe("翻譯內文\n\n---\n\nTranslated by gpt-4o-mini");
  });

  test("OpenAI 漏欄位時各欄位 fallback 為原始值", async () => {
    stubFetch(async () => okResponse({ content: "only content" }));

    const result = await mod.translateDraft({
      title: "Orig Title",
      description: "Orig Desc",
      content: "Orig Content",
      sourceLang: "en",
      targetLang: "ja",
    });

    expect(result.title).toBe("Orig Title");
    expect(result.description).toBe("Orig Desc");
    expect(result.content).toBe("only content\n\n---\n\nTranslated by gpt-4o-mini");
  });

  test("API 回傳非 2xx 時拋錯（含 status 與 body）", async () => {
    stubFetch(async () => new Response("rate limited", { status: 429 }));

    await expect(
      mod.translateDraft({
        title: "t",
        description: "",
        content: "c",
        sourceLang: "en",
        targetLang: "ja",
      }),
    ).rejects.toThrow("OpenAI API error 429: rate limited");
  });

  test("回應沒有 content 時拋錯", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
    );

    await expect(
      mod.translateDraft({
        title: "t",
        description: "",
        content: "c",
        sourceLang: "en",
        targetLang: "ja",
      }),
    ).rejects.toThrow("No content in OpenAI API response");
  });

  test("自訂 baseUrl / model 會反映在 fetch 與歸因說明", async () => {
    const custom = createTranslator({
      apiKey: "k",
      model: "my-model",
      baseUrl: "https://proxy.example.com",
    });
    const fetchSpy = stubFetch(async () => okResponse({ content: "z" }));

    const result = await custom.translateDraft({
      title: "t",
      description: "",
      content: "c",
      sourceLang: "en",
      targetLang: "ja",
    });

    expect(fetchSpy.mock.calls[0]![0]).toBe("https://proxy.example.com/v1/chat/completions");
    expect(result.content).toContain("Translated by my-model");
  });

  test("有命中的 preset 會把 glossary 注入 system prompt", async () => {
    const fetchSpy = stubFetch(async () =>
      okResponse({ title: "x", description: "y", content: "z" }),
    );

    await mod.translateDraft({
      title: "About foo",
      description: "",
      content: "body",
      sourceLang: "en",
      targetLang: "ja",
      presets: [{ keywords: ["foo"], translations: { ja: "フー" }, note: "keep katakana" }],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]![1]!;
    const sentBody = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = sentBody.messages[0]!.content;
    expect(systemPrompt).toContain("Fixed Translation Glossary");
    expect(systemPrompt).toContain('[foo] → "フー"');
    expect(systemPrompt).toContain("keep katakana");
  });

  test("無對應 targetLang 翻譯的 preset 不會注入 glossary 區塊", async () => {
    const fetchSpy = stubFetch(async () =>
      okResponse({ title: "x", description: "y", content: "z" }),
    );

    await mod.translateDraft({
      title: "About foo",
      description: "",
      content: "body",
      sourceLang: "en",
      targetLang: "ja",
      presets: [{ keywords: ["foo"], translations: { en: "FOO" }, note: "" }],
    });

    const init = fetchSpy.mock.calls[0]![1]!;
    const sentBody = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(sentBody.messages[0]!.content).not.toContain("Fixed Translation Glossary");
  });
});
