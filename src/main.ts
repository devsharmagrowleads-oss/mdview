import { Crepe } from "@milkdown/crepe";
import { imageInlineComponent, inlineImageConfig } from "@milkdown/kit/component/image-inline";
import { editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
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
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";

import { changedBlocks } from "./diff";
import { copyRich, docx, documentBody, standaloneHtml, type CodeBlock } from "./exporters";
import { renderMermaid } from "./mermaid";
import { loadJson, prefs, saveJson, savePrefs } from "./prefs";
import { openSettings, type ShellStatus } from "./settings";
import { openTableTool } from "./tables";

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
  /** Top-level blocks that changed in the last reload from disk (indexes). */
  changes: number[];
  changeCursor: number;
}

interface FileData {
  content: string;
  mtime: number;
  lossy: boolean;
}

/** Something the backend asks for: from the command line, a link, an agent, a shortcut. */
type AppRequest =
  | { kind: "open"; path: string; agent: boolean }
  | { kind: "watch"; path: string; confirm: boolean }
  | { kind: "clipboard"; text: string };

interface ExistingPath {
  path: string;
  isDir: boolean;
}

interface ActivityItem {
  path: string;
  kind: "new" | "edited" | "agent";
  at: number;
  seen: boolean;
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
  btnActivity: $<HTMLButtonElement>("btn-activity"),
  btnFind: $<HTMLButtonElement>("btn-find"),
  btnExport: $<HTMLButtonElement>("btn-export"),
  btnTheme: $<HTMLButtonElement>("btn-theme"),
  exportMenu: $("export-menu"),
  banners: $("banners"),
  activity: $("activity"),
  activityList: $("activity-list"),
  watchList: $("watch-list"),
  activityBadge: $("activity-badge"),
  activityBadgeSide: $("activity-badge-side"),
  sideTabOutline: $<HTMLButtonElement>("side-tab-outline"),
  sideTabActivity: $<HTMLButtonElement>("side-tab-activity"),
  tableTool: $<HTMLButtonElement>("table-tool"),
  changes: $("changes"),
  changesText: $("changes-text"),
  toast: $("toast"),
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

let toastTimer: number | undefined;
function toast(text: string) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.toast.hidden = true), Math.min(9000, 2500 + text.length * 40));
}

async function focusWindow() {
  try {
    await appWindow.unminimize();
    await appWindow.show();
    await appWindow.setFocus();
  } catch {
    // the window manager may refuse; nothing to do
  }
}

const parentDir = (path: string) => path.replace(/[\\/][^\\/]*$/, "");
const folderName = (dir: string) => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;

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

