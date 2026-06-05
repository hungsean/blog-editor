/**
 * `lib/translator` 測試。
 *
 * @remarks
 * translator.ts 在 **module load 當下**就把 `OPENAI_API_KEY` / `OPENAI_MODEL` /
 * `OPENAI_BASE_URL` 讀進 const，因此測不同 env 必須「先設 env → 再載入模組」。
 * 用 dynamic import 加 query-string（Bun 視為不同模組、會重新執行）達成同一檔測
 * 「未啟用」與「已啟用」兩種狀態。
 *
 * 翻譯不打真實 OpenAI：覆寫 `globalThis.fetch` 攔截 `/v1/chat/completions` 呼叫，
 * 用假回應驗證解析、fallback、錯誤路徑與 glossary 注入。
 */
import { describe, test, expect, beforeAll, afterEach, afterAll, mock } from "bun:test";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_MODEL = process.env.OPENAI_MODEL;
const ORIGINAL_BASE = process.env.OPENAI_BASE_URL;

type Translator = typeof import("../src/lib/translator");

/**
 * 以 query-string 強制重新載入 translator（Bun 視為不同模組）。
 *
 * @remarks
 * specifier 用變數而非字面值，避免 TS 對 query-string path 做模組解析（會誤報找不到模組）；
 * 執行期由 Bun 正確解析至同一個 `src/lib/translator.ts`。
 */
function loadTranslator(tag: string): Promise<Translator> {
  const spec = `../src/lib/translator?${tag}`;
  return import(spec) as Promise<Translator>;
}

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

afterAll(() => {
  // 還原被測試改動的 env，避免污染其他測試檔。
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_MODEL === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = ORIGINAL_MODEL;
  if (ORIGINAL_BASE === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = ORIGINAL_BASE;
});

describe("isTranslationEnabled — 未設定 API key", () => {
  let mod: Translator;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "";
    mod = await loadTranslator("disabled");
  });

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
  let mod: Translator;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_MODEL; // 預設 gpt-4o-mini
    delete process.env.OPENAI_BASE_URL; // 預設官方 endpoint
    mod = await loadTranslator("enabled");
  });

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
