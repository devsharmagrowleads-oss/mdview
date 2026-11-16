/** The Settings window: system integration, AI agents, folders, shortcuts, updates. */
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";

import { prefs, savePrefs } from "./prefs";

export interface ShellStatus {
  supported: boolean;
  defaultApp: boolean;
  onPath: boolean;
  registered: boolean;
  exe: string;
}

interface AgentInfo {
  id: string;
  name: string;
  detected: boolean;
  connected: boolean;
  detail: string;
}

export interface SettingsDeps {
  addWatchFolder: () => Promise<void>;
  removeWatchFolder: (dir: string) => void;
  setClipboardShortcut: (enabled: boolean) => Promise<void>;
  checkForUpdates: (manual: boolean) => Promise<void>;
  toast: (text: string) => void;
}

const isMac = navigator.platform.toLowerCase().includes("mac");
const SHORTCUT = isMac
  ? "<kbd>Control</kbd>+<kbd>Option</kbd>+<kbd>M</kbd>"
  : "<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd>";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const folderName = (dir: string) => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;

let openModal: HTMLElement | null = null;

export async function openSettings(deps: SettingsDeps) {
  if (openModal) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal settings-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Settings");
  backdrop.append(modal);
  document.body.append(backdrop);
  openModal = backdrop;

  const version = await getVersion().catch(() => "");
  let shell: ShellStatus = { supported: false, defaultApp: false, onPath: false, registered: false, exe: "" };
  let agents: AgentInfo[] = [];

  async function refresh() {
    [shell, agents] = await Promise.all([
      invoke<ShellStatus>("shell_status").catch(() => shell),
      invoke<AgentInfo[]>("agent_status").catch(() => [] as AgentInfo[]),
    ]);
    render();
  }

  function status(ok: boolean, yes: string, no: string) {
    return `<span class="pill ${ok ? "ok" : ""}">${ok ? yes : no}</span>`;
  }

  function render() {
    const scroll = modal.querySelector(".settings-body")?.scrollTop ?? 0;
    const exe = shell.exe || "mdview";
    const integrated = shell.onPath && shell.registered;
    modal.innerHTML = `
      <div class="modal-head">
        <h2>Settings</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="settings-body">
        ${
          shell.supported
            ? `<section>
          <h3>Open Markdown from anywhere</h3>
          <div class="row">
            <div class="row-text">
              <div class="row-title">Default app for .md files ${status(shell.defaultApp, "MDView", "Another app")}</div>
              <p>Double-clicking a .md file, or Ctrl+clicking a file name an AI agent prints in the terminal, opens it here.</p>
            </div>
            <button type="button" class="btn" data-act="default">${shell.defaultApp ? "Change" : "Make default"}</button>
          </div>
          <div class="row">
            <div class="row-text">
              <div class="row-title">Terminal command and Explorer menus ${status(integrated, "Set up", "Not set up")}</div>
              <p>The <code>mdview</code> command in any new terminal, "Open with MDView" and "Watch with MDView" in right-click menus, and <code>mdview://</code> links.</p>
            </div>
            <button type="button" class="btn" data-act="${integrated ? "unregister" : "register"}">${integrated ? "Remove" : "Set up"}</button>
          </div>
        </section>`
            : ""
        }
        <section>
          <h3>AI agents</h3>
          <p class="section-note">Connect an agent and the Markdown files it writes open here by themselves.</p>
          ${agents
            .map(
              (a) => `
          <div class="row">
            <div class="row-text">
              <div class="row-title">${esc(a.name)} ${
                a.connected
                  ? '<span class="pill ok">Connected</span>'
                  : a.detected
                    ? ""
                    : '<span class="pill">Not found on this computer</span>'
              }</div>
              <p>${esc(a.detail)}</p>
            </div>
            <button type="button" class="btn ${a.connected ? "" : "primary"}" data-act="agent" data-id="${a.id}" data-connect="${!a.connected}">${a.connected ? "Disconnect" : "Connect"}</button>
          </div>`,
            )
            .join("")}
          <div class="row">
            <div class="row-text">
              <div class="row-title">Other agents (MCP)</div>
              <p>Cursor, Windsurf, Claude Desktop and others: add MDView as an MCP server with the command <code>${esc(exe)} --mcp</code>. Tools: <code>open_markdown</code>, <code>show_markdown</code>, <code>watch_folder</code>.</p>
            </div>
            <button type="button" class="btn" data-act="mcp">Copy config</button>
          </div>
        </section>
        <section>
          <h3>Watched folders</h3>
          <p class="section-note">MDView keeps an eye on these folders and opens Markdown files as agents write them.</p>
          <ul class="folder-list">
            ${
              prefs.watchDirs.length
                ? prefs.watchDirs
                    .map(
                      (d) => `<li><span class="folder-name" title="${esc(d)}">${esc(folderName(d))}</span><span class="folder-path">${esc(d)}</span>
                <button type="button" class="icon-btn" data-act="unwatch" data-dir="${esc(d)}" aria-label="Stop watching ${esc(d)}" title="Stop watching"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`,
                    )
                    .join("")
                : '<li class="folder-empty">No folders yet.</li>'
            }
          </ul>
          <button type="button" class="btn" data-act="watch">Watch a folder…</button>
          <label class="field">When a watched file is created or changed
            <select data-pref="autoOpen">
              <option value="all"${prefs.autoOpen === "all" ? " selected" : ""}>Open it (new and changed files)</option>
              <option value="new"${prefs.autoOpen === "new" ? " selected" : ""}>Open new files only</option>
              <option value="none"${prefs.autoOpen === "none" ? " selected" : ""}>Just list it under Activity</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" data-pref="focusAgent"${prefs.focusAgent ? " checked" : ""} /> Bring MDView to the front when an agent opens a new file</label>
        </section>
        <section>
          <h3>Shortcuts</h3>
          <label class="check"><input type="checkbox" data-pref="clipboardShortcut"${prefs.clipboardShortcut ? " checked" : ""} />
            <span>${SHORTCUT} from any app: open the file path on the clipboard, or show copied Markdown</span></label>
          <p class="section-note">Inside MDView, ${isMac ? "<kbd>Cmd</kbd>" : "<kbd>Ctrl</kbd>"}+<kbd>V</kbd> outside edit mode does the same.</p>
        </section>
        <section>
          <h3>Updates</h3>
          <div class="row">
            <div class="row-text"><div class="row-title">MDView ${esc(version)}</div></div>
            <button type="button" class="btn" data-act="update">Check now</button>
          </div>
          <label class="check"><input type="checkbox" data-pref="autoUpdate"${prefs.autoUpdate ? " checked" : ""} /> Check for updates when MDView starts</label>
        </section>
      </div>`;
    const body = modal.querySelector(".settings-body");
    if (body) body.scrollTop = scroll;
  }

  function close() {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    openModal = null;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("mousedown", (e) => e.target === backdrop && close());

  async function busy(button: HTMLButtonElement, job: () => Promise<unknown>) {
    button.disabled = true;
    try {
      await job();
    } catch (err) {
      await message(String(err), { title: "MDView", kind: "error" });
    } finally {
      await refresh();
    }
  }

  modal.addEventListener("click", (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>("button[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    switch (act) {
      case "close":
        close();
        break;
      case "default":
        void busy(button, () => invoke("open_default_apps"));
        deps.toast("In the window that opens, choose MDView for .md files.");
        break;
      case "register":
      case "unregister":
        void busy(button, async () => {
          await invoke("shell_register", { enable: act === "register" });
          deps.toast(
            act === "register"
              ? "Done. Open a new terminal and try: mdview --help"
              : "Removed the mdview command and Explorer menus.",
          );
        });
        break;
      case "agent":
        void busy(button, async () => {
          const result = await invoke<string>("connect_agent", {
            id: button.dataset.id,
            connect: button.dataset.connect === "true",
          });
          deps.toast(result);
        });
        break;
      case "mcp": {
        const config = { mcpServers: { mdview: { command: shell.exe || "mdview", args: ["--mcp"] } } };
        void navigator.clipboard.writeText(JSON.stringify(config, null, 2)).then(() => deps.toast("MCP config copied."));
        break;
      }
      case "watch":
        void deps.addWatchFolder().then(render);
        break;
      case "unwatch":
        deps.removeWatchFolder(button.dataset.dir ?? "");
        render();
        break;
      case "update":
        void busy(button, () => deps.checkForUpdates(true));
        break;
    }
  });

  modal.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement;
    const key = input.dataset.pref;
    if (!key) return;
    if (key === "autoOpen") prefs.autoOpen = input.value as typeof prefs.autoOpen;
    if (key === "focusAgent") prefs.focusAgent = (input as HTMLInputElement).checked;
    if (key === "autoUpdate") prefs.autoUpdate = (input as HTMLInputElement).checked;
    if (key === "clipboardShortcut") {
      prefs.clipboardShortcut = (input as HTMLInputElement).checked;
      void deps.setClipboardShortcut(prefs.clipboardShortcut);
    }
    savePrefs();
  });

  render();
  await refresh();
}
