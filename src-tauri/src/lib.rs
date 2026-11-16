mod agents;
mod cli;
mod launch;
mod mcp;
mod shell;
mod watch;

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use tauri::{AppHandle, Emitter, Manager, State};

use cli::{Mode, Request};

/// Largest image the viewer will load from disk.
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
];
/// Opens the file path (or shows the Markdown) that is on the clipboard.
/// Ctrl+Alt+M; on macOS Control+Option+M, because Cmd+Option+M is the
/// system's "minimise all windows".
const CLIPBOARD_SHORTCUT: &str = "Control+Alt+M";

/// Requests (files to open, folders to watch) the UI has not picked up yet.
#[derive(Default)]
struct Pending(Mutex<Vec<Request>>);

#[derive(serde::Serialize)]
struct FileData {
    content: String,
    mtime: f64,
    /// The file was not valid text; `content` is an approximation and must
    /// not be written back.
    lossy: bool,
}

/// Queue requests for the UI and tell it to come and get them.
fn deliver(app: &AppHandle, requests: Vec<Request>) {
    if requests.is_empty() {
        return;
    }
    if let Some(pending) = app.try_state::<Pending>() {
        pending.0.lock().unwrap().extend(requests);
    }
    let _ = app.emit("requests-pending", ());
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn gui_requests(argv: &[String], cwd: &Path) -> Vec<Request> {
    match cli::parse(argv.get(1..).unwrap_or(&[]), cwd) {
        Mode::Gui { requests, .. } => requests,
        _ => vec![],
    }
}

fn mtime_of(path: &Path) -> Result<f64, String> {
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0))
}

/// Decode a text file. Returns the text and whether decoding lost information.
fn decode_text(bytes: &[u8]) -> (String, bool) {
    let utf16 = |be: bool| {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| {
                if be {
                    u16::from_be_bytes([c[0], c[1]])
                } else {
                    u16::from_le_bytes([c[0], c[1]])
                }
            })
            .collect();
        String::from_utf16_lossy(&units)
    };
    let utf8 = |b: &[u8]| match std::str::from_utf8(b) {
        Ok(s) => (s.to_owned(), false),
        Err(_) => (String::from_utf8_lossy(b).into_owned(), true),
    };
    match bytes {
        [0xFF, 0xFE, ..] => (utf16(false), false),
        [0xFE, 0xFF, ..] => (utf16(true), false),
        [0xEF, 0xBB, 0xBF, rest @ ..] => utf8(rest),
        _ => utf8(bytes),
    }
}

/// The drive/share a path lives on (`C:`, `\\server\share`), if it names one.
fn root_of(path: &Path) -> Option<Component<'_>> {
    match path.components().next() {
        Some(prefix @ Component::Prefix(_)) => Some(prefix),
        _ => None,
    }
}

/// A path that came out of a document may only point at a local drive, or at
/// the share the document itself is on. Anything else (`\\host\share`,
/// `//host@8080/x`, device paths) would make Windows contact that host and
/// hand it the user's credentials.
fn is_safe_target(base: &Path, resolved: &Path) -> bool {
    use std::path::Prefix;
    match root_of(resolved) {
        None => true,
        Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) => true,
        other => other == root_of(base),
    }
}

#[tauri::command]
fn take_pending(pending: State<Pending>) -> Vec<Request> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

/// Write raw bytes (exports such as .docx). The path travels in a header,
/// percent-encoded, so the body can stay binary.
#[tauri::command(async)]
fn write_binary_file(request: tauri::ipc::Request) -> Result<(), String> {
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("No path given.")?;
    let path: String = url::form_urlencoded::parse(format!("p={encoded}").as_bytes())
        .next()
        .map(|(_, p)| p.into_owned())
        .ok_or("No path given.")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary data.".into());
    };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExistingPath {
    path: String,
    is_dir: bool,
}

