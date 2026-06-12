/**
 * `lib/env` 純函式邊界測試：`readEnv(source)` 的預設值、CORS 解析、非字串 binding 忽略、
 * R2_PUBLIC_URL 去尾斜線、PR_CHECK_INTERVAL_MS 數值解析、NODE_ENV → isDev。
 *
 * @remarks
 * `readEnv` 是 #03 的環境變數單一讀取點，被 self-host（`process.env`）與 Workers（`c.env`）共用，
 * 且 route 測試只透過 `readEnv({})` 取預設值、不會碰到非預設分支（mock 隔離了對外服務）。
 * 因此這些分支必須在此直接斷言，否則 coverage 會「有改到但沒測到」。
 */
import { describe, test, expect } from "bun:test";
import { readEnv } from "../../src/lib/env";

describe("readEnv 預設值（空來源）", () => {
  const env = readEnv({});

  test("github 缺值補空字串、defaultBranch 預設 main", () => {
    expect(env.github).toEqual({ token: "", owner: "", repo: "", defaultBranch: "main" });
  });

  test("openai 預設 model / baseUrl", () => {
    expect(env.openai).toEqual({
      apiKey: "",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com",
    });
  });

  test("r2 全部欄位未設時為 undefined", () => {
    expect(env.r2).toEqual({
      accountId: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      bucket: undefined,
      publicUrl: undefined,
    });
  });

  test("CORS 未設時帶 localhost 開發預設", () => {
    expect(env.corsOrigins).toEqual(["http://localhost:5173", "http://localhost:3000"]);
  });

  test("PR_CHECK_INTERVAL_MS 未設時預設 60000", () => {
    expect(env.prCheckIntervalMs).toBe(60_000);
  });

  test("NODE_ENV 未設時 isDev 為 true", () => {
    expect(env.isDev).toBe(true);
  });
});

describe("readEnv 自訂值", () => {
  test("逐欄讀取 github / openai 設定", () => {
    const env = readEnv({
      GITHUB_TOKEN: "tok",
      GITHUB_OWNER: "me",
      GITHUB_REPO: "blog",
      GITHUB_DEFAULT_BRANCH: "trunk",
      OPENAI_API_KEY: "sk-1",
      OPENAI_MODEL: "gpt-4o",
      OPENAI_BASE_URL: "https://proxy.example.com",
    });
    expect(env.github).toEqual({ token: "tok", owner: "me", repo: "blog", defaultBranch: "trunk" });
    expect(env.openai).toEqual({
      apiKey: "sk-1",
      model: "gpt-4o",
      baseUrl: "https://proxy.example.com",
    });
  });

  test("CORS_ORIGIN 逗號分隔會被拆開、去除前後空白並濾掉空項", () => {
    const env = readEnv({ CORS_ORIGIN: " https://a.com , https://b.com ,, " });
    expect(env.corsOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  test("CORS_ORIGIN 全為空白 / 逗號時退回 localhost 預設", () => {
    const env = readEnv({ CORS_ORIGIN: " , , " });
    expect(env.corsOrigins).toEqual(["http://localhost:5173", "http://localhost:3000"]);
  });

  test("R2_PUBLIC_URL 尾端斜線會被去除（避免雙斜線 URL）", () => {
    expect(readEnv({ R2_PUBLIC_URL: "https://cdn.example.com/" }).r2.publicUrl).toBe(
      "https://cdn.example.com",
    );
    expect(readEnv({ R2_PUBLIC_URL: "https://cdn.example.com" }).r2.publicUrl).toBe(
      "https://cdn.example.com",
    );
  });

  test("R2 全部欄位齊全時逐欄帶入", () => {
    const env = readEnv({
      R2_ACCOUNT_ID: "acc",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "bucket",
      R2_PUBLIC_URL: "https://cdn.example.com",
    });
    expect(env.r2).toEqual({
      accountId: "acc",
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucket: "bucket",
      publicUrl: "https://cdn.example.com",
    });
  });

  test("PR_CHECK_INTERVAL_MS 字串會被轉成數字", () => {
    expect(readEnv({ PR_CHECK_INTERVAL_MS: "5000" }).prCheckIntervalMs).toBe(5000);
  });

  test.each([
    ["非數字字串", "abc"],
    ["空字串", ""],
    ["零", "0"],
    ["負數", "-5"],
    ["非字串 binding", 123 as unknown as string],
  ])("PR_CHECK_INTERVAL_MS 為%s時回退預設 60000（避免 setInterval busy loop）", (_label, value) => {
    expect(readEnv({ PR_CHECK_INTERVAL_MS: value }).prCheckIntervalMs).toBe(60_000);
  });

  test("NODE_ENV=production 時 isDev 為 false，其餘值為 true", () => {
    expect(readEnv({ NODE_ENV: "production" }).isDev).toBe(false);
    expect(readEnv({ NODE_ENV: "staging" }).isDev).toBe(true);
  });
});

describe("readEnv 非字串 binding 忽略（Workers c.env）", () => {
  test("D1 等非字串 binding 不會被當成字串讀入，缺漏欄位退回預設", () => {
    // 模擬 Workers 的 c.env：同時含字串變數與 D1 binding 物件 / 數字。
    const env = readEnv({
      DB: { prepare() {}, batch() {} }, // D1 binding 物件 → 非字串，應被忽略
      GITHUB_TOKEN: 12345 as unknown as string, // 非字串 → 視為未設定
      GITHUB_OWNER: "real-owner", // 唯一的合法字串
    });
    expect(env.github.token).toBe(""); // 非字串被忽略 → 退回預設空字串
    expect(env.github.owner).toBe("real-owner");
    // binding 物件不會洩漏進任何字串欄位
    expect(env.r2.accountId).toBeUndefined();
  });
});
