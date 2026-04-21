import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import flatpickr from 'flatpickr'

marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  }
}))

// Hardcoded extra fields (everything except title / lang / slug / description / tags)
const EXTRA_FIELDS = [
  { key: "pubDate", type: "date", required: true },
  { key: "nsfw", type: "boolean", default: false },
];

function slugifyClient(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

let draftId = globalThis.__DRAFT_ID__;
let draft = null;
let translations = []; // [{id, lang, title, status}]
let aiTranslationEnabled = false;
let cmView = null;
let previewEl = null;
let mdContent = "";
let saveTimer = null;
let saving = false;

const saveStatus = document.getElementById("save-status");
const btnPublish = document.getElementById("btn-publish");
const fieldsForm = document.getElementById("fields-form");
const fieldsPanel = document.getElementById("fields-panel");
const fieldsToggle = document.getElementById("fields-toggle");

fieldsToggle?.addEventListener("click", () => {
  const collapsed = fieldsPanel.dataset.collapsed === "true";
  fieldsPanel.dataset.collapsed = collapsed ? "false" : "true";
  fieldsToggle.setAttribute("aria-expanded", collapsed ? "true" : "false");
});

async function init() {
  [draft] = await Promise.all([
    draftId
      ? fetch(`/api/drafts/${draftId}`).then((r) => r.json())
      : Promise.resolve(null),
    fetch("/api/translation-status")
      .then((r) => r.json())
      .then((d) => { aiTranslationEnabled = d.enabled; })
      .catch(() => {}),
  ]);

  if (!draftId || !draft || draft.error) {
    const res = await fetch("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    draft = await res.json();
    draftId = draft.id;
    history.replaceState(null, "", `/editor/${draftId}`);
  }

  await loadTranslations();
  renderFields();
  initEditor();
  updatePublishButton();
  renderGithubSourceInfo();

  btnPublish.addEventListener("click", publish);
}

async function loadTranslations() {
  if (!draftId) return;
  try {
    const res = await fetch(`/api/drafts/${draftId}/translations`);
    if (res.ok) translations = await res.json();
  } catch { /* ignore */ }
}

function renderFields() {
  const extraFields = JSON.parse(draft.fields || "{}");
  const rows = EXTRA_FIELDS.map((f) => renderField(f, extraFields[f.key]));
  const currentLang = draft.lang || "zh-tw";

  fieldsForm.innerHTML = `
    ${renderTextField({ key: "title", label: "標題", required: true }, draft.title)}
    ${renderSlugField(draft.slug, draft.title)}
    ${renderLangField(currentLang)}
    ${renderTextField({ key: "description", label: "描述" }, draft.description)}
    ${renderTagsField(JSON.parse(draft.tags || "[]"))}
    ${rows.join("")}
    ${renderTranslationSection(currentLang)}
  `;

  // Wire up all simple inputs except title (handled separately for slug sync)
  fieldsForm.querySelectorAll("input[data-key], select[data-key]").forEach((el) => {
    if (el.dataset.key === "title" || el.dataset.key === "slug") return;
    el.addEventListener("input", scheduleSave);
  });

  // Title → slug auto-sync
  const titleEl = fieldsForm.querySelector('[data-key="title"]');
  const slugEl = fieldsForm.querySelector('[data-key="slug"]');
  let prevDerived = slugifyClient(draft.title || "");
  titleEl?.addEventListener("input", () => {
    const newDerived = slugifyClient(titleEl.value);
    if (slugEl && slugEl.value === prevDerived) slugEl.value = newDerived;
    prevDerived = newDerived;
    scheduleSave();
  });
  slugEl?.addEventListener("input", scheduleSave);

  document.getElementById("btn-reset-slug")?.addEventListener("click", () => {
    if (slugEl && titleEl) { slugEl.value = slugifyClient(titleEl.value); scheduleSave(); }
  });

  // AI translation buttons
  fieldsForm.querySelectorAll(".btn-ai-translate").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetLang = btn.dataset.lang;
      if (!confirm(`確定要使用 AI 自動翻譯為 ${targetLang}？`)) return;
      clearTimeout(saveTimer);
      await autoSave();
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = "翻譯中...";
      try {
        const res = await fetch(`/api/drafts/${draftId}/ai-translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetLang }),
        });
        const data = await res.json();
        if (data.id) {
          window.location.href = `/editor/${data.id}`;
        } else {
          alert(`翻譯失敗：${data.error}`);
          btn.disabled = false;
          btn.textContent = origText;
        }
      } catch (e) {
        alert(`翻譯失敗：${e.message}`);
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  });

  // Plain copy translation buttons
  fieldsForm.querySelectorAll(".btn-create-translation").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetLang = btn.dataset.lang;
      if (!confirm(`確定要建立 ${targetLang} 翻譯版本？內容將從目前草稿複製。`)) return;
      clearTimeout(saveTimer);
      await autoSave();
      btn.disabled = true;
      btn.textContent = "建立中...";
      try {
        const res = await fetch(`/api/drafts/${draftId}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetLang }),
        });
        const data = await res.json();
        if (data.id) {
          window.location.href = `/editor/${data.id}`;
        } else {
          alert(`建立失敗：${data.error}`);
          btn.disabled = false;
          btn.textContent = `+ ${targetLang} 版`;
        }
      } catch (e) {
        alert(`建立失敗：${e.message}`);
        btn.disabled = false;
      }
    });
  });

  initTagsInput();
  initDatePickers();
}

