/**
 * ## test/helpers/mocks
 *
 * route 整合測試用的外部依賴替身：GitHub REST（`lib/github`）、物件儲存（`lib/storage`）、
 * OpenAI 翻譯（`lib/translator`）、OG 圖片生成（`lib/ogImage`）。
 *
 * @remarks
 * #03 起 `lib/github` / `lib/translator` 改成 **factory**（`createGithub(env)` 等），route 在每個
 * handler 內呼叫 factory 取得 client。因此這裡用 `mock.module()` 把 factory 整個替換成「回傳固定
 * client 物件」的函式——該 client 的每個 method 都是 `mock()` spy，且**跨呼叫共用同一個物件**，
 * 所以測試在 handler 跑之前設的 `mockResolvedValueOnce` / 之後讀的呼叫紀錄都生效。
 *
 * #04 起物件儲存改由 runtime provider（`makeStorage`）注入 {@link import("../../src/lib/storage/types").Storage}
 * 介面，route 經 `c.var.storage` 取用、**不再 import 任何實作**。因此 storage 不走 `mock.module()`，
 * 改由 {@link setupRouteApp} 直接把下方的 {@link storage} spy 當 provider 注入（更貼近真實注入路徑）。
 *
 * 各 mock function 都是 `mock()` spy，測試可：
 * - 直接斷言呼叫次數 / 參數（`expect(github.openPR).toHaveBeenCalled()`）
 * - 以 `mockResolvedValueOnce` / `mockRejectedValueOnce` 覆寫單次行為（測錯誤路徑）
 *
 * **mock 緊貼真實簽章**（對齊 `lib/github`、`lib/translator`、`lib/ogImage` 的 factory 回傳介面，
 * 與 `lib/storage/types` 的 `Storage` 介面）；若真實介面改動，這裡要同步，否則會假綠。
 *
 * `registerMocks()` 必須在**任何會 import 這些模組的 SUT 被載入之前**呼叫
 * （見 `setupRouteEnv.ts` 的載入順序契約）。`resetMocks()` 在每個 route 測試的
 * `beforeEach` 呼叫，清掉呼叫紀錄與單次覆寫，回到預設行為。
 */
import { mock } from "bun:test";
import type { Storage, StoredObject } from "../../src/lib/storage/types";

/** GitHub client 的 method spy，對齊 `createGithub(env)` 回傳的介面（route 只用到 file / PR 相關）。 */
export const github = {
  getGithubFile: mock(
    async (_path: string): Promise<{ content: string; sha: string }> => ({
      content: "---\ntitle: \"Remote Post\"\nlang: \"en\"\n---\n\nremote body",
      sha: "remote-sha",
    }),
  ),
  listGithubPosts: mock(
    async (): Promise<Array<{ path: string; sha: string }>> => [],
  ),
  openPR: mock(
    async (params: {
      slug: string;
      lang: string;
      githubPath?: string;
    }): Promise<{ prUrl: string; filePath: string }> => ({
      prUrl: "https://github.com/owner/repo/pull/1",
      filePath: params.githubPath ?? `src/content/blog/${params.lang}/${params.slug}.md`,
    }),
  ),
  openBatchPR: mock(
    async (_files: unknown[]): Promise<{ prUrl: string }> => ({
      prUrl: "https://github.com/owner/repo/pull/2",
    }),
  ),
  getPR: mock(async (_n: number) => ({
    number: 1,
    state: "open",
    merged: false,
    head: { ref: "feature" },
    base: { ref: "main" },
  })),
  getPRFiles: mock(async (_n: number) => [] as Array<{ filename: string; sha: string; status: string }>),
  getFileSha: mock(async (_path: string) => "remote-sha"),
  defaultBranch: "main",
};

/**
 * 物件儲存的 method spy，對齊 {@link Storage} 介面。預設視為已啟用。
 *
 * @remarks
 * `put` 只寫入不回 URL；`publicUrl(key)` 推導 `https://cdn.example.com/{key}`，對齊真實實作的
 * 「寫入 / URL 推導分離」。`satisfies Storage` 確保介面一旦改動、這裡會編譯錯而非假綠。
 */
