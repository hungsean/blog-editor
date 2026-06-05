/**
 * ## repos/presets
 *
 * `translation_presets` 表的資料存取層。注入契約：`db` 為第一參數，本檔不 import
 * db 單例，只 import schema 與型別。keywords / translations 以 JSON 字串存放，
 * 序列化由呼叫端負責，repo 不介入。
 */
import { desc, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db";
import {
  translationPresets,
  type TranslationPreset,
  type NewTranslationPreset,
} from "../schema";

/** 列出所有翻譯 preset，依 updated_at 由新到舊。 */
export async function listPresets(db: DrizzleDB): Promise<TranslationPreset[]> {
  return db.select().from(translationPresets).orderBy(desc(translationPresets.updated_at));
}

/** 依 id 取得單筆 preset，不存在回傳 `null`。 */
export async function getPresetById(
  db: DrizzleDB,
  id: string,
): Promise<TranslationPreset | null> {
  const rows = await db
    .select()
    .from(translationPresets)
    .where(eq(translationPresets.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** 建立 preset 並回傳建立後的完整列。 */
export async function createPreset(
  db: DrizzleDB,
  values: NewTranslationPreset,
): Promise<TranslationPreset> {
  const rows = await db.insert(translationPresets).values(values).returning();
  return rows[0]!;
}

/** 局部更新 preset，回傳更新後的列；id 不存在回傳 `null`。 */
export async function updatePreset(
  db: DrizzleDB,
  id: string,
  patch: Partial<NewTranslationPreset>,
): Promise<TranslationPreset | null> {
  const rows = await db
    .update(translationPresets)
    .set(patch)
    .where(eq(translationPresets.id, id))
    .returning();
  return rows[0] ?? null;
}

/** 刪除單筆 preset，回傳是否確實刪到。 */
export async function deletePreset(db: DrizzleDB, id: string): Promise<boolean> {
  const rows = await db
    .delete(translationPresets)
    .where(eq(translationPresets.id, id))
    .returning({ id: translationPresets.id });
  return rows.length > 0;
}
