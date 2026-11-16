//! One-click connections to AI coding agents (Claude Code, Codex, Gemini CLI).
//!
//! Every change is reversible: MDView's additions are either JSON entries it
//! can recognise again or text between `mdview:start` / `mdview:end` markers.
//! Files are backed up once before MDView first changes them.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

const START: &str = "mdview:start";
const END: &str = "mdview:end";
const HOOK_FLAG: &str = "--hook";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    id: &'static str,
    name: &'static str,
    /// The agent's config folder exists on this computer.
    detected: bool,
    connected: bool,
    /// What connecting does (or did).
    detail: String,
}

pub fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn exe() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

// ---------- File helpers ----------

fn read(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

/// Write via a temporary file and a rename, keeping one backup of the original.
fn write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let backup = PathBuf::from(format!("{}.mdview-backup", path.display()));
        if !backup.exists() {
            std::fs::copy(path, &backup).map_err(|e| format!("Could not back up {}: {e}", path.display()))?;
        }
    }
    let tmp = PathBuf::from(format!("{}.mdview-tmp", path.display()));
    std::fs::write(&tmp, content).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not write {}: {e}", path.display())
    })
}

fn read_json(path: &Path) -> Result<Map<String, Value>, String> {
    let text = read(path)?;
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(format!(
            "{} is not plain JSON, so MDView left it alone. Fix or remove it and try again.",
            path.display()
        )),
    }
}

fn write_json(path: &Path, map: Map<String, Value>) -> Result<(), String> {
    let mut text = serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| e.to_string())?;
    text.push('\n');
    write(path, &text)
}

/// Text with MDView's marked block (whose marker lines use `comment`) removed.
pub fn strip_block(text: &str, comment: (&str, &str)) -> String {
    let start = format!("{} {START} {}", comment.0, comment.1);
    let end = format!("{} {END} {}", comment.0, comment.1);
    let (start, end) = (start.trim(), end.trim());
    let mut out = String::new();
    let mut inside = false;
    for line in text.split_inclusive('\n') {
        let t = line.trim();
        if t == start {
            inside = true;
        } else if inside && t == end {
            inside = false;
        } else if !inside {
            out.push_str(line);
        }
    }
    // Don't leave the blank line that separated the block behind.
    let trimmed = out.trim_end();
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}\n")
    }
}

pub fn add_block(text: &str, body: &str, comment: (&str, &str)) -> String {
    let base = strip_block(text, comment);
    let start = format!("{} {START} {}", comment.0, comment.1);
    let end = format!("{} {END} {}", comment.0, comment.1);
    let sep = if base.is_empty() { "" } else { "\n" };
    format!("{base}{sep}{}\n{}\n{}\n", start.trim(), body.trim_end(), end.trim())
}

pub fn has_block(text: &str) -> bool {
    text.lines().any(|l| l.contains(START))
}

const MD_COMMENT: (&str, &str) = ("<!--", "-->");
const TOML_COMMENT: (&str, &str) = ("#", "");

fn instructions(exe: &str) -> String {
    format!(
        "## Showing Markdown to the user (MDView)

When you create or substantially update a Markdown file that the user is meant to read
(a plan, report, summary, spec, notes), open it for them in MDView. It returns immediately:

    mdview --from-agent \"<absolute path of the .md file>\"

If `mdview` is not found, use the full path: `\"{exe}\" --from-agent \"<path>\"`
(in PowerShell, put `&` before the quoted program path).
If the `mdview` MCP tools are available, `open_markdown` does the same thing.
"
    )
}

// ---------- Claude Code ----------

fn claude_dir() -> PathBuf {
    home().join(".claude")
}

fn is_our_hook(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|c| c.to_ascii_lowercase().contains("mdview") && c.contains(HOOK_FLAG))
            })
        })
        .unwrap_or(false)
}

fn claude_connected() -> bool {
    let Ok(settings) = read_json(&claude_dir().join("settings.json")) else { return false };
    settings
        .get("hooks")
        .and_then(|h| h.get("PostToolUse"))
        .and_then(Value::as_array)
        .is_some_and(|list| list.iter().any(is_our_hook))
}

