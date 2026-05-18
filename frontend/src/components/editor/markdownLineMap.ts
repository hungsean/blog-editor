import { marked, type Token, type TokensList } from "marked";

/**
 * 把 markdown 渲染成 HTML，並在每個頂層區塊的最外層標籤加上 `data-source-line`
 * 屬性（0-based 來源行號），供編輯器與預覽的行對應滾動同步使用。
 *
 * @remarks
 * marked 的 token 不帶行號，因此先用 `marked.lexer` 取得頂層 token，再逐一累加各
 * `token.raw` 的換行數來推算每個區塊的起始行；每個 token 單獨用 `marked.parser`
 * 渲染後，把 `data-source-line` 注入結果字串的第一個標籤。
 *
 * `marked.parser` 會讀取 token 陣列上的 `.links` 屬性（參考式連結定義
 * `[foo]: url`），因此切成單一 token 陣列時必須把 lexer 回傳的 `.links` 一併帶上，
 * 否則參考式連結會渲染失敗。
 *
 * `space` token 渲染為空字串會被略過，但行號仍要累加，否則後續區塊的行號會偏移。
 * marked 的 `markedHighlight` 等 plugin 設定是註冊在全域 marked 實例上，lexer 與
 * parser 會自動沿用，本檔不需重複設定。
 */
export function renderWithLineMarkers(content: string): string {
  const tokens = marked.lexer(content);
  let line = 0;
  let html = "";

  for (const token of tokens) {
    const startLine = line;
    line += token.raw.split("\n").length - 1;

    const single = [token] as Token[] as TokensList;
    single.links = tokens.links;
    const blockHtml = marked.parser(single);
    if (!blockHtml.trim()) continue;

    html += blockHtml.replace(
      /^(\s*)<(\w+)/,
      `$1<$2 data-source-line="${startLine}"`,
    );
  }

  return html;
}
