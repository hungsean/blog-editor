import { Hono } from "hono";
import { html, raw } from "hono/html";

const pages = new Hono();

pages.get("/", (c) => {
  return c.html(listPage());
});

pages.get("/editor", (c) => {
  return c.html(editorPage(null));
});

pages.get("/editor/:id", (c) => {
  return c.html(editorPage(c.req.param("id")));
});

function listPage() {
  return html`<!DOCTYPE html>
<html lang="zh-TW" data-color-mode="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog Editor</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>Blog Editor</h1>
      <div class="header-actions">
        <button id="btn-sync" class="btn btn-secondary">↓ 從 GitHub 同步</button>
        <button id="btn-new" class="btn btn-primary">+ 新增文章</button>
      </div>
    </header>
    <main id="drafts-list">
      <p class="loading">載入中...</p>
    </main>
  </div>

  <!-- Sync Modal -->
  <div id="sync-modal" class="modal-overlay" style="display:none">
    <div class="modal">
      <div class="modal-header">
        <h2>從 GitHub 同步文章</h2>
        <button id="sync-modal-close" class="btn btn-secondary">✕</button>
      </div>
      <div id="sync-modal-body" class="modal-body">
        <p class="loading">載入 GitHub 文章中...</p>
      </div>
      <div class="modal-footer">
        <button id="sync-modal-cancel" class="btn btn-secondary">取消</button>
        <button id="sync-modal-confirm" class="btn btn-primary" disabled>同步選取</button>
      </div>
    </div>
  </div>

  <script src="/js/list.js"></script>
</body>
</html>`;
}

function editorPage(id: string | null) {
  const draftId = id ?? "";
  return html`<!DOCTYPE html>
<html lang="zh-TW" data-color-mode="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog Editor</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div class="container editor-container">
    <header>
      <a href="/" class="back-link">← 返回列表</a>
      <div class="header-actions">
        <span id="save-status" class="save-status"></span>
        <button id="btn-publish" class="btn btn-success">送出 PR</button>
      </div>
    </header>
    <main>
      <div id="fields-form"></div>
      <div class="editor-wrap">
        <div id="md-editor"></div>
        <div id="md-preview" class="markdown-body"></div>
      </div>
    </main>
  </div>
  <script>
    window.__DRAFT_ID__ = ${raw(JSON.stringify(draftId))};
  </script>
  <script src="/js/editor.bundle.js"></script>
</body>
</html>`;
}

export default pages;