/// Remove MDView's hook from Claude Code settings; returns whether anything changed.
fn remove_claude_hook(settings: &mut Map<String, Value>) -> bool {
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else { return false };
    let Some(list) = hooks.get_mut("PostToolUse").and_then(Value::as_array_mut) else { return false };
    let before = list.len();
    list.retain(|e| !is_our_hook(e));
    let changed = list.len() != before;
    if list.is_empty() {
        hooks.remove("PostToolUse");
    }
    if hooks.is_empty() {
        settings.remove("hooks");
    }
    changed
}

fn connect_claude() -> Result<String, String> {
    let exe = exe()?;
    let path = claude_dir().join("settings.json");
    let mut settings = read_json(&path)?;
    remove_claude_hook(&mut settings);
    let hooks = settings.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("`hooks` in Claude Code settings is not an object")?;
    let list = hooks.entry("PostToolUse").or_insert_with(|| json!([]));
    let list = list.as_array_mut().ok_or("`hooks.PostToolUse` in Claude Code settings is not a list")?;
    // Forward slashes work in every shell Claude Code uses, including Git Bash.
    let command = format!("\"{}\" {HOOK_FLAG}", exe.replace('\\', "/"));
    list.push(json!({
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": command, "timeout": 10 }]
    }));
    write_json(&path, settings)?;

    let command_file = claude_dir().join("commands").join("mdview.md");
    write(
        &command_file,
        &format!(
            "---\ndescription: Open a Markdown file in MDView\nargument-hint: [file.md]\n---\n<!-- {START} (created by MDView; disconnecting removes it) -->\n\
Open $ARGUMENTS in MDView by running `\"{}\" --from-agent \"<absolute path>\"`. \
If no file was given, open the Markdown file you most recently wrote in this conversation.\n",
            exe.replace('\\', "/")
        ),
    )?;
    Ok("Markdown files Claude Code writes or edits now open in MDView. Added a /mdview command too. Restart running Claude Code sessions to pick this up.".into())
}

fn disconnect_claude() -> Result<String, String> {
    let path = claude_dir().join("settings.json");
    let mut settings = read_json(&path)?;
    if remove_claude_hook(&mut settings) {
        write_json(&path, settings)?;
    }
    let command_file = claude_dir().join("commands").join("mdview.md");
    if read(&command_file)?.contains(START) {
        let _ = std::fs::remove_file(command_file);
    }
    Ok("Claude Code no longer opens files in MDView.".into())
}

// ---------- Codex ----------

fn codex_dir() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".codex"))
}

fn toml_string(s: &str) -> String {
    if s.contains('\'') {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        format!("'{s}'")
    }
}

fn connect_codex() -> Result<String, String> {
    let exe = exe()?;
    let agents_md = codex_dir().join("AGENTS.md");
    write(&agents_md, &add_block(&read(&agents_md)?, &instructions(&exe), MD_COMMENT))?;

    let config = codex_dir().join("config.toml");
    let text = strip_block(&read(&config)?, TOML_COMMENT);
    let mut note = String::new();
    if text.contains("[mcp_servers.mdview]") {
        note = " Your config.toml already defines an `mdview` MCP server, so it was left as is.".into();
        write(&config, &text)?;
    } else {
        let block = format!("[mcp_servers.mdview]\ncommand = {}\nargs = [\"--mcp\"]", toml_string(&exe));
        write(&config, &add_block(&text, &block, TOML_COMMENT))?;
    }
    Ok(format!(
        "Codex now knows to open Markdown it writes in MDView, and has MDView's MCP tools.{note} Start a new Codex session to pick this up."
    ))
}

fn disconnect_codex() -> Result<String, String> {
    for (file, comment) in [("AGENTS.md", MD_COMMENT), ("config.toml", TOML_COMMENT)] {
        let path = codex_dir().join(file);
        let text = read(&path)?;
        if has_block(&text) {
            write(&path, &strip_block(&text, comment))?;
        }
    }
    Ok("Codex no longer opens files in MDView.".into())
}

fn codex_connected() -> bool {
    read(&codex_dir().join("AGENTS.md")).is_ok_and(|t| has_block(&t))
}

// ---------- Gemini CLI ----------

fn gemini_dir() -> PathBuf {
    home().join(".gemini")
}

fn connect_gemini() -> Result<String, String> {
    let exe = exe()?;
    let gemini_md = gemini_dir().join("GEMINI.md");
    write(&gemini_md, &add_block(&read(&gemini_md)?, &instructions(&exe), MD_COMMENT))?;
    let path = gemini_dir().join("settings.json");
    let mut settings = read_json(&path)?;
    let servers = settings.entry("mcpServers").or_insert_with(|| json!({}));
    let servers = servers.as_object_mut().ok_or("`mcpServers` in Gemini settings is not an object")?;
    servers.insert("mdview".into(), json!({ "command": exe, "args": ["--mcp"] }));
    write_json(&path, settings)?;
    Ok("Gemini CLI now knows to open Markdown it writes in MDView, and has MDView's MCP tools. Start a new session to pick this up.".into())
}

