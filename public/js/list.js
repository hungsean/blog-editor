async function loadDrafts() {
  const list = document.getElementById("drafts-list");
  try {
    const res = await fetch("/api/drafts");
    const drafts = await res.json();

    if (drafts.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>還沒有草稿，點擊「新增文章」開始寫吧！</p></div>`;
      return;
    }

    list.innerHTML = `<div class="drafts-grid">${drafts.map(draftCard).join("")}</div>`;

    list.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = `/editor/${btn.dataset.id}`;
      });
    });

    list.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("確定要刪除這篇草稿？")) return;
        await fetch(`/api/drafts/${btn.dataset.id}`, { method: "DELETE" });
        loadDrafts();
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="loading">載入失敗：${e.message}</p>`;
  }
}

function draftCard(d) {
  const date = new Date(d.updated_at).toLocaleString("zh-TW");
  const badge =
    d.status === "pr_opened"
      ? `<span class="badge badge-pr">PR 已開</span>`
      : `<span class="badge badge-draft">草稿</span>`;
  const prLink =
    d.status === "pr_opened" && d.pr_url
      ? `<a href="${d.pr_url}" target="_blank" style="font-size:0.75rem;color:#22c55e">查看 PR →</a>`
      : "";

  return `
    <div class="draft-card">
      <div class="draft-info">
        <div class="draft-title">${escHtml(d.title || "(未命名)")}</div>
        <div class="draft-meta">${badge} ${d.lang} · 更新 ${date} ${prLink}</div>
      </div>
      <div class="draft-actions">
        <button class="btn btn-primary btn-edit" data-id="${d.id}">編輯</button>
        <button class="btn btn-danger btn-delete" data-id="${d.id}">刪除</button>
      </div>
    </div>`;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.getElementById("btn-new").addEventListener("click", async () => {
  const res = await fetch("/api/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const draft = await res.json();
  window.location.href = `/editor/${draft.id}`;
});

loadDrafts();
