import { Crepe } from "@milkdown/crepe";
import { imageInlineComponent, inlineImageConfig } from "@milkdown/kit/component/image-inline";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import { replaceAll } from "@milkdown/kit/utils";
import "@milkdown/crepe/theme/common/style.css";
import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

// ---------- Types & state ----------

interface Tab {
  path: string | null;
  name: string;
  pane: HTMLElement;
  tabEl: HTMLElement;
  crepe: Crepe;
  /** YAML front matter (with its fences), kept verbatim and re-attached on save. */
  frontmatter: string;
  eol: "\n" | "\r\n";
  /** Editor's Markdown at the last load/save; differing from it means unsaved changes. */
  baseline: string;
  /** Cached for the tab dot only. It lags typing; decisions call syncDirty(). */
  dirty: boolean;
  editing: boolean;
  /** The file was not valid text, so it must never be written back. */
  readOnly: boolean;
  mtime: number;
  changedOnDisk: boolean;
  /** A save or close is in progress. */
  busy: boolean;
  reloading: boolean;
  /** The last reload read an empty file; probably another program mid-write. */
  sawEmpty: boolean;
  images: Map<string, Promise<string>>;
}

interface FileData {
  content: string;
  mtime: number;
  lossy: boolean;
}

const MD_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;
const isMac = navigator.platform.toLowerCase().includes("mac");
const appWindow = getCurrentWindow();
/** Shown in place of images the viewer refuses to load (remote or unreadable). */
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

const tabs: Tab[] = [];
let active: Tab | null = null;
let untitledCount = 0;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  tabs: $("tabs"),
  docs: $("docs"),
  notice: $("notice"),
  outlineList: $("outline-list"),
  findbar: $("findbar"),
  findInput: $<HTMLInputElement>("find-input"),
  findCount: $("find-count"),
  dropOverlay: $("drop-overlay"),
  btnSave: $<HTMLButtonElement>("btn-save"),
  btnView: $<HTMLButtonElement>("btn-view"),
  btnEdit: $<HTMLButtonElement>("btn-edit"),
  btnOutline: $<HTMLButtonElement>("btn-outline"),
  btnFind: $<HTMLButtonElement>("btn-find"),
  btnPrint: $<HTMLButtonElement>("btn-print"),
  btnTheme: $<HTMLButtonElement>("btn-theme"),
};

// ---------- Small helpers ----------

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;
const samePath = (a: string, b: string) =>
  a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