fn disconnect_gemini() -> Result<String, String> {
    let gemini_md = gemini_dir().join("GEMINI.md");
    let text = read(&gemini_md)?;
    if has_block(&text) {
        write(&gemini_md, &strip_block(&text, MD_COMMENT))?;
    }
    let path = gemini_dir().join("settings.json");
    let mut settings = read_json(&path)?;
    let removed = settings
        .get_mut("mcpServers")
        .and_then(Value::as_object_mut)
        .is_some_and(|s| s.remove("mdview").is_some());
    if removed {
        write_json(&path, settings)?;
    }
    Ok("Gemini CLI no longer opens files in MDView.".into())
}

fn gemini_connected() -> bool {
    read(&gemini_dir().join("GEMINI.md")).is_ok_and(|t| has_block(&t))
}

// ---------- Commands ----------

#[tauri::command(async)]
pub fn agent_status() -> Vec<AgentInfo> {
    vec![
        AgentInfo {
            id: "claude",
            name: "Claude Code",
            detected: claude_dir().is_dir(),
            connected: claude_connected(),
            detail: "Adds a hook that opens every .md file Claude Code writes or edits, plus a /mdview command.".into(),
        },
        AgentInfo {
            id: "codex",
            name: "Codex",
            detected: codex_dir().is_dir(),
            connected: codex_connected(),
            detail: "Adds an instruction to ~/.codex/AGENTS.md and MDView's MCP tools to config.toml.".into(),
        },
        AgentInfo {
            id: "gemini",
            name: "Gemini CLI",
            detected: gemini_dir().is_dir(),
            connected: gemini_connected(),
            detail: "Adds an instruction to ~/.gemini/GEMINI.md and MDView's MCP tools to settings.json.".into(),
        },
    ]
}

#[tauri::command(async)]
pub fn connect_agent(id: String, connect: bool) -> Result<String, String> {
    match (id.as_str(), connect) {
        ("claude", true) => connect_claude(),
        ("claude", false) => disconnect_claude(),
        ("codex", true) => connect_codex(),
        ("codex", false) => disconnect_codex(),
        ("gemini", true) => connect_gemini(),
        ("gemini", false) => disconnect_gemini(),
        _ => Err(format!("Unknown agent: {id}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_round_trip() {
        let original = "# My rules\n\nBe nice.\n";
        let added = add_block(original, "hello", MD_COMMENT);
        assert!(added.starts_with(original));
        assert!(added.contains("<!-- mdview:start -->\nhello\n<!-- mdview:end -->"));
        assert!(has_block(&added));
        // Adding twice keeps one block.
        let twice = add_block(&added, "hello", MD_COMMENT);
        assert_eq!(twice.matches(START).count(), 1);
        assert_eq!(strip_block(&twice, MD_COMMENT), original);
        assert_eq!(strip_block("", MD_COMMENT), "");
        let toml = add_block("model = 'x'\n", "[mcp_servers.mdview]", TOML_COMMENT);
        assert!(toml.contains("# mdview:start\n[mcp_servers.mdview]\n# mdview:end"));
        assert_eq!(strip_block(&toml, TOML_COMMENT), "model = 'x'\n");
    }

    #[test]
    fn claude_hook_is_recognised_and_removed_alone() {
        let mut settings = serde_json::from_value::<Map<String, Value>>(json!({
            "model": "opus",
            "hooks": { "PostToolUse": [
                { "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo hi" }] },
                { "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "\"C:/x/mdview.exe\" --hook" }] }
            ]}
        }))
        .unwrap();
        assert!(remove_claude_hook(&mut settings));
        let list = settings["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["matcher"], "Bash");
        assert_eq!(settings["model"], "opus");
        assert!(!remove_claude_hook(&mut settings));
    }

    #[test]
    fn toml_strings() {
        assert_eq!(toml_string(r"C:\a\mdview.exe"), r"'C:\a\mdview.exe'");
        assert_eq!(toml_string(r"C:\it's"), r#""C:\\it's""#);
    }
}
