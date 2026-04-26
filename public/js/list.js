let selectMode = false;
const selectedIds = new Set();

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
    attachCardListeners(list, drafts);
  } catch (e) {
    list.innerHTML = `<p class="loading">載入失敗：${e.message}</p>`;
  }
}

function attachCardListeners(list, drafts) {
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

  // Select mode: checkbox listeners
  list.querySelectorAll(".draft-select-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selectedIds.add(cb.dataset.id);
        cb.closest(".draft-card").classList.add("selected");
      } else {
        selectedIds.delete(cb.dataset.id);
        cb.closest(".draft-card").classList.remove("selected");
      }
      updateBatchBar();
    });
  });

  applySelectModeUI();
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

  const isChecked = selectedIds.has(d.id) ? "checked" : "";
  const selectedClass = selectedIds.has(d.id) ? " selected" : "";

  return `
    <div class="draft-card${selectedClass}" data-id="${d.id}">
      <label class="draft-select-wrap" style="display:none">
        <input type="checkbox" class="draft-select-cb" data-id="${d.id}" ${isChecked}>
      </label>
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

// ── Select mode ──────────────────────────────────────────────────────────────

function applySelectModeUI() {
  const list = document.getElementById("drafts-list");
  const checkboxes = list.querySelectorAll(".draft-select-wrap");
  const actionBtns = list.querySelectorAll(".draft-actions");

  if (selectMode) {
    checkboxes.forEach((el) => { el.style.display = "flex"; });
    actionBtns.forEach((el) => { el.style.display = "none"; });
  } else {
    checkboxes.forEach((el) => { el.style.display = "none"; });
    actionBtns.forEach((el) => { el.style.display = "flex"; });
  }
}

function updateBatchBar() {
  const count = selectedIds.size;
  document.getElementById("batch-count").textContent = `已選取 ${count} 篇`;
  document.getElementById("batch-submit").disabled = count === 0;
  document.getElementById("batch-delete").disabled = count === 0;
}

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  document.getElementById("btn-select-mode").textContent = "✕ 取消選取";
  document.getElementById("btn-select-mode").classList.add("btn-active");
  document.getElementById("batch-bar").style.display = "flex";
  updateBatchBar();
  applySelectModeUI();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  document.getElementById("btn-select-mode").textContent = "☑ 選取模式";
  document.getElementById("btn-select-mode").classList.remove("btn-active");
  document.getElementById("batch-bar").style.display = "none";
  const submitBtn = document.getElementById("batch-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "一起送 PR";
  const deleteBtn = document.getElementById("batch-delete");
  deleteBtn.disabled = true;
  deleteBtn.textContent = "批量刪除";
  document.querySelectorAll(".draft-select-cb").forEach((cb) => { cb.checked = false; });
  document.querySelectorAll(".draft-card.selected").forEach((el) => { el.classList.remove("selected"); });
  applySelectModeUI();
}

document.getElementById("btn-select-mode").addEventListener("click", () => {
  if (selectMode) exitSelectMode();
  else enterSelectMode();
});

document.getElementById("batch-cancel").addEventListener("click", exitSelectMode);

document.getElementById("batch-delete").addEventListener("click", async () => {
  const draftIds = [...selectedIds];
  if (draftIds.length === 0) return;

  if (!confirm(`確定要刪除選取的 ${draftIds.length} 篇文章？`)) return;
  if (!confirm(`再次確認：這個動作無法復原，將永久刪除這 ${draftIds.length} 篇文章，確定嗎？`)) return;

  const deleteBtn = document.getElementById("batch-delete");
  deleteBtn.disabled = true;
  deleteBtn.textContent = "刪除中...";

  try {
    const res = await fetch("/api/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(`刪除失敗：${data.error}`);
      deleteBtn.disabled = false;
      deleteBtn.textContent = "批量刪除";
      return;
    }

    exitSelectMode();
    loadDrafts();
  } catch (e) {
    alert(`刪除失敗：${e.message}`);
    deleteBtn.disabled = false;
    deleteBtn.textContent = "批量刪除";
  }
});

document.getElementById("batch-submit").addEventListener("click", async () => {
  const draftIds = [...selectedIds];
  if (draftIds.length === 0) return;
  if (!confirm(`確定要將選取的 ${draftIds.length} 篇文章一起送出 PR？`)) return;

  const submitBtn = document.getElementById("batch-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "送出中...";

  try {
    const res = await fetch("/api/batch-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(`送出失敗：${data.error}`);
      submitBtn.disabled = false;
      submitBtn.textContent = "一起送 PR";
      return;
    }

    alert(`成功！已開啟 PR，包含 ${data.count} 篇文章。`);
    if (data.pr_url) window.open(data.pr_url, "_blank");
    exitSelectMode();
    loadDrafts();
  } catch (e) {
    alert(`送出失敗：${e.message}`);
    submitBtn.disabled = false;
    submitBtn.textContent = "一起送 PR";
  }
});

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
        <label class="sync-row${p.synced ? " sync-row-synced" : ""}">
          <input type="checkbox" class="sync-check" value="${escHtml(p.path)}" data-sha="${escHtml(p.sha)}"${p.synced ? " disabled" : ""}>
          <span class="sync-path">
            <span class="sync-filename">${escHtml(filename)}</span>
            <span class="sync-fullpath">${escHtml(p.path)}</span>
          </span>
          ${syncedLabel}
        </label>`;
    }).join("");

    const unsynced = posts.filter((p) => !p.synced).length;
    syncModalBody.innerHTML = `
      <div class="sync-select-all-wrap">
        <label><input type="checkbox" id="sync-select-all"> 全選</label>
        <small style="color:#888">${unsynced} 篇未同步 / 共 ${posts.length} 篇</small>
      </div>
      <div class="sync-list">${rows}</div>`;

    document.getElementById("sync-select-all").addEventListener("change", (e) => {
      syncModalBody.querySelectorAll(".sync-check:not(:disabled)").forEach((cb) => { cb.checked = e.target.checked; });
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

// ── Settings modal ────────────────────────────────────────────────────────────

const settingsModal = document.getElementById("settings-modal");
let editingPresetId = null;
let presetsData = [];

function openSettingsModal() {
  settingsModal.style.display = "flex";
  loadPresets();
}

function closeSettingsModal() {
  settingsModal.style.display = "none";
  hidePresetForm();
}

document.getElementById("btn-settings").addEventListener("click", openSettingsModal);
document.getElementById("settings-modal-close").addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettingsModal(); });

