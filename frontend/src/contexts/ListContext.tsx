import React, { createContext, useContext, useMemo } from "react";

/**
 * 草稿列表頁共享的選取狀態與卡片操作。
 *
 * @remarks
 * 狀態本體與 bulk 操作邏輯仍留在 {@link ListPage}（TopBar / SelectModeBar 也要用），
 * 這裡只把 PostList 原本純轉手的東西收進來，讓 PostList 回歸成只負責 `posts` 映射的
 * 容器，PostCard 直接從 context 取得選取狀態與刪除/同步回呼。
 */
interface ListContextValue {
  selectMode: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  /** 單篇刪除成功後呼叫，從列表移除該篇。 */
  onDelete?: (id: string) => void;
  /** 單篇 sync 成功後呼叫，讓列表重新載入。 */
  onSynced?: () => void;
}

const ListContext = createContext<ListContextValue | null>(null);

interface ListProviderProps extends ListContextValue {
  children: React.ReactNode;
}

export function ListProvider({ selectMode, selectedIds, toggleSelect, onDelete, onSynced, children }: Readonly<ListProviderProps>) {
  const value = useMemo(
    () => ({ selectMode, selectedIds, toggleSelect, onDelete, onSynced }),
    [selectMode, selectedIds, toggleSelect, onDelete, onSynced]
  );
  return <ListContext.Provider value={value}>{children}</ListContext.Provider>;
}

/**
 * 取用列表頁共享狀態；必須在 {@link ListProvider} 內使用。
 *
 * @remarks
 * 在 Provider 外呼叫會 throw，以便及早抓出元件掛錯位置。
 */
export function useList(): ListContextValue {
  const ctx = useContext(ListContext);
  if (!ctx) {
    throw new Error("useList must be used within a ListProvider");
  }
  return ctx;
}
