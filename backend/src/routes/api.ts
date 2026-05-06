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
 * - `GET /drafts/:id/translations` — 取得相同 slug 的其他語言版本
 * - `GET /slug` — 查詢同 slug 的草稿；`slug` 必填，`lang` 選填（有帶則限同語言）
 * - `POST /drafts/:id/publish` — 對單篇開 GitHub PR
 * - `POST /batch-publish` — 多篇同時送出一個 PR
 * - `POST /batch-delete` — 批量刪除草稿
 * - `GET /translation-status` — 檢查 AI 翻譯是否啟用
 * - `POST /drafts/:id/translate` — 建立人工翻譯副本（直接複製內容）
 * - `POST /drafts/:id/ai-translate` — 使用 OpenAI 翻譯後建立副本
 * - `POST /upload` — 上傳圖片到 R2
 * - `POST /drafts/:id/og-hero` — 暫存 OG 封面圖到 data/og-temp/，回傳 heroToken
 * - `POST /drafts/:id/generate-og` — 動態生成 OG 圖片並上傳到 R2
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
import publish from "./publish";
import translate from "./translate";
import upload from "./upload";
import presets from "./presets";
import slug from "./slug";

const api = new Hono();

api.route("/", drafts);
api.route("/", github);
api.route("/", publish);
api.route("/", translate);
api.route("/", upload);
api.route("/", presets);
api.route("/", slug);

export default api;