// ── Presets list ──────────────────────────────────────────────────────────────

async function loadPresets() {
  const listEl = document.getElementById("presets-list");
  listEl.innerHTML = `<p class="loading">載入中...</p>`;
  try {
    const res = await fetch("/api/presets");
    presetsData = await res.json();
    renderPresetsList();
  } catch (e) {
    listEl.innerHTML = `<p class="loading">載入失敗：${escHtml(e.message)}</p>`;
  }
}

function renderPresetsList() {
  const listEl = document.getElementById("presets-list");
  if (presetsData.length === 0) {
    listEl.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;padding:12px 0">尚未設定任何常用翻譯。</p>`;
    return;
  }
  listEl.innerHTML = presetsData.map(presetItemHtml).join("");
  document.querySelectorAll(".btn-preset-edit").forEach((btn) => {
    btn.addEventListener("click", () => openPresetForm(btn.dataset.id));
  });
  document.querySelectorAll(".btn-preset-delete").forEach((btn) => {
    btn.addEventListener("click", () => deletePreset(btn.dataset.id));
  });
}

function presetItemHtml(p) {
  const keywords = JSON.parse(p.keywords || "[]");
  const translations = JSON.parse(p.translations || "{}");
  const langs = ["zh-tw", "en", "ja"];
  const transText = langs
    .filter((l) => translations[l])
    .map((l) => `${l}: ${escHtml(translations[l])}`)
    .join(" · ");
  const kwChips = keywords.map((k) => `<span class="preset-keyword-chip">${escHtml(k)}</span>`).join("");
  return `
    <div class="preset-item" data-id="${p.id}">
      <div class="preset-item-info">
        <div class="preset-keywords">${kwChips}</div>
        ${transText ? `<div class="preset-translations">${transText}</div>` : ""}
        ${p.note ? `<div class="preset-note">${escHtml(p.note)}</div>` : ""}
      </div>
      <div class="preset-item-actions">
        <button class="btn btn-secondary btn-preset-edit" data-id="${p.id}" style="font-size:0.75rem;padding:4px 10px">編輯</button>
        <button class="btn btn-danger btn-preset-delete" data-id="${p.id}" style="font-size:0.75rem;padding:4px 10px">刪除</button>
      </div>
    </div>`;
}

// ── Preset form ───────────────────────────────────────────────────────────────

