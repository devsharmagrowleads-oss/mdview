<p align="center">
  <img src="docs/logo.png" width="112" alt="MDView logo" />
</p>

<h1 align="center">MDView</h1>

<p align="center">
  <b>Double-click a Markdown file. Read it. Edit it. Done.</b><br />
  A light, offline Markdown viewer and editor for Windows, macOS and Linux.
</p>

<p align="center">
  <a href="https://github.com/devsharmagrowleads-oss/mdview/releases/latest"><img src="https://img.shields.io/github/v/release/devsharmagrowleads-oss/mdview?style=for-the-badge&color=2a5bd7&label=download" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/macOS-111111?style=for-the-badge&logo=apple&logoColor=white" alt="macOS" />
  <img src="https://img.shields.io/badge/Linux-E95420?style=for-the-badge&logo=linux&logoColor=white" alt="Linux" />
  <img src="https://img.shields.io/badge/price-free-2ea44f?style=for-the-badge" alt="Free" />
  <img src="https://img.shields.io/badge/license-MIT-8250df?style=for-the-badge" alt="MIT license" />
</p>

<p align="center">
  <a href="#-download">Download</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-for-ai-agents">For AI agents</a> ·
  <a href="#-how-to-use">How to use</a> ·
  <a href="#%EF%B8%8F-keyboard-shortcuts">Shortcuts</a> ·
  <a href="#-good-to-know">Good to know</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/view-dark.png" />
    <img src="docs/screenshots/view-light.png" alt="MDView showing a Markdown document with an outline sidebar, a checklist and a table" width="920" />
  </picture>
</p>

## Why MDView

AI tools write Markdown all day: plans, specs, READMEs, notes. Reading one usually means opening a code editor and finding the preview button.

MDView makes a `.md` file behave like any other document. Double-click it and it opens, formatted, in a small fast window. The installer is about **2.4 MB** on Windows, because MDView uses the webview already built into your system instead of shipping its own browser.

It is free for everyone, works with no internet connection, and never sends anything anywhere.

## 📦 Download