function safeDecode(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: number | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

async function showError(text: string) {
  await message(text, { title: "MDView", kind: "error" });
}

/** Split a file into front matter and body, normalising line endings to "\n". */
function parseFile(raw: string) {
  const eol: "\n" | "\r\n" = raw.includes("\r\n") ? "\r\n" : "\n";
  const text = raw.replace(/\r\n/g, "\n");
  // The line after the opening fence must look like YAML, so a document that
  // merely starts with a "---" rule keeps its first section in the body.
  const match = /^---\n(?=[ \t]*[\w"'#-])[\s\S]*?\n---[ \t]*(?:\n+|$)/.exec(text);
  const frontmatter = match ? match[0] : "";
  return { eol, frontmatter, body: text.slice(frontmatter.length) };
}

// ---------- Tabs ----------

function renderFrontmatter(tab: Tab) {
  tab.pane.querySelector(".frontmatter")?.remove();
  if (!tab.frontmatter) return;
  const details = document.createElement("details");
  details.className = "frontmatter";
  const summary = document.createElement("summary");
  summary.textContent = "Front matter";
  const pre = document.createElement("pre");
  pre.textContent = tab.frontmatter.replace(/^---\n/, "").replace(/\n---[ \t]*\n*$/, "");
  details.append(summary, pre);
  tab.pane.prepend(details);
}

async function createTab(path: string | null, file: FileData): Promise<Tab> {
  const { eol, frontmatter, body } = parseFile(file.content);

  const pane = document.createElement("div");
  pane.className = "pane";
  const host = document.createElement("div");
  pane.append(host);

  const tabEl = document.createElement("div");
  tabEl.className = "tab";
  tabEl.setAttribute("role", "tab");
  const nameEl = document.createElement("span");
  nameEl.className = "tab-name";
  const closeEl = document.createElement("button");
  closeEl.type = "button";
  closeEl.className = "tab-close";
  closeEl.setAttribute("aria-label", "Close tab");
  closeEl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  tabEl.append(nameEl, closeEl);

  const tab: Tab = {
    crepe: null!, // assigned just below; the image resolver needs `tab` first
    path,
    name: path ? baseName(path) : `Untitled ${++untitledCount}.md`,
    pane,
    tabEl,
    frontmatter,
    eol,
    baseline: "",
    dirty: false,
    editing: false,
    readOnly: file.lossy,
    mtime: file.mtime,
    changedOnDisk: false,
    busy: false,
    reloading: false,
    sawEmpty: false,
    images: new Map(),
  };

  tab.crepe = new Crepe({
    root: host,
    defaultValue: body,
    // Crepe's image block overwrites an image's alt text with a size ratio
    // when saving, so it stays off and images remain plain Markdown images.
    features: { [Crepe.Feature.TopBar]: true, [Crepe.Feature.ImageBlock]: false },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: "Start writing…" },
    },
  });
  tab.crepe.editor
    .config((ctx) => {
      ctx.update(inlineImageConfig.key, (value) => ({
        ...value,
        proxyDomURL: (url: string) => resolveImage(tab, url),
      }));
      ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const }));
      // A pasted or dropped image would otherwise be saved as a temporary
      // blob: address that stops working when the app closes.
      ctx.update(uploadConfig.key, (prev) => ({ ...prev, uploader: async () => [] }));
    })
    .use(imageInlineComponent);
  tab.crepe.setReadonly(true);
  tab.crepe.on((listener) => {
    listener.markdownUpdated(() => onContentChange(tab));
  });

  // Nothing is attached to the page until the editor exists, so a failure
  // here cannot leave a dead tab behind.
  el.docs.append(pane);
  try {
    await tab.crepe.create();
  } catch (err) {
    pane.remove();
    throw err;
  }
  tab.baseline = tab.crepe.getMarkdown();
  el.tabs.append(tabEl);

  renderFrontmatter(tab);

  tabEl.addEventListener("mousedown", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      void closeTab(tab);
    } else if (e.button === 0 && !(e.target as Element).closest(".tab-close")) {
      activate(tab);
    }
  });
  closeEl.addEventListener("click", () => void closeTab(tab));
  pane.addEventListener("scroll", onPaneScroll, { passive: true });

  tabs.push(tab);
  refreshTabLabel(tab);
  return tab;
}

function refreshTabLabel(tab: Tab) {
  tab.tabEl.querySelector(".tab-name")!.textContent = tab.name;
  tab.tabEl.title = tab.path ?? tab.name;
  tab.tabEl.classList.toggle("dirty", tab.dirty);
}

/**
 * Ask the editor whether the tab has unsaved changes. The editor's change
 * event is delayed by ~200 ms, so anything that could lose work (closing,
 * reloading, skipping a save) must call this rather than read `tab.dirty`.
 */
function syncDirty(tab: Tab): boolean {
  const dirty = tabs.includes(tab) && tab.crepe.getMarkdown() !== tab.baseline;
  if (dirty !== tab.dirty) {
    tab.dirty = dirty;
    refreshTabLabel(tab);
    if (tab === active) updateChrome();
  }
  return dirty;
}

function onContentChange(tab: Tab) {
  syncDirty(tab);
  if (tab === active) {
    refreshOutlineSoon();
    if (!el.findbar.hidden) runFindSoon();
  }
}

