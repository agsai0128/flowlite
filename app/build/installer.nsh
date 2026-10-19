; FlowLite NSIS hooks (included by electron-builder).
; On uninstall, remove the start-at-login entry the app created, so nothing points
; at the deleted exe. User settings in %APPDATA%\FlowLite are intentionally kept.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "FlowLite"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "FlowLite"
!macroend
