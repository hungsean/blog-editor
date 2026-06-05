/**
 * `lib/slugify` 純函式邊界測試：slugify 轉換規則、SLUG_PATTERN / isValidSlug 把關。
 */
import { describe, test, expect } from "bun:test";
import { slugify, isValidSlug, SLUG_PATTERN } from "../src/lib/slugify";

describe("slugify", () => {
  test.each([
    ["Hello World", "hello-world"],
    ["Hello, World!", "hello-world"],
    ["UPPER Case", "upper-case"],
    ["multiple   spaces", "multiple-spaces"],
    ["collapse---hyphens", "collapse-hyphens"],
    ["  leading and trailing  ", "leading-and-trailing"],
    ["--strip-edge--", "strip-edge"],
    ["snake_case_value", "snake-case-value"],
    ["mix 中文 123 abc", "mix-123-abc"],
    ["react.js", "react-js"],
  ])("slugify(%j) === %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  test("純 CJK 標題會變成空字串（呼叫端需 fallback）", () => {
    expect(slugify("你好世界")).toBe("");
    expect(slugify("　全形空白　")).toBe("");
  });

  test("空字串與純符號回傳空字串", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!@@@###")).toBe("");
  });

  test("超過 50 字會被截斷到 50", () => {
    const long = "a".repeat(80);
    const result = slugify(long);
    expect(result.length).toBe(50);
    expect(result).toBe("a".repeat(50));
  });

  test("截斷發生在去頭尾連字號之後，可能在尾端留下連字號", () => {
    // toLowerCase → 替換非英數為 '-' → 去頭尾 '-' → slice(0,50)。
    // 49 個 a + 空白 + b → "a"*49 + "-b"（長度 51），slice(0,50) 砍在連字號後留尾 '-'。
    const input = "a".repeat(49) + " b";
    expect(slugify(input)).toBe("a".repeat(49) + "-");
  });
});

describe("SLUG_PATTERN / isValidSlug", () => {
  test.each([
    "a",
    "123",
    "hello-world",
    "a1-b2-c3",
    "react-js",
  ])("合法 slug: %j", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
    expect(SLUG_PATTERN.test(slug)).toBe(true);
  });

  test.each([
    ["", "空字串"],
    ["-hello", "前置連字號"],
    ["hello-", "尾端連字號"],
    ["hello--world", "連續連字號"],
    ["Hello", "含大寫"],
    ["hello world", "含空白"],
    ["hello/world", "含斜線"],
    ["héllo", "含非 ASCII"],
    ["中文", "CJK"],
  ])("不合法 slug: %j (%s)", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });

  test("slugify 的輸出永遠通過 isValidSlug（非空時）", () => {
    for (const input of ["Hello World", "react.js", "a b c", "MiXeD 123"]) {
      const s = slugify(input);
      if (s) expect(isValidSlug(s)).toBe(true);
    }
  });
});