function activate(tab: Tab | null) {
  active = tab;
  for (const t of tabs) {
    const on = t === tab;
    t.pane.classList.toggle("active", on);
    t.tabEl.classList.toggle("active", on);
    t.tabEl.setAttribute("aria-selected", String(on));
  }
  tab?.tabEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  updateChrome();
  refreshOutline();
  if (!tab) closeFind();
  else if (!el.findbar.hidden) runFind(false);
  void checkDisk();
}

function updateChrome() {
  const tab = active;
  document.body.classList.toggle("has-doc", !!tab);
  el.btnSave.disabled = !tab || tab.readOnly || (!tab.dirty && !!tab.path);
  el.btnView.disabled = el.btnEdit.disabled = !tab;
  el.btnView.setAttribute("aria-pressed", String(!!tab && !tab.editing));
  el.btnEdit.setAttribute("aria-pressed", String(!!tab && tab.editing));
  el.btnOutline.disabled = el.btnFind.disabled = el.btnPrint.disabled = !tab;
  el.notice.hidden = !tab?.changedOnDisk;
  const title = tab ? `${tab.dirty ? "● " : ""}${tab.name} — MDView` : "MDView";
  if (document.title !== title) {
    document.title = title;
    void appWindow.setTitle(title);
  }
}

function setEditing(tab: Tab, editing: boolean) {
  if (editing && tab.readOnly) {
    void showError(
      `${tab.name} is not saved as UTF-8 text, so it is opened read-only. Editing it here could damage it.`,
    );
    return;
  }
  tab.editing = editing;
  tab.crepe.setReadonly(!editing);
  tab.pane.classList.toggle("editing", editing);
  updateChrome();
  if (editing) (tab.pane.querySelector(".ProseMirror") as HTMLElement | null)?.focus();
}

// ---------- Opening ----------

// Everything that opens a tab goes through one queue. Opening is async, so
// without it two requests for the same file would both pass the "already
// open?" check and produce two tabs fighting over one file.
let openQueue: Promise<unknown> = Promise.resolve();
function enqueue(job: () => Promise<unknown>) {
  openQueue = openQueue.then(job).catch((err) => console.error(err));
  return openQueue;
}

async function openPaths(paths: string[]) {
  const failures: string[] = [];
  let last: Tab | null = null;
  for (const path of paths) {
    const existing = tabs.find((t) => t.path && samePath(t.path, path));
    if (existing) {
      last = existing;
      continue;
    }
    try {
      const file = await invoke<FileData>("read_text_file", { path });
      last = await createTab(path, file);
    } catch (err) {
      failures.push(`${baseName(path)}: ${err}`);
    }
  }
  if (last) activate(last);
  if (failures.length) await showError(`Could not open:\n\n${failures.join("\n")}`);
}

