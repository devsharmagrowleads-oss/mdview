; Windows installer hooks (Tauri NSIS).
; After installing: add "Open with MDView" / "Watch with MDView" to Explorer,
; the `mdview` terminal command (PATH), mdview:// links and the entry in
; Settings > Default apps. Before uninstalling: remove them again.
; MDView does the registry work itself (mdview --register / --unregister).

!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\mdview.exe" --register'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\mdview.exe" --unregister'
!macroend
