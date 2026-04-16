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

let draftId = window.__DRAFT_ID__;
let draft = null;
let schema = null;
let cmView = null;
let previewEl = null;
let mdContent = "";
let saveTimer = null;
let saving = false;

const saveStatus = document.getElementById("save-status");
const btnPublish = document.getElementById("btn-publish");
const btnRefreshSchema = document.getElementById("btn-refresh-schema");
const fieldsForm = document.getElementById("fields-form");

async function init() {
  [schema, draft] = await Promise.all([
    fetch("/api/schema").then((r) => r.json()),
    draftId
      ? fetch(`/api/drafts/${draftId}`).then((r) => r.json())
      : Promise.resolve(null),
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

  renderFields();
  initEditor();
  updatePublishButton();

  btnPublish.addEventListener("click", publish);
  btnRefreshSchema.addEventListener("click", refreshSchema);
}

function renderFields() {
  const extraFields = JSON.parse(draft.fields || "{}");
  const rows = schema.fields
    .filter((f) => !["title", "lang", "description", "tags"].includes(f.key))
    .map((f) => renderField(f, extraFields[f.key]));

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
  const schema_ = schema.fields.find((f) => f.key === "lang");
  const opts = schema_?.options ?? ["zh-tw", "en"];
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

  const fields = {};
  document.querySelectorAll("[data-key-extra]").forEach((el) => {
    const key = el.dataset.keyExtra;
    if (el.type === "checkbox") fields[key] = el.checked;
    else if (el.value !== "") fields[key] = el.value;
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

async function refreshSchema() {
  btnRefreshSchema.disabled = true;
  btnRefreshSchema.textContent = "更新中...";
  try {
    schema = await fetch("/api/schema/refresh", { method: "POST" }).then((r) => r.json());
    renderFields();
  } finally {
    btnRefreshSchema.disabled = false;
    btnRefreshSchema.textContent = "更新欄位";
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
