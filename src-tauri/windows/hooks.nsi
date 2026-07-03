; Remove the default-browser registration that the app rewrites at runtime
; (src/default_browser.rs), so an uninstalled UWebBrowser doesn't linger in
; Settings > Default apps or "Open with" menus. Runtime registration always
; writes HKCU, so these deletes target HKCU regardless of the installer's
; install mode. The extension list mirrors FILE_EXTENSIONS in default_browser.rs.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\UWebBrowserHTML"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\UWebBrowser"
  DeleteRegValue HKCU "Software\RegisteredApplications" "UWebBrowser"
  DeleteRegValue HKCU "Software\Classes\.htm\OpenWithProgids" "UWebBrowserHTML"
  DeleteRegValue HKCU "Software\Classes\.html\OpenWithProgids" "UWebBrowserHTML"
  DeleteRegValue HKCU "Software\Classes\.shtml\OpenWithProgids" "UWebBrowserHTML"
  DeleteRegValue HKCU "Software\Classes\.svg\OpenWithProgids" "UWebBrowserHTML"
  DeleteRegValue HKCU "Software\Classes\.xht\OpenWithProgids" "UWebBrowserHTML"
  DeleteRegValue HKCU "Software\Classes\.xhtml\OpenWithProgids" "UWebBrowserHTML"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "UWebBrowserHTML"
!macroend
