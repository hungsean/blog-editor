/**
 * ## storage/types
 *
 * 物件儲存抽象的**純型別**入口：`Storage` 介面與共用型別，**不 import 任何實作**
 * （aws-sdk / R2 binding 一律不在此檔出現）。
 *
 * ### 為什麼把型別與實作徹底分離
 * self-host 走 `@aws-sdk/client-s3`（S3 相容 API 打 R2），Cloudflare Workers 走原生 R2 binding。
 * aws-sdk 不可被拉進 Worker bundle，因此兩個實作各自一支檔（`s3.ts` / `r2.ts`），route handler
 * 只 `import type` 本檔，由 #03 的 runtime provider（`makeStorage`）每 request 注入對應實作。
 * 詳見 `plan/issue/04-storage-abstraction-r2.md`。
 *
 * @remarks
 * 本檔只放型別（`import type` 安全、編譯後 erased），不得 `import './s3'` / `import './r2'`，
 * 否則會把實作（含 aws-sdk）靜態拉進任何 import 本檔的 bundle。
 */

/** 物件儲存中單一物件的精簡描述，供圖片庫同步等列出操作使用。 */
export interface StoredObject {
  /** 物件鍵值，例如 `uploads/abc123.png`。 */
  key: string;
  /** 可公開存取的完整 URL（= `publicUrl(key)`）。 */
  url: string;
  /** 物件大小（bytes）。 */
  size: number;
  /** 最後修改時間（ISO 8601 字串）。 */
  lastModified: string;
}

/**
 * 物件儲存的 runtime-中立介面。兩個 runtime 各自注入實作：
 * self-host = {@link import("./s3").S3Storage}、Workers = {@link import("./r2").R2Storage}。
 *
 * @remarks
 * `list` 把兩種後端不同的回傳結構（S3 `ListObjectsV2` vs R2 `bucket.list`）拉平成
 * {@link StoredObject}，並一律過濾「資料夾標記」（鍵值以 `/` 結尾者）。
 * `put` 只負責寫入、不回傳 URL；URL 一律由 `publicUrl(key)` 推導，讓兩個關注點分離。
 */
export interface Storage {
  /**
   * 儲存設定是否齊全可用。
   *
   * @returns `true` 表示可上傳 / 列出；呼叫其餘方法前應先確認，否則行為未定義
   */
  isEnabled(): boolean;

  /**
   * 寫入一個物件。
   *
   * @param key - 物件鍵值，例如 `uploads/abc123.png`
   * @param bytes - 物件的 raw bytes
   * @param contentType - MIME type，例如 `image/png`
   * @throws 後端寫入失敗時拋出
   */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;

  /**
   * 讀取一個物件的 raw bytes。
   *
   * @param key - 物件鍵值
   * @returns 物件 bytes；不存在時回 `null`
   */
  get(key: string): Promise<Uint8Array | null>;

  /**
   * 列出指定前綴下的所有物件（自動翻完所有分頁）。
   *
   * @param prefix - 鍵值前綴，例如 `uploads/`
   * @returns 物件清單（已過濾資料夾標記、補上預設值）
   */
  list(prefix: string): Promise<StoredObject[]>;

  /**
   * 刪除一個物件。
   *
   * @param key - 物件鍵值
   */
  delete(key: string): Promise<void>;

  /**
   * 由鍵值推導可公開存取的 URL。
   *
   * @param key - 物件鍵值
   * @returns 完整公開 URL：`{publicUrl}/{key}`
   */
  publicUrl(key: string): string;
}