export const storage = {
  isEnabled: mock((): boolean => true),
  put: mock(async (_key: string, _bytes: Uint8Array, _contentType: string): Promise<void> => {}),
  get: mock(async (_key: string): Promise<Uint8Array | null> => null),
  list: mock(async (_prefix: string): Promise<StoredObject[]> => []),
  delete: mock(async (_key: string): Promise<void> => {}),
  publicUrl: mock((key: string): string => `https://cdn.example.com/${key}`),
} satisfies Storage;

/** Translator client 的 method spy，對齊 `createTranslator(env)` 回傳的介面。預設翻譯視為已啟用。 */
export const translator = {
  isTranslationEnabled: mock((): boolean => true),
  translateDraft: mock(
    async (params: {
      title: string;
      description: string;
      content: string;
      targetLang: string;
    }): Promise<{ title: string; description: string; content: string }> => ({
      title: `[${params.targetLang}] ${params.title}`,
      description: params.description,
      content: `${params.content}\n\n---\n\nTranslated by mock`,
    }),
  ),
};

/** 對齊 `lib/ogImage` 的 export（非 factory，#06 才動）。回傳一段假 PNG bytes（PNG magic header）。 */
export const ogImage = {
  generateArticleOg: mock(
    async (_params: unknown): Promise<Uint8Array> =>
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ),
};

/**
 * 用 `mock.module()` 把四個 lib 整模組替換掉。
 *
 * @remarks
 * github / translator 是 factory：mock 的 `createX` **永遠回傳同一個** client 物件（上方的 spy
 * 集合），讓「設定單次覆寫 → handler 內呼叫 → 斷言呼叫紀錄」全程操作同一組 spy。ogImage 仍是
 * 具名 function export。**storage 不在此**——它改由 {@link setupRouteApp} 經 provider 注入
 * {@link storage} spy（見上方說明），不需 `mock.module()`。
 *
 * specifier 以**本檔（test/helpers/mocks.ts）為基準**解析至 `src/lib/*`；SUT（route / lib）
 * import 同一個檔案的絕對路徑，Bun 以解析後的絕對路徑比對，因此替換生效。
 * 必須在 dynamic import SUT 之前呼叫。
 */
export function registerMocks(): void {
  mock.module("../../src/lib/github", () => ({ createGithub: () => github }));
  mock.module("../../src/lib/translator", () => ({ createTranslator: () => translator }));
  mock.module("../../src/lib/ogImage", () => ({ ...ogImage }));
}

/** 所有 mock spy 的扁平清單，供 `resetMocks()` 一次清空。 */
const ALL_SPIES = [
  github.getGithubFile,
  github.listGithubPosts,
  github.openPR,
  github.openBatchPR,
  github.getPR,
  github.getPRFiles,
  github.getFileSha,
  storage.isEnabled,
  storage.put,
  storage.get,
  storage.list,
  storage.delete,
  storage.publicUrl,
  translator.isTranslationEnabled,
  translator.translateDraft,
  ogImage.generateArticleOg,
];

/**
 * 清掉所有 mock 的**呼叫紀錄**，回到「呼叫次數 / 參數紀錄」乾淨狀態。
 *
 * @remarks
 * 只呼叫 `mockClear()`，**不會**清掉預設實作（避免 `mockReset()` 把 `mock()` 定義時
 * 的預設行為一起抹掉），也**不會**清掉尚未消費的 `mockResolvedValueOnce` /
 * `mockRejectedValueOnce`（Bun 1.3 的 `mockClear()` 不動 once queue，已實測）。
 *
 * 因此 route 測試對 once override 有一條**契約**：誰設定、誰負責在同一測試內把它消費掉，
 * 不要遺留 unconsumed once override 給下一個測試（例如在 error path 設了 once override，
 * 但 SUT 走 early-return 沒呼叫該 mock）。違反此契約會造成順序相依與假紅，
 * `resetMocks()` 不會替你兜底。
 */
export function resetMocks(): void {
  for (const spy of ALL_SPIES) spy.mockClear();
}
