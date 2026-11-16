//! Operating-system integration: default app status, Explorer menus, the
//! `mdview` terminal command and `mdview://` links. Windows only; elsewhere the
//! installer packages (.deb/.rpm/.app) already cover what they can.

use std::path::Path;

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShellStatus {
    /// This platform supports the integration below.
    supported: bool,
    /// Double-clicking a .md file opens MDView.
    default_app: bool,
    /// `mdview` works in a new terminal.
    on_path: bool,
    /// Explorer menus and mdview:// links are registered for this executable.
    registered: bool,
    exe: String,
}

#[cfg(windows)]
mod win {
    use std::path::Path;
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    /// The ProgId the installer registers for Markdown files.
    pub const PROGID: &str = "Markdown Document";
    const EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];
    const CAPABILITIES: &str = r"Software\MDView\Capabilities";

    fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    fn set(path: &str, name: &str, value: &str) -> std::io::Result<()> {
        let (key, _) = hkcu().create_subkey(path)?;
        key.set_value(name, &value)
    }

    fn quoted(exe: &Path) -> String {
        format!("\"{}\"", exe.display())
    }

    pub fn register(exe: &Path) -> std::io::Result<()> {
        let open = format!("{} \"%1\"", quoted(exe));
        let icon = format!("{},0", quoted(exe));
        let classes = r"Software\Classes";

        // The document type (the installer writes this too; keep it pointing here).
        set(&format!(r"{classes}\{PROGID}"), "", "Markdown Document")?;
        set(&format!(r"{classes}\{PROGID}\DefaultIcon"), "", &icon)?;
        set(&format!(r"{classes}\{PROGID}\shell\open"), "", "Open with MDView")?;
        set(&format!(r"{classes}\{PROGID}\shell\open\command"), "", &open)?;

        for ext in EXTENSIONS {
            // Listed under "Open with", without taking over the default.
            set(&format!(r"{classes}\.{ext}\OpenWithProgids"), PROGID, "")?;
            // Explorer right-click menu, whatever app is the default.
            let menu = format!(r"{classes}\SystemFileAssociations\.{ext}\shell\MDView");
            set(&menu, "", "Open with MDView")?;
            set(&menu, "Icon", &icon)?;
            set(&format!(r"{menu}\command"), "", &open)?;
        }
        set(&format!(r"{classes}\Applications\mdview.exe"), "FriendlyAppName", "MDView")?;
        for ext in EXTENSIONS {
            set(&format!(r"{classes}\Applications\mdview.exe\SupportedTypes"), &format!(".{ext}"), "")?;
        }

        // "Watch with MDView" on folders and folder backgrounds.
        for base in [r"Directory\shell", r"Directory\Background\shell"] {
            let menu = format!(r"{classes}\{base}\MDView.Watch");
            set(&menu, "", "Watch with MDView")?;
            set(&menu, "Icon", &icon)?;
            set(&format!(r"{menu}\command"), "", &format!("{} --watch \"%V\"", quoted(exe)))?;
        }

        // mdview:// links.
        set(&format!(r"{classes}\mdview"), "", "URL:MDView link")?;
        set(&format!(r"{classes}\mdview"), "URL Protocol", "")?;
        set(&format!(r"{classes}\mdview\DefaultIcon"), "", &icon)?;
        set(&format!(r"{classes}\mdview\shell\open\command"), "", &open)?;

        // Lets Settings > Default apps show MDView with a "Set default" button.
        set(CAPABILITIES, "ApplicationName", "MDView")?;
        set(CAPABILITIES, "ApplicationDescription", "Markdown viewer and editor")?;
        set(CAPABILITIES, "ApplicationIcon", &icon)?;
        for ext in EXTENSIONS {
            set(&format!(r"{CAPABILITIES}\FileAssociations"), &format!(".{ext}"), PROGID)?;
        }
        set(&format!(r"{CAPABILITIES}\URLAssociations"), "mdview", "mdview")?;
        set(r"Software\RegisteredApplications", "MDView", CAPABILITIES)?;

        if let Some(dir) = exe.parent() {
            add_to_path(&dir.to_string_lossy())?;
        }
        notify_shell();
        Ok(())
    }

    pub fn unregister(exe: &Path) -> std::io::Result<()> {
        let root = hkcu();
        let classes = r"Software\Classes";
        let mut doomed: Vec<String> = vec![
            format!(r"{classes}\Directory\shell\MDView.Watch"),
            format!(r"{classes}\Directory\Background\shell\MDView.Watch"),
            format!(r"{classes}\mdview"),
            format!(r"{classes}\Applications\mdview.exe"),
            r"Software\MDView".into(),
        ];
        for ext in EXTENSIONS {
            doomed.push(format!(r"{classes}\SystemFileAssociations\.{ext}\shell\MDView"));
        }
        for key in doomed {
            let _ = root.delete_subkey_all(key);
        }
        if let Ok(apps) = root.open_subkey_with_flags(r"Software\RegisteredApplications", KEY_WRITE) {
            let _ = apps.delete_value("MDView");
        }
        if let Some(dir) = exe.parent() {
            remove_from_path(&dir.to_string_lossy())?;
        }
        notify_shell();
        Ok(())
    }

    fn user_path() -> String {
        hkcu()
            .open_subkey_with_flags("Environment", KEY_READ)
            .and_then(|k| k.get_value::<String, _>("Path"))
            .unwrap_or_default()
    }

    fn same_dir(a: &str, b: &str) -> bool {
        a.trim().trim_end_matches('\\').eq_ignore_ascii_case(b.trim().trim_end_matches('\\'))
    }

    fn write_path(value: &str) -> std::io::Result<()> {
        use winreg::enums::RegType::REG_EXPAND_SZ;
        use winreg::RegValue;
        let (env, _) = hkcu().create_subkey("Environment")?;
        let bytes: Vec<u8> = value.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect();
        env.set_raw_value("Path", &RegValue { vtype: REG_EXPAND_SZ, bytes: bytes.into() })
    }

    fn add_to_path(dir: &str) -> std::io::Result<()> {
        let current = user_path();
        if current.split(';').any(|p| same_dir(p, dir)) {
            return Ok(());
        }
        let trimmed = current.trim_end_matches(';');
        write_path(&if trimmed.is_empty() { dir.to_owned() } else { format!("{trimmed};{dir}") })
    }

    fn remove_from_path(dir: &str) -> std::io::Result<()> {
        let current = user_path();
        let kept: Vec<&str> = current.split(';').filter(|p| !p.is_empty() && !same_dir(p, dir)).collect();
        if kept.len() == current.split(';').filter(|p| !p.is_empty()).count() {
            return Ok(());
        }
        write_path(&kept.join(";"))
    }

    /// Tell Explorer and running programs that associations and PATH changed.
    fn notify_shell() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        let env: Vec<u16> = "Environment".encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: broadcast with a valid NUL-terminated string that outlives the call.
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                env.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                2000,
                std::ptr::null_mut(),
            );
        }
        #[link(name = "shell32")]
        extern "system" {
            fn SHChangeNotify(event: i32, flags: u32, item1: *const core::ffi::c_void, item2: *const core::ffi::c_void);
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        // SAFETY: documented call with no items.
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, 0, std::ptr::null(), std::ptr::null()) };
    }

    fn is_ours(progid: &str) -> bool {
        progid == PROGID || progid.eq_ignore_ascii_case(r"Applications\mdview.exe")
    }

    /// Whether double-clicking a .md file opens MDView.
    pub fn is_default() -> bool {
        let exts = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md";
        let mut choice: Option<String> = None;
        for sub in ["UserChoiceLatest", "UserChoice"] {
            if let Ok(key) = hkcu().open_subkey(format!(r"{exts}\{sub}")) {
                if let Ok(p) = key.get_value::<String, _>("ProgId") {
                    choice = Some(p);
                    break;
                }
            }
        }
        match choice {
            Some(p) => is_ours(&p),
            // No choice made: Windows uses the class registered for .md.
            None => RegKey::predef(HKEY_CLASSES_ROOT)
                .open_subkey(".md")
                .and_then(|k| k.get_value::<String, _>(""))
                .is_ok_and(|p| is_ours(&p)),
        }
    }

    pub fn on_path(exe: &Path) -> bool {
        let Some(dir) = exe.parent().map(|d| d.to_string_lossy().into_owned()) else { return false };
        user_path().split(';').any(|p| same_dir(p, &dir))
            || std::env::var("PATH").unwrap_or_default().split(';').any(|p| same_dir(p, &dir))
    }

    pub fn registered(exe: &Path) -> bool {
        hkcu()
            .open_subkey(r"Software\Classes\mdview\shell\open\command")
            .and_then(|k| k.get_value::<String, _>(""))
            .is_ok_and(|cmd| cmd.to_ascii_lowercase().contains(&exe.to_string_lossy().to_ascii_lowercase()))
    }

    /// Whether a URL scheme has a handler (to know if VS Code / Cursor are installed).
    pub fn has_scheme(scheme: &str) -> bool {
        RegKey::predef(HKEY_CLASSES_ROOT).open_subkey(format!(r"{scheme}\shell\open\command")).is_ok()
    }
}

