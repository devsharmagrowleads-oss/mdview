//! Starting MDView in the background, so terminals, agent hooks and the MCP
//! server never wait for the window to close.

use std::path::Path;
use std::process::{Command, Stdio};

/// Run this executable again with `args`, detached from the caller.
pub fn spawn_detached(args: &[String]) -> std::io::Result<()> {
    let exe = std::env::current_exe()?;
    let mut base = Command::new(exe);
    base.arg("--detached").args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT};
        use windows_sys::Win32::System::Console::{
            GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
        };
        // Our caller's pipes (an agent hook, an MCP client) must not leak into
        // the long-lived window: the caller waits for them to close.
        for which in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            // SAFETY: plain Win32 calls on this process's own standard handles.
            unsafe {
                let h = GetStdHandle(which);
                if !h.is_null() && h as isize != -1 {
                    SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0);
                }
            }
        }
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        // Leave the caller's job object if allowed, so closing the terminal or
        // the agent does not take the window with it.
        base.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
        if base.spawn().is_ok() {
            return Ok(());
        }
        base.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        base.spawn().map(|_| ())
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        base.process_group(0);
        base.spawn().map(|_| ())
    }
}

/// Open documents in MDView on behalf of an agent, without waiting.
pub fn open_for_agent(paths: &[impl AsRef<Path>]) -> std::io::Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["--from-agent".to_owned()];
    args.extend(paths.iter().map(|p| p.as_ref().to_string_lossy().into_owned()));
    spawn_detached(&args)
}

/// Print to the terminal MDView was started from. A Windows GUI program has
/// no output handle of its own unless the output is piped, so write to the
/// attached console directly in that case.
pub fn say(text: &str) {
    use std::io::Write;
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Console::{GetStdHandle, STD_OUTPUT_HANDLE};
        // SAFETY: plain Win32 call with a constant argument.
        let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
        if handle.is_null() || handle as isize == -1 {
            if let Ok(mut console) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
                let _ = console.write_all(text.replace('\n', "\r\n").as_bytes());
            }
            return;
        }
    }
    let mut out = std::io::stdout();
    let _ = out.write_all(text.as_bytes());
    let _ = out.flush();
}

/// True when started from a terminal window, whose shell would otherwise wait
/// for MDView to exit. On Windows this also connects stdout to that terminal,
/// so `--help` and errors are visible.
pub fn attach_terminal() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        // SAFETY: plain Win32 call with a constant argument.
        unsafe { AttachConsole(ATTACH_PARENT_PROCESS) != 0 }
    }
    #[cfg(not(windows))]
    {
        use std::io::IsTerminal;
        std::io::stdin().is_terminal() || std::io::stdout().is_terminal()
    }
}
