/**
 * `lib/repos/images` 測試：list（uploaded_at DESC）、upsert（同 key 更新）、insert（重複拋錯）。
 */
import { test, expect, beforeEach } from "bun:test";
import { makeTestDb } from "../helpers/makeTestDb";
import type { DrizzleDB } from "../../src/lib/db";
import { listImages, upsertImage, insertImage } from "../../src/lib/repos/images";

let db: DrizzleDB;

beforeEach(() => {
  db = makeTestDb().db;
});

test("listImages 依 uploaded_at DESC", async () => {
  await insertImage(db, { key: "uploads/a.png", url: "u/a", size: 1, uploaded_at: "2026-01-01T00:00:00.000Z" });
  await insertImage(db, { key: "uploads/b.png", url: "u/b", size: 2, uploaded_at: "2026-05-01T00:00:00.000Z" });
  await insertImage(db, { key: "uploads/c.png", url: "u/c", size: 3, uploaded_at: "2026-03-01T00:00:00.000Z" });

  const rows = await listImages(db);
  expect(rows.map((r) => r.key)).toEqual(["uploads/b.png", "uploads/c.png", "uploads/a.png"]);
});

test("upsertImage：同 key 更新 url/size/uploaded_at，不新增重複列", async () => {
  await upsertImage(db, { key: "uploads/x.png", url: "old", size: 10, uploaded_at: "2026-01-01T00:00:00.000Z" });
  await upsertImage(db, { key: "uploads/x.png", url: "new", size: 99, uploaded_at: "2026-02-02T00:00:00.000Z" });

  const rows = await listImages(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.url).toBe("new");
  expect(rows[0]!.size).toBe(99);
  expect(rows[0]!.uploaded_at).toBe("2026-02-02T00:00:00.000Z");
});

test("insertImage：純 INSERT，同 key 第二次插入拋錯（PRIMARY KEY 衝突）", async () => {
  await insertImage(db, { key: "uploads/dup.png", url: "u", size: 1, uploaded_at: "2026-01-01T00:00:00.000Z" });
  await expect(
    insertImage(db, { key: "uploads/dup.png", url: "u2", size: 2, uploaded_at: "2026-01-02T00:00:00.000Z" }),
  ).rejects.toThrow();
});
