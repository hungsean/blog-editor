import React, { createContext, useContext, useMemo } from "react";
import type { FieldValues } from "../components/editor/FieldsPanel";

/**
 * 編輯器頁面共享的草稿狀態。
 *
 * @remarks
 * 狀態本體仍留在 {@link EditorPage}（連同 save/debounce 邏輯），這裡只是把
 * `fields` / `content` / `draftId` 與寫回函式往下供應，讓 FieldsPanel 底下的
 * TranslationButtons、TranslationDialog、OgImageDialog 不必層層轉手 props。
 * UI 控制狀態（dialog 的 open/mode 等）刻意不放這裡，仍由各自的父層管理。
 */
interface EditorContextValue {
  draftId: string | null;
  fields: FieldValues;
  content: string;
  /** 更新整個 fields 物件（對應 EditorPage 的 handleFieldsChange，會觸發 debounce 儲存）。 */
  updateFields: (fields: FieldValues) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

interface EditorProviderProps extends EditorContextValue {
  children: React.ReactNode;
}

export function EditorProvider({ draftId, fields, content, updateFields, children }: Readonly<EditorProviderProps>) {
  const value = useMemo(
    () => ({ draftId, fields, content, updateFields }),
    [draftId, fields, content, updateFields]
  );
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

/**
 * 取用編輯器共享狀態；必須在 {@link EditorProvider} 內使用。
 *
 * @remarks
 * 在 Provider 外呼叫會 throw，藉此及早抓出元件掛錯位置，而不是拿到 undefined 後才在
 * 別處炸開。
 */
export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error("useEditor must be used within an EditorProvider");
  }
  return ctx;
}