function renderSlugField(slug, title) {
  const val = slug || slugifyClient(title || "");
  return `
    <div class="field-group">
      <label>Slug <small style="color:#666">(URL 識別碼，翻譯版本共用)</small></label>
      <div style="display:flex;gap:0.5rem">
        <input type="text" data-key="slug" value="${escAttr(val)}" placeholder="自動從標題產生" style="flex:1">
        <button type="button" id="btn-reset-slug" class="btn btn-secondary" style="white-space:nowrap;font-size:0.8rem;padding:0 0.6rem">重設</button>
      </div>
    </div>`;
}

function renderTranslationSection(currentLang) {
  const LANGS = [
    { value: "zh-tw", label: "繁中 (zh-tw)" },
    { value: "en",    label: "English (en)" },
    { value: "ja",    label: "日本語 (ja)" },
  ];
  const others = LANGS.filter((l) => l.value !== currentLang);
  const existingMap = Object.fromEntries(translations.map((t) => [t.lang, t]));

  const items = others.map((l) => {
    const existing = existingMap[l.value];
    if (existing) {
      const statusDot = existing.status === "pr_opened"
        ? `<span style="color:#22c55e">●</span> `
        : `<span style="color:#888">●</span> `;
      return `<a href="/editor/${existing.id}" class="btn btn-filled" style="font-size:0.8rem;text-decoration:none">
        ${statusDot}${escHtml(l.label)} →
      </a>`;
    }
    if (aiTranslationEnabled) {
      return `<span style="display:inline-flex;gap:0.25rem;align-items:center">
        <button type="button" class="btn btn-primary btn-ai-translate" data-lang="${l.value}" style="font-size:0.8rem" title="使用 AI 自動翻譯">
          ✨ AI 翻譯 ${escHtml(l.label)}
        </button>
        <button type="button" class="btn btn-secondary btn-create-translation" data-lang="${l.value}" style="font-size:0.8rem" title="僅複製內容，不翻譯">
          複製
        </button>
      </span>`;
    }
    return `<button type="button" class="btn btn-secondary btn-create-translation" data-lang="${l.value}" style="font-size:0.8rem">
      + ${escHtml(l.label)}
    </button>`;
  });

  return `
    <div class="field-group">
      <label>翻譯版本</label>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">${items.join("")}</div>
    </div>`;
}