async function openWithDialog() {
  const picked = await openDialog({
    multiple: true,
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (picked) await enqueue(() => openPaths(Array.isArray(picked) ? picked : [picked]));
}

function newDocument() {
  return enqueue(async () => {
    const tab = await createTab(null, { content: "", mtime: 0, lossy: false });
    activate(tab);
    setEditing(tab, true);
  });
}

function takePendingFiles() {
  return enqueue(async () => openPaths(await invoke<string[]>("take_pending_files")));
}

// ---------- Saving & closing ----------

async function saveTab(tab: Tab, saveAs = false): Promise<boolean> {
  if (tab.busy || tab.readOnly) return false;
  tab.busy = true;
  try {
    return await writeTab(tab, saveAs);
  } finally {
    tab.busy = false;
  }
}

async function writeTab(tab: Tab, saveAs: boolean): Promise<boolean> {
  let path = tab.path;
  if (!path || saveAs) {
    path = await saveDialog({
      defaultPath: tab.path ?? tab.name,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (!path || !tabs.includes(tab)) return false;
  } else {
    // Don't silently overwrite something another program wrote since we loaded.
    const onDisk = await invoke<number>("file_mtime", { path }).catch(() => tab.mtime);
    if (onDisk !== tab.mtime) {
      const OVERWRITE = "Overwrite";
      const answer = await message(
        `"${tab.name}" was changed by another program since you opened it. Saving will replace those changes.`,
        { title: "MDView", kind: "warning", buttons: { ok: OVERWRITE, cancel: "Cancel" } },
      );
      if (answer !== OVERWRITE && answer !== "Ok") return false;
    }
  }
  const markdown = tab.crepe.getMarkdown();
  let content = tab.frontmatter + markdown;
  if (tab.eol === "\r\n") content = content.replace(/\r?\n/g, "\r\n");
  try {
    tab.mtime = await invoke<number>("write_text_file", { path, content });
  } catch (err) {
    await showError(`Could not save ${baseName(path)}.\n\n${err}`);
    return false;
  }
  if (tab.path !== path) dropImages(tab);
  tab.path = path;
  tab.name = baseName(path);
  tab.baseline = markdown;
  tab.changedOnDisk = false;
  // The user may have kept typing while the file was being written.
  syncDirty(tab);
  refreshTabLabel(tab);
  if (tab === active) updateChrome();
  return true;
}

/** Ask what to do with unsaved changes. Returns false if the user cancelled. */
async function confirmDiscard(tab: Tab): Promise<boolean> {
  if (!syncDirty(tab)) return true;
  activate(tab);
  const SAVE = "Save";
  const DISCARD = "Don't save";
  const answer = await message(`Save changes to "${tab.name}" before closing?`, {
    title: "MDView",
    kind: "warning",
    buttons: { yes: SAVE, no: DISCARD, cancel: "Cancel" },
  });
  if (answer === SAVE || answer === "Yes") return saveTab(tab);
  return answer === DISCARD || answer === "No";
}

function dropImages(tab: Tab) {
  for (const pending of tab.images.values()) {
    void pending.then((url) => url.startsWith("blob:") && URL.revokeObjectURL(url));
  }
  tab.images.clear();
}

async function closeTab(tab: Tab) {
  if (tab.busy || !tabs.includes(tab)) return;
  tab.busy = true;
  let confirmed = false;
  try {
    // confirmDiscard may call saveTab, which manages `busy` itself.
    tab.busy = false;
    confirmed = await confirmDiscard(tab);
  } finally {
    tab.busy = false;
  }
  const index = tabs.indexOf(tab);
  if (!confirmed || index < 0) return;
  tabs.splice(index, 1);
  tab.tabEl.remove();
  tab.pane.remove();
  dropImages(tab);
  tab.crepe.destroy().catch(() => {});
  if (active === tab) activate(tabs[Math.min(index, tabs.length - 1)] ?? null);
}

// ---------- Reloading when another program changes the file ----------

async function reloadFromDisk(tab: Tab, force = false) {
  if (!tab.path || tab.reloading) return;
  tab.reloading = true;
  try {
    const file = await invoke<FileData>("read_text_file", { path: tab.path });
    if (!tabs.includes(tab)) return;
    // The user may have started typing while the file was being read.
    if (!force && syncDirty(tab)) {
      tab.mtime = file.mtime;
      tab.changedOnDisk = true;
      updateChrome();
      return;
    }
    // Programs often save by emptying a file and then writing it. Don't show
    // an empty document for that; the next check reads it again.
    if (!force && file.content === "" && tab.baseline.trim() !== "" && !tab.sawEmpty) {
      tab.sawEmpty = true;
      return;
    }
    tab.sawEmpty = false;
    const { eol, frontmatter, body } = parseFile(file.content);
    const scroll = tab.pane.scrollTop;
    tab.eol = eol;
    tab.frontmatter = frontmatter;
    tab.mtime = file.mtime;
    tab.readOnly = file.lossy;
    dropImages(tab);
    tab.crepe.editor.action(replaceAll(body));
    tab.baseline = tab.crepe.getMarkdown();
    tab.changedOnDisk = false;
    syncDirty(tab);
    if (tab.readOnly && tab.editing) {
      tab.editing = false;
      tab.crepe.setReadonly(true);
      tab.pane.classList.remove("editing");
    }
    renderFrontmatter(tab);
    requestAnimationFrame(() => (tab.pane.scrollTop = scroll));
    if (tab === active) {
      updateChrome();
      refreshOutline();
    }
  } catch {
    // The file may be locked mid-write or gone. `tab.mtime` is unchanged, so
    // the next check tries again.
  } finally {
    tab.reloading = false;
  }
}

async function checkDisk() {
  const tab = active;
  if (!tab?.path || document.hidden || tab.busy || tab.reloading) return;
  const path = tab.path;
  let mtime: number;
  try {
    mtime = await invoke<number>("file_mtime", { path });
  } catch {
    return;
  }
  // Anything may have happened during the await: a save, a Save As, a close.
  if (!tabs.includes(tab) || tab.busy || tab.reloading || tab.path !== path || mtime === tab.mtime) return;
  if (syncDirty(tab)) {
    tab.mtime = mtime;
    tab.changedOnDisk = true;
    updateChrome();
  } else {
    await reloadFromDisk(tab);
  }
}

// ---------- Images & links ----------

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const isDrivePath = (text: string) => /^[a-z]:[\\/]/i.test(text);

/** Turn a link or image address from a document into a file path (relative or absolute). */
function localTarget(url: string): string {
  let target = url.replace(/[?#].*$/, "");
  if (/^file:/i.test(target)) {
    target = target.replace(/^file:\/\/(localhost)?/i, "");
    // "/C:/x" is how a Windows drive path looks inside a file: URL.
    if (/^\/[a-z]:/i.test(target)) target = target.slice(1);
  }
  return safeDecode(target);
}

/**
 * Images are loaded through the backend and shown as blob: addresses. Remote
 * images are never fetched: this is an offline viewer, and a remote image
 * would tell its server that (and when, and from where) the file was opened.
 */
function resolveImage(tab: Tab, url: string): Promise<string> {
  if (/^(data:|blob:)/i.test(url)) return Promise.resolve(url);
  const base = tab.path;
  if (!url || !base || (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url) && !isDrivePath(url))) {
    return Promise.resolve(BLANK_IMAGE);
  }
  let pending = tab.images.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        const path = await invoke<string>("resolve_path", { baseFile: base, target: localTarget(url) });
        const bytes = await invoke<ArrayBuffer>("read_image_file", { path });
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        return URL.createObjectURL(new Blob([bytes], { type: IMAGE_TYPES[ext] ?? "" }));
      } catch {
        return BLANK_IMAGE;
      }
    })();
    tab.images.set(url, pending);
  }
  return pending;
}

async function followLink(tab: Tab, href: string) {
  if (/^(https?:|mailto:)/i.test(href)) {
    await openUrl(href);
    return;
  }
  if (href.startsWith("#")) {
    const id = safeDecode(href.slice(1));
    const target =
      tab.pane.querySelector(`[id="${CSS.escape(id)}"]`) ??
      headingsOf(tab).find((h) => slug(h.textContent ?? "") === id.toLowerCase());
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  const isOtherScheme = /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href) && !isDrivePath(href);
  if (!tab.path || isOtherScheme) return;
  const target = localTarget(href);
  if (!MD_EXT.test(target)) return;
  const base = tab.path;
  await enqueue(async () => {
    try {
      await openPaths([await invoke<string>("resolve_path", { baseFile: base, target })]);
    } catch (err) {
      await showError(String(err));
    }
  });
}

const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

// Never let a link navigate the app window itself.
function onLinkClick(e: MouseEvent) {
  const link = (e.target as Element).closest?.("a[href]");
  if (!link) return;
  e.preventDefault();
  const tab = active;
  if (e.button !== 0 || e.detail > 1 || !tab || !tab.pane.contains(link)) return;
  const withMod = isMac ? e.metaKey : e.ctrlKey;
  if (tab.editing && !withMod) return;
  void followLink(tab, link.getAttribute("href") ?? "");
}
document.addEventListener("click", onLinkClick, true);
document.addEventListener("auxclick", onLinkClick, true);

// ---------- Outline ----------

function headingsOf(tab: Tab): HTMLElement[] {
  return Array.from(
    tab.pane.querySelectorAll<HTMLElement>(
      ".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6",
    ),
  ).filter((h) => h.textContent?.trim());
}

function refreshOutline() {
  el.outlineList.replaceChildren();
  const headings = active ? headingsOf(active) : [];
  if (!headings.length) {
    const empty = document.createElement("div");
    empty.className = "outline-empty";
    empty.textContent = "No headings in this document.";
    el.outlineList.append(empty);
    return;
  }
  const top = Math.min(...headings.map((h) => Number(h.tagName[1])));
  headings.forEach((heading, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "outline-item";
    item.dataset.level = String(Number(heading.tagName[1]) - top + 1);
    item.textContent = heading.textContent;
    item.title = heading.textContent ?? "";
    // Look the heading up again at click time: the editor replaces elements
    // as the document changes, so a stored reference can be stale.
    item.addEventListener("click", () => {
      if (active) headingsOf(active)[index]?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    el.outlineList.append(item);
  });
  markActiveHeading();
}

const refreshOutlineSoon = debounce(refreshOutline, 250);

function markActiveHeading() {
  if (!active) return;
  const items = el.outlineList.querySelectorAll(".outline-item");
  if (!items.length) return;
  const edge = active.pane.getBoundingClientRect().top + 90;
  let current = -1;
  headingsOf(active).forEach((h, i) => {
    if (h.getBoundingClientRect().top <= edge) current = i;
  });
  items.forEach((item, i) => item.classList.toggle("active", i === current));
}

let scrollTicking = false;
function onPaneScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    markActiveHeading();
  });
}

