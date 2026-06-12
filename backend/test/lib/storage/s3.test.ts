/**
 * `lib/storage/s3` 真實實作邊界測試：`S3Storage`（self-host 的 {@link Storage} 實作）。
 *
 * @remarks
 * route 測試經 provider 注入假 storage，因此**真實的** `S3Storage`（isEnabled 設定齊全判定、
 * S3Client lazy singleton、put/get/list/delete 對 S3 API 的呼叫、list 分頁 + 資料夾標記過濾、
 * URL 推導）在 route 測試裡完全沒被執行——本檔改 mock `@aws-sdk/client-s3`，直接驗證真實實作
 * 對 S3 API 的呼叫與回傳。
 *
 * mock 必須在 import `src/lib/storage/s3`（static import `@aws-sdk/client-s3`）之前註冊，故用
 * top-level `mock.module` + dynamic import 的順序。
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

/** 每次 `S3Client.send` 收到的 command（Put/Get/List/Delete 實例）。 */
let sent: Array<{ __type: string; input: Record<string, unknown> }> = [];
/** 預先排好的 ListObjectsV2 回應佇列（測分頁用，依序消費）。 */
let listResponses: Array<Record<string, unknown>> = [];
/** 預先排好的 GetObject 回應（或拋出的錯誤）。 */
let getResponse: { body: Uint8Array | null } | Error = { body: null };
/** S3Client 被 new 出來的次數（驗證 lazy singleton 只建一次）。 */
let clientConstructions = 0;
/** 最近一次 S3Client 的建構設定（驗證 endpoint / credentials）。 */
let lastClientConfig: Record<string, unknown> | null = null;

mock.module("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: Record<string, unknown>) {
      clientConstructions += 1;
      lastClientConfig = config;
    }
    async send(command: { __type: string; input: Record<string, unknown> }) {
      sent.push(command);
      if (command.__type === "list") {
        return listResponses.shift() ?? { Contents: [], IsTruncated: false };
      }
      if (command.__type === "get") {
        if (getResponse instanceof Error) throw getResponse;
        const { body } = getResponse;
        return body === null ? {} : { Body: { transformToByteArray: async () => body } };
      }
      return {};
    }
  },
  PutObjectCommand: class {
    __type = "put";
    constructor(public input: Record<string, unknown>) {}
  },
  GetObjectCommand: class {
    __type = "get";
    constructor(public input: Record<string, unknown>) {}
  },
  ListObjectsV2Command: class {
    __type = "list";
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    __type = "delete";
    constructor(public input: Record<string, unknown>) {}
  },
}));

const { S3Storage } = await import("../../../src/lib/storage/s3");

const fullEnv = {
  accountId: "acc",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "my-bucket",
  publicUrl: "https://cdn.example.com",
};

beforeEach(() => {
  sent = [];
  listResponses = [];
  getResponse = { body: null };
  clientConstructions = 0;
  lastClientConfig = null;
});

describe("isEnabled", () => {
  test("所有欄位齊全時為 true", () => {
    expect(new S3Storage(fullEnv).isEnabled()).toBe(true);
  });

  test.each([
    "accountId",
    "accessKeyId",
    "secretAccessKey",
    "bucket",
    "publicUrl",
  ])("缺 %s 時為 false", (missing) => {
    const env = { ...fullEnv, [missing]: undefined };
    expect(new S3Storage(env).isEnabled()).toBe(false);
  });

  test("完全空設定為 false", () => {
    expect(new S3Storage({}).isEnabled()).toBe(false);
  });
});

describe("put / publicUrl", () => {
  test("送出 PutObjectCommand；URL 由 publicUrl 推導", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const s = new S3Storage(fullEnv);
    await s.put("uploads/a.png", body, "image/png");

    expect(s.publicUrl("uploads/a.png")).toBe("https://cdn.example.com/uploads/a.png");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.input).toEqual({
      Bucket: "my-bucket",
      Key: "uploads/a.png",
      Body: body,
      ContentType: "image/png",
    });
    // endpoint 由 accountId 組出、credentials 正確
    expect(lastClientConfig).toMatchObject({
      region: "auto",
      endpoint: "https://acc.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "key", secretAccessKey: "secret" },
    });
  });

  test("S3Client 為 lazy singleton：多次呼叫只建一次", async () => {
    const s = new S3Storage(fullEnv);
    await s.put("a", new Uint8Array(), "image/png");
    await s.put("b", new Uint8Array(), "image/png");
    expect(clientConstructions).toBe(1);
  });
});

describe("get", () => {
  test("回傳物件 bytes", async () => {
    getResponse = { body: new Uint8Array([9, 8, 7]) };
    const bytes = await new S3Storage(fullEnv).get("uploads/a.png");
    expect(bytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(sent[0]!.input).toEqual({ Bucket: "my-bucket", Key: "uploads/a.png" });
  });

  test("無 Body 回 null", async () => {
    getResponse = { body: null };
    expect(await new S3Storage(fullEnv).get("missing")).toBeNull();
  });

  test("NoSuchKey 回 null，其餘錯誤往上拋", async () => {
    const notFound = Object.assign(new Error("missing"), { name: "NoSuchKey" });
    getResponse = notFound;
    expect(await new S3Storage(fullEnv).get("missing")).toBeNull();

    getResponse = new Error("boom");
    await expect(new S3Storage(fullEnv).get("x")).rejects.toThrow("boom");
  });
});

describe("delete", () => {
  test("送出 DeleteObjectCommand", async () => {
    await new S3Storage(fullEnv).delete("uploads/a.png");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.__type).toBe("delete");
    expect(sent[0]!.input).toEqual({ Bucket: "my-bucket", Key: "uploads/a.png" });
  });
});

describe("list", () => {
  test("跨分頁取完所有物件、過濾資料夾標記、補上預設值", async () => {
    const lastModified = new Date("2026-06-09T00:00:00.000Z");
    listResponses = [
      {
        Contents: [
          { Key: "uploads/a.png", Size: 10, LastModified: lastModified },
          { Key: "uploads/", Size: 0, LastModified: lastModified }, // 資料夾標記 → 略過
          { Key: undefined }, // 無 Key → 略過
        ],
        IsTruncated: true,
        NextContinuationToken: "tok-1",
      },
      {
        Contents: [
          { Key: "uploads/b.png" }, // 無 Size / LastModified → 用預設
        ],
        IsTruncated: false,
      },
    ];

    const objects = await new S3Storage(fullEnv).list("uploads/");

    expect(objects).toHaveLength(2);
    expect(objects[0]!).toEqual({
      key: "uploads/a.png",
      url: "https://cdn.example.com/uploads/a.png",
      size: 10,
      lastModified: "2026-06-09T00:00:00.000Z",
    });
    expect(objects[1]!.key).toBe("uploads/b.png");
    expect(objects[1]!.size).toBe(0); // 預設

    // 第二頁帶上前一頁的 ContinuationToken
    const listCommands = sent.filter((c) => c.__type === "list");
    expect(listCommands).toHaveLength(2);
    expect(listCommands[0]!.input.ContinuationToken).toBeUndefined();
    expect(listCommands[1]!.input.ContinuationToken).toBe("tok-1");
    expect(listCommands[0]!.input.Prefix).toBe("uploads/");
  });

  test("無內容時回空陣列", async () => {
    listResponses = [{ Contents: undefined, IsTruncated: false }];
    expect(await new S3Storage(fullEnv).list("uploads/")).toEqual([]);
  });
});