function renderTextField({ key, label, required }, value = "") {
  return `
    <div class="field-group">
      <label>${label}${required ? " *" : ""}</label>
      <input type="text" data-key="${key}" value="${escAttr(value)}">
    </div>`;
}

function renderLangField(value) {
  const opts = ["zh-tw", "en", "ja"];
  return `
    <div class="field-group">
      <label>語言</label>
      <select data-key="lang">
        ${opts.map((o) => `<option value="${o}"${value === o ? " selected" : ""}>${o}</option>`).join("")}
      </select>
    </div>`;
}

function renderTagsField(tags) {
  return `
    <div class="field-group">
      <label>標籤 <small style="color:#666">(Enter 新增)</small></label>
      <div class="tags-input-wrap" id="tags-wrap">
        ${tags.map((t) => tagChip(t)).join("")}
        <input class="tags-input" id="tags-input" type="text" placeholder="輸入標籤...">
      </div>
    </div>`;
}

function tagChip(t) {
  return `<span class="tag-chip">${escHtml(t)}<button class="tag-chip-remove" data-tag="${escAttr(t)}">×</button></span>`;
}

function initTagsInput() {
  const wrap = document.getElementById("tags-wrap");
  const input = document.getElementById("tags-input");
  if (!input) return;

  wrap.addEventListener("click", (e) => {
    if (e.target.classList.contains("tag-chip-remove")) {
      e.target.closest(".tag-chip").remove();
      scheduleSave();
    } else {
      input.focus();
    }
  });

  input.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && !e.isComposing) {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      input.value = "";
      wrap.insertBefore(parseHTML(tagChip(val)), input);
      scheduleSave();
    } else if (e.key === "Backspace" && !input.value) {
      const chips = wrap.querySelectorAll(".tag-chip");
      if (chips.length) { chips[chips.length - 1].remove(); scheduleSave(); }
    }
  });
}

function initDatePickers() {
  document.querySelectorAll(".flatpickr-date").forEach((el) => {
    flatpickr(el, {
      dateFormat: "Y-m-d",
      allowInput: false,
      disableMobile: true,
      onChange: () => scheduleSave(),
    });
  });
}

function getTags() {
  return [...document.querySelectorAll("#tags-wrap .tag-chip")].map((el) =>
    el.childNodes[0].textContent.trim()
  );
}

function renderField(f, value) {
  if (f.type === "boolean") {
    const checked = value === undefined ? (f.default ?? false) : value;
    return `
      <div class="field-group">
        <label>${f.key}</label>
        <div class="toggle-wrap">
          <input type="checkbox" data-key-extra="${f.key}" ${checked ? "checked" : ""}>
          <span>${f.key}</span>
        </div>
      </div>`;
  }
  if (f.type === "enum") {
    const opts = f.options ?? [];
    return `
      <div class="field-group">
        <label>${f.key}</label>
        <select data-key-extra="${f.key}">
          ${opts.map((o) => `<option value="${o}"${value === o ? " selected" : ""}>${o}</option>`).join("")}
        </select>
      </div>`;
  }
  if (f.type === "date") {
    const dateVal = value ? String(value).slice(0, 10) : new Date().toISOString().slice(0, 10);
    return `
      <div class="field-group">
        <label>${f.key}${f.required ? " *" : ""}</label>
        <input type="text" class="flatpickr-date" data-key-extra="${f.key}" value="${escAttr(dateVal)}" readonly>
      </div>`;
  }
  return `
    <div class="field-group">
      <label>${f.key}</label>
      <input type="text" data-key-extra="${f.key}" value="${escAttr(value ?? "")}">
    </div>`;
}