function toggleOutline(visible = !document.body.classList.contains("show-outline")) {
  document.body.classList.toggle("show-outline", visible);
  el.btnOutline.setAttribute("aria-pressed", String(visible));
  try {
    localStorage.setItem("mdview.outline", visible ? "1" : "0");
  } catch {
    // preference just won't persist
  }
}

// ---------- Find ----------

const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote, .cm-line";
// Editor furniture that is not document text.
const NOT_TEXT = "button, .tools, .language-picker, .label-wrapper, .preview-panel, .hidden, [hidden]";
const canHighlight = typeof Highlight !== "undefined" && !!CSS.highlights;
let matches: Range[] = [];
let matchIndex = -1;

function clearFind() {
  matches = [];
  matchIndex = -1;
  if (canHighlight) {
    CSS.highlights.delete("mdview-find");
    CSS.highlights.delete("mdview-find-current");
  }
  el.findCount.textContent = "";
}

function collectMatches(root: Element, query: string): Range[] {
  // Build one searchable string from all text nodes, with a break between
  // blocks so a match can span bold/italic/link boundaries but not paragraphs.
  const nodes: { node: Text; start: number }[] = [];
  let haystack = "";
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(NOT_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const block = n.parentElement?.closest(BLOCKS) ?? null;
    if (block !== lastBlock) {
      haystack += "\n";
      lastBlock = block;
    }
    nodes.push({ node: n, start: haystack.length });
    // Lower-casing changes the length of a few characters (İ); keep such
    // nodes as written so offsets still line up.
    const lower = n.data.toLowerCase();
    haystack += lower.length === n.data.length ? lower : n.data;
  }
  const needle = query.toLowerCase();

  const locate = (offset: number, isEnd: boolean) => {
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (nodes[mid].start <= offset - (isEnd ? 1 : 0)) lo = mid;
      else hi = mid - 1;
    }
    return { node: nodes[lo].node, offset: offset - nodes[lo].start };
  };

  const found: Range[] = [];
  if (!nodes.length) return found;
  for (
    let at = haystack.indexOf(needle);
    at !== -1 && found.length < 5000;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    const start = locate(at, false);
    const end = locate(at + needle.length, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    found.push(range);
  }
  return found;
}

