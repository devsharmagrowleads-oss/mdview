//! Turning a command line or an `mdview://` link into requests for the app.
//! Everything here is pure (no UI), so it is unit-tested below.

use std::path::{Component, Path, PathBuf};

/// Extensions MDView opens as documents.
pub const DOC_EXTENSIONS: [&str; 5] = ["md", "markdown", "mdown", "mkd", "txt"];

/// Something the running app should do.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Request {
    /// Open a file. `agent` is set when an AI agent (hook, MCP, --from-agent) asked.
    Open { path: String, agent: bool },
    /// Watch a folder for Markdown files. `confirm` is set when the request came
    /// from a link (which any web page can produce), so the user must agree first.
    Watch { path: String, confirm: bool },
    /// Text from the clipboard (global shortcut): a path to open, or Markdown to show.
    Clipboard { text: String },
}

#[derive(Debug, PartialEq)]
pub enum Mode {
    /// Normal app start. `detached` means this process was already re-launched
    /// away from a terminal.
    Gui { requests: Vec<Request>, detached: bool },
    /// Read an agent hook payload on stdin and open the file it names.
    Hook,
    /// Serve the Model Context Protocol on stdin/stdout.
    Mcp,
    /// Add Explorer menus, the `mdview` command and the `mdview://` link type.
    Register,
    Unregister,
    Help,
    Version,
}

pub const HELP: &str = "MDView - Markdown viewer

Usage:
  mdview [FILE...]           Open Markdown files (a running MDView gets new tabs)
  mdview FOLDER              Watch a folder and open Markdown files as they appear
  mdview --watch [FOLDER]    Same, defaulting to the current folder
  mdview --from-agent FILE   Open a file on behalf of an AI agent
  mdview \"mdview://open?path=C:\\notes\\plan.md\"

For AI agents:
  mdview --hook              Read a Claude Code / Gemini CLI hook payload on stdin
                             and open the Markdown file it wrote
  mdview --mcp               Run as an MCP server (tools: open_markdown,
                             show_markdown, watch_folder)

Setup (Windows):
  mdview --register          Add Explorer menus, PATH entry and mdview:// links
  mdview --unregister        Remove them
";

pub fn is_doc_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| DOC_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// A path on this machine: a drive path on Windows, `/...` elsewhere. Network
/// shares and device paths are refused, because merely touching
/// `\\host\share` makes Windows send that host the user's credentials.
pub fn is_local_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::Prefix;
        matches!(
            path.components().next(),
            Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        ) && path.has_root()
    }
    #[cfg(not(windows))]
    {
        let s = path.to_string_lossy();
        s.starts_with('/') && !s.starts_with("//") && matches!(path.components().next(), Some(Component::RootDir))
    }
}

fn absolute(arg: &str, cwd: &Path) -> PathBuf {
    let p = PathBuf::from(arg);
    if p.is_absolute() {
        p
    } else {
        cwd.join(p)
    }
}

/// `notes.md:12` or `notes.md:12:4` names a file plus a position; keep the file.
fn strip_position(arg: &str) -> &str {
    let mut s = arg;
    for _ in 0..2 {
        match s.rfind(':') {
            Some(i) if i > 1 && s[i + 1..].chars().all(|c| c.is_ascii_digit()) && i + 1 < s.len() => s = &s[..i],
            _ => break,
        }
    }
    s
}

/// A file named on the command line, made absolute; `None` if it does not exist.
fn existing_file(arg: &str, cwd: &Path) -> Option<PathBuf> {
    let direct = absolute(arg, cwd);
    if direct.is_file() {
        return Some(direct);
    }
    let stripped = absolute(strip_position(arg), cwd);
    stripped.is_file().then_some(stripped)
}

fn to_string(p: PathBuf) -> String {
    p.to_string_lossy().into_owned()
}

