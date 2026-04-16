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

    list.querySelectorAll(".btn-resync").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("確定要從 GitHub 重新同步？本地的修改將被覆蓋。")) return;
        btn.disabled = true;
        btn.textContent = "同步中...";
        try {
          const res = await fetch(`/api/drafts/${btn.dataset.id}/resync`, { method: "POST" });
          if (res.ok) {
            loadDrafts();
          } else {
            const data = await res.json();
            alert(`同步失敗：${data.error}`);
            btn.disabled = false;
            btn.textContent = "重新同步";
          }
        } catch (e) {
          alert(`同步失敗：${e.message}`);
          btn.disabled = false;
          btn.textContent = "重新同步";
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="loading">載入失敗：${e.message}</p>`;
  }
}

function draftCard(d) {
  const date = new Date(d.updated_at).toLocaleString("zh-TW");
  const statusBadge =
    d.status === "pr_opened"
      ? `<span class="badge badge-pr">PR 已開</span>`
      : `<span class="badge badge-draft">草稿</span>`;
  const sourceBadge = d.source === "github"
    ? `<span class="badge badge-github">GitHub</span>`
    : "";
  const prLink =
    d.status === "pr_opened" && d.pr_url
      ? `<a href="${d.pr_url}" target="_blank" style="font-size:0.75rem;color:#22c55e">查看 PR →</a>`
      : "";
  const resyncBtn = d.source === "github"
    ? `<button class="btn btn-secondary btn-resync" data-id="${d.id}" style="font-size:0.75rem;padding:0.2rem 0.5rem">重新同步</button>`
    : "";

  return `
    <div class="draft-card">
      <div class="draft-info">
        <div class="draft-title">${escHtml(d.title || "(未命名)")}</div>
        <div class="draft-meta">${statusBadge} ${sourceBadge} ${d.lang} · 更新 ${date} ${prLink}</div>
      </div>
      <div class="draft-actions">
        ${resyncBtn}
        <button class="btn btn-primary btn-edit" data-id="${d.id}">編輯</button>
        <button class="btn btn-danger btn-delete" data-id="${d.id}">刪除</button>
      </div>
    </div>`;
}

function escHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// ── New article ──────────────────────────────────────────────────────────────

document.getElementById("btn-new").addEventListener("click", async () => {
  const res = await fetch("/api/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const draft = await res.json();
  window.location.href = `/editor/${draft.id}`;
});

// ── Sync modal ───────────────────────────────────────────────────────────────

const syncModal = document.getElementById("sync-modal");
const syncModalBody = document.getElementById("sync-modal-body");
const syncModalConfirm = document.getElementById("sync-modal-confirm");

function openSyncModal() {
  syncModal.style.display = "flex";
  syncModalConfirm.disabled = true;
  syncModalBody.innerHTML = `<p class="loading">載入 GitHub 文章中...</p>`;
  loadGithubPosts();
}

function closeSyncModal() {
  syncModal.style.display = "none";
}

document.getElementById("btn-sync").addEventListener("click", openSyncModal);
document.getElementById("sync-modal-close").addEventListener("click", closeSyncModal);
document.getElementById("sync-modal-cancel").addEventListener("click", closeSyncModal);
syncModal.addEventListener("click", (e) => { if (e.target === syncModal) closeSyncModal(); });

async function loadGithubPosts() {
  try {
    const posts = await fetch("/api/github/posts").then((r) => r.json());
    if (posts.error) throw new Error(posts.error);

    if (posts.length === 0) {
      syncModalBody.innerHTML = `<p class="loading">GitHub 上沒有找到文章。</p>`;
      return;
    }

    const rows = posts.map((p) => {
      const filename = p.path.split("/").pop();
      const syncedLabel = p.synced
        ? `<span class="badge badge-github" style="font-size:0.7rem">已同步</span>`
        : "";
      return `
        <label class="sync-row">
          <input type="checkbox" class="sync-check" value="${escHtml(p.path)}" data-sha="${escHtml(p.sha)}">
          <span class="sync-path">
            <span class="sync-filename">${escHtml(filename)}</span>
            <span class="sync-fullpath">${escHtml(p.path)}</span>
          </span>
          ${syncedLabel}
        </label>`;
    }).join("");

    syncModalBody.innerHTML = `
      <div class="sync-select-all-wrap">
        <label><input type="checkbox" id="sync-select-all"> 全選</label>
        <small style="color:#888">${posts.length} 篇文章</small>
      </div>
      <div class="sync-list">${rows}</div>`;

    document.getElementById("sync-select-all").addEventListener("change", (e) => {
      syncModalBody.querySelectorAll(".sync-check").forEach((cb) => { cb.checked = e.target.checked; });
      updateSyncConfirmBtn();
    });

    syncModalBody.querySelectorAll(".sync-check").forEach((cb) => {
      cb.addEventListener("change", updateSyncConfirmBtn);
    });

    updateSyncConfirmBtn();
  } catch (e) {
    syncModalBody.innerHTML = `<p class="loading">載入失敗：${escHtml(e.message)}</p>`;
  }
}

function updateSyncConfirmBtn() {
  const checked = syncModalBody.querySelectorAll(".sync-check:checked").length;
  syncModalConfirm.disabled = checked === 0;
  syncModalConfirm.textContent = checked > 0 ? `同步選取 (${checked})` : "同步選取";
}

syncModalConfirm.addEventListener("click", async () => {
  const paths = [...syncModalBody.querySelectorAll(".sync-check:checked")].map((cb) => cb.value);
  if (paths.length === 0) return;

  syncModalConfirm.disabled = true;
  syncModalConfirm.textContent = "同步中...";

  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    const data = await res.json();

    const importedCount = data.imported?.length ?? 0;
    const updatedCount = data.updated?.length ?? 0;
    const errorCount = data.errors?.length ?? 0;

    let msg = `同步完成！新匯入 ${importedCount} 篇，更新 ${updatedCount} 篇。`;
    if (errorCount > 0) msg += `\n錯誤 ${errorCount} 篇：\n${data.errors.join("\n")}`;
    alert(msg);

    closeSyncModal();
    loadDrafts();
  } catch (e) {
    alert(`同步失敗：${e.message}`);
    syncModalConfirm.disabled = false;
    updateSyncConfirmBtn();
  }
});

loadDrafts();
