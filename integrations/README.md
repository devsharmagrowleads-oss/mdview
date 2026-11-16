# MDView for AI agents

MDView can open the Markdown files your AI agent writes, as soon as it writes them.
All of these need MDView installed. On Windows the installer also adds the `mdview`
command; on macOS run once:

```sh
sudo ln -sf /Applications/MDView.app/Contents/MacOS/mdview /usr/local/bin/mdview
```

## The easy way: from MDView

Open **Settings** (gear icon, or <kbd>Ctrl</kbd>+<kbd>,</kbd>) and press **Connect** next to
Claude Code, Codex or Gemini CLI. Disconnect removes exactly what was added, and the original
config file is backed up once as `*.mdview-backup`.

| Agent | What Connect adds |
| --- | --- |
| Claude Code | A `PostToolUse` hook in `~/.claude/settings.json` that opens every `.md` file written or edited, plus a `/mdview` command |
| Codex | An instruction in `~/.codex/AGENTS.md` and the MDView MCP server in `~/.codex/config.toml` |
| Gemini CLI | An instruction in `~/.gemini/GEMINI.md` and the MDView MCP server in `~/.gemini/settings.json` |

## Claude Code plugin

The same Claude Code integration as a plugin, plus MDView's MCP tools:

```
/plugin install mdview --marketplace devsharmagrowleads-oss/mdview
```

On older versions of Claude Code:

```
/plugin marketplace add devsharmagrowleads-oss/mdview
/plugin install mdview@mdview
```

Use either the plugin or **Connect** in MDView, not both (both work, but each file is then
handed to MDView twice).

## Any MCP client

```json
{
  "mcpServers": {
    "mdview": { "command": "mdview", "args": ["--mcp"] }
  }
}
```

Tools:

| Tool | Does |
| --- | --- |
| `open_markdown(path)` | Opens a `.md` file in MDView, or refreshes it if it is open |
| `show_markdown(title, markdown)` | Shows Markdown text without saving a file first |
| `watch_folder(path)` | Asks the user to let MDView watch a folder |

## No integration at all: watch a folder

`mdview --watch` in a project folder (or **Activity → Watched folders → Add**, or right-click a
folder in Explorer → **Watch with MDView**) opens every Markdown file created or changed there.
This works with any agent or tool.

## Command line

```
mdview notes.md              open a file (a running MDView gets a new tab)
mdview --watch [folder]      watch a folder
mdview --from-agent FILE     open on behalf of an agent (only takes focus for new files)
mdview --hook                read a Claude Code / Gemini CLI hook payload from stdin
mdview --mcp                 run as an MCP server
mdview "mdview://open?path=C:\notes\plan.md"
```