function openPresetForm(presetId = null) {
  editingPresetId = presetId;
  resetPresetForm();
  if (presetId) {
    const preset = presetsData.find((p) => p.id === presetId);
    if (preset) populatePresetForm(preset);
  }
  document.getElementById("preset-form-wrap").style.display = "block";
  document.getElementById("preset-keywords-input").focus();
}

function hidePresetForm() {
  document.getElementById("preset-form-wrap").style.display = "none";
  resetPresetForm();
  editingPresetId = null;
}

function resetPresetForm() {
  const wrap = document.getElementById("preset-keywords-wrap");
  wrap.querySelectorAll(".tag-chip").forEach((el) => el.remove());
  document.getElementById("preset-keywords-input").value = "";
  document.getElementById("preset-trans-zh-tw").value = "";
  document.getElementById("preset-trans-en").value = "";
  document.getElementById("preset-trans-ja").value = "";
  document.getElementById("preset-note").value = "";
}

function populatePresetForm(preset) {
  const keywords = JSON.parse(preset.keywords || "[]");
  const translations = JSON.parse(preset.translations || "{}");
  const wrap = document.getElementById("preset-keywords-wrap");
  const input = document.getElementById("preset-keywords-input");
  keywords.forEach((kw) => {
    const chip = createPresetKeywordChip(kw);
    wrap.insertBefore(chip, input);
  });
  document.getElementById("preset-trans-zh-tw").value = translations["zh-tw"] || "";
  document.getElementById("preset-trans-en").value = translations["en"] || "";
  document.getElementById("preset-trans-ja").value = translations["ja"] || "";
  document.getElementById("preset-note").value = preset.note || "";
}

function createPresetKeywordChip(kw) {
  const span = document.createElement("span");
  span.className = "tag-chip";
  span.textContent = kw;
  const btn = document.createElement("button");
  btn.className = "tag-chip-remove";
  btn.textContent = "×";
  btn.addEventListener("click", () => span.remove());
  span.appendChild(btn);
  return span;
}

// Keywords tag input
(function initPresetKeywordsInput() {
  const wrap = document.getElementById("preset-keywords-wrap");
  const input = document.getElementById("preset-keywords-input");

  function commitKeyword() {
    const val = input.value.replaceAll(",", "").trim();
    if (!val) return;
    input.value = "";
    wrap.insertBefore(createPresetKeywordChip(val), input);
  }

  input.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && !e.isComposing) {
      e.preventDefault();
      commitKeyword();
    } else if (e.key === "Backspace" && !input.value) {
      const chips = wrap.querySelectorAll(".tag-chip");
      if (chips.length) chips[chips.length - 1].remove();
    }
  });
  input.addEventListener("blur", () => commitKeyword());
})();

function getPresetFormData() {
  const wrap = document.getElementById("preset-keywords-wrap");
  const keywords = [...wrap.querySelectorAll(".tag-chip")]
    .map((el) => el.childNodes[0].textContent.trim())
    .filter(Boolean);
  const translations = {};
  const zhVal = document.getElementById("preset-trans-zh-tw").value.trim();
  const enVal = document.getElementById("preset-trans-en").value.trim();
  const jaVal = document.getElementById("preset-trans-ja").value.trim();
  if (zhVal) translations["zh-tw"] = zhVal;
  if (enVal) translations["en"] = enVal;
  if (jaVal) translations["ja"] = jaVal;
  const note = document.getElementById("preset-note").value.trim();
  return { keywords, translations, note };
}

document.getElementById("btn-add-preset").addEventListener("click", () => openPresetForm(null));
document.getElementById("btn-preset-cancel").addEventListener("click", hidePresetForm);

document.getElementById("btn-preset-save").addEventListener("click", async () => {
  const data = getPresetFormData();
  if (data.keywords.length === 0) {
    alert("請至少輸入一個關鍵字。");
    return;
  }
  const saveBtn = document.getElementById("btn-preset-save");
  saveBtn.disabled = true;
  saveBtn.textContent = "儲存中...";
  try {
    const url = editingPresetId ? `/api/presets/${editingPresetId}` : "/api/presets";
    const method = editingPresetId ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(`儲存失敗：${err.error}`);
      return;
    }
    hidePresetForm();
    await loadPresets();
  } catch (e) {
    alert(`儲存失敗：${e.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "儲存";
  }
});

async function deletePreset(id) {
  if (!confirm("確定要刪除這個常用翻譯？")) return;
  try {
    const res = await fetch(`/api/presets/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(`刪除失敗：${err.error}`);
      return;
    }
    await loadPresets();
  } catch (e) {
    alert(`刪除失敗：${e.message}`);
  }
}
