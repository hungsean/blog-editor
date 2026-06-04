# #04 物件儲存抽象：aws-sdk(S3) ⇄ R2 binding

**Phase B — 後端 Workers 化** ｜ 相依：#03 ｜ 後續：#06（OG 字型 / 暫存檔會用到）

## 背景

目前圖片上傳走 `src/lib/r2.ts`，用 `@aws-sdk/client-s3` 打 R2 的 S3 相容 API。
另有暫存檔（`src/routes/upload.ts` 的 `data/og-temp/`）與 OG 字型快取（`data/fonts/`）
直接用 `Bun.file` / `node:fs` 寫磁碟。Workers **無檔案系統**，且原生 R2 binding 比
aws-sdk 更輕。需要把「物件儲存」與「暫存」抽象成介面，兩環境各自注入實作。

## 目標

- 定義 `Storage` 介面：`put(key, bytes, contentType)`、`get(key)`、`list(prefix)`、`delete(key)`、`publicUrl(key)`。
- self-host 實作：`@aws-sdk/client-s3`（沿用現有 R2 S3 設定）。
- Cloudflare 實作：R2 binding（`env.BUCKET.put/get/list/delete`）。
- 暫存檔（OG temp）從本地磁碟改走 Storage（短 TTL key），移除 `node:fs` 依賴。

## 先確認：`upload.ts` 的 endpoint 可能已廢棄（review 點 7）

已查證前端（`frontend/src/`）目前只呼叫 **`/images/upload`** 與 **`/og/preview`、`/og/upload`**，
**沒有任何 caller 打 `/upload/r2` 或 `/upload/temp`**。

- 若無外部 / 第三方相容需求 → **直接刪除 `src/routes/upload.ts`（整個 `/upload/*`）**，
  連帶 `OG_TEMP_DIR` 的 `node:fs` 暫存邏輯一起移除，Worker 不必再做相容層。這會讓本 issue
  與 #06 都更乾淨（少一塊要去 fs 化的東西）。
- 若確有外部 caller → 才走下面的「改走 Storage」路徑。

**先做這個確認再決定範圍。** 以下影響檔案以「刪除 upload.ts」為預設。

## 影響檔案

- 新增 `src/lib/storage/` — 介面 + 兩個實作。
- `src/lib/r2.ts` — 改為 S3 實作，或併入 storage 模組。
- `src/routes/upload.ts` — **預設刪除**（無前端 caller）；若需保留則改走 Storage。
- `src/routes/images.ts` — `/images/sync`（list）、`/images/upload`（put）改走 Storage。
- `src/routes/og.ts` — `/og/upload` 改走 Storage（與 #06 協調）。
- `src/routes/api.ts` — 移除已刪除路由的 mount。

## 實作步驟

### 共用步驟（兩條路徑都要做）

1. 定義 `Storage` 介面與 `isEnabled()`。
2. `S3Storage`：包現有 aws-sdk 邏輯（`PutObjectCommand` / `ListObjectsV2Command`）。
3. `R2Storage`：用 binding；`publicUrl` 走 `R2_PUBLIC_URL` 或自訂 domain。
4. 由 #03 的 env provider 決定注入哪個實作（依 binding 是否存在）。
5. `images.ts`（`/images/sync` list、`/images/upload` put）、`og.ts`（`/og/upload`）改走 Storage。

### 路徑甲：刪除 `upload.ts`（**預設**，前端無 caller）

6a. 直接刪除 `src/routes/upload.ts` 與 `api.ts` 對它的 mount，連同 `data/og-temp/` 的
    `mkdir`/`unlink`/`readdir`/`Bun.file` 全部移除。**不需要把暫存檔搬上 Storage**。

### 路徑乙：保留 `/upload/temp`（**僅當確認有外部 caller**）

6b. 才需要：`upload/temp` 改成把 bytes `put` 到 `tmp/{token}` key；`:token` 改成 `get`；
    過期清理改用 key 前綴掃描或 R2 object lifecycle rule；移除本地 `node:fs` 暫存。

## 注意 / 地雷

- R2 binding 的 `list` 與 S3 `ListObjectsV2` 回傳結構不同，介面要拉平。
- `images/sync` 依賴列出 `uploads/` 前綴，確認兩實作前綴語意一致。
- self-host 仍想用本機磁碟暫存也可（多一個 `FsStorage` 實作），但預設統一走 R2 較簡單。
- 移除 `@aws-sdk/client-s3` 從 Workers bundle（只在 self-host 路徑 import，避免進 worker bundle）。

## 驗收標準

- [ ] self-host：圖片上傳 / 圖片庫 / OG 上傳功能與現況一致。
- [ ] Workers：以 R2 binding 完成同樣操作，無檔案系統呼叫。
- [ ] 程式碼內無 `data/og-temp/`、`data/fonts/` 之外的本地寫檔（fonts 在 #06 處理）。
- [ ] Workers bundle 不含 `@aws-sdk/client-s3`。