function showMatch(scroll: boolean) {
  const total = matches.length;
  const query = el.findInput.value;
  el.findCount.textContent = !query ? "" : total ? `${matchIndex + 1} of ${total}` : "No results";
  if (!total) return;
  const current = matches[matchIndex];
  if (canHighlight) {
    CSS.highlights.set("mdview-find", new Highlight(...matches));
    CSS.highlights.set("mdview-find-current", new Highlight(current));
  }
  if (scroll && active) {
    const rect = current.getBoundingClientRect();
    const box = active.pane.getBoundingClientRect();
    if (rect.top < box.top + 70 || rect.bottom > box.bottom - 40) {
      active.pane.scrollTop += rect.top - box.top - box.height / 3;
    }
  }
}

function runFind(scroll = true) {
  const keep = matchIndex;
  clearFind();
  // A delayed refresh can arrive after the bar was closed.
  if (el.findbar.hidden) return;
  const query = el.findInput.value;
  const root = active?.pane.querySelector(".ProseMirror");
  if (!query || !root) return;
  matches = collectMatches(root, query);
  matchIndex = matches.length ? Math.min(Math.max(keep, 0), matches.length - 1) : -1;
  showMatch(scroll);
}

const runFindSoon = debounce(() => runFind(false), 250);

function stepFind(delta: number) {
  // After an edit the stored ranges point at replaced text until the delayed
  // refresh runs; search again rather than jump somewhere meaningless.
  if (matches.some((m) => !m.startContainer.isConnected)) runFind(false);
  if (!matches.length) return;
  matchIndex = (matchIndex + delta + matches.length) % matches.length;
  showMatch(true);
}