function initEditor() {
  mdContent = draft.content ?? "";
  previewEl = document.getElementById("md-preview");
  renderPreview();

  cmView = new EditorView({
    parent: document.getElementById("md-editor"),
    state: EditorState.create({
      doc: mdContent,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown({ base: markdownLanguage, codeLanguages: [] }),
        oneDark,
        EditorView.lineWrapping,
        Prec.high(keymap.of([{ key: "Enter", run: continueListOnEnter }])),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((v) => {
          if (v.docChanged) {
            mdContent = v.state.doc.toString();
            renderPreview();
            scheduleSave();
          }
        }),
      ],
    }),
  });

  initScrollSync();
}

function renderPreview() {
  if (!previewEl) return;

  const md = mdContent || "";
  const tokens = marked.lexer(md);
  const BLOCK_TYPES = new Set(["heading", "paragraph", "code", "blockquote", "list", "hr", "table", "html"]);
  const blockLineNumbers = [];
  let line = 1;

  for (const token of tokens) {
    if (BLOCK_TYPES.has(token.type)) blockLineNumbers.push(line);
    line += (token.raw.match(/\n/g) || []).length;
  }

  previewEl.innerHTML = marked.parse(md);

  const blockEls = previewEl.querySelectorAll(
    ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, " +
    ":scope > p, :scope > pre, :scope > blockquote, :scope > ul, :scope > ol, " +
    ":scope > hr, :scope > table, :scope > div"
  );
  blockEls.forEach((el, i) => {
    if (i < blockLineNumbers.length) el.dataset.sourceLine = blockLineNumbers[i];
  });
}

// ── Scroll sync ──────────────────────────────────────────────────────────────

let scrollSyncSource = null;
let scrollSyncTimer = null;

function initScrollSync() {
  cmView.scrollDOM.addEventListener("scroll", () => {
    if (scrollSyncSource === "preview") return;
    scrollSyncSource = "editor";
    clearTimeout(scrollSyncTimer);
    syncPreviewFromEditor();
    scrollSyncTimer = setTimeout(() => { scrollSyncSource = null; }, 100);
  }, { passive: true });

  previewEl.addEventListener("scroll", () => {
    if (scrollSyncSource === "editor") return;
    scrollSyncSource = "preview";
    clearTimeout(scrollSyncTimer);
    syncEditorFromPreview();
    scrollSyncTimer = setTimeout(() => { scrollSyncSource = null; }, 100);
  }, { passive: true });
}

function getPreviewAnchors() {
  return [...previewEl.querySelectorAll("[data-source-line]")]
    .map(el => ({ el, line: parseInt(el.dataset.sourceLine, 10) }))
    .filter(a => !isNaN(a.line));
}

function syncPreviewFromEditor() {
  const scrollDOM = cmView.scrollDOM;
  const scrollTop = scrollDOM.scrollTop;
  const scrollMax = scrollDOM.scrollHeight - scrollDOM.clientHeight;
  if (scrollMax <= 0) return;

  const topBlock = cmView.lineBlockAtHeight(scrollTop);
  const topLine = cmView.state.doc.lineAt(topBlock.from).number;
  const totalLines = cmView.state.doc.lines;
  const anchors = getPreviewAnchors();

  if (!anchors.length) {
    previewEl.scrollTop = (scrollTop / scrollMax) * (previewEl.scrollHeight - previewEl.clientHeight);
    return;
  }

  let before = null, after = null;
  for (const a of anchors) {
    if (a.line <= topLine) before = a;
    else if (!after) after = a;
  }

  if (!before) { previewEl.scrollTop = 0; return; }

  if (!after) {
    previewEl.scrollTop = (scrollTop / scrollMax) * (previewEl.scrollHeight - previewEl.clientHeight);
    return;
  }

  const eBefore = cmView.lineBlockAt(cmView.state.doc.line(before.line).from).top;
  const eAfter  = cmView.lineBlockAt(cmView.state.doc.line(Math.min(after.line, totalLines)).from).top;
  const frac = eAfter > eBefore ? Math.max(0, Math.min(1, (scrollTop - eBefore) / (eAfter - eBefore))) : 0;
  previewEl.scrollTop = before.el.offsetTop + frac * (after.el.offsetTop - before.el.offsetTop);
}

