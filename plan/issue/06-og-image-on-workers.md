# #06 OG 圖片生成上雲：resvg-js → resvg-wasm + 字型策略

**Phase B — 後端 Workers 化** ｜ 相依：#03、#04 ｜ ⚠️ **最高風險 issue**

## 背景（主人特別交代：OG 目前還沒遷移好）

OG 圖片生成 **仍在後端跑**，沒有移到前端：

- `src/routes/og.ts` 掛在 API 上（`api.ts` 有 `api.route("/", og)`）。
- `POST /og/preview` → `generateArticleOg()`（`src/lib/ogImage.ts`）→ 回傳 PNG bytes。
- `POST /og/upload` → 上傳 PNG 到 R2。
- 前端 `src/lib/api/og.ts` + `OgImageDialog.tsx` 呼叫這兩個 endpoint。

`ogImage.ts` 的相依在 Workers 上有 **兩個硬阻礙**：

1. **`@resvg/resvg-js`** — 原生 Rust napi 模組，**Workers (workerd) 完全跑不動**。
2. **字型快取寫磁碟** — `getFonts()` 用 `Bun.file` / `Bun.write` 把 8~10 MB 字型下載到
   `data/fonts/`，`mkdir` 建目錄。Workers 無檔案系統。

`satori`（SVG 生成）本身是純 JS，兩環境都能跑，不是問題。

## 方案評估

| 方案 | 說明 | self-host | Workers | 取捨 |
| --- | --- | --- | --- | --- |
| **A. resvg-wasm + 字型走 Storage（推薦）** | `@resvg/resvg-wasm` 取代 native；字型存 R2，lazy load 後快取在 module scope | ✅ | ✅ | 需處理 wasm 初始化與字型載入延遲 |
| B. 維持 native，OG 只在 self-host | Workers 不提供 OG，前端或 self-host 產 | ✅ | ❌（功能缺） | 違背「雙環境等價」 |
| C. Cloudflare Browser Rendering | 用 headless 瀏覽器截圖 | 重 | ✅ | 成本高、過度設計 |
| D. 整個搬到前端瀏覽器 canvas | 前端 satori + canvas 渲染 | ✅ | ✅ | 改動大、字型/CJK 在瀏覽器同樣要處理 |

**採方案 A**：satori（已可用）+ `@resvg/resvg-wasm`（SVG→PNG），字型透過 #04 的 Storage
介面從 R2 取得並在 isolate 記憶體快取。self-host 也走同一條 wasm 路徑，保持單一程式碼。

## 字型策略（最關鍵）

- 現況下載 ~8~10 MB CJK 字型。Workers bundle 上限（付費 10 MB 壓縮），**不可直接打包全字型**。
- 做法：
  1. 把所需字型（subset 後更佳）上傳到 R2 固定 key（如 `fonts/xxx.ttf`）。
  2. `getFonts()` 改成：先查 module-scope cache → 無則從 R2 `get` → 存進 cache。
     暖 isolate 重複使用，只有冷啟動付一次 R2 讀取延遲。
  3. self-host 同樣走 Storage（或本機路徑），不再 `fetch` Google Fonts 寫磁碟。
- 若 CJK 全字型太大導致冷啟動慢，評估 **字型 subset**（只保留常用字）或限制 OG 標題字元集。

## ⚠️ 先做 feasibility spike，再做正式實作（review 點 5）

「OG 生成耗 CPU，但 1200×630 通常可接受」是 **未經驗證的假設**。Workers 的硬限制可能讓
整個方案在某些方案層級不可行，必須先驗證再投入改寫：

| 限制 | Workers Free | Workers Paid |
| --- | --- | --- |
| 每次 request CPU 時間 | **10 ms** | 預設 30 s（可調，上限更高） |
| 記憶體 | 128 MB | 128 MB |
| Worker bundle（gzip 後） | **3 MB** | **10 MB** |

（參考：Workers limits <https://developers.cloudflare.com/workers/platform/limits/>）

satori（SVG 生成）+ resvg-wasm（rasterize PNG）+ CJK 字型，**幾乎不可能塞進 Free 的
10 ms CPU 與 3 MB bundle**。所以本 issue 預設 **最低需 Workers Paid**，且仍需 spike 確認
實際 CPU / 記憶體 / bundle 數字。

### #06a — Spike（先做，產出 go/no-go）

1. 最小 PoC worker：satori + `@resvg/resvg-wasm`，硬編一張含 CJK 標題的 OG。
2. 量測並記錄：
   - gzip 後 bundle 大小（含 wasm）是否 < 10 MB（Paid）。
   - 單次生成的 CPU 時間（`wrangler dev` / 部署後觀測）與記憶體峰值。
   - 冷啟動含「從 R2 拉字型」的延遲。
   - CJK 是否正確顯示（字型 subset 後是否仍涵蓋標題用字）。
3. 產出結論：可行的最低 Workers 方案（預期 Paid）、字型策略（全量 vs subset）、
   或 fallback（OG 只在 self-host / 改前端 canvas）。**spike 失敗則回 EPIC 重新選方案。**

### #06b — 正式實作（spike 通過後）

1. `bun add @resvg/resvg-wasm`，移除 `@resvg/resvg-js`。
2. `ogImage.ts`：
   - `Resvg` 改用 wasm 版，需先 `initWasm()`（一次性，快取初始化狀態）。
   - `getFonts()` 重寫為走 Storage + module cache，移除 `Bun.file`/`Bun.write`/`mkdir`。
3. 字型上傳：寫個一次性腳本 / 文件，把字型放進 R2 `fonts/`。
4. `og.ts`：`/og/preview` 與 `/og/upload` 不需大改，但 `/og/upload` 走 #04 Storage。
5. 驗證 wasm 初始化在 Workers 與 Bun 都成功。

## 注意 / 地雷

- `@resvg/resvg-wasm` 的 wasm binary 也算進 Worker bundle 體積，要確認在上限內。
- satori fetch `heroImageUrl`：Workers 的 fetch 受 subrequest 數量 / 大小限制，留意大圖。
- wasm `initWasm` 不可重複初始化，要用旗標保護（module scope）。
- OG 生成耗 CPU，Workers 有 CPU time 上限；1200×630 PNG 通常可接受，但需實測。
- 依規範同步更新 `ogImage.ts` / `og.ts` 的 JSDoc（字型來源、渲染引擎都變了）。

## 驗收標準

- [ ] **#06a spike** 有書面結論：bundle 大小、CPU、記憶體、冷啟動、CJK 顯示數字齊全，
      並指定最低 Workers 方案（預期 Paid）。
- [ ] self-host：`/og/preview` 產出的 PNG 與現況視覺一致（字型、版面、CJK 正常）。
- [ ] Workers：`wrangler dev` 下 `/og/preview` 能成功回傳 PNG，CPU / 記憶體在所選方案額度內。
- [ ] 程式碼無 `@resvg/resvg-js`、無 `data/fonts/` 磁碟讀寫。
- [ ] Worker bundle（含 wasm + 字型策略）gzip 後在所選方案上限內。
- [ ] `/og/upload` 經 Storage 寫入 R2 `og/{draftId}.png`。
