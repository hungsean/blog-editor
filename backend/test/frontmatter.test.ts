/**
 * `lib/frontmatter` 純函式測試：parseFrontmatter / frontmatterToDraft / extractFromPath。
 */
import { describe, test, expect } from "bun:test";
import {
  parseFrontmatter,
  frontmatterToDraft,
  extractFromPath,
} from "../src/lib/frontmatter";

describe("parseFrontmatter", () => {
  test("解析標準 frontmatter 並回傳 trim 過的 body", () => {
    const raw = `---
title: Hello
lang: en
tags:
  - a
  - b
---

# Body heading

content line`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe("Hello");
    expect(frontmatter.lang).toBe("en");
    expect(frontmatter.tags).toEqual(["a", "b"]);
    expect(body).toBe("# Body heading\n\ncontent line");
  });

  test("沒有 frontmatter 時回傳空物件與原始字串", () => {
    const raw = "# 沒有 frontmatter\n\n直接是內文";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  test("空 frontmatter（parseYaml 回傳 null）視為空物件", () => {
    // 開頭 `---\n` + 空內容 + `\n---`，故空白 frontmatter 區塊需有一個空行。
    const raw = "---\n\n---\nbody";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe("body");
  });

  test("頂層非 mapping（YAML 陣列）視為空物件", () => {
    const raw = "---\n- a\n- b\n---\nbody";
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
  });

  test("支援 CRLF 換行", () => {
    const raw = "---\r\ntitle: CRLF\r\n---\r\nbody text";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe("CRLF");
    expect(body).toBe("body text");
  });

  test("支援多行 block scalar 與特殊字元", () => {
    const raw = `---
title: "Title: with colon & #hash"
description: |-
  line one
  line two
---
body`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe("Title: with colon & #hash");
    expect(frontmatter.description).toBe("line one\nline two");
  });

  test("YAML 不合法時往上拋（不靜默吞掉）", () => {
    const raw = "---\ntitle: \"unterminated\n---\nbody";
    expect(() => parseFrontmatter(raw)).toThrow();
  });
});

describe("frontmatterToDraft", () => {
  test("已知欄位映射，其餘 key 收進 fields(JSON)", () => {
    const result = frontmatterToDraft({
      title: "T",
      lang: "ja",
      description: "D",
      tags: ["x", "y"],
      pubDate: "2026-01-02",
      heroImage: "/img.png",
    });
    expect(result.title).toBe("T");
    expect(result.lang).toBe("ja");
    expect(result.description).toBe("D");
    expect(JSON.parse(result.tags)).toEqual(["x", "y"]);
    expect(JSON.parse(result.fields)).toEqual({
      pubDate: "2026-01-02",
      heroImage: "/img.png",
    });
  });

  test("缺欄位走預設值（lang 預設 zh-tw）", () => {
    const result = frontmatterToDraft({});
    expect(result.title).toBe("");
    expect(result.lang).toBe("zh-tw");
    expect(result.description).toBe("");
    expect(result.tags).toBe("[]");
    expect(result.fields).toBe("{}");
  });

  test("tags 非陣列時 fallback 為 '[]'", () => {
    const result = frontmatterToDraft({ tags: "not-an-array" });
    expect(result.tags).toBe("[]");
  });

  test("title 非字串會 String() 強制轉型", () => {
    const result = frontmatterToDraft({ title: 123, lang: 42 });
    expect(result.title).toBe("123");
    expect(result.lang).toBe("42");
  });

  test("parse → frontmatterToDraft round-trip 保留 extra 欄位", () => {
    const raw = `---
title: Round Trip
lang: en
description: desc
tags: [t1, t2]
pubDate: 2026-03-04
draft: true
---
body`;
    const { frontmatter } = parseFrontmatter(raw);
    const draft = frontmatterToDraft(frontmatter);
    expect(draft.title).toBe("Round Trip");
    expect(JSON.parse(draft.tags)).toEqual(["t1", "t2"]);
    expect(JSON.parse(draft.fields)).toEqual({ pubDate: "2026-03-04", draft: true });
  });
});

describe("extractFromPath", () => {
  test("標準 blog 路徑解析 lang 與 slug", () => {
    expect(extractFromPath("src/content/blog/en/my-post.md")).toEqual({
      lang: "en",
      slug: "my-post",
    });
    expect(extractFromPath("src/content/blog/ja/another.md")).toEqual({
      lang: "ja",
      slug: "another",
    });
  });

  test("lang segment 不在白名單時 fallback 為 zh-tw，slug 取最後一段", () => {
    expect(extractFromPath("src/content/blog/fr/x.md")).toEqual({
      lang: "zh-tw",
      slug: "x",
    });
  });

  test("非預期格式的短路徑 fallback", () => {
    expect(extractFromPath("just-a-file.md")).toEqual({
      lang: "zh-tw",
      slug: "just-a-file",
    });
  });
});
