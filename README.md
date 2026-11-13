# MDView

A light, offline desktop app for reading and editing Markdown files. Double-click a `.md` file and it opens rendered, the way a `.docx` opens in Word.

Free for everyone to use. Made by Dev Sharma.

Runs on Windows, macOS and Linux. Built with [Tauri](https://tauri.app), so it uses the system's own webview instead of bundling a browser.

## What it does

- **Opens `.md` files by double-click.** The installer registers MDView for `.md`, `.markdown`, `.mdown` and `.mkd`. Opening a second file adds a tab to the window that is already open.
- **View and Edit modes.** Files open read-only. Switch to Edit and type straight into the formatted document; a formatting bar appears, and `/` opens a block menu.
- **Tabs** for several files in one window.
- **Outline** sidebar built from the document's headings.
- **Find in document** with match count and next / previous.
- **PDF / Print** through the system print dialog (choose "Save as PDF" there).
- **Light and dark themes.**
- **Live reload.** When another program rewrites the file you are looking at (an AI agent, for instance), the view refreshes. If you have unsaved edits you are asked first.
- Tables, task lists, code blocks with syntax highlighting, math, and images stored next to the document.
- YAML front matter is shown in a collapsed panel and written back untouched.

## Keyboard shortcuts

Use `Cmd` instead of `Ctrl` on macOS.

| Action | Shortcut |
| --- | --- |
| Open file | `Ctrl+O` |
| New document | `Ctrl+N` |
| Save / Save as | `Ctrl+S` / `Ctrl+Shift+S` |
| Start editing | `Ctrl+E` |
| Switch View / Edit | `Ctrl+Shift+E` |
| Find | `Ctrl+F`, then `Enter` / `Shift+Enter` |
| Outline | `Ctrl+\` |
| PDF / Print | `Ctrl+P` |
| Close tab | `Ctrl+W` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Follow a link while editing | `Ctrl+Click` |

## Good to know

- Saving an edited file rewrites its Markdown in a consistent style (for example `*` list bullets may become `-`). The content is the same; the raw text can differ slightly. A file you only view is never modified.
- Raw HTML inside a Markdown file is shown as text, not rendered.
- MDView never goes online. Images stored on your computer are shown; images that point at a web address are left blank, so opening a file cannot tell anyone you opened it.
- Pasting an image into a document is not supported yet.
- Files that are not UTF-8 text open read-only so they cannot be damaged.

## Development

Needs [Node.js](https://nodejs.org), [Rust](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run app:dev      # run the app with hot reload
npm run app:build    # build the installer for the OS you are on
```

Installers are written to the Cargo target directory under `release/bundle/`.

### Building for all three platforms

An installer can only be built on its own OS. `.github/workflows/build.yml` builds all three on GitHub Actions: push the project to GitHub, then push a tag such as `v0.1.0` (or run the workflow manually) and the Windows, macOS and Linux installers are attached to a draft release.

## Layout

```
index.html, src/     UI (TypeScript, Milkdown Crepe editor)
src-tauri/           Desktop shell (Rust): file access, file associations, single instance
```