/// Parse an `mdview://open?path=...` or `mdview://watch?path=...` link.
pub fn parse_link(link: &str) -> Option<Request> {
    let url = url::Url::parse(link).ok()?;
    if url.scheme() != "mdview" {
        return None;
    }
    let action = url
        .host_str()
        .filter(|h| !h.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| url.path().trim_matches('/').to_owned())
        .to_ascii_lowercase();
    let path = url
        .query_pairs()
        .find(|(k, _)| k == "path" || k == "file" || k == "dir")
        .map(|(_, v)| v.into_owned())?;
    let path = PathBuf::from(path);
    if !is_local_path(&path) {
        return None;
    }
    match action.as_str() {
        "open" if path.is_file() && is_doc_path(&path) => Some(Request::Open { path: to_string(path), agent: false }),
        "watch" if path.is_dir() => Some(Request::Watch { path: to_string(path), confirm: true }),
        _ => None,
    }
}

/// Parse process arguments (without the program name).
pub fn parse(args: &[String], cwd: &Path) -> Mode {
    match args.first().map(String::as_str) {
        Some("--hook") => return Mode::Hook,
        Some("--mcp") => return Mode::Mcp,
        Some("--register") => return Mode::Register,
        Some("--unregister") => return Mode::Unregister,
        Some("--help" | "-h" | "/?") => return Mode::Help,
        Some("--version" | "-V") => return Mode::Version,
        _ => {}
    }
    let mut requests = Vec::new();
    let mut detached = false;
    let mut agent = false;
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        i += 1;
        match arg {
            "--detached" => detached = true,
            "--from-agent" => agent = true,
            "--watch" => {
                let dir = match args.get(i) {
                    Some(next) if !next.starts_with('-') && !next.starts_with("mdview:") => {
                        i += 1;
                        absolute(next, cwd)
                    }
                    _ => cwd.to_path_buf(),
                };
                if dir.is_dir() {
                    requests.push(Request::Watch { path: to_string(dir), confirm: false });
                }
            }
            _ if arg.starts_with("mdview:") => requests.extend(parse_link(arg)),
            // Unknown flags (including ones the OS or WebView adds) are ignored.
            _ if arg.starts_with('-') => {}
            _ => {
                if let Some(file) = existing_file(arg, cwd) {
                    requests.push(Request::Open { path: to_string(file), agent: false });
                } else {
                    let dir = absolute(arg, cwd);
                    if dir.is_dir() {
                        requests.push(Request::Watch { path: to_string(dir), confirm: false });
                    }
                }
            }
        }
    }
    if agent {
        for r in &mut requests {
            if let Request::Open { agent: a, .. } = r {
                *a = true;
            }
        }
    }
    Mode::Gui { requests, detached }
}