function syncEditorFromPreview() {
  const scrollTop = previewEl.scrollTop;
  const scrollMax = previewEl.scrollHeight - previewEl.clientHeight;
  if (scrollMax <= 0) return;

  const anchors = getPreviewAnchors();

  if (!anchors.length) {
    cmView.scrollDOM.scrollTop = (scrollTop / scrollMax) * (cmView.scrollDOM.scrollHeight - cmView.scrollDOM.clientHeight);
    return;
  }

  let before = null, after = null;
  for (const a of anchors) {
    const top = a.el.offsetTop;
    if (top <= scrollTop) before = { ...a, offsetTop: top };
    else if (!after) after = { ...a, offsetTop: top };
  }

  if (!before) { cmView.scrollDOM.scrollTop = 0; return; }

  if (!after) {
    cmView.scrollDOM.scrollTop = (scrollTop / scrollMax) * (cmView.scrollDOM.scrollHeight - cmView.scrollDOM.clientHeight);
    return;
  }

  const totalLines = cmView.state.doc.lines;
  const frac = after.offsetTop > before.offsetTop
    ? Math.max(0, Math.min(1, (scrollTop - before.offsetTop) / (after.offsetTop - before.offsetTop)))
    : 0;
  const eBefore = cmView.lineBlockAt(cmView.state.doc.line(before.line).from).top;
  const eAfter  = cmView.lineBlockAt(cmView.state.doc.line(Math.min(after.line, totalLines)).from).top;
  cmView.scrollDOM.scrollTop = eBefore + frac * (eAfter - eBefore);
}

function continueListOnEnter(view) {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const text = line.text;

  const m = text.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)\.\s+|>\s+)(.*)$/);
  if (!m) return false;

  const [, indent, marker, num, rest] = m;

  if (rest.length === 0) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: indent },
      selection: { anchor: line.from + indent.length },
    });
    return true;
  }

  let nextMarker = marker;
  if (num !== undefined) {
    nextMarker = `${Number(num) + 1}. `;
  } else if (/\[[ xX]\]/.test(marker)) {
    nextMarker = marker.replace(/\[[xX]\]/, "[ ]");
  }

  const insert = `\n${indent}${nextMarker}`;
  view.dispatch({
    changes: { from, to: from, insert },
    selection: { anchor: from + insert.length },
  });
  return true;
}

function getFormData() {
  const get = (sel) => document.querySelector(sel);
  const title = get('[data-key="title"]')?.value ?? "";
  const lang = get('[data-key="lang"]')?.value ?? "zh-tw";
  const slug = get('[data-key="slug"]')?.value || slugifyClient(title);
  const description = get('[data-key="description"]')?.value ?? "";
  const tags = JSON.stringify(getTags());
  const content = mdContent;

  // Start from existing fields to preserve keys not rendered in schema (e.g. pubDate)
  const fields = { ...(JSON.parse(draft.fields || "{}")) };
  document.querySelectorAll("[data-key-extra]").forEach((el) => {
    const key = el.dataset.keyExtra;
    if (el.type === "checkbox") fields[key] = el.checked;
    else if (el.value !== "") fields[key] = el.value;
    else delete fields[key];
  });

  return { title, lang, slug, description, tags, fields: JSON.stringify(fields), content };
}

function scheduleSave() {
  saveStatus.textContent = "未儲存";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, 1000);
}

