/**
 * ## r2
 *
 * 封裝 Cloudflare R2 圖片上傳功能（透過 AWS S3 相容 API）。
 *
 * ### 資料流
 * 上傳檔案 → PutObject 到 R2 → 回傳公開 URL（`R2_PUBLIC_URL/{key}`）
 *
 * ### Factory（#03）
 * 改為 {@link createR2} factory：傳入 {@link import("./env").R2Env} 設定，回傳
 * `{ isR2Enabled, uploadToR2, listR2Objects }`。**不再於 module load 時讀 `process.env`**。
 * caller 由 `c.var.env.r2` 取得設定後建立 client。
 *
 * @remarks
 * #04（storage 去 fs 化）會以更完整的 Storage 抽象接手此模組；#03 先把「import 即讀 env」消除，
 * 介面與行為維持不變，讓 route 改吃 factory 後 #04 能無痛替換。
 *
 * ### 已知限制
 * - S3Client 為 client 內的 lazy singleton，第一次呼叫上傳 / 列表時才建立連線
 * - 若任何一個 R2 設定未填，`isR2Enabled()` 回傳 false，上傳功能全部停用
 * - `publicUrl` 尾部斜線在 env provider 已去除（避免雙斜線 URL）
 */
import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { R2Env } from "./env";

/** R2 物件的精簡描述，供圖片庫同步使用。 */
export interface R2Object {
  key: string;
  url: string;
  size: number;
  lastModified: string;
}

/** {@link createR2} 回傳的 R2 client 型別。 */
export type R2 = ReturnType<typeof createR2>;

/**
 * 建立綁定特定 R2 設定的 client。
 *
 * @param env - R2 連線設定（accountId / accessKeyId / secretAccessKey / bucket / publicUrl），
 *   來自 `c.var.env.r2`
 * @returns `{ isR2Enabled, uploadToR2, listR2Objects }`
 */
export function createR2(env: R2Env) {
  const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } = env;

  /**
   * 檢查所有必要的 R2 設定是否齊全。
   *
   * @returns `true` 表示 R2 可用；呼叫 `uploadToR2` 前應先確認
   */
  function isR2Enabled() {
    return !!(accountId && accessKeyId && secretAccessKey && bucket && publicUrl);
  }

  let client: S3Client | null = null;

  function getClient() {
    if (!client) {
      client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      });
    }
    return client;
  }

  /**
   * 上傳檔案到 R2，並回傳可公開存取的 URL。
   *
   * @param key - R2 物件鍵值，例如 `uploads/abc123.png`
   * @param body - 檔案的 raw bytes
   * @param contentType - MIME type，例如 `image/png`
   * @returns 完整公開 URL：`{publicUrl}/{key}`
   * @throws 若上傳失敗，S3Client 會拋出錯誤
   *
   * @remarks
   * 呼叫前請先確認 `isR2Enabled()` 為 true，否則 client 建立時會因設定為 undefined 而行為未定義。
   */
  async function uploadToR2(key: string, body: Uint8Array, contentType: string): Promise<string> {
    await getClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    return `${publicUrl}/${key}`;
  }

  /**
   * 列出 R2 bucket 中指定前綴下的所有物件。
   *
   * @param prefix - 物件鍵值前綴，例如 `uploads/`
   * @returns 物件清單，含公開 URL；不含「資料夾標記」（鍵值以 `/` 結尾者）
   * @throws 若列表失敗，S3Client 會拋出錯誤
   *
   * @remarks
   * ListObjectsV2 單次最多回傳 1000 筆，因此以 `ContinuationToken` 迴圈取完所有分頁。
   * 呼叫前請先確認 `isR2Enabled()` 為 true。
   */
  async function listR2Objects(prefix: string): Promise<R2Object[]> {
    const out: R2Object[] = [];
    let token: string | undefined;
    do {
      const res = await getClient().send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith("/")) continue;
        out.push({
          key: obj.Key,
          url: `${publicUrl}/${obj.Key}`,
          size: obj.Size ?? 0,
          lastModified: (obj.LastModified ?? new Date()).toISOString(),
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  return { isR2Enabled, uploadToR2, listR2Objects };
}
