use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use tauri::{AppHandle, Emitter, Manager, State};

/// Largest image the viewer will load from disk.
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
];

/// Files the OS asked us to open that the UI has not picked up yet.
#[derive(Default)]
struct Pending(Mutex<Vec<String>>);

#[derive(serde::Serialize)]
struct FileData {
    content: String,
    mtime: f64,
    /// The file was not valid text; `content` is an approximation and must
    /// not be written back.
    lossy: bool,
}

/// Turn process arguments into absolute paths of files that exist.
fn files_from_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(&a);
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Queue files for the UI and tell it to come and get them.
fn deliver(app: &AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    if let Some(pending) = app.try_state::<Pending>() {
        pending.0.lock().unwrap().extend(files);
    }
    let _ = app.emit("files-pending", ());
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
fn take_pending_files(pending: State<Pending>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
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

pub fn run() {
    let app = tauri::Builder::default()
        // Must be registered first: a second launch (double-clicking another
        // file) hands its file to the window that is already open.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            deliver(app, files_from_args(argv, Path::new(&cwd)));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Pending::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            install_mac_menu(app.handle())?;
            let cwd = std::env::current_dir().unwrap_or_default();
            let files = files_from_args(std::env::args(), &cwd);
            app.state::<Pending>().0.lock().unwrap().extend(files);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_files,
            read_text_file,
            write_text_file,
            file_mtime,
            resolve_path,
            read_image_file,
            print_page
        ])
        .build(tauri::generate_context!())
        .expect("error while building MDView");

    app.run(|_app, _event| {
        // macOS delivers double-clicked files as an event, not as arguments.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let files = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            deliver(_app, files);
        }
    });
}