function openFind() {
  if (!active) return;
  el.findbar.hidden = false;
  const selected = window.getSelection()?.toString().trim();
  if (selected && !selected.includes("\n")) el.findInput.value = selected;
  el.findInput.focus();
  el.findInput.select();
  matchIndex = -1;
  runFind();
}

function closeFind() {
  el.findbar.hidden = true;
  clearFind();
}

// ---------- Theme ----------

function setTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  el.btnTheme.querySelector(".theme-label")!.textContent = theme === "dark" ? "Light" : "Dark";
  el.btnTheme.title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  try {
    localStorage.setItem("mdview.theme", theme);
  } catch {
    // preference just won't persist
  }
}

// ---------- Wiring ----------

const mod = isMac ? "⌘" : "Ctrl+";
const shift = isMac ? "⇧" : "Shift+";
$("btn-new").title = `New document (${mod}N)`;
$("btn-open").title = `Open file (${mod}O)`;
el.btnSave.title = `Save (${mod}S)`;
el.btnView.title = `Read-only view (${mod}${shift}E)`;
el.btnEdit.title = `Edit this document (${mod}E)`;
el.btnOutline.title = `Show or hide the outline (${mod}\\)`;
el.btnFind.title = `Find in document (${mod}F)`;
el.btnPrint.title = `Print or save as PDF (${mod}P)`;

$("btn-new").addEventListener("click", () => void newDocument());
$("btn-open").addEventListener("click", () => void openWithDialog());
$("empty-open").addEventListener("click", () => void openWithDialog());
$("empty-new").addEventListener("click", () => void newDocument());
el.btnSave.addEventListener("click", () => active && void saveTab(active));
el.btnView.addEventListener("click", () => active && setEditing(active, false));
el.btnEdit.addEventListener("click", () => active && setEditing(active, true));
el.btnOutline.addEventListener("click", () => toggleOutline());
el.btnFind.addEventListener("click", () => (el.findbar.hidden ? openFind() : closeFind()));
el.btnPrint.addEventListener("click", () => void printDocument());
el.btnTheme.addEventListener("click", () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"),
);

