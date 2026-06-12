/**
 * `worker.ts`（Cloudflare Workers 入口）煙霧測試：用一個 bun:sqlite 支撐的 **D1 shim** 當作
 * `c.env.DB` binding，真正跑通 `worker.fetch → installRuntime middleware → createD1Db → route →
 * repo → D1 query` 整條路徑。
 *
 * @remarks
 * reviewer 指出 #03 只有 `wrangler deploy --dry-run` 的 bundle 驗證，沒有任何「真的對 worker 入口
 * 發 request」的測試，mounted 子集（drafts / slug / presets / images）的 runtime 行為等於沒被覆蓋。
 * #04 起 `images` 已去 aws-sdk、改走 `c.var.storage`，故一併掛上並在此煙霧驗證（storage 未綁
 * R2 binding 時 `isEnabled()` 為 false，sync 回 503；純讀 DB 的 `GET /images` 不受影響）。
 *
 * drizzle-orm/d1 對 binding 的呼叫面很小（`prepare(sql).bind(...params)` → `all()` / `run()` /
 * `raw()`，外加 `batch()`），可用 bun:sqlite 完整模擬，因此本檔提供 {@link FakeD1Database} 把
 * in-memory sqlite 包成 D1 介面，讓 worker 入口能在測試行程內真實處理請求——這比 dry-run bundle
 * 更強的 #03 收尾證據。完整 worker（含 upload/og + nodejs_compat）仍待 #04 / #06 / #07。
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations, createBunSqliteDb } from "../src/lib/db.bun";
import { createPreset, listPresets } from "../src/lib/repos/presets";
import worker from "../worker";

/** drizzle-orm/d1 用到的 D1PreparedStatement 子集，以 bun:sqlite 為後端。 */
class FakeD1PreparedStatement {
  constructor(
    private readonly sqlite: Database,
    private readonly query: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.sqlite, this.query, params);
  }

  /** drizzle 取「物件列」的路徑（select / insert returning）。 */
  async all(): Promise<{ results: unknown[]; success: true; meta: Record<string, unknown> }> {
    const results = this.sqlite.query(this.query).all(...(this.params as never[]));
    return { results, success: true, meta: {} };
  }

  /** drizzle 寫入（無 returning）的路徑。 */
  async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
    this.sqlite.query(this.query).run(...(this.params as never[]));
    return { success: true, meta: {} };
  }

  /** drizzle 取「陣列列（依欄位順序）」的路徑。 */
  async raw(): Promise<unknown[]> {
    return this.sqlite.query(this.query).values(...(this.params as never[]));
  }

  async first(colName?: string): Promise<unknown> {
    const row = this.sqlite.query(this.query).get(...(this.params as never[])) as Record<string, unknown> | null;
    if (!row) return null;
    return colName ? row[colName] : row;
  }
}

/** drizzle-orm/d1 用到的 D1Database 子集，以 bun:sqlite 為後端。 */
class FakeD1Database {
  constructor(private readonly sqlite: Database) {}
  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.sqlite, query);
  }
  async batch(statements: FakeD1PreparedStatement[]): Promise<unknown[]> {
    return Promise.all(statements.map((s) => s.all()));
  }
  async exec(query: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(query);
    return { count: 0, duration: 0 };
  }
  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

let sqlite: Database;
/** worker.fetch 的第二參數（Workers bindings）：含 D1 shim 與字串環境變數。 */
let env: { DB: FakeD1Database; [k: string]: unknown };

/** 對 worker 入口發一個 JSON 請求（帶上 D1 binding 當 env）。 */
async function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`http://worker.test${path}`, init), env as never);
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  runMigrations(sqlite);
  env = { DB: new FakeD1Database(sqlite) };
});

describe("worker 入口：D1 binding 真實處理請求", () => {
  test("GET /api/presets 透過 D1 shim 讀回 seed 資料", async () => {
    // 用 bun-sqlite drizzle 寫入同一條 in-memory 連線，再經 worker（D1 shim）讀回。
    const now = "2026-06-09T00:00:00.000Z";
    await createPreset(createBunSqliteDb(sqlite), {
      id: "p1",
      keywords: JSON.stringify(["k"]),
      translations: JSON.stringify({ en: "v" }),
      note: "",
      created_at: now,
      updated_at: now,
    });

    const res = await fetchWorker("/api/presets");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("p1");
  });

  test("POST /api/presets 透過 D1 shim 寫入並回傳建立結果", async () => {
    const res = await fetchWorker("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: ["hello"], translations: { en: "hi" }, note: "n" }),
    });
    expect(res.status).toBe(201);

    // 寫入確實落到底層 sqlite（用獨立的 bun-sqlite drizzle 驗證）。
    const rows = await listPresets(createBunSqliteDb(sqlite));
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.keywords)).toEqual(["hello"]);
  });

  test("GET /api/slug 缺 slug 參數回 400（middleware + route 正常掛載）", async () => {
    const res = await fetchWorker("/api/slug");
    expect(res.status).toBe(400);
  });

  test("GET /api/images 經 D1 shim 讀回空圖片庫（images 已掛載、純讀 DB 不碰 storage）", async () => {
    const res = await fetchWorker("/api/images");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("POST /api/images/sync 未綁 R2 binding 時回 503（makeStorage 注入、isEnabled=false）", async () => {
    const res = await fetchWorker("/api/images/sync", { method: "POST" });
    expect(res.status).toBe(503);
  });

  test("未掛載的路由回 404", async () => {
    const res = await fetchWorker("/api/nope");
    expect(res.status).toBe(404);
  });
});
