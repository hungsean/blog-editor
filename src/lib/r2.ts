/**
 * ## r2
 *
 * 封裝 Cloudflare R2 圖片上傳功能（透過 AWS S3 相容 API）。
 *
 * ### 資料流
 * 上傳檔案 → PutObject 到 R2 → 回傳公開 URL（`R2_PUBLIC_URL/{key}`）
 *
 * ### 已知限制
 * - S3Client 為 lazy singleton，第一次呼叫 `getClient()` 時才建立連線
 * - 若任何一個環境變數未設定，`isR2Enabled()` 回傳 false，上傳功能全部停用
 * - `R2_PUBLIC_URL` 尾部斜線會自動去除，避免雙斜線 URL
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;
const PUBLIC_URL = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");

/**
 * 檢查所有必要的 R2 環境變數是否齊全。
 *
 * @returns `true` 表示 R2 可用；呼叫 `uploadToR2` 前應先確認
 */
export function isR2Enabled() {
  return !!(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET && PUBLIC_URL);
}

let client: S3Client | null = null;

function getClient() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID!, secretAccessKey: SECRET_ACCESS_KEY! },
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
 * @returns 完整公開 URL：`{R2_PUBLIC_URL}/{key}`
 * @throws 若上傳失敗，S3Client 會拋出錯誤
 *
 * @remarks
 * 呼叫前請先確認 `isR2Enabled()` 為 true，否則 client 建立時會因環境變數為 undefined 而行為未定義。
 */
export async function uploadToR2(key: string, body: Uint8Array, contentType: string): Promise<string> {
  await getClient().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return `${PUBLIC_URL}/${key}`;
}
