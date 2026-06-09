/**
 * `lib/r2` 真實 factory 邊界測試：`createR2(env)` 回傳的真實 client。
 *
 * @remarks
 * route 測試用 `mock.module("../../src/lib/r2")` 把整個 factory 換成假 client，因此**真實的**
 * `createR2`（isR2Enabled 設定齊全判定、S3Client lazy singleton、上傳 URL 組裝、list 分頁 +
 * 資料夾標記過濾）在 route 測試裡完全沒被執行——本檔改 mock `@aws-sdk/client-s3`，直接驗證真實
 * factory 對 S3 API 的呼叫與回傳。
 *
 * mock 必須在 import `src/lib/r2`（static import `@aws-sdk/client-s3`）之前註冊，故用 top-level
 * `mock.module` + dynamic import 的順序。
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

/** 每次 `S3Client.send` 收到的 command（PutObjectCommand / ListObjectsV2Command 實例）。 */
let sent: Array<{ __type: string; input: Record<string, unknown> }> = [];
/** 預先排好的 ListObjectsV2 回應佇列（測分頁用，依序消費）。 */
let listResponses: Array<Record<string, unknown>> = [];
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
      return {};
    }
  },
  PutObjectCommand: class {
    __type = "put";
    constructor(public input: Record<string, unknown>) {}
  },
  ListObjectsV2Command: class {
    __type = "list";
    constructor(public input: Record<string, unknown>) {}
  },
}));

const { createR2 } = await import("../../src/lib/r2");

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
  clientConstructions = 0;
  lastClientConfig = null;
});

describe("isR2Enabled", () => {
  test("所有欄位齊全時為 true", () => {
    expect(createR2(fullEnv).isR2Enabled()).toBe(true);
  });

  test.each([
    "accountId",
    "accessKeyId",
    "secretAccessKey",
    "bucket",
    "publicUrl",
  ])("缺 %s 時為 false", (missing) => {
    const env = { ...fullEnv, [missing]: undefined };
    expect(createR2(env).isR2Enabled()).toBe(false);
  });

  test("完全空設定為 false", () => {
    expect(createR2({}).isR2Enabled()).toBe(false);
  });
});

describe("uploadToR2", () => {
  test("送出 PutObjectCommand 並回傳公開 URL", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const url = await createR2(fullEnv).uploadToR2("uploads/a.png", body, "image/png");

    expect(url).toBe("https://cdn.example.com/uploads/a.png");
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
    const r2 = createR2(fullEnv);
    await r2.uploadToR2("a", new Uint8Array(), "image/png");
    await r2.uploadToR2("b", new Uint8Array(), "image/png");
    expect(clientConstructions).toBe(1);
  });
});

describe("listR2Objects", () => {
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

    const objects = await createR2(fullEnv).listR2Objects("uploads/");

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
    expect(await createR2(fullEnv).listR2Objects("uploads/")).toEqual([]);
  });
});