pub fn register(exe: &Path) -> Result<(), String> {
    #[cfg(windows)]
    return win::register(exe).map_err(|e| e.to_string());
    #[cfg(not(windows))]
    {
        let _ = exe;
        Err("Only needed on Windows.".into())
    }
}

pub fn unregister(exe: &Path) -> Result<(), String> {
    #[cfg(windows)]
    return win::unregister(exe).map_err(|e| e.to_string());
    #[cfg(not(windows))]
    {
        let _ = exe;
        Ok(())
    }
}

pub fn has_scheme(scheme: &str) -> bool {
    #[cfg(windows)]
    return win::has_scheme(scheme);
    #[cfg(not(windows))]
    {
        let _ = scheme;
        true
    }
}

#[tauri::command(async)]
pub fn shell_status() -> ShellStatus {
    let exe = std::env::current_exe().unwrap_or_default();
    #[cfg(windows)]
    return ShellStatus {
        supported: true,
        default_app: win::is_default(),
        on_path: win::on_path(&exe),
        registered: win::registered(&exe),
        exe: exe.to_string_lossy().into_owned(),
    };
    #[cfg(not(windows))]
    ShellStatus { exe: exe.to_string_lossy().into_owned(), ..Default::default() }
}

#[tauri::command(async)]
pub fn shell_register(enable: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if enable {
        register(&exe)
    } else {
        unregister(&exe)
    }
}

/// Open the system page where the user picks the default app for .md files.
#[tauri::command]
pub fn open_default_apps() -> Result<(), String> {
    #[cfg(windows)]
    {
        // Make sure Windows knows MDView's capabilities, so the page lists it.
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        if !win::registered(&exe) {
            let _ = win::register(&exe);
        }
        tauri_plugin_opener::open_url("ms-settings:defaultapps?registeredAppUser=MDView", None::<&str>)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    Err("Use your system's \"Open With\" settings to make MDView the default.".into())
}
