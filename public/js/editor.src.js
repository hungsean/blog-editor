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

marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  }
}))

// Hardcoded extra fields (everything except title / lang / description / tags)
const EXTRA_FIELDS = [
  { key: "pubDate", type: "date", required: true },
  { key: "persona", type: "enum", options: ["", "表", "裏"], required: false },
  { key: "nsfw", type: "boolean", default: false },
];

let draftId = globalThis.__DRAFT_ID__;
let draft = null;
let cmView = null;
let previewEl = null;
let mdContent = "";
let saveTimer = null;
let saving = false;

const saveStatus = document.getElementById("save-status");
const btnPublish = document.getElementById("btn-publish");
const fieldsForm = document.getElementById("fields-form");

async function init() {
  draft = draftId
    ? await fetch(`/api/drafts/${draftId}`).then((r) => r.json())
    : null;

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

  renderFields();
  initEditor();
  updatePublishButton();
  renderGithubSourceInfo();

  btnPublish.addEventListener("click", publish);
}

function renderFields() {
  const extraFields = JSON.parse(draft.fields || "{}");
  const rows = EXTRA_FIELDS.map((f) => renderField(f, extraFields[f.key]));

  fieldsForm.innerHTML = `
    ${renderTextField({ key: "title", label: "標題", required: true }, draft.title)}
    ${renderLangField(draft.lang)}
    ${renderTextField({ key: "description", label: "描述" }, draft.description)}
    ${renderTagsField(JSON.parse(draft.tags || "[]"))}
    ${rows.join("")}
  `;

  fieldsForm.querySelectorAll("input[data-key], select[data-key]").forEach((el) => {
    el.addEventListener("input", scheduleSave);
  });
  initTagsInput();
}

function renderTextField({ key, label, required }, value = "") {
  return `
    <div class="field-group">
      <label>${label}${required ? " *" : ""}</label>
      <input type="text" data-key="${key}" value="${escAttr(value)}">
    </div>`;
}

function renderLangField(value) {
  const opts = ["zh-tw", "en"];
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
    // Normalize to YYYY-MM-DD for <input type="date">
    const dateVal = value ? String(value).slice(0, 10) : new Date().toISOString().slice(0, 10);
    return `
      <div class="field-group">
        <label>${f.key}${f.required ? " *" : ""}</label>
        <input type="date" data-key-extra="${f.key}" value="${escAttr(dateVal)}">
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
}

function renderPreview() {
  if (!previewEl) return;
  previewEl.innerHTML = marked.parse(mdContent || "");
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

  return { title, lang, description, tags, fields: JSON.stringify(fields), content };
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
      draft = await res.json();
      saveStatus.textContent = "已儲存";
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