async function createTab(path: string | null, file: FileData, title?: string): Promise<Tab> {
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
    name: path ? baseName(path) : (title ?? `Untitled ${++untitledCount}.md`),
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
    changes: [],
    changeCursor: -1,
  };

  tab.crepe = new Crepe({
    root: host,
    defaultValue: body,
    // Crepe's image block overwrites an image's alt text with a size ratio
    // when saving, so it stays off and images remain plain Markdown images.
    features: { [Crepe.Feature.TopBar]: true, [Crepe.Feature.ImageBlock]: false },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: "Start writing…" },
      [Crepe.Feature.CodeMirror]: {
        // Diagrams and math show as pictures; "Edit" on the block shows the source.
        previewOnlyByDefault: true,
        renderPreview: (language: string, content: string, apply: (value: null | string | HTMLElement) => void) =>
          language.toLowerCase() === "mermaid" && content.trim() ? renderMermaid(content, apply) : null,
      },
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
  // Typing makes "what the agent changed" meaningless.
  if (tab.editing && tab.changes.length) clearChanges(tab);
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
  if (tab?.path) markSeen(tab.path);
  hideTableTool();
  updateChrome();
  refreshOutline();
  showChanges();
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
  el.btnFind.disabled = el.btnExport.disabled = !tab;
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
  if (editing) {
    clearChanges(tab);
    hideTableTool();
  }
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

async function openPaths(paths: string[], activateLast = true) {
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
  if (last && (activateLast || !active)) activate(last);
  if (failures.length) await showError(`Could not open:\n\n${failures.join("\n")}`);
}

const findTab = (path: string) => tabs.find((t) => t.path && samePath(t.path, path));

/** The user is in the middle of typing; don't switch tabs under them. */
const busyEditing = () => !!active?.editing && syncDirty(active);

/** An agent wrote or edited these files (hook, MCP or --from-agent). */
async function openForAgent(paths: string[]) {
  const fresh = paths.filter((p) => !findTab(p));
  for (const p of paths) recordActivity(p, fresh.includes(p) ? "agent" : "edited");
  if (fresh.length) {
    await openPaths(paths, !busyEditing());
    if (prefs.focusAgent) await focusWindow();
    return;
  }
  // Already open: show it; the reload (with changes marked) happens on activation.
  const tab = findTab(paths[paths.length - 1]);
  if (!tab) return;
  if (tab !== active && !busyEditing()) activate(tab);
  else if (tab === active) await checkDisk();
}

/** A document from text with no file behind it (clipboard). */
async function showText(text: string) {
  const heading = /^#{1,3}\s+(.+)$/m.exec(text)?.[1]?.trim();
  const title = `${(heading ?? "Clipboard").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "Clipboard"}.md`;
  const tab = await createTab(null, { content: text, mtime: 0, lossy: false }, title);
  activate(tab);
}

/** Text from the clipboard: a path to open, or Markdown to show. */
async function handleClipboardText(text: string, fromShortcut: boolean) {
  const trimmed = text.trim();
  if (!trimmed.includes("\n")) {
    let candidate = trimmed.replace(/^["'`]|["'`]$/g, "");
    if (/^file:/i.test(candidate)) candidate = localTarget(candidate);
    const position = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(candidate)!;
    const found =
      (await invoke<ExistingPath | null>("resolve_existing", { baseFile: null, target: candidate })) ??
      (position[2] ? await invoke<ExistingPath | null>("resolve_existing", { baseFile: null, target: position[1] }) : null);
    if (found) {
      if (found.isDir) await requestWatch(found.path, true);
      else if (MD_EXT.test(found.path)) await openPaths([found.path]);
      else await openReference(found.path, Number(position[2]) || undefined, Number(position[3]) || undefined);
      return;
    }
    if (!fromShortcut) {
      toast("Paste a path to a Markdown file, or Markdown text, to open it.");
      return;
    }
  }
  await showText(text);
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

async function handleRequests(requests: AppRequest[]) {
  const plain: string[] = [];
  const fromAgent: string[] = [];
  for (const r of requests) {
    if (r.kind === "open") (r.agent ? fromAgent : plain).push(r.path);
    else if (r.kind === "watch") await requestWatch(r.path, r.confirm);
    else await handleClipboardText(r.text, true);
  }
  if (plain.length) await openPaths(plain);
  if (fromAgent.length) await openForAgent(fromAgent);
}

function takePending() {
  return enqueue(async () => handleRequests(await invoke<AppRequest[]>("take_pending")));
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
    const before = blockKeys(tab);
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
    markChanges(tab, before);
    requestAnimationFrame(() => (tab.pane.scrollTop = scroll));
    if (tab === active) {
      updateChrome();
      refreshOutline();
      showChanges();
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

// ---------- What changed on disk ----------

function viewOf(tab: Tab) {
  return tab.crepe.editor.action((ctx) => ctx.get(editorViewCtx));
}

/** One string per top-level block, for comparing two versions of a document. */
function blockKeys(tab: Tab): string[] {
  const keys: string[] = [];
  try {
    viewOf(tab).state.doc.forEach((node) => keys.push(node.toString()));
  } catch {
    // editor not ready
  }
  return keys;
}

/** Code blocks in document order, with their full text. */
function codeBlocksOf(tab: Tab): CodeBlock[] {
  const out: CodeBlock[] = [];
  viewOf(tab).state.doc.descendants((node) => {
    if (node.type.name === "code_block") out.push({ language: String(node.attrs.language ?? ""), text: node.textContent });
    return true;
  });
  return out;
}

function markChanges(tab: Tab, before: string[]) {
  const after = blockKeys(tab);
  const changed = before.length ? changedBlocks(before, after) : [];
  // A rewrite of most of the document would just paint everything.
  const tooMany = changed.length > Math.max(4, after.length * 0.6);
  tab.changes = tooMany ? [] : changed;
  tab.changeCursor = -1;
}

function changeElements(tab: Tab): HTMLElement[] {
  if (!tab.changes.length) return [];
  const want = new Set(tab.changes);
  const view = viewOf(tab);
  const out: HTMLElement[] = [];
  view.state.doc.forEach((_node, offset, index) => {
    if (!want.has(index)) return;
    const dom = view.nodeDOM(offset);
    if (dom instanceof HTMLElement) out.push(dom);
  });
  return out;
}

function clearChanges(tab: Tab) {
  tab.changes = [];
  tab.changeCursor = -1;
  if (tab === active) showChanges();
}

/** Paint the active tab's changed blocks and show the "N changed" pill. */
function showChanges() {
  const tab = active;
  tab?.pane.querySelectorAll(".change-mark").forEach((m) => m.remove());
  for (const t of tabs) if (t !== tab) t.pane.querySelectorAll(".change-mark").forEach((m) => m.remove());
  const elements = tab && !tab.editing ? changeElements(tab) : [];
  if (canHighlight) CSS.highlights.delete("mdview-changed");
  if (!tab || !elements.length) {
    el.changes.hidden = true;
    return;
  }
  if (canHighlight) {
    const ranges = elements.map((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      return r;
    });
    CSS.highlights.set("mdview-changed", new Highlight(...ranges));
  }
  // A bar in the margin, for changes with little or no text (images, rules).
  const paneTop = tab.pane.getBoundingClientRect().top - tab.pane.scrollTop;
  const pm = tab.pane.querySelector(".ProseMirror")?.getBoundingClientRect();
  for (const e of elements) {
    const rect = e.getBoundingClientRect();
    const mark = document.createElement("div");
    mark.className = "change-mark";
    mark.style.top = `${rect.top - paneTop}px`;
    mark.style.height = `${Math.max(rect.height, 8)}px`;
    if (pm) mark.style.left = `${pm.left - tab.pane.getBoundingClientRect().left + 30}px`;
    tab.pane.append(mark);
  }
  const n = elements.length;
  el.changesText.textContent = `${n} ${n === 1 ? "part" : "parts"} changed`;
  el.changes.hidden = false;
}
const showChangesSoon = debounce(showChanges, 150);

function nextChange() {
  const tab = active;
  if (!tab) return;
  const elements = changeElements(tab);
  if (!elements.length) return;
  tab.changeCursor = (tab.changeCursor + 1) % elements.length;
  elements[tab.changeCursor].scrollIntoView({ block: "center", behavior: "smooth" });
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
  if (!MD_EXT.test(target)) {
    // A link to code or another file: show it in the editor, never run it.
    const found = await invoke<ExistingPath | null>("resolve_existing", { baseFile: tab.path, target });
    if (found) await openReference(found.path);
    else toast(`Not found: ${target}`);
    return;
  }
  const base = tab.path;
  await enqueue(async () => {
    try {
      await openPaths([await invoke<string>("resolve_path", { baseFile: base, target })]);
    } catch (err) {
      await showError(String(err));
    }
  });
}

/** Open a file mentioned in a document: Markdown here, anything else in an editor. */
async function openReference(path: string, line?: number, column?: number) {
  if (MD_EXT.test(path)) {
    await enqueue(() => openPaths([path]));
    return;
  }
  try {
    const where = await invoke<string>("open_in_editor", { path, line: line ?? null, column: column ?? null });
    toast(where === "folder" ? `Showing ${baseName(path)} in its folder` : `Opened ${baseName(path)} in ${where}`);
  } catch (err) {
    toast(String(err));
  }
}

/** Inline code that names a file: `src/main.ts`, `docs/plan.md:12`, `C:\x\y.json`. */
const KNOWN_EXT =
  /\.(md|markdown|mdown|mkd|txt|json|jsonc|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|rb|php|cs|cpp|cc|c|h|hpp|css|scss|html|vue|svelte|yml|yaml|toml|ini|cfg|sh|ps1|bat|sql|ipynb|csv|xml|lock|env|gradle|dart|lua|r)$/i;
function fileReference(text: string): { file: string; line?: number; column?: number } | null {
  const t = text.trim();
  if (!t || t.length > 300 || /[<>|*?"]/.test(t) || /^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null;
  const m = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(t)!;
  const file = m[1];
  const hasDir = /[\\/]/.test(file);
  if (!KNOWN_EXT.test(file) && !(hasDir && /\.[a-z0-9]{1,8}$/i.test(file))) return null;
  // Bare names like `config.json` count; dotted words like `user.name` don't.
  if (/\s/.test(file) && !hasDir) return null;
  return { file, line: m[2] ? Number(m[2]) : undefined, column: m[3] ? Number(m[3]) : undefined };
}

function referenceCode(target: EventTarget | null): HTMLElement | null {
  const tab = active;
  const code = (target as Element | null)?.closest?.<HTMLElement>("code");
  if (!tab || !code || !tab.pane.contains(code) || code.closest("pre, .milkdown-code-block")) return null;
  return fileReference(code.textContent ?? "") ? code : null;
}

document.addEventListener("click", (e) => {
  const tab = active;
  if (!tab || e.button !== 0 || e.detail > 1) return;
  const code = referenceCode(e.target);
  if (!code) return;
  if (tab.editing && !(isMac ? e.metaKey : e.ctrlKey)) return;
  const ref = fileReference(code.textContent ?? "")!;
  e.preventDefault();
  void (async () => {
    const found = await invoke<ExistingPath | null>("resolve_existing", { baseFile: tab.path, target: ref.file });
    if (!found) toast(`Not found: ${ref.file}`);
    else await openReference(found.path, ref.line, ref.column);
  })();
});

// Show file references as links on hover (without touching the document).
let hoveredCode: HTMLElement | null = null;
document.addEventListener("mouseover", (e) => {
  const code = active && !active.editing ? referenceCode(e.target) : null;
  if (code === hoveredCode) return;
  hoveredCode = code;
  for (const t of tabs) t.pane.classList.toggle("over-reference", !!code && t === active);
  if (!canHighlight) return;
  if (code) {
    const r = document.createRange();
    r.selectNodeContents(code);
    CSS.highlights.set("mdview-reference", new Highlight(r));
    code.closest(".pane")?.setAttribute("title", "Click to open");
  } else {
    CSS.highlights.delete("mdview-reference");
    for (const t of tabs) t.pane.removeAttribute("title");
  }
});

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

// ---------- Sidebar: Outline and Activity ----------

type SideView = "outline" | "activity";
let sideView: SideView = loadJson<SideView>("mdview.sideview", "outline") === "activity" ? "activity" : "outline";

function setSidebar(visible: boolean, view: SideView = sideView) {
  sideView = view;
  document.body.classList.toggle("show-outline", visible);
  document.body.dataset.side = view;
  el.btnOutline.setAttribute("aria-pressed", String(visible && view === "outline"));
  el.btnActivity.setAttribute("aria-pressed", String(visible && view === "activity"));
  el.sideTabOutline.setAttribute("aria-selected", String(view === "outline"));
  el.sideTabActivity.setAttribute("aria-selected", String(view === "activity"));
  el.outlineList.hidden = view !== "outline";
  el.activity.hidden = view !== "activity";
  try {
    localStorage.setItem("mdview.outline", visible ? "1" : "0");
  } catch {
    // preference just won't persist
  }
  saveJson("mdview.sideview", view);
  if (visible && view === "activity") renderActivity();
}

const sidebarShowing = (view: SideView) => document.body.classList.contains("show-outline") && sideView === view;

function toggleOutline(visible = !sidebarShowing("outline")) {
  setSidebar(visible, "outline");
}

function toggleActivity(visible = !sidebarShowing("activity")) {
  setSidebar(visible, "activity");
}

let activity: ActivityItem[] = loadJson<ActivityItem[]>("mdview.activity", []).filter((a) => a && a.path).slice(0, 50);

function recordActivity(path: string, kind: ActivityItem["kind"]) {
  const previous = activity.find((a) => samePath(a.path, path));
  activity = activity.filter((a) => a !== previous);
  // A file the agent created stays "new" while it keeps editing it.
  const keep = previous && !previous.seen && previous.kind !== "edited" && kind === "edited" ? previous.kind : kind;
  const seen = !!active?.path && samePath(active.path, path) && document.hasFocus();
  activity.unshift({ path, kind: keep, at: Date.now(), seen });
  activity = activity.slice(0, 50);
  saveJson("mdview.activity", activity);
  renderActivity();
}

function markSeen(path: string) {
  let changed = false;
  for (const a of activity) {
    if (!a.seen && samePath(a.path, path)) {
      a.seen = true;
      changed = true;
    }
  }
  if (changed) {
    saveJson("mdview.activity", activity);
    renderActivity();
  }
}

function ago(at: number) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
}

const KIND_LABEL: Record<ActivityItem["kind"], string> = { new: "New", edited: "Edited", agent: "From agent" };

function renderActivity() {
  const unseen = activity.filter((a) => !a.seen).length;
  for (const badge of [el.activityBadge, el.activityBadgeSide]) {
    badge.hidden = unseen === 0;
    badge.textContent = unseen > 9 ? "9+" : String(unseen);
  }
  if (el.activity.hidden) return;

  el.watchList.replaceChildren(
    ...(prefs.watchDirs.length
      ? prefs.watchDirs.map((dir) => {
          const li = document.createElement("li");
          li.className = "watch-item";
          li.title = dir;
          const name = document.createElement("span");
          name.textContent = folderName(dir);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "icon-btn";
          remove.setAttribute("aria-label", `Stop watching ${dir}`);
          remove.title = "Stop watching";
          remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
          remove.addEventListener("click", () => removeWatchFolder(dir));
          li.append(name, remove);
          return li;
        })
      : [
          Object.assign(document.createElement("li"), {
            className: "side-empty",
            textContent: "Watch a project folder and MDView opens Markdown files as your AI agent writes them.",
          }),
        ]),
  );

  el.activityList.replaceChildren(
    ...(activity.length
      ? activity.map((a) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = `activity-item${a.seen ? "" : " unseen"}`;
          item.title = a.path;
          const name = document.createElement("span");
          name.className = "activity-name";
          name.textContent = baseName(a.path);
          const meta = document.createElement("span");
          meta.className = "activity-meta";
          meta.textContent = `${KIND_LABEL[a.kind]} · ${folderName(parentDir(a.path))} · ${ago(a.at)}`;
          item.append(name, meta);
          item.addEventListener("click", () => void enqueue(() => openPaths([a.path])));
          return item;
        })
      : [
          Object.assign(document.createElement("div"), {
            className: "side-empty",
            textContent: "Files your agents write, and changes in watched folders, show up here.",
          }),
        ]),
  );
}

// ---------- Watched folders ----------

async function applyWatch() {
  const failed = await invoke<string[]>("set_watch_dirs", { dirs: prefs.watchDirs }).catch(() => prefs.watchDirs);
  if (failed.length) toast(`Could not watch: ${failed.map(folderName).join(", ")}`);
}

async function watchFolder(dir: string) {
  if (!prefs.watchDirs.some((d) => samePath(d, dir))) {
    prefs.watchDirs.push(dir);
    savePrefs();
    await applyWatch();
  }
  toast(`Watching ${folderName(dir)} for Markdown files`);
  setSidebar(true, "activity");
}

function removeWatchFolder(dir: string) {
  prefs.watchDirs = prefs.watchDirs.filter((d) => !samePath(d, dir));
  savePrefs();
  void applyWatch();
  renderActivity();
}

async function addWatchFolder() {
  const picked = await openDialog({ directory: true, multiple: false, title: "Watch a folder for Markdown files" });
  if (typeof picked === "string") await watchFolder(picked);
}

/** A request to watch a folder. Links (which any web page can make) must be confirmed. */
async function requestWatch(dir: string, confirm: boolean) {
  if (prefs.watchDirs.some((d) => samePath(d, dir))) {
    setSidebar(true, "activity");
    return;
  }
  if (confirm) {
    await focusWindow();
    const WATCH = "Watch";
    const answer = await message(
      `Watch this folder for Markdown files?\n\n${dir}\n\nNew and changed .md files there will open in MDView.`,
      { title: "MDView", kind: "info", buttons: { ok: WATCH, cancel: "Cancel" } },
    );
    if (answer !== WATCH && answer !== "Ok") return;
  }
  await watchFolder(dir);
}

// A file in a watched folder was created or changed. Editors and agents often
// write in several steps, so wait for the writes to settle.
const settling = new Map<string, { created: boolean; timer: number }>();
void listen<{ path: string; created: boolean }>("md-activity", (event) => {
  const { path, created } = event.payload;
  const key = path.toLowerCase();
  const prev = settling.get(key);
  clearTimeout(prev?.timer);
  settling.set(key, {
    created: created || !!prev?.created,
    timer: window.setTimeout(() => {
      const entry = settling.get(key);
      settling.delete(key);
      void onWatchedFile(path, !!entry?.created);
    }, 600),
  });
});

async function onWatchedFile(path: string, created: boolean) {
  const tab = findTab(path);
  if (tab) {
    const mtime = await invoke<number>("file_mtime", { path }).catch(() => null);
    // Our own save, or a change the live reload already picked up.
    if (mtime === null || mtime === tab.mtime) return;
    recordActivity(path, "edited");
    if (tab === active) await checkDisk();
    else if (prefs.autoOpen === "all" && !busyEditing()) activate(tab);
    return;
  }
  const isNew = created && !activity.some((a) => samePath(a.path, path));
  recordActivity(path, isNew ? "new" : "edited");
  if (prefs.autoOpen === "all" || (prefs.autoOpen === "new" && isNew)) {
    await enqueue(() => openPaths([path], !busyEditing()));
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
el.btnActivity.title = "Files your agents wrote, and watched folders";
el.btnFind.title = `Find in document (${mod}F)`;
el.btnExport.title = `Copy or save as HTML, Word or PDF (${mod}P prints)`;
$("btn-settings").title = `Settings (${mod},)`;

$("btn-new").addEventListener("click", () => void newDocument());
$("btn-open").addEventListener("click", () => void openWithDialog());
$("empty-open").addEventListener("click", () => void openWithDialog());
$("empty-new").addEventListener("click", () => void newDocument());
el.btnSave.addEventListener("click", () => active && void saveTab(active));
el.btnView.addEventListener("click", () => active && setEditing(active, false));
el.btnEdit.addEventListener("click", () => active && setEditing(active, true));
el.btnOutline.addEventListener("click", () => toggleOutline());
el.btnActivity.addEventListener("click", () => toggleActivity());
el.sideTabOutline.addEventListener("click", () => setSidebar(true, "outline"));
el.sideTabActivity.addEventListener("click", () => setSidebar(true, "activity"));
$("btn-add-watch").addEventListener("click", () => void addWatchFolder());
$("btn-clear-activity").addEventListener("click", () => {
  activity = [];
  saveJson("mdview.activity", activity);
  renderActivity();
});
el.btnFind.addEventListener("click", () => (el.findbar.hidden ? openFind() : closeFind()));
el.btnExport.addEventListener("click", () => toggleExportMenu());
el.btnTheme.addEventListener("click", () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"),
);
$("btn-settings").addEventListener("click", () => void showSettings());
$("empty-connect").addEventListener("click", () => void showSettings());
$("empty-watch").addEventListener("click", () => void addWatchFolder());
$("changes-next").addEventListener("click", nextChange);
$("changes-clear").addEventListener("click", () => active && clearChanges(active));
window.addEventListener("resize", showChangesSoon);

function showSettings() {
  closeExportMenu();
  return openSettings({
    addWatchFolder,
    removeWatchFolder,
    setClipboardShortcut,
    checkForUpdates,
    toast,
  });
}

// ---------- Export ----------

function toggleExportMenu(open = el.exportMenu.hidden) {
  if (!open || !active) {
    closeExportMenu();
    return;
  }
  const r = el.btnExport.getBoundingClientRect();
  el.exportMenu.hidden = false;
  const width = el.exportMenu.offsetWidth;
  el.exportMenu.style.top = `${r.bottom + 4}px`;
  el.exportMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
  el.btnExport.setAttribute("aria-expanded", "true");
  el.btnExport.dataset.title = el.btnExport.title;
  el.btnExport.title = "";
  el.exportMenu.querySelector<HTMLElement>("button")?.focus();
}

function closeExportMenu() {
  if (el.btnExport.dataset.title) el.btnExport.title = el.btnExport.dataset.title;
  el.exportMenu.hidden = true;
  el.btnExport.setAttribute("aria-expanded", "false");
}

document.addEventListener("mousedown", (e) => {
  const t = e.target as Element;
  if (!el.exportMenu.hidden && !el.exportMenu.contains(t) && !el.btnExport.contains(t)) closeExportMenu();
});

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** `forOtherApps`: inline styles and pictures, for mail apps and Word. */
async function exportBody(tab: Tab, forOtherApps: boolean) {
  const root = tab.pane.querySelector<HTMLElement>(".ProseMirror");
  if (!root) throw new Error("The document is not ready yet.");
  return documentBody(root, codeBlocksOf(tab), { inlineStyles: forOtherApps, pictures: forOtherApps });
}

function documentMarkdown(tab: Tab) {
  return tab.frontmatter + tab.crepe.getMarkdown();
}

async function runExport(kind: string) {
  closeExportMenu();
  const tab = active;
  if (!tab) return;
  try {
    if (kind === "print") return await printDocument();
    if (kind === "markdown") {
      await navigator.clipboard.writeText(documentMarkdown(tab));
      return toast("Markdown copied");
    }
    if (kind === "rich") {
      await copyRich(exportBody(tab, true), tab.crepe.getMarkdown());
      return toast("Copied. Paste into Gmail, Google Docs, Word, Notion or Slack.");
    }
    const ext = kind === "docx" ? "docx" : "html";
    const path = await saveDialog({
      defaultPath: `${stem(tab.path ?? tab.name)}.${ext}`,
      filters: [{ name: ext === "docx" ? "Word document" : "Web page", extensions: [ext] }],
    });
    if (!path) return;
    const html = standaloneHtml(stem(tab.name), await exportBody(tab, kind === "docx"));
    if (ext === "html") await invoke("write_text_file", { path, content: html });
    else await invoke("write_binary_file", docx(html), { headers: { "x-path": encodeURIComponent(path) } });
    toast(`Saved ${baseName(path)}`);
  } catch (err) {
    await showError(`Export failed.\n\n${err}`);
  }
}

el.exportMenu.addEventListener("click", (e) => {
  const kind = (e.target as Element).closest<HTMLElement>("[data-export]")?.dataset.export;
  if (kind) void runExport(kind);
});
el.exportMenu.addEventListener("keydown", (e) => {
  const items = Array.from(el.exportMenu.querySelectorAll<HTMLElement>("button"));
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === "Escape") {
    closeExportMenu();
    el.btnExport.focus();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }
});

// ---------- Table tools ----------

let toolTable: HTMLTableElement | null = null;

function hideTableTool() {
  el.tableTool.hidden = true;
  toolTable = null;
}

function placeTableTool() {
  if (!toolTable || !toolTable.isConnected) return hideTableTool();
  const docs = el.docs.getBoundingClientRect();
  const r = toolTable.getBoundingClientRect();
  if (r.bottom < docs.top + 30 || r.top > docs.bottom - 30) return hideTableTool();
  el.tableTool.hidden = false;
  el.tableTool.style.top = `${Math.max(r.top - docs.top - 34, 4)}px`;
  el.tableTool.style.left = `${Math.max(r.right - docs.left - el.tableTool.offsetWidth, 4)}px`;
}

el.docs.addEventListener("mousemove", (e) => {
  const tab = active;
  if (!tab || tab.editing) return;
  const t = e.target as Element;
  if (el.tableTool.contains(t)) return;
  const table = t.closest?.("table");
  if (table && tab.pane.contains(table) && (table as HTMLTableElement).rows.length > 2) {
    if (table !== toolTable) {
      toolTable = table as HTMLTableElement;
      placeTableTool();
    }
  } else if (toolTable) {
    // Keep the button while the pointer travels from the table up to it.
    const r = toolTable.getBoundingClientRect();
    if (e.clientY < r.top - 40 || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right + 10) hideTableTool();
  }
});
el.docs.addEventListener("scroll", () => toolTable && placeTableTool(), true);
el.tableTool.addEventListener("click", () => {
  const tab = active;
  if (toolTable && tab) openTableTool(toolTable, (href) => void followLink(tab, href));
});

// ---------- Paste a path or Markdown ----------

document.addEventListener("paste", (e) => {
  if (active?.editing) return; // the editor handles it
  if ((e.target as Element).closest?.("input, textarea, select, .modal")) return;
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (!text.trim()) return;
  e.preventDefault();
  void enqueue(() => handleClipboardText(text, false));
});

async function setClipboardShortcut(enabled: boolean) {
  try {
    await invoke("set_clipboard_shortcut", { enabled });
  } catch (err) {
    if (enabled) toast(`${isMac ? "Control+Option+M" : "Ctrl+Alt+M"} is taken by another app (${err})`);
  }
}

// ---------- Banners: default app, updates ----------

function showBanner(id: string, text: string, actions: { label: string; primary?: boolean; run: () => unknown }[]) {
  let banner = el.banners.querySelector<HTMLElement>(`[data-banner="${id}"]`);
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "banner";
    banner.dataset.banner = id;
    el.banners.append(banner);
  }
  const span = document.createElement("span");
  span.textContent = text;
  banner.replaceChildren(
    span,
    ...actions.map((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      if (a.primary) b.className = "primary";
      b.addEventListener("click", () => void a.run());
      return b;
    }),
  );
}

const hideBanner = (id: string) => el.banners.querySelector(`[data-banner="${id}"]`)?.remove();

let lastDefaultCheck = 0;
async function checkDefaultApp() {
  if (prefs.defaultPromptDismissed || Date.now() - lastDefaultCheck < 3000) return;
  lastDefaultCheck = Date.now();
  const status = await invoke<ShellStatus>("shell_status").catch(() => null);
  if (!status?.supported || status.defaultApp) {
    hideBanner("default");
    return;
  }
  showBanner(
    "default",
    "Make MDView your default Markdown app? Then .md files, and file names your AI agent prints in the terminal, open here with a click.",
    [
      {
        label: "Make default",
        primary: true,
        run: async () => {
          await invoke("open_default_apps").catch((err) => showError(String(err)));
          toast("Choose MDView for .md files in the window that opened.");
        },
      },
      {
        label: "Not now",
        run: () => {
          prefs.defaultPromptDismissed = true;
          savePrefs();
          hideBanner("default");
        },
      },
    ],
  );
}

async function checkForUpdates(manual: boolean) {
  let update;
  try {
    update = await checkUpdate();
  } catch (err) {
    if (manual) throw new Error(`Could not check for updates: ${err}`);
    return;
  }
  if (!update) {
    if (manual) toast("MDView is up to date.");
    return;
  }
  const found = update;
  showBanner("update", `MDView ${found.version} is available.`, [
    {
      label: "Install and restart",
      primary: true,
      run: async () => {
        for (const tab of [...tabs]) if (!(await confirmDiscard(tab))) return;
        showBanner("update", `Downloading MDView ${found.version}…`, []);
        try {
          await found.downloadAndInstall();
          await relaunch();
        } catch (err) {
          hideBanner("update");
          await showError(`The update could not be installed.\n\n${err}`);
        }
      },
    },
    { label: "Later", run: () => hideBanner("update") },
  ]);
}

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
    case "Comma":
      return showSettings;
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
setSidebar(storedOutline ? storedOutline === "1" : window.innerWidth >= 900, sideView);
setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
updateChrome();
renderActivity();
setInterval(() => void checkDisk(), 1500);
// Keep "5 min ago" honest.
setInterval(() => !el.activity.hidden && renderActivity(), 60_000);
window.addEventListener("focus", () => {
  void checkDisk();
  if (el.banners.querySelector('[data-banner="default"]')) void checkDefaultApp();
});
// Listen first, then collect: a request delivered in between is not missed.
void listen("requests-pending", () => void takePending()).then(() => takePending());
void applyWatch();
if (prefs.clipboardShortcut) void setClipboardShortcut(true);
setTimeout(() => void checkDefaultApp(), 1200);
if (prefs.autoUpdate) setTimeout(() => void checkForUpdates(false), 8000);
