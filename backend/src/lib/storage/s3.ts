/**
 * ## storage/s3
 *
 * self-host（Bun）的 {@link Storage} 實作：透過 `@aws-sdk/client-s3` 打 R2 的 S3 相容 API。
 * #04 併入 — 原 `src/lib/r2.ts` 的 `createR2` 邏輯整併到此。
 *
 * ### ⚠️ Worker bundle 純淨度
 * **本檔是整個 codebase 唯一 import `@aws-sdk/client-s3` 的地方**，且**只**由 `server.bun.ts`
 * 鏈到。任何被 `worker.ts` transitively import 的模組都不可碰本檔，否則 aws-sdk 會被靜態
 * 拉進 Worker bundle（見 `plan/issue/04-storage-abstraction-r2.md` 的 build 驗收）。
 *
 * @remarks
 * `S3Client` 為 instance 內的 lazy singleton，第一次呼叫時才建立連線。`isEnabled()` 在任一
 * 必要設定缺漏時回 false（呼叫端據此回 503）。`publicUrl` 尾部斜線已在 env provider 去除。
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { R2Env } from "../env";
import type { Storage, StoredObject } from "./types";

/** S3 GetObject 在物件不存在時回傳的錯誤名稱。 */
const NOT_FOUND_ERRORS = new Set(["NoSuchKey", "NotFound"]);

/**
 * 以 `@aws-sdk/client-s3`（S3 相容 API）為後端的 {@link Storage} 實作。
 *
 * @remarks
 * 沿用原 `createR2` 的設定來源 {@link R2Env}（`c.var.env.r2`）：accountId 組 endpoint、
 * accessKeyId/secretAccessKey 當 credentials、bucket/publicUrl 用於操作與 URL 推導。
 */
export class S3Storage implements Storage {
  #client: S3Client | null = null;

  constructor(private readonly env: R2Env) {}

  isEnabled(): boolean {
    const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } = this.env;
    return !!(accountId && accessKeyId && secretAccessKey && bucket && publicUrl);
  }

  #getClient(): S3Client {
    if (!this.#client) {
      this.#client = new S3Client({
        region: "auto",
        endpoint: `https://${this.env.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.env.accessKeyId!,
          secretAccessKey: this.env.secretAccessKey!,
        },
      });
    }
    return this.#client;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.#getClient().send(
      new PutObjectCommand({ Bucket: this.env.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.#getClient().send(
        new GetObjectCommand({ Bucket: this.env.bucket, Key: key }),
      );
      if (!res.Body) return null;
      // aws-sdk v3 的 stream mixin：把 Body 串流收成 byte array。
      return await res.Body.transformToByteArray();
    } catch (err) {
      // 物件不存在回 null，其餘錯誤往上拋。
      if (err instanceof Error && NOT_FOUND_ERRORS.has(err.name)) return null;
      throw err;
    }
  }

  /**
   * @remarks
   * `ListObjectsV2` 單次最多 1000 筆，以 `ContinuationToken` 迴圈取完所有分頁；
   * 略過鍵值以 `/` 結尾的資料夾標記與無 Key 的項目，與 R2 binding 實作的語意一致。
   */
  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.#getClient().send(
        new ListObjectsV2Command({ Bucket: this.env.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith("/")) continue;
        out.push({
          key: obj.Key,
          url: this.publicUrl(obj.Key),
          size: obj.Size ?? 0,
          lastModified: (obj.LastModified ?? new Date()).toISOString(),
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.#getClient().send(new DeleteObjectCommand({ Bucket: this.env.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    return `${this.env.publicUrl}/${key}`;
  }
}
