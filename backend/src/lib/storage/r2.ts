/**
 * ## storage/r2
 *
 * Cloudflare Workers 的 {@link Storage} 實作：用原生 R2 binding（`env.BUCKET`），**不碰 aws-sdk**，
 * 因此可安全進 Worker bundle。由 `worker.ts` 注入（`makeStorage`）。
 *
 * @remarks
 * R2 binding 的 `list` 回傳結構（`{ objects, truncated, cursor }`）與 S3 `ListObjectsV2` 不同，
 * 在此拉平成 {@link StoredObject}，並過濾資料夾標記，使兩個實作對 route 行為一致。
 * `publicUrl` 來源為 `R2_PUBLIC_URL`（env provider 已去尾斜線），可指向自訂 domain。
 * 型別來自 `@cloudflare/workers-types`（`import type`，編譯後 erased）。
 */
import type { Storage, StoredObject } from "./types";

/**
 * 以原生 R2 binding 為後端的 {@link Storage} 實作。
 *
 * @param bucket - R2 bucket binding（`c.env.BUCKET`）；未綁定時為 `undefined`，`isEnabled()` 回 false
 * @param publicUrlBase - 公開 URL 前綴（`c.var.env.r2.publicUrl`），缺漏時視為未啟用
 */
export class R2Storage implements Storage {
  constructor(
    private readonly bucket: R2Bucket | undefined,
    private readonly publicUrlBase: string | undefined,
  ) {}

  isEnabled(): boolean {
    return !!(this.bucket && this.publicUrlBase);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.bucket!.put(key, bytes, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket!.get(key);
    if (!obj) return null;
    return new Uint8Array(await obj.arrayBuffer());
  }

  /**
   * @remarks
   * R2 `list` 單次有上限，以 `cursor` 迴圈取完所有分頁；略過鍵值以 `/` 結尾的資料夾標記，
   * 與 S3 實作語意一致。`uploaded` 為 Date，轉成 ISO 字串對齊 {@link StoredObject}。
   */
  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.bucket!.list({ prefix, cursor });
      for (const obj of res.objects) {
        if (obj.key.endsWith("/")) continue;
        out.push({
          key: obj.key,
          url: this.publicUrl(obj.key),
          size: obj.size,
          lastModified: obj.uploaded.toISOString(),
        });
      }
      cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.bucket!.delete(key);
  }

  publicUrl(key: string): string {
    return `${this.publicUrlBase}/${key}`;
  }
}