async function autoSave() {
  if (saving) { saveTimer = setTimeout(autoSave, 500); return; }
  saving = true;
  saveStatus.textContent = "儲存中...";
  try {
    const body = getFormData();
    const res = await fetch(`/api/drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const prevSlug = draft.slug;
      draft = await res.json();
      saveStatus.textContent = "已儲存";
      // Refresh translation section if slug changed
      if (draft.slug !== prevSlug) {
        await loadTranslations();
        const section = fieldsForm.querySelector(".field-group:last-child");
        if (section) section.outerHTML = renderTranslationSection(draft.lang);
      }
    } else {
      saveStatus.textContent = "儲存失敗";
    }
  } finally {
    saving = false;
  }
}

async function publish() {
  const body = getFormData();
  if (!body.title.trim()) { alert("請輸入標題"); return; }

  clearTimeout(saveTimer);
  await autoSave();

  if (!confirm(`確定要對「${body.title}」開 Pull Request？`)) return;

  btnPublish.disabled = true;
  btnPublish.textContent = "送出中...";

  try {
    const res = await fetch(`/api/drafts/${draftId}/publish`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      draft.status = "pr_opened";
      draft.pr_url = data.pr_url;
      updatePublishButton();
      window.open(data.pr_url, "_blank");
    } else {
      alert(`送出失敗：${data.error}`);
      btnPublish.disabled = false;
      btnPublish.textContent = "送出 PR";
    }
  } catch (e) {
    alert(`送出失敗：${e.message}`);
    btnPublish.disabled = false;
    btnPublish.textContent = "送出 PR";
  }
}

function renderGithubSourceInfo() {
  const existing = document.getElementById("github-source-info");
  existing?.remove();
  if (!draft?.github_path) return;

  const info = document.createElement("div");
  info.id = "github-source-info";
  info.style.cssText = "margin-bottom:0.75rem;padding:0.5rem 0.75rem;background:#1a2a1a;border:1px solid #2a4a2a;border-radius:6px;font-size:0.8rem;color:#86efac;display:flex;align-items:center;gap:0.75rem;";
  info.innerHTML = `
    <span>GitHub 來源: <code style="background:#0d1a0d;padding:0.1rem 0.3rem;border-radius:3px">${escHtml(draft.github_path)}</code></span>
    <button id="btn-resync" class="btn btn-secondary" style="font-size:0.75rem;padding:0.2rem 0.6rem;margin-left:auto">重新同步</button>
  `;
  fieldsForm.parentNode.insertBefore(info, fieldsForm);

  document.getElementById("btn-resync").addEventListener("click", async () => {
    if (!confirm("確定要從 GitHub 重新同步？本地的修改將被覆蓋。")) return;
    const btn = document.getElementById("btn-resync");
    btn.disabled = true;
    btn.textContent = "同步中...";
    try {
      const res = await fetch(`/api/drafts/${draftId}/resync`, { method: "POST" });
      if (res.ok) {
        draft = await res.json();
        renderFields();
        cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: draft.content ?? "" } });
        mdContent = draft.content ?? "";
        renderPreview();
        renderGithubSourceInfo();
      } else {
        const data = await res.json();
        alert(`同步失敗：${data.error}`);
      }
    } catch (e) {
      alert(`同步失敗：${e.message}`);
    } finally {
      const b = document.getElementById("btn-resync");
      if (b) { b.disabled = false; b.textContent = "重新同步"; }
    }
  });
}

function updatePublishButton() {
  if (draft?.status === "pr_opened" && draft?.pr_url) {
    btnPublish.disabled = false;
    btnPublish.textContent = "重新送出 PR";
    let prLinkEl = document.getElementById("pr-link");
    if (!prLinkEl) {
      prLinkEl = document.createElement("a");
      prLinkEl.id = "pr-link";
      prLinkEl.target = "_blank";
      prLinkEl.style.cssText = "font-size:0.8rem;color:#22c55e;margin-left:0.5rem;";
      btnPublish.parentNode.insertBefore(prLinkEl, btnPublish.nextSibling);
    }
    prLinkEl.href = draft.pr_url;
    prLinkEl.textContent = "查看 PR →";
  } else {
    btnPublish.disabled = false;
    btnPublish.textContent = "送出 PR";
    document.getElementById("pr-link")?.remove();
  }
}

function escHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escAttr(s) {
  return String(s).replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function parseHTML(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstElementChild;
}

init();