/// Resolve a path mentioned in a document (`src/main.ts`, `../plan.md`,
/// `C:\x\y.md`, `~/notes.md`), returning it only if it exists locally.
#[tauri::command(async)]
fn resolve_existing(base_file: Option<String>, target: String) -> Option<ExistingPath> {
    let target = target.trim().trim_matches('`').trim_matches('"');
    if target.is_empty() || target.len() > 1024 {
        return None;
    }
    let raw = match target.strip_prefix("~/").or_else(|| target.strip_prefix("~\\")) {
        Some(rest) => agents::home().join(rest),
        None => PathBuf::from(target),
    };
    let joined = if raw.is_absolute() {
        raw
    } else {
        Path::new(base_file.as_deref()?).parent()?.join(raw)
    };
    let mut out = PathBuf::new();
    for part in joined.components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    if !cli::is_local_path(&out) {
        return None;
    }
    let meta = std::fs::metadata(&out).ok()?;
    Some(ExistingPath { path: out.to_string_lossy().into_owned(), is_dir: meta.is_dir() })
}

/// Show a non-Markdown file mentioned in a document: in VS Code or Cursor at
/// the given line if one is installed, otherwise selected in its folder.
/// Never runs the file.
#[tauri::command(async)]
fn open_in_editor(path: String, line: Option<u32>, column: Option<u32>) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !cli::is_local_path(&p) || !p.exists() {
        return Err("That file is not on this computer.".into());
    }
    if p.is_file() {
        for (scheme, name) in [("vscode", "VS Code"), ("cursor", "Cursor")] {
            if shell::has_scheme(scheme) {
                let mut target = path.replace('\\', "/");
                if let Some(l) = line {
                    target.push_str(&format!(":{l}:{}", column.unwrap_or(1)));
                }
                let encoded = target.replace('%', "%25").replace(' ', "%20").replace('#', "%23");
                let lead = if encoded.starts_with('/') { "" } else { "/" };
                tauri_plugin_opener::open_url(format!("{scheme}://file{lead}{encoded}"), None::<&str>)
                    .map_err(|e| e.to_string())?;
                return Ok(name.into());
            }
        }
    }
    tauri_plugin_opener::reveal_item_in_dir(&p).map_err(|e| e.to_string())?;
    Ok("folder".into())
}

/// Turn the clipboard shortcut on or off.
#[tauri::command]
fn set_clipboard_shortcut(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcuts = app.global_shortcut();
    let registered = shortcuts.is_registered(CLIPBOARD_SHORTCUT);
    if enabled && !registered {
        shortcuts.register(CLIPBOARD_SHORTCUT).map_err(|e| e.to_string())?;
    } else if !enabled && registered {
        shortcuts.unregister(CLIPBOARD_SHORTCUT).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command(async)]
fn read_text_file(path: String) -> Result<FileData, String> {
    // Stat before reading: if another program is mid-write, the worst case is
    // one extra reload rather than stale content pinned to a fresh timestamp.
    let mtime = mtime_of(Path::new(&path))?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let (content, lossy) = decode_text(&bytes);
    Ok(FileData {
        content,
        mtime,
        lossy,
    })
}

#[tauri::command(async)]
fn write_text_file(path: String, content: String) -> Result<f64, String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    mtime_of(Path::new(&path))
}

#[tauri::command(async)]
fn file_mtime(path: String) -> Result<f64, String> {
    mtime_of(Path::new(&path))
}

/// Resolve a link or image `target` found in a document against the folder
/// that contains `base_file`.
#[tauri::command]
fn resolve_path(base_file: String, target: String) -> Result<String, String> {
    let base = Path::new(&base_file).parent().unwrap_or(Path::new(""));
    let mut out = PathBuf::new();
    for part in base.join(&target).components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    if !is_safe_target(base, &out) {
        return Err("Links to network locations are not followed.".into());
    }
    Ok(out.to_string_lossy().into_owned())
}

/// Raw bytes of a local image (used to show images that sit next to a document).
#[tauri::command(async)]
fn read_image_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err("Not an image file.".into());
    }
    let size = std::fs::metadata(p).map_err(|e| e.to_string())?.len();
    if size > MAX_IMAGE_BYTES {
        return Err("Image is too large.".into());
    }
    std::fs::read(p)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// The stock macOS menu's Quit item ends the process immediately, without
/// giving the window a chance to ask about unsaved changes. This menu's Quit
/// (Cmd+Q) closes the window instead, which runs the same "Save changes?"
/// flow as the red close button; the app exits once the window is gone.
#[cfg(target_os = "macos")]
fn install_mac_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let about = AboutMetadata {
        name: Some("MDView".into()),
        version: Some(app.package_info().version.to_string()),
        authors: Some(vec!["Dev Sharma".into()]),
        comments: Some("MDView is made by Dev Sharma".into()),
        ..Default::default()
    };
    let quit = MenuItemBuilder::with_id("quit", "Quit MDView")
        .accelerator("Cmd+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "MDView")
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    // Without an Edit menu, Cmd+C / Cmd+V / Cmd+Z do nothing in a macOS webview.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .fullscreen()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "quit" {
            match app.get_webview_window("main") {
                Some(window) => {
                    let _ = window.close();
                }
                None => app.exit(0),
            }
        }
    });
    Ok(())
}

