/**
 * 共用 domain 型別。
 *
 * @remarks
 * 自 #01 起，DB 相關型別的單一來源為 `lib/schema.ts`（Drizzle 推導），此檔僅
 * 再匯出，避免與 schema 重複定義導致漂移。
 */
export type { Draft, TranslationPreset } from "./lib/schema";
