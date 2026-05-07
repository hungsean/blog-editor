## 專案概覽

Blog Editor 是一個部落格草稿管理工具，分為兩個獨立的子專案：

- `frontend/` — React + Vite + Tailwind，編輯器 UI
- `backend/` — Bun + Hono，REST API 伺服器

## 注意事項

請勿再對 `/src` 或是 `/public` 進行編輯，此處程式已經過時，請改以 `/frontend`, `/backend`

## Bun 套件管理

兩個子專案都使用 Bun：

- `bun install` 代替 npm/yarn/pnpm install
- `bun run <script>` 代替 npm run
- `bun test` 代替 jest/vitest
- `bunx <package>` 代替 npx
- Bun 自動載入 `.env`，不需要 dotenv

## 文件規範

- 修改任何函式的行為時，必須同步更新該函式的 JSDoc
- `@remarks` 區塊用來記錄 **why**，不只是 what（限制、地雷、設計決策）
- edge case 和注意事項必須寫在最靠近程式碼的地方，不要只放在 README
- 顯而易見的函式（純 getter、簡單映射）不需要 JSDoc
- 架構層級的決策分別記錄在 `frontend/CLAUDE.md` 和 `backend/CLAUDE.md`
