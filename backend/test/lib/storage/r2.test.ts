/**
 * `lib/storage/r2` 真實實作邊界測試：`R2Storage`（Cloudflare Workers 的 {@link Storage} 實作）。
 *
 * @remarks
 * route 測試經 provider 注入假 storage，因此**真實的** `R2Storage`（isEnabled 判定、put/get/list/
 * delete 對 R2 binding 的呼叫、list 分頁 + 資料夾標記過濾、URL 推導）在 route 測試裡沒被執行——
 * 本檔用一個以 Map 為後端的 {@link FakeR2Bucket} 模擬 R2 binding，直接驗證真實實作行為。
 *
 * R2 binding 不靜態 import 任何模組（型別來自 `@cloudflare/workers-types`，編譯後 erased），故
 * 不需 `mock.module`，static import `R2Storage` 即可。
 */
import { describe, test, expect } from "bun:test";
import { R2Storage } from "../../../src/lib/storage/r2";

/** 固定上傳時間，方便斷言 lastModified。 */
const UPLOADED = new Date("2026-06-09T00:00:00.000Z");

/** 以 Map 為後端的 R2Bucket 子集模擬，涵蓋 R2Storage 用到的 put / get / list / delete。 */
class FakeR2Bucket {
  private readonly store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  /** list 單頁筆數；設小可逼出 cursor 分頁路徑。 */
  constructor(private readonly pageSize = 1000) {}

  async put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
    this.store.set(key, { bytes: value, contentType: opts?.httpMetadata?.contentType });
  }

  async get(key: string) {
    const hit = this.store.get(key);
    if (!hit) return null;
    return { arrayBuffer: async () => hit.bytes.slice().buffer };
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  async list({ prefix, cursor }: { prefix?: string; cursor?: string }) {
    const keys = [...this.store.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + this.pageSize);
    const nextStart = start + this.pageSize;
    const truncated = nextStart < keys.length;
    return {
      objects: page.map((key) => ({ key, size: this.store.get(key)!.bytes.length, uploaded: UPLOADED })),
      truncated,
      cursor: truncated ? String(nextStart) : undefined,
    };
  }
}

const PUBLIC_URL = "https://cdn.example.com";

/** 把 FakeR2Bucket 當 R2Bucket 注入（測試 shim，故 cast 成 never）。 */
function makeStorage(bucket: FakeR2Bucket, publicUrl: string = PUBLIC_URL) {
  return new R2Storage(bucket as never, publicUrl);
}

describe("isEnabled", () => {
  test("bucket 與 publicUrl 齊全時為 true", () => {
    expect(makeStorage(new FakeR2Bucket()).isEnabled()).toBe(true);
  });

  test("無 bucket binding 時為 false", () => {
    expect(new R2Storage(undefined, PUBLIC_URL).isEnabled()).toBe(false);
  });

  test("無 publicUrl 時為 false", () => {
    expect(new R2Storage(new FakeR2Bucket() as never, undefined).isEnabled()).toBe(false);
  });
});

describe("put / get / publicUrl", () => {
  test("put 寫入並帶 contentType；publicUrl 推導；get 讀回 bytes", async () => {
    const bucket = new FakeR2Bucket();
    const s = makeStorage(bucket);
    const body = new Uint8Array([1, 2, 3]);

    await s.put("uploads/a.png", body, "image/png");
    expect(s.publicUrl("uploads/a.png")).toBe("https://cdn.example.com/uploads/a.png");

    const got = await s.get("uploads/a.png");
    expect(got).toEqual(body);
  });

  test("get 不存在回 null", async () => {
    expect(await makeStorage(new FakeR2Bucket()).get("missing")).toBeNull();
  });
});

describe("delete", () => {
  test("刪除後 get 回 null", async () => {
    const bucket = new FakeR2Bucket();
    const s = makeStorage(bucket);
    await s.put("uploads/a.png", new Uint8Array([1]), "image/png");
    await s.delete("uploads/a.png");
    expect(await s.get("uploads/a.png")).toBeNull();
  });
});

describe("list", () => {
  test("跨分頁取完所有物件、過濾資料夾標記、拉平成 StoredObject", async () => {
    const bucket = new FakeR2Bucket(1); // 單頁 1 筆，逼出 cursor 分頁
    const s = makeStorage(bucket);
    await s.put("uploads/a.png", new Uint8Array([1, 2]), "image/png");
    await s.put("uploads/b.png", new Uint8Array([3]), "image/png");
    await bucket.put("uploads/", new Uint8Array([]), {}); // 資料夾標記 → 應被略過

    const objects = await s.list("uploads/");

    expect(objects).toEqual([
      { key: "uploads/a.png", url: "https://cdn.example.com/uploads/a.png", size: 2, lastModified: UPLOADED.toISOString() },
      { key: "uploads/b.png", url: "https://cdn.example.com/uploads/b.png", size: 1, lastModified: UPLOADED.toISOString() },
    ]);
  });

  test("無物件時回空陣列", async () => {
    expect(await makeStorage(new FakeR2Bucket()).list("uploads/")).toEqual([]);
  });
});
