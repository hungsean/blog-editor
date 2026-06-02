# #08 前端上 Cloudflare Pages 與部署收尾

**Phase C — 前端** ｜ 相依：#07 ｜ 後續：無（收尾）

## 背景

前端是純 React 19 + Vite 7 SPA，`bun run build` 產出靜態 `dist/`。目前用 nginx 提供
靜態檔並反向代理 `/api`。搬上 Pages 幾乎零改動，重點是讓 `/api` 同源轉發到 #07 部署的
Worker，並完成整體部署文件與 self-host 路徑的保留。

## 目標

- 前端部署到 Pages。
- `/api/*` 同源轉發到 Worker（免 CORS）。
- 整理雙環境部署文件；self-host 的 docker 路徑保留可用。

## 實作步驟

1. **Pages 設定**
   - build command：`cd frontend && bun install && bun run build`，輸出 `frontend/dist`。
   - SPA fallback：Pages 內建（所有未命中路由回 `index.html`）。
2. **/api 轉發**（擇一）
   - Pages → Worker 用 **Service binding** 或 `_routes.json` + 同 domain 路由，
     讓 `/api/*` 走 Worker；前端維持相對路徑（`VITE_API_URL` 留空）。
   - 或前端打 Worker 的 custom domain（需設 CORS，較不推薦）。
3. **環境變數**：Pages 上 `VITE_API_URL` 留空走同源；保留 `.env.example` 給 self-host。
4. **self-host 保留**
   - `docker-compose.yml` / nginx / 兩個 Dockerfile 仍可用於 self-host；
     在 README 標明這是 self-host 路徑，Cloudflare 路徑不需要它們。
5. **文件**（呼應 EPIC 的 DoD）
   - 根 `README` / `CLAUDE.md` 補：兩種部署方式、所需 binding / secrets / env、
     migration 指令、字型上傳步驟。

## 注意 / 地雷

- Cloudflare Access 可掛在 Pages 前面控管存取，沿用現有部署思路。
- 確認前端所有 API 呼叫都走 `VITE_API_URL` 前綴（grep `fetch(`），無寫死的 localhost。
- Pages 與 Worker 同 domain 時最乾淨；跨 domain 才需回頭開 CORS（#03 的 env provider 已可控）。

## 驗收標準

- [ ] 前端在 Pages 上線，路由 / 重整 / 深連結正常（SPA fallback）。
- [ ] `/api` 同源轉發到 Worker，瀏覽器無 CORS 錯誤。
- [ ] self-host（docker compose）仍能完整跑起來。
- [ ] README 同時說明 self-host 與 Cloudflare 兩種部署。
