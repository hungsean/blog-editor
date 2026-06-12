/**
 * ## env
 *
 * 環境變數的單一讀取點（provider）。把散落在各模組 module-load 時直接讀 `process.env`
 * 的行為，集中成一個純函數 {@link readEnv}，由不同 runtime 的入口提供「來源」：
 *
 * - self-host（Bun）：來源是 `process.env`，啟動即備齊，整個 process 讀一次即可。
 * - Cloudflare（Workers）：來源是每個 request 注入的 `c.env`（binding 尚未在 import 期存在），
 *   因此必須**每 request** 呼叫 `readEnv(c.env)`，不能在 module top-level 讀。
 *
 * @remarks
 * 這是 #03 runtime 抽象的基礎：所有 lib factory（`createGithub` / `createTranslator`）、物件儲存
 * （#04 的 `S3Storage` / `R2Storage`）與 route 都改吃 {@link Env}，不再自己碰 `process.env`，這樣
 * 同一份程式碼兩種 runtime 都能跑。`readEnv` 只讀字串值（D1 binding 等非字串 binding 由 `makeDb`
 * 另外處理），故 `process.env` 與 `c.env` 都能當來源傳入。
 */

/** GitHub REST API 設定（供 {@link import("./github").createGithub} 使用）。 */
export interface GithubEnv {
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
}

/** OpenAI 翻譯設定（供 {@link import("./translator").createTranslator} 使用）。 */
export interface OpenAIEnv {
  apiKey: string;
  model: string;
  baseUrl: string;
}

/**
 * Cloudflare R2 設定（供 self-host 的 {@link import("./storage/s3").S3Storage} 使用；
 * Workers 改用原生 R2 binding，僅 `publicUrl` 經此提供）。
 *
 * @remarks 任一欄位缺漏即視為未設定，`S3Storage.isEnabled()` 回 false、上傳功能停用。
 */
export interface R2Env {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  publicUrl?: string;
}

/** 整個應用的設定快照，由 {@link readEnv} 從原始環境變數來源建立。 */
export interface Env {
  github: GithubEnv;
  openai: OpenAIEnv;
  r2: R2Env;
  /** 允許的 CORS 來源清單（已解析 `CORS_ORIGIN`，空值時帶 localhost 開發預設）。 */
  corsOrigins: string[];
  /** prChecker 輪詢間隔（毫秒）；僅 self-host 常駐 process 會用到。 */
  prCheckIntervalMs: number;
  /** 是否為開發模式（`NODE_ENV !== "production"`），控制 verbose log。 */
  isDev: boolean;
}

/**
 * `readEnv` 的原始來源型別：`process.env`（self-host）或 `c.env`（Workers binding 物件）。
 *
 * @remarks 值型別放寬為 `unknown`，因為 Workers 的 `c.env` 同時含字串變數與 D1 等非字串
 * binding；{@link readEnv} 只挑字串欄位讀，非字串 binding 由各 runtime 的 `makeDb` 處理。
 */
export type EnvSource = Record<string, unknown>;

/**
 * 同源部署（Pages → Worker / nginx 同源代理）不觸發 CORS；只有本機開發
 * （vite :5173 → backend :3000）跨來源時才需放行。故 `CORS_ORIGIN` 未設時預設只放行
 * localhost 開發來源，不全開（`*`）。
 */
const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];

/** 從來源取字串值；非字串（含 undefined / binding 物件）一律回 undefined。 */
function readString(source: EnvSource, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * 從原始環境變數來源建立一份 {@link Env} 設定快照。
 *
 * @param source - `process.env`（self-host）或每 request 的 `c.env`（Workers）
 * @returns 已套用預設值、解析過 CORS / 數值的設定物件
 *
 * @remarks
 * 純函數、無 side effect，可重複呼叫。Workers 上必須每 request 呼叫（binding 在 import
 * 期尚未注入）；self-host 可在啟動時呼叫一次後重複使用。
 */
export function readEnv(source: EnvSource): Env {
  const corsRaw = readString(source, "CORS_ORIGIN");
  const corsOrigins = corsRaw
    ? corsRaw.split(",").map((o) => o.trim()).filter(Boolean)
    : DEFAULT_CORS_ORIGINS;

  return {
    github: {
      token: readString(source, "GITHUB_TOKEN") ?? "",
      owner: readString(source, "GITHUB_OWNER") ?? "",
      repo: readString(source, "GITHUB_REPO") ?? "",
      defaultBranch: readString(source, "GITHUB_DEFAULT_BRANCH") ?? "main",
    },
    openai: {
      apiKey: readString(source, "OPENAI_API_KEY") ?? "",
      model: readString(source, "OPENAI_MODEL") ?? "gpt-4o-mini",
      baseUrl: readString(source, "OPENAI_BASE_URL") ?? "https://api.openai.com",
    },
    r2: {
      accountId: readString(source, "R2_ACCOUNT_ID"),
      accessKeyId: readString(source, "R2_ACCESS_KEY_ID"),
      secretAccessKey: readString(source, "R2_SECRET_ACCESS_KEY"),
      bucket: readString(source, "R2_BUCKET"),
      publicUrl: readString(source, "R2_PUBLIC_URL")?.replace(/\/$/, ""),
    },
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : DEFAULT_CORS_ORIGINS,
    prCheckIntervalMs: Number(readString(source, "PR_CHECK_INTERVAL_MS") ?? 60_000),
    isDev: (readString(source, "NODE_ENV") ?? "development") !== "production",
  };
}