| Your computer | File to download |
| --- | --- |
| **Windows** 10 / 11 | [`MDView_0.1.0_x64-setup.exe`](https://github.com/devsharmagrowleads-oss/mdview/releases/download/v0.1.0/MDView_0.1.0_x64-setup.exe) |
| **macOS** (Intel and Apple Silicon) | [`MDView_0.1.0_universal.dmg`](https://github.com/devsharmagrowleads-oss/mdview/releases/download/v0.1.0/MDView_0.1.0_universal.dmg) |
| **Linux** (Debian, Ubuntu) | [`MDView_0.1.0_amd64.deb`](https://github.com/devsharmagrowleads-oss/mdview/releases/download/v0.1.0/MDView_0.1.0_amd64.deb) |
| **Linux** (Fedora, RHEL) | [`MDView-0.1.0-1.x86_64.rpm`](https://github.com/devsharmagrowleads-oss/mdview/releases/download/v0.1.0/MDView-0.1.0-1.x86_64.rpm) |
| **Linux** (any) | [`MDView_0.1.0_amd64.AppImage`](https://github.com/devsharmagrowleads-oss/mdview/releases/download/v0.1.0/MDView_0.1.0_amd64.AppImage) |

Newer versions, when there are any, are on the [releases page](https://github.com/devsharmagrowleads-oss/mdview/releases/latest).

> [!NOTE]
> The installers are not code-signed yet, so your system will ask before running them.
> **Windows:** click **More info**, then **Run anyway**.
> **macOS:** right-click the app, choose **Open**, then **Open** again. You only do this once.

## ✨ Features

| | |
| --- | --- |
| 📂 **Opens on double-click** | Installs as the app for `.md`, `.markdown`, `.mdown` and `.mkd` files. |
| 👁️ **View and Edit modes** | Files open read-only. Switch to Edit and type straight into the formatted page. |
| 🗂️ **Tabs** | Several files in one window. Opening another file adds a tab. |
| 🧭 **Outline** | A sidebar built from the headings; click to jump. |
| 🔎 **Find** | Search the document with a match count and next / previous. |
| 🖨️ **PDF and print** | Send the formatted document to a printer or save it as a PDF. |
| 🌗 **Light and dark** | One click to switch; your choice is remembered. |
| 🔄 **Live reload** | When another program rewrites the file, the view refreshes by itself. |
| 🧱 **Rich Markdown** | Tables, task lists, highlighted code, math, quotes and local images. |
| 🧾 **Front matter** | YAML at the top of a file is tucked into a panel and saved back untouched. |
| 🔒 **Private** | Fully offline. Web images are never fetched, so opening a file tells no one. |
| 🤖 **AI agent integration** | Claude Code, Codex and Gemini CLI open the Markdown they write in MDView. One click in Settings. |
| 👀 **Watched folders** | Point MDView at a project and new or changed `.md` files open as they are written. |
| 🟩 **What changed** | When a file is rewritten, the changed parts are highlighted, with **Next** to step through them. |
| 📊 **Diagrams** | ` ```mermaid ` blocks are drawn as diagrams. |
| 🧮 **Sort and filter tables** | Hover a table and press **Sort & filter**; copy the result as CSV. The file is not changed. |
| 📤 **Export** | Copy formatted for Gmail, Docs or Slack, or save as HTML, Word (.docx) or PDF. |
| 🔗 **Clickable file names** | `` `src/app.ts:42` `` in a document opens in VS Code at that line; `` `notes.md` `` opens in a tab. |
| ⌨️ **`mdview` command** | `mdview notes.md`, `mdview --watch`, Explorer right-click menus and `mdview://` links. |
| ⬆️ **Updates** | MDView tells you when a new version is out and installs it for you. |

### Read

Code blocks are highlighted, math is typeset, and images stored next to the document are shown.

<p align="center">
  <img src="docs/screenshots/code-math-light.png" alt="A code block, a quote, a math formula and an image rendered in MDView" width="860" />
</p>

### Edit

Press **Edit** and the page becomes editable, with a formatting bar for headings, lists, tables, links, code and math. There is no separate "source" pane to manage.

<p align="center">
  <img src="docs/screenshots/edit-light.png" alt="MDView in edit mode with the formatting bar visible" width="860" />
</p>

### Find

<p align="center">
  <img src="docs/screenshots/find-dark.png" alt="Find in document with matches highlighted" width="860" />
</p>

### Start screen

<p align="center">
  <img src="docs/screenshots/start-dark.png" alt="MDView start screen with Open file and New document buttons" width="860" />
</p>

## 🤖 For AI agents

AI coding agents write plans, reports and notes as Markdown and print the file name in the terminal. MDView opens those files for you, formatted, as soon as they are written.

1. Open **Settings** (gear icon, <kbd>Ctrl</kbd> <kbd>,</kbd>) and press **Connect** next to your agent.

   | Agent | What happens |
   | --- | --- |
   | **Claude Code** | Every `.md` file it writes or edits opens in MDView. A `/mdview` command is added too. |
   | **Codex**, **Gemini CLI** | The agent is told to open the Markdown it writes in MDView, and gets MDView's MCP tools. |
   | **Anything else** | Watch the project folder (**Activity → Add**, `mdview --watch`, or right-click a folder → **Watch with MDView**). |

2. Make MDView your default app for `.md` files (MDView offers this on first start). Then <kbd>Ctrl</kbd> + click on a file name in the terminal opens it here too.

When an agent edits a file that is already open, MDView reloads it and highlights what changed. **Activity** lists everything agents wrote recently.

Claude Code users can also install the plugin:

```
/plugin install mdview --marketplace devsharmagrowleads-oss/mdview
```

On older versions of Claude Code: `/plugin marketplace add devsharmagrowleads-oss/mdview`, then `/plugin install mdview@mdview`.

Any MCP client (Cursor, Windsurf, Claude Desktop) can use `mdview --mcp`, which offers `open_markdown`, `show_markdown` and `watch_folder`. Details are in [integrations/README.md](integrations/README.md).

## 🚀 How to use

1. **Install it.** Download the file for your computer from the table above and run it.
2. **Open a file.** Double-click any `.md` file. You can also drag a file onto the MDView window, or press **Open**.
   If `.md` files still open in another app, right-click one, choose **Open with**, pick MDView and tick **Always**.
3. **Read.** Use **Outline** to jump between sections and **Find** to search. **Dark** / **Light** switches the theme.
4. **Edit.** Press **Edit**, then type. Use the formatting bar, or type `/` on an empty line for a menu of blocks. Press **Save** when you are done; a dot on the tab means there are unsaved changes.
5. **Share.** Press **Export** to copy the document formatted for email or chat, or save it as HTML, Word or PDF.
6. **Paste to open.** Copy a file path or some Markdown and press <kbd>Ctrl</kbd> <kbd>V</kbd> in MDView (outside edit mode), or <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>M</kbd> from any app (macOS: <kbd>Control</kbd> <kbd>Option</kbd> <kbd>M</kbd>).

Working alongside an AI tool? Leave the file open in MDView. Each time the tool rewrites it, the view updates on its own.

## ⌨️ Keyboard shortcuts

On macOS use <kbd>Cmd</kbd> in place of <kbd>Ctrl</kbd>.

| Action | Shortcut |
| --- | --- |
| Open a file | <kbd>Ctrl</kbd> <kbd>O</kbd> |
| New document | <kbd>Ctrl</kbd> <kbd>N</kbd> |
| Save | <kbd>Ctrl</kbd> <kbd>S</kbd> |
| Save as | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>S</kbd> |
| Start editing | <kbd>Ctrl</kbd> <kbd>E</kbd> |
| Switch between View and Edit | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>E</kbd> |
| Find | <kbd>Ctrl</kbd> <kbd>F</kbd>, then <kbd>Enter</kbd> / <kbd>Shift</kbd> <kbd>Enter</kbd> |
| Show or hide the outline | <kbd>Ctrl</kbd> <kbd>\</kbd> |
| PDF / Print | <kbd>Ctrl</kbd> <kbd>P</kbd> |
| Settings | <kbd>Ctrl</kbd> <kbd>,</kbd> |
| Open the path or Markdown on the clipboard (from any app) | <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>M</kbd> (macOS: <kbd>Control</kbd> <kbd>Option</kbd> <kbd>M</kbd>) |
| Close the tab | <kbd>Ctrl</kbd> <kbd>W</kbd> |
| Next / previous tab | <kbd>Ctrl</kbd> <kbd>Tab</kbd> / <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Tab</kbd> |
| Follow a link while editing | <kbd>Ctrl</kbd> + click |

## 💡 Good to know

- **A file you only view is never changed.** Saving an edited file rewrites its Markdown in a consistent style (table columns are padded to line up, for example). The content stays the same; the raw text can differ slightly.
- **Web images are left blank.** MDView never goes online to show a document, so only images stored on your computer are shown. The only network request MDView makes is the update check, which you can turn off in Settings.
- **Connecting an agent edits its config file.** MDView backs the file up once (`*.mdview-backup`) and **Disconnect** removes exactly what it added.
- **Word export** carries the formatted page inside the .docx; Word converts it when the file is opened. Other word processors may not show it.
- **Raw HTML is shown as text,** not rendered.
- **Pasting an image into a document is not supported yet.**
- **Files that are not UTF-8 text open read-only,** so they cannot be damaged.
- The macOS and Linux builds are produced automatically and have had less hands-on testing than the Windows one. If something is off, please [open an issue](https://github.com/devsharmagrowleads-oss/mdview/issues).

## 🛠️ Build it yourself

You need [Node.js](https://nodejs.org) 20.19 or newer on the 20.x line, or 22.12 or newer (required by the Vite version this project uses), [Rust](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system.

```sh
npm install
npm run app:dev      # run the app with hot reload
npm run app:build    # build the installer for the system you are on
```

Pushing a version tag such as `v0.2.0` makes GitHub Actions build the installers for all three systems and attach them to a draft release. See [docs/RELEASING.md](docs/RELEASING.md) for signing and package managers.

```
index.html, src/     the interface (TypeScript, Milkdown Crepe editor)
src-tauri/           the desktop shell (Rust): files, file associations, single window,
                     command line, MCP server, folder watching, agent connections
integrations/        Claude Code plugin and agent setup notes
packaging/           winget / Scoop / Homebrew manifest generator
docs/                logo, screenshots and the demo document shown above
```

## License

[MIT](LICENSE). Free to use, share and modify.

---

<p align="center">
  <b>MDView is made by Dev Sharma.</b>
</p>
