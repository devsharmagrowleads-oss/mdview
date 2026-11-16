//! A small Model Context Protocol server (`mdview --mcp`), so any MCP-capable
//! agent can show Markdown in MDView. JSON-RPC 2.0, one message per line.

use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::cli::{is_doc_path, is_local_path};
use crate::launch;

const SUPPORTED_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

fn tools() -> Value {
    json!([
        {
            "name": "open_markdown",
            "title": "Open in MDView",
            "description": "Open a Markdown file in MDView so the user can read it formatted. Use after writing a plan, report, summary or other document the user should read. If the file is already open it is refreshed.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Absolute path of the .md file" } },
                "required": ["path"]
            }
        },
        {
            "name": "show_markdown",
            "title": "Show Markdown in MDView",
            "description": "Show Markdown text in MDView without the caller saving a file first. The text is saved as a temporary .md file named after the title; calling again with the same title updates that document.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short document title, used as the file name" },
                    "markdown": { "type": "string", "description": "The Markdown to show" }
                },
                "required": ["title", "markdown"]
            }
        },
        {
            "name": "watch_folder",
            "title": "Watch a folder in MDView",
            "description": "Ask MDView to watch a project folder and open Markdown files there as they are created or changed. The user is asked to confirm.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Absolute path of the folder" } },
                "required": ["path"]
            }
        }
    ])
}

/// A file name made from a title: letters, digits, dashes.
fn slug(title: &str) -> String {
    let mut out = String::new();
    for c in title.trim().chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= 60 {
            break;
        }
    }
    let out = out.trim_end_matches('-').to_owned();
    if out.is_empty() {
        "document".into()
    } else {
        out
    }
}

pub fn shown_documents_dir() -> PathBuf {
    std::env::temp_dir().join("MDView")
}

fn call_tool(name: &str, args: &Value) -> Result<String, String> {
    let arg = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_owned);
    match name {
        "open_markdown" => {
            let path = PathBuf::from(arg("path").ok_or("`path` is required")?);
            if !path.is_absolute() || !is_local_path(&path) {
                return Err("`path` must be an absolute path on this computer.".into());
            }
            if !path.is_file() {
                return Err(format!("{} does not exist.", path.display()));
            }
            if !is_doc_path(&path) {
                return Err("Only Markdown or text files can be opened.".into());
            }
            launch::open_for_agent(&[&path]).map_err(|e| e.to_string())?;
            Ok(format!("Opened {} in MDView.", path.display()))
        }
        "show_markdown" => {
            let title = arg("title").unwrap_or_else(|| "document".into());
            let markdown = arg("markdown").ok_or("`markdown` is required")?;
            let dir = shown_documents_dir();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{}.md", slug(&title)));
            std::fs::write(&path, markdown).map_err(|e| e.to_string())?;
            launch::open_for_agent(&[&path]).map_err(|e| e.to_string())?;
            Ok(format!("Showing \"{title}\" in MDView ({}).", path.display()))
        }
        "watch_folder" => {
            let path = PathBuf::from(arg("path").ok_or("`path` is required")?);
            if !path.is_absolute() || !is_local_path(&path) || !path.is_dir() {
                return Err("`path` must be an existing folder on this computer.".into());
            }
            let link = format!(
                "mdview://watch?path={}",
                url::form_urlencoded::byte_serialize(path.to_string_lossy().as_bytes()).collect::<String>()
            );
            launch::spawn_detached(&[link]).map_err(|e| e.to_string())?;
            Ok(format!("Asked MDView to watch {}. The user will be asked to confirm.", path.display()))
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

/// The response to one JSON-RPC message, or `None` for notifications.
pub fn handle(message: &Value) -> Option<Value> {
    let id = message.get("id")?.clone();
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = SUPPORTED_VERSIONS.iter().find(|v| **v == asked).copied().unwrap_or(SUPPORTED_VERSIONS[0]);
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "mdview", "title": "MDView", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Use open_markdown after writing a Markdown document the user should read, or show_markdown to display Markdown text directly."
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match call_tool(name, &args) {
                Ok(text) => json!({ "content": [{ "type": "text", "text": text }], "isError": false }),
                Err(text) => json!({ "content": [{ "type": "text", "text": text }], "isError": true }),
            }
        }
        _ => {
            return Some(json!({
                "jsonrpc": "2.0", "id": id,
                "error": { "code": -32601, "message": format!("Method not found: {method}") }
            }))
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

pub fn run() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                let replies: Vec<Value> = batch.iter().filter_map(handle).collect();
                (!replies.is_empty()).then(|| Value::Array(replies))
            }
            Ok(message) => handle(&message),
            Err(e) => Some(json!({
                "jsonrpc": "2.0", "id": null,
                "error": { "code": -32700, "message": format!("Parse error: {e}") }
            })),
        };
        if let Some(reply) = reply {
            if writeln!(stdout, "{reply}").and_then(|_| stdout.flush()).is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_and_list() {
        let init = handle(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}})).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        let unknown = handle(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}})).unwrap();
        assert_eq!(unknown["result"]["protocolVersion"], SUPPORTED_VERSIONS[0]);
        let list = handle(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})).unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 3);
        assert!(handle(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})).is_none());
        let missing = handle(&json!({"jsonrpc":"2.0","id":3,"method":"nope"})).unwrap();
        assert_eq!(missing["error"]["code"], -32601);
    }

    #[test]
    fn tool_errors_are_reported_not_thrown() {
        let r = handle(&json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"open_markdown","arguments":{"path":"relative.md"}}})).unwrap();
        assert_eq!(r["result"]["isError"], true);
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Q3 Plan: Launch!"), "q3-plan-launch");
        assert_eq!(slug("///"), "document");
    }
}
