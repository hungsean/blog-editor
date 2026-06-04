/**
 * ## repos/images
 *
 * `images` 表（R2 物件本地快取）的資料存取層。注入契約：`db` 為第一參數，
 * 本檔不 import db 單例，只 import schema 與型別。
 */
import { desc } from "drizzle-orm";
import type { DrizzleDB } from "../db";
import { images, type Image, type NewImage } from "../schema";

/** 列出圖片庫，依 uploaded_at 由新到舊。 */
export async function listImages(db: DrizzleDB): Promise<Image[]> {
  return db.select().from(images).orderBy(desc(images.uploaded_at));
}

/**
 * 以 key 為衝突鍵 upsert 一張圖片（sync 用）。
 *
 * @remarks
 * 對齊原 `ON CONFLICT(key) DO UPDATE`：key 已存在時更新 url/size/uploaded_at，
 * 不新增重複列。
 */
export async function upsertImage(db: DrizzleDB, values: NewImage): Promise<void> {
  await db
    .insert(images)
    .values(values)
    .onConflictDoUpdate({
      target: images.key,
      set: { url: values.url, size: values.size, uploaded_at: values.uploaded_at },
    });
}

/**
 * 插入一張新上傳的圖片（upload 用）。
 *
 * @remarks
 * 採純 INSERT（非 upsert），語意對齊原 route：key 衝突時拋錯，由呼叫端處理。
 */
export async function insertImage(db: DrizzleDB, values: NewImage): Promise<void> {
  await db.insert(images).values(values);
}
