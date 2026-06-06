/**
 * ## test/helpers/http
 *
 * route 測試用的精簡 HTTP client：包住 `app.request()`，自動帶 JSON header / 序列化 body，
 * 讓測試讀起來像呼叫 REST API。
 */
import type { Hono } from "hono";

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** 綁定一個 Hono app，回傳 get/post/patch/del 四個發 request 的 helper。 */
export function makeClient(app: Hono) {
  return {
    get: (path: string) => app.request(path),
    post: (path: string, body?: unknown) => app.request(path, jsonInit("POST", body)),
    patch: (path: string, body?: unknown) => app.request(path, jsonInit("PATCH", body)),
    del: (path: string, body?: unknown) => app.request(path, jsonInit("DELETE", body)),
    /** 直接送一個 multipart FormData（測 upload / og / images 用）。 */
    form: (path: string, method: string, form: FormData) =>
      app.request(path, { method, body: form }),
  };
}

export type Client = ReturnType<typeof makeClient>;
