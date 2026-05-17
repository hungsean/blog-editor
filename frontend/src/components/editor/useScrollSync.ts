import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";

interface LineMarker {
  /** 0-based 來源行號。 */
  line: number;
  /** 該區塊頂端相對預覽滾動容器內容頂端的位移（px）。 */
  top: number;
}

/**
 * 收集預覽容器內所有 `data-source-line` 標記，回傳依來源行號（同時也是位移）
 * 遞增排序的清單。
 *
 * @remarks
 * `top` 用 `getBoundingClientRect` 相對 container 計算後再加上 `container.scrollTop`，
 * 不依賴 `offsetParent`，因此預覽容器是否 `position: relative` 都不影響結果。
 * 標記在 DOM 中本就依來源行遞增排列，故回傳結果的 `line` 與 `top` 皆為遞增。
 * 每次同步時即時呼叫，圖片載入後造成的高度變化會自動反映。
 */
function collectMarkers(container: HTMLElement): LineMarker[] {
  const containerTop = container.getBoundingClientRect().top;
  const markers: LineMarker[] = [];
  const els = container.querySelectorAll<HTMLElement>("[data-source-line]");
  for (const el of els) {
    const line = Number(el.dataset.sourceLine);
    if (Number.isNaN(line)) continue;
    const top = el.getBoundingClientRect().top - containerTop + container.scrollTop;
    markers.push({ line, top });
  }
  return markers;
}

/**
 * 在遞增排序的標記清單中，依 `keyOf` 取出的軸做線性內插，回傳 `valueOf` 軸上
 * 對應 `keyValue` 的值。`keyValue` 落在清單範圍外時夾到頭尾標記。
 */
function interpolate(
  markers: LineMarker[],
  keyOf: (m: LineMarker) => number,
  valueOf: (m: LineMarker) => number,
  keyValue: number,
): number {
  const first = markers[0];
  const last = markers[markers.length - 1];
  if (!first || !last) return 0;
  if (keyValue <= keyOf(first)) return valueOf(first);
  if (keyValue >= keyOf(last)) return valueOf(last);
  for (let i = 0; i < markers.length - 1; i++) {
    const a = markers[i];
    const b = markers[i + 1];
    if (!a || !b) continue;
    if (keyValue >= keyOf(a) && keyValue <= keyOf(b)) {
      const span = keyOf(b) - keyOf(a);
      const ratio = span === 0 ? 0 : (keyValue - keyOf(a)) / span;
      return valueOf(a) + ratio * (valueOf(b) - valueOf(a));
    }
  }
  return valueOf(last);
}

/**
 * 讓 CodeMirror 編輯器與 marked 預覽面板的滾動位置以「來源行」對應方式同步。
 *
 * @remarks
 * 用 leader pane 機制避免回授迴圈：滑鼠進入（`pointerenter`）或編輯器取得焦點
 * （`focusin`）時記下該面板為 leader，只有 leader 的 `scroll` 事件會驅動對方；
 * 程式化設定對方 `scrollTop` 觸發的 `scroll` 事件因發起面板非 leader 而被忽略。
 * 每次同步用 `requestAnimationFrame` 節流。
 *
 * 行對應依賴預覽 HTML 上的 `data-source-line` 標記（見 markdownLineMap.ts）。
 * 找不到標記（內容為空等）時不做任何事，為安全 fallback。
 *
 * 呼叫端必須傳入 state 保存的實際 DOM / EditorView 實例，而不是 ref 物件；
 * ref `.current` 變化不會觸發 React effect 重新執行。編輯既有草稿時頁面先顯示
 * loading，editor/preview 會晚於父層 hook 第一次 effect 才掛載，因此要讓實例就緒
 * 本身觸發重新 render，監聽器才會被正確安裝。
 */
export function useScrollSync(
  view: EditorView | null,
  preview: HTMLDivElement | null,
): void {
  useEffect(() => {
    if (!view || !preview) return;
    const editorScroller = view.scrollDOM;

    type Pane = "editor" | "preview";
    let leader: Pane = "editor";
    let frame = 0;

    // 以下用 const 箭頭函式（非 function 宣告），確保 TS 把守衛後收斂的
    // 非空 view / preview 帶進閉包。

    /** 編輯器頂端可視位置對應的小數來源行（0-based）。 */
    const editorTopLine = (): number => {
      const block = view.lineBlockAtHeight(editorScroller.scrollTop);
      const lineNumber = view.state.doc.lineAt(block.from).number - 1;
      const within =
        block.height > 0
          ? (editorScroller.scrollTop - block.top) / block.height
          : 0;
      return lineNumber + Math.min(Math.max(within, 0), 1);
    };

    const syncEditorToPreview = () => {
      const markers = collectMarkers(preview);
      if (markers.length === 0) return;
      const top = interpolate(markers, (m) => m.line, (m) => m.top, editorTopLine());
      preview.scrollTop = top;
    };

    const syncPreviewToEditor = () => {
      const markers = collectMarkers(preview);
      if (markers.length === 0) return;
      const line = interpolate(markers, (m) => m.top, (m) => m.line, preview.scrollTop);
      const doc = view.state.doc;
      const lineNumber = Math.min(Math.max(Math.floor(line) + 1, 1), doc.lines);
      const block = view.lineBlockAt(doc.line(lineNumber).from);
      const frac = line - Math.floor(line);
      editorScroller.scrollTop = block.top + frac * block.height;
    };

    const schedule = (fn: () => void) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        fn();
      });
    };

    const onEditorScroll = () => {
      if (leader === "editor") schedule(syncEditorToPreview);
    };
    const onPreviewScroll = () => {
      if (leader === "preview") schedule(syncPreviewToEditor);
    };
    const setEditorLeader = () => {
      leader = "editor";
    };
    const setPreviewLeader = () => {
      leader = "preview";
    };

    editorScroller.addEventListener("scroll", onEditorScroll, { passive: true });
    preview.addEventListener("scroll", onPreviewScroll, { passive: true });
    editorScroller.addEventListener("pointerenter", setEditorLeader);
    preview.addEventListener("pointerenter", setPreviewLeader);
    editorScroller.addEventListener("focusin", setEditorLeader);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      editorScroller.removeEventListener("scroll", onEditorScroll);
      preview.removeEventListener("scroll", onPreviewScroll);
      editorScroller.removeEventListener("pointerenter", setEditorLeader);
      preview.removeEventListener("pointerenter", setPreviewLeader);
      editorScroller.removeEventListener("focusin", setEditorLeader);
    };
  }, [view, preview]);
}
