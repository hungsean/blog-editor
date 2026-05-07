## 執行

```sh
bun run dev   # vite --host 0.0.0.0
bun run build # vite build
```

## 技術棧

- **框架**：React 19 + TypeScript
- **打包**：Vite（不是 Bun.serve HTML imports）
- **樣式**：Tailwind CSS v4（透過 @tailwindcss/vite plugin）

## 專案架構

```
src/
├── main.tsx              # React 入口，router 設定
├── styles.css            # 全域樣式
├── components/
│   ├── PostCard.tsx      # 單篇草稿卡片
│   ├── PostList.tsx      # 草稿列表容器
│   └── TopBar.tsx        # 頂部操作列
└── pages/
    └── list.tsx          # 草稿列表頁
```
