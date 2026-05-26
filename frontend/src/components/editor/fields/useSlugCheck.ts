import { useEffect, useRef, useState } from "react";
import { fetchSlugMatches, type SlugMatch } from "../../../lib/api/slug";

/** slug 檢查狀態：閒置、檢查中、可用、衝突、查詢失敗。 */
export type SlugCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok" }
  | { status: "conflict"; matches: SlugMatch[] }
  | { status: "error" };

/** slug/lang 變動後延遲多久才打 API（毫秒）。 */
const DEBOUNCE_MS = 500;

/**
 * 查詢同語言同名草稿，並把結果整理成 {@link SlugCheckState}。
 *
 * @remarks
 * 抽成模組層級函式（而非寫在 hook 的 effect 內），是為了壓低 effect →
 * setTimeout → fetch callback 的巢狀層數。`draftId` 相同者代表草稿自己，
 * 會被排除，避免與自己衝突。查詢失敗一律回 `error`，不阻擋編輯。
 */
async function resolveSlugCheck(
  slug: string,
  lang: string,
  draftId: string | null,
): Promise<SlugCheckState> {
  try {
    const matches = await fetchSlugMatches(slug, lang);
    const others = matches.filter((m) => m.id !== draftId);
    return others.length > 0 ? { status: "conflict", matches: others } : { status: "ok" };
  } catch {
    return { status: "error" };
  }
}

/**
 * 在 slug 或 lang 變動後，延遲檢查是否已有同語言且同名的草稿。
 *
 * @param slug    目前輸入的 slug（前後空白會被忽略）
 * @param lang    目前選擇的語言
 * @param draftId 目前草稿 id，會從結果排除，避免草稿與自己衝突
 *
 * @remarks
 * 以 {@link DEBOUNCE_MS} debounce 避免逐字觸發 API。每次查詢用遞增的 `seq`
 * 標記，回應若晚於後續查詢即丟棄，避免 race 導致顯示過期結果。slug 為空時
 * 直接回到 `idle`，不視為衝突——空 slug 由送出 PR 時的必填檢查負責把關。
 */
export function useSlugCheck(slug: string, lang: string, draftId: string | null): SlugCheckState {
  const [state, setState] = useState<SlugCheckState>({ status: "idle" });
  const seqRef = useRef(0);

  useEffect(() => {
    const trimmed = slug.trim();
    if (!trimmed) {
      seqRef.current++;
      setState({ status: "idle" });
      return;
    }

    const seq = ++seqRef.current;
    setState({ status: "checking" });

    const timer = setTimeout(() => {
      void resolveSlugCheck(trimmed, lang, draftId).then((next) => {
        if (seq === seqRef.current) setState(next);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [slug, lang, draftId]);

  return state;
}