/// Handle the modes that never open a window. Returns the requests the window
/// should handle, or `None` when there is no window to start.
fn run_cli() -> Option<Vec<Request>> {
    let args: Vec<String> = std::env::args().collect();
    let rest = args.get(1..).unwrap_or(&[]);
    let cwd = std::env::current_dir().unwrap_or_default();
    let exe = std::env::current_exe().unwrap_or_default();
    match cli::parse(rest, &cwd) {
        Mode::Gui { requests, detached } => {
            // From a terminal, start the window in the background and return
            // at once, so the shell (or agent) is not blocked until it closes.
            if !detached && !cfg!(debug_assertions) && launch::attach_terminal() {
                if let Err(e) = launch::spawn_detached(rest) {
                    launch::say(&format!("mdview: could not start: {e}
"));
                }
                return None;
            }
            Some(requests)
        }
        Mode::Hook => {
            // Agent hooks must never fail or slow the agent down.
            let mut input = String::new();
            let _ = std::io::Read::read_to_string(&mut std::io::stdin(), &mut input);
            let _ = launch::open_for_agent(&cli::paths_from_hook(&input, &cwd));
            None
        }
        Mode::Mcp => {
            mcp::run();
            None
        }
        mode @ (Mode::Register | Mode::Unregister) => {
            launch::attach_terminal();
            let result = if mode == Mode::Register { shell::register(&exe) } else { shell::unregister(&exe) };
            launch::say(&match result {
                Ok(()) => "mdview: done
".to_owned(),
                Err(e) => format!("mdview: {e}
"),
            });
            None
        }
        Mode::Help => {
            launch::attach_terminal();
            launch::say(cli::HELP);
            None
        }
        Mode::Version => {
            launch::attach_terminal();
            launch::say(&format!("mdview {}
", env!("CARGO_PKG_VERSION")));
            None
        }
    }
}

pub fn run() {
    let Some(initial) = run_cli() else { return };

    let app = tauri::Builder::default()
        // Must be registered first: a second launch (double-clicking another
        // file, a terminal command, an agent) hands its requests to the window
        // that is already open.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let requests = gui_requests(&argv, Path::new(&cwd));
            // The UI focuses an agent's file only when it is new, so an agent
            // editing a file repeatedly doesn't keep stealing focus.
            let quiet = !requests.is_empty()
                && requests.iter().all(|r| matches!(r, Request::Open { agent: true, .. }));
            deliver(app, requests);
            if !quiet {
                focus_main(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_clipboard_manager::ClipboardExt;
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if let Ok(text) = app.clipboard().read_text() {
                        if !text.trim().is_empty() {
                            deliver(app, vec![Request::Clipboard { text }]);
                            focus_main(app);
                        }
                    }
                })
                .build(),
        )
        .manage(Pending::default())
        .manage(watch::WatchState::default())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            install_mac_menu(app.handle())?;
            app.state::<Pending>().0.lock().unwrap().extend(initial);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending,
            read_text_file,
            write_text_file,
            write_binary_file,
            file_mtime,
            resolve_path,
            resolve_existing,
            open_in_editor,
            read_image_file,
            print_page,
            set_clipboard_shortcut,
            watch::set_watch_dirs,
            agents::agent_status,
            agents::connect_agent,
            shell::shell_status,
            shell::shell_register,
            shell::open_default_apps
        ])
        .build(tauri::generate_context!())
        .expect("error while building MDView");

    app.run(|_app, _event| {
        // macOS delivers double-clicked files and mdview:// links as an event,
        // not as arguments.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let requests = urls
                .iter()
                .filter_map(|u| {
                    if u.scheme() == "mdview" {
                        cli::parse_link(u.as_str())
                    } else {
                        u.to_file_path().ok().map(|p| Request::Open {
                            path: p.to_string_lossy().into_owned(),
                            agent: false,
                        })
                    }
                })
                .collect();
            deliver(_app, requests);
        }
    });
}
