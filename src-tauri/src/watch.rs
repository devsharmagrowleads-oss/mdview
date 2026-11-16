//! Watching project folders for Markdown files that agents create or change.

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

use crate::cli::{is_doc_path, is_local_path};

/// Folders that are never interesting and often huge or noisy.
const IGNORED_DIRS: [&str; 12] = [
    ".git", "node_modules", "target", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".cache", ".turbo",
    ".pnpm-store", ".mdview-tmp",
];

#[derive(Default)]
pub struct WatchState(Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Activity {
    path: String,
    /// The file did not exist before this event.
    created: bool,
}

fn ignored(path: &Path) -> bool {
    path.components().any(|c| match c {
        Component::Normal(name) => IGNORED_DIRS.iter().any(|d| name.eq_ignore_ascii_case(d)),
        _ => false,
    }) || path.file_name().is_some_and(|n| {
        let n = n.to_string_lossy();
        // Editor swap and temp files.
        n.starts_with(".#") || n.starts_with("~$") || n.ends_with(".mdview-tmp") || n.ends_with('~')
    })
}

/// Start watching exactly `dirs`. Returns the folders that could not be watched.
#[tauri::command]
pub fn set_watch_dirs(app: AppHandle, state: State<WatchState>, dirs: Vec<String>) -> Vec<String> {
    let mut slot = state.0.lock().unwrap();
    *slot = None;
    if dirs.is_empty() {
        return vec![];
    }
    let handle = app.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let created = matches!(event.kind, EventKind::Create(_));
        let relevant = created
            || matches!(event.kind, EventKind::Modify(_))
            || matches!(event.kind, EventKind::Any);
        if !relevant {
            return;
        }
        for path in event.paths {
            if is_doc_path(&path) && !ignored(&path) && path.is_file() {
                let _ = handle.emit("md-activity", Activity { path: path.to_string_lossy().into_owned(), created });
            }
        }
    });
    let mut watcher = match watcher {
        Ok(w) => w,
        Err(_) => return dirs,
    };
    let mut failed = Vec::new();
    for dir in dirs {
        let path = PathBuf::from(&dir);
        if !is_local_path(&path) || !path.is_dir() || watcher.watch(&path, RecursiveMode::Recursive).is_err() {
            failed.push(dir);
        }
    }
    *slot = Some(watcher);
    failed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_noise() {
        assert!(ignored(Path::new("/p/node_modules/x/README.md")));
        assert!(ignored(Path::new("/p/.git/COMMIT_EDITMSG.md")));
        assert!(ignored(Path::new("/p/docs/~$draft.md")));
        assert!(!ignored(Path::new("/p/docs/plan.md")));
    }
}