$("notice-reload").addEventListener("click", () => active && void reloadFromDisk(active, true));
$("notice-keep").addEventListener("click", () => {
  if (!active) return;
  active.changedOnDisk = false;
  updateChrome();
});

el.findInput.addEventListener("input", () => {
  matchIndex = -1;
  runFind();
});
el.findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    stepFind(e.shiftKey ? -1 : 1);
  }
});
$("find-prev").addEventListener("click", () => stepFind(-1));
$("find-next").addEventListener("click", () => stepFind(1));
$("find-close").addEventListener("click", closeFind);

async function printDocument() {
  if (!active) return;
  closeFind();
  await invoke("print_page");
}

/**
 * The physical key, so shortcuts work on any keyboard layout. Synthetic input
 * (on-screen keyboards, remote desktops, automation) often carries no physical
 * key, so fall back to the character.
 */
function keyCode(e: KeyboardEvent): string {
  if (e.code) return e.code;
  if (/^[a-z]$/i.test(e.key)) return `Key${e.key.toUpperCase()}`;
  return e.key === "\\" ? "Backslash" : e.key;
}

function shortcutFor(e: KeyboardEvent): (() => unknown) | null {
  const tab = active;
  const code = keyCode(e);
  switch (code) {
    case "KeyS":
      // A document that was only viewed is never rewritten.
      return () => tab && (e.shiftKey || !tab.path || syncDirty(tab)) && saveTab(tab, e.shiftKey);
    case "KeyE":
      // In edit mode plain Ctrl+E belongs to the editor (inline code).
      if (!tab || (tab.editing && !e.shiftKey)) return null;
      return () => setEditing(tab, !tab.editing);
  }
  if (e.shiftKey) return null;
  switch (code) {
    case "KeyO":
      return openWithDialog;
    case "KeyN":
      return newDocument;
    case "KeyW":
      return () => tab && closeTab(tab);
    case "KeyF":
      return openFind;
    case "KeyP":
      return printDocument;
    case "Backslash":
      return () => toggleOutline();
  }
  return null;
}

window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && !el.findbar.hidden) {
      e.preventDefault();
      closeFind();
      return;
    }
    if (e.altKey) return;
    if (e.ctrlKey && keyCode(e) === "Tab" && tabs.length > 1 && active) {
      e.preventDefault();
      const step = e.shiftKey ? -1 : 1;
      activate(tabs[(tabs.indexOf(active) + step + tabs.length) % tabs.length]);
      return;
    }
    // On macOS, Ctrl+letter is text navigation and must reach the editor.
    const modKey = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!modKey) return;
    const action = shortcutFor(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) void action();
  },
  true,
);

let closingWindow = false;
void appWindow.onCloseRequested(async (event) => {
  if (closingWindow) {
    event.preventDefault();
    return;
  }
  closingWindow = true;
  try {
    for (const tab of [...tabs]) {
      if (!(await confirmDiscard(tab))) {
        event.preventDefault();
        return;
      }
    }
  } finally {
    closingWindow = false;
  }
});

void getCurrentWebview().onDragDropEvent((event) => {
  const { payload } = event;
  if (payload.type === "enter" || payload.type === "over") {
    el.dropOverlay.hidden = false;
    return;
  }
  el.dropOverlay.hidden = true;
  if (payload.type === "drop") {
    const files = payload.paths.filter((p) => MD_EXT.test(p));
    if (files.length) void enqueue(() => openPaths(files));
  }
});

let storedOutline: string | null = null;
try {
  storedOutline = localStorage.getItem("mdview.outline");
} catch {
  // default below
}
toggleOutline(storedOutline ? storedOutline === "1" : window.innerWidth >= 900);
setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
updateChrome();
setInterval(() => void checkDisk(), 1500);
window.addEventListener("focus", () => void checkDisk());
// Listen first, then collect: a file delivered in between is not missed.
void listen("files-pending", () => void takePendingFiles()).then(() => takePendingFiles());