/// Paths of Markdown files named in an agent hook payload. Understands
/// Claude Code (`tool_input.file_path`), Gemini CLI (`tool_input.file_path` /
/// `absolute_path`) and plain text (one path per line).
pub fn paths_from_hook(input: &str, fallback_cwd: &Path) -> Vec<PathBuf> {
    let mut candidates: Vec<String> = Vec::new();
    let mut cwd = fallback_cwd.to_path_buf();
    match serde_json::from_str::<serde_json::Value>(input) {
        Ok(json) => {
            if let Some(c) = json.get("cwd").and_then(|v| v.as_str()) {
                cwd = PathBuf::from(c);
            }
            let tool_input = json.get("tool_input").or_else(|| json.get("toolInput")).unwrap_or(&json);
            for key in ["file_path", "filePath", "absolute_path", "path", "notebook_path"] {
                if let Some(p) = tool_input.get(key).and_then(|v| v.as_str()) {
                    candidates.push(p.to_owned());
                }
            }
        }
        Err(_) => candidates.extend(input.lines().map(|l| l.trim().trim_matches('"').to_owned())),
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for c in candidates.into_iter().filter(|c| !c.is_empty()) {
        let p = absolute(&c, &cwd);
        if p.is_file() && is_doc_path(&p) && !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mdview-cli-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.md"), "# A").unwrap();
        std::fs::write(dir.join("b.txt"), "b").unwrap();
        std::fs::write(dir.join("c.rs"), "fn main(){}").unwrap();
        dir
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn opens_files_and_watches_folders() {
        let dir = tmp();
        let Mode::Gui { requests, detached } = parse(&s(&["a.md", "missing.md", "sub", "--detached"]), &dir) else {
            panic!()
        };
        assert!(detached);
        assert_eq!(requests.len(), 2);
        assert!(matches!(&requests[0], Request::Open { path, agent: false } if path.ends_with("a.md")));
        assert!(matches!(&requests[1], Request::Watch { path, confirm: false } if path.ends_with("sub")));
    }

    #[test]
    fn position_suffix_and_agent_flag() {
        let dir = tmp();
        let Mode::Gui { requests, .. } = parse(&s(&["--from-agent", "a.md:12:3"]), &dir) else { panic!() };
        assert!(matches!(&requests[0], Request::Open { agent: true, path } if path.ends_with("a.md")));
    }

    #[test]
    fn watch_defaults_to_cwd() {
        let dir = tmp();
        let Mode::Gui { requests, .. } = parse(&s(&["--watch"]), &dir) else { panic!() };
        assert_eq!(requests, vec![Request::Watch { path: to_string(dir.clone()), confirm: false }]);
    }

    #[test]
    fn modes() {
        let dir = tmp();
        assert_eq!(parse(&s(&["--hook"]), &dir), Mode::Hook);
        assert_eq!(parse(&s(&["--mcp"]), &dir), Mode::Mcp);
        assert_eq!(parse(&s(&["--help"]), &dir), Mode::Help);
    }

    #[test]
    fn links() {
        let dir = tmp();
        let file = dir.join("a.md");
        let enc: String = url::form_urlencoded::byte_serialize(file.to_string_lossy().as_bytes()).collect();
        let open = parse_link(&format!("mdview://open?path={enc}")).unwrap();
        assert!(matches!(open, Request::Open { agent: false, .. }));
        let enc_dir: String = url::form_urlencoded::byte_serialize(dir.to_string_lossy().as_bytes()).collect();
        let watch = parse_link(&format!("mdview://watch?path={enc_dir}")).unwrap();
        assert!(matches!(watch, Request::Watch { confirm: true, .. }));
        // Not a document, relative, or a network share: refused.
        let code: String = url::form_urlencoded::byte_serialize(dir.join("c.rs").to_string_lossy().as_bytes()).collect();
        assert_eq!(parse_link(&format!("mdview://open?path={code}")), None);
        assert_eq!(parse_link("mdview://open?path=a.md"), None);
        assert_eq!(parse_link("mdview://open?path=%5C%5Cevil%5Cshare%5Cx.md"), None);
        assert_eq!(parse_link("https://open?path=x"), None);
    }

    #[test]
    fn hook_payloads() {
        let dir = tmp();
        let file = dir.join("a.md");
        let json = serde_json::json!({
            "tool_name": "Write",
            "tool_input": { "file_path": file.to_string_lossy(), "content": "# A" }
        });
        assert_eq!(paths_from_hook(&json.to_string(), &dir), vec![file.clone()]);
        // Relative to the payload's cwd; non-Markdown ignored.
        let rel = serde_json::json!({ "cwd": dir.to_string_lossy(), "tool_input": { "file_path": "a.md" } });
        assert_eq!(paths_from_hook(&rel.to_string(), Path::new("/")), vec![file.clone()]);
        let code = serde_json::json!({ "tool_input": { "file_path": dir.join("c.rs").to_string_lossy() } });
        assert!(paths_from_hook(&code.to_string(), &dir).is_empty());
        // Plain text input.
        assert_eq!(paths_from_hook(&format!("\"{}\"\n", file.display()), &dir), vec![file]);
    }
}
