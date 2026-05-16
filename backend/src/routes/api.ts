/**
 * ## api
 *
 * 所有 `/api/*` REST endpoint 的 Hono router。
 *
 * ### 端點一覽
 * - `GET/POST /drafts` — 列表 / 新建草稿
 * - `GET/PATCH/DELETE /drafts/:id` — 單篇 CRUD
 * - `GET /github/posts` — 列出 GitHub 上的 .md 檔案
 * - `POST /github/sync` — 將 GitHub 文章匯入本地 DB
 * - `POST /drafts/:id/resync` — 從 GitHub 覆蓋本地草稿
 * - `GET /slug` — 查詢同 slug 的草稿；`slug` 必填，`lang` 選填（有帶則限同語言）
 * - `POST /drafts/publish` — 多篇同時送出一個 PR（batch，body: `{ draftIds }`)
 * - `POST /drafts/:id/publish` — 對單篇開 GitHub PR
 * - `DELETE /drafts` — 批量刪除草稿（batch，body: `{ draftIds }`）
 * - `GET /translation/status` — 檢查 AI 翻譯是否啟用
 * - `POST /translation` — 翻譯文章內容並回傳結果（不建立草稿）
 * - `POST /upload/r2` — 上傳圖片到 R2，回傳公開 URL
 * - `POST /upload/temp` — 暫存圖片到 data/og-temp/，回傳 token（24 小時有效）
 * - `GET /upload/temp/:token` — 以 base64 data URL 取得暫存圖片
 * - `GET /images` — 列出圖片庫（讀本地 DB）
 * - `POST /images/sync` — 從 R2 uploads/ 同步圖片清單進 DB
 * - `POST /images/upload` — 上傳圖片到 R2 並寫入圖片庫
 * - `GET/POST /presets` — 常用翻譯設定列表 / 新增
 * - `GET/PATCH/DELETE /presets/:id` — 單筆常用翻譯 CRUD
 *
 * ### 已知限制
 * - `publish` 與 `batch-publish` 的 frontmatter 序列化為自製格式，僅支援 string/boolean/array
 * - `slug` 若為空，publish 時會嘗試以 `slugify(title)` 產生；若仍為空則阻擋送出
 * - slug 唯一性規則為同語言內唯一（`lang + slug` 不重複），不同語言可用相同 slug
 */
import { Hono } from "hono";
import drafts from "./drafts";
import github from "./github";
import translate from "./translate";
import upload from "./upload";
import images from "./images";
import presets from "./presets";
import slug from "./slug";

const api = new Hono();

api.route("/", drafts);
api.route("/", github);
api.route("/", translate);
api.route("/", upload);
api.route("/", images);
api.route("/", presets);
api.route("/", slug);

export default api;
