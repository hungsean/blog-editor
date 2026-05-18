## 執行

```sh
bun run dev   # vite --host 0.0.0.0
bun run build # vite build
```

## 技術棧

- **框架**：React 19 + TypeScript
- **打包**：Vite（不是 Bun.serve HTML imports）
- **樣式**：Tailwind CSS v4（透過 @tailwindcss/vite plugin）
- **UI 元件**：shadcn/ui（新增元件用 `bunx shadcn@latest add <component>`）
- **路由**：wouter（輕量，API 類似 react-router）
- **編輯器**：CodeMirror 6（`@codemirror/*`）
- **Preview**：marked + marked-highlight + highlight.js

## 專案架構

```
src/
├── main.tsx              # React 入口，wouter Switch/Route 路由設定
├── styles.css            # 全域樣式（含 .prose markdown preview 樣式）
├── lib/
│   ├── utils.ts          # shadcn/ui 工具函式（cn）
│   └── api/
│       ├── drafts.ts     # fetch/create/update draft API
│       ├── images.ts     # 圖片庫 list/sync/upload API
│       └── presets.ts    # translation presets CRUD API
├── components/
│   ├── ui/               # shadcn/ui 自動產生的元件（勿手動修改）
│   ├── editor/
│   │   ├── MarkdownEditor.tsx     # CodeMirror 6 React wrapper（含上傳圖片工具列）
│   │   ├── MarkdownPreview.tsx    # marked + hljs preview
│   │   ├── ImagePickerDialog.tsx  # 圖片庫挑選對話框（sync / upload / 選圖插入）
│   │   └── FieldsPanel.tsx        # 可折疊的 frontmatter 欄位面板
│   ├── settings/
│   │   ├── PresetSettings.tsx
│   │   ├── PresetForm.tsx
│   │   ├── AddPresetForm.tsx
│   │   └── EditPresetForm.tsx
│   ├── PostCard.tsx      # 單篇草稿卡片
│   ├── PostList.tsx      # 草稿列表容器
│   └── TopBar.tsx        # 頂部操作列（列表頁用）
└── pages/
    ├── list.tsx          # 草稿列表頁（/）
    └── editor.tsx        # 編輯器頁（/editor 新建、/editor/:id 編輯）
```

## Extra fields 設計

Draft 的非標準 frontmatter 欄位（pubDate、nsfw、ogImage）存在 `fields` JSON 字串中，與 backend 一致。`FieldsPanel` 負責解析與序列化這個欄位。
