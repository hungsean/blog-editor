/**
 * `lib/repos/presets` 測試：translation_presets 的 CRUD 與 updated_at DESC 列表排序。
 */
import { test, expect, beforeEach } from "bun:test";
import { makeTestDb } from "../helpers/makeTestDb";
import type { DrizzleDB } from "../../src/lib/db";
import type { NewTranslationPreset } from "../../src/lib/schema";
import {
  listPresets,
  getPresetById,
  createPreset,
  updatePreset,
  deletePreset,
} from "../../src/lib/repos/presets";

let db: DrizzleDB;

beforeEach(() => {
  db = makeTestDb().db;
});

let seq = 0;
function presetValues(over: Partial<NewTranslationPreset> = {}): NewTranslationPreset {
  const now = "2026-01-01T00:00:00.000Z";
  seq += 1;
  return {
    id: `p${seq}`,
    keywords: JSON.stringify(["kw"]),
    translations: JSON.stringify({ en: "KW" }),
    note: "",
    created_at: now,
    updated_at: now,
    ...over,
  };
}

test("createPreset 回傳完整列，getPresetById 取回", async () => {
  const created = await createPreset(db, presetValues({ id: "x1", note: "hello" }));
  expect(created.id).toBe("x1");
  expect(created.note).toBe("hello");
  expect((await getPresetById(db, "x1"))!.note).toBe("hello");
});

test("getPresetById 不存在回傳 null", async () => {
  expect(await getPresetById(db, "missing")).toBeNull();
});

test("updatePreset 局部更新並回傳；不存在回傳 null", async () => {
  await createPreset(db, presetValues({ id: "u1", note: "old" }));
  const updated = await updatePreset(db, "u1", { note: "new", updated_at: "2026-02-02T00:00:00.000Z" });
  expect(updated!.note).toBe("new");
  expect(updated!.updated_at).toBe("2026-02-02T00:00:00.000Z");
  expect(await updatePreset(db, "missing", { note: "x" })).toBeNull();
});

test("deletePreset 回傳是否刪到", async () => {
  await createPreset(db, presetValues({ id: "d1" }));
  expect(await deletePreset(db, "d1")).toBe(true);
  expect(await deletePreset(db, "d1")).toBe(false);
  expect(await getPresetById(db, "d1")).toBeNull();
});

test("listPresets 依 updated_at DESC", async () => {
  await createPreset(db, presetValues({ id: "a", updated_at: "2026-01-01T00:00:00.000Z" }));
  await createPreset(db, presetValues({ id: "b", updated_at: "2026-05-01T00:00:00.000Z" }));
  await createPreset(db, presetValues({ id: "c", updated_at: "2026-03-01T00:00:00.000Z" }));

  const rows = await listPresets(db);
  expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
});
