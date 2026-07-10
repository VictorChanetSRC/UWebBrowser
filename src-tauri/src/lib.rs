mod cache;
mod default_browser;
pub mod discovery;
mod downloads;
mod extensions;
mod github;
mod history;
mod http;
mod itch;
mod news;
mod sales;
mod stats;
mod sysmon;
mod tabs;
mod terminal;
mod unreal;
mod webext;

use tauri::{LogicalPosition, LogicalSize, WebviewUrl};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Pick a loopback port for Chromium remote debugging — what lets us embed
    // the real DevTools frontend in a docked panel. The flag is applied per
    // browsing-profile webview via `browsing_browser_args` (wry sets browser
    // args through the API, which overrides the WEBVIEW2_* env var). 0 off
    // Windows; the DevTools commands read it back to build the frontend URL.
    let devtools_port = webext::pick_debug_port();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // When we're the default browser, opening a link spawns a second
        // process; this forwards its URL to the running instance instead.
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
                default_browser::on_second_instance(app, &argv, &cwd);
            }))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_window_state::Builder::default().build());
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(tabs::TabsState::default())
        .manage(tabs::DevtoolsPort(devtools_port))
        .manage(default_browser::StartupUrls::from_env())
        .manage(unreal::BuildState::default())
        .manage(sysmon::MonitorState::default())
        .manage(terminal::TermState::default())
        .invoke_handler(tauri::generate_handler![
            tabs::create_tab,
            tabs::navigate_tab,
            tabs::close_tab,
            tabs::activate_tab,
            tabs::tab_eval,
            tabs::tab_find,
            tabs::tab_zoom,
            tabs::tab_devtools,
            tabs::devtools_open,
            tabs::devtools_close,
            tabs::devtools_set_dock,
            tabs::devtools_set_size,
            tabs::tab_print,
            tabs::permission_respond,
            tabs::basic_auth_respond,
            tabs::cert_respond,
            tabs::tab_live_url,
            tabs::set_content_insets,
            tabs::clear_browsing_data,
            tabs::open_external,
            downloads::download_cancel,
            downloads::download_open,
            downloads::download_show,
            extensions::ext_list,
            extensions::ext_import,
            extensions::ext_install_from_store,
            extensions::ext_uninstall,
            extensions::ext_open_popup,
            extensions::ext_close_popup,
            terminal::term_create,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_close,
            default_browser::is_default_browser,
            default_browser::open_default_browser_settings,
            default_browser::take_startup_urls,
            stats::steam_stats,
            stats::steam_players,
            stats::reddit_search,
            itch::itch_games,
            itch::itch_earnings,
            sales::steam_sales_status,
            sales::steam_sales_connect,
            sales::steam_sales_disconnect,
            sales::steam_sales_summary,
            github::github_repo_stats,
            github::github_releases,
            news::fetch_feed,
            news::steam_featured,
            news::epic_free_games,
            discovery::check_platform,
            unreal::detect_engines,
            unreal::validate_engine,
            unreal::read_uproject,
            unreal::open_uproject,
            unreal::start_build,
            unreal::cancel_build,
            history::build_history,
            history::build_log,
            history::clear_build_history,
            history::launch_packaged,
            history::reveal_in_explorer,
            sysmon::system_stats
        ])
        .setup(|app| {
            // Chrome-style: refresh the default-browser registration on every
            // launch so the registry always points at the current exe.
            default_browser::register_as_browser();
            let width = 1360.0;
            let height = 860.0;

            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("UWebBrowser")
                .inner_size(width, height)
                .min_inner_size(960.0, 620.0)
                .resizable(true)
                .decorations(false)
                .shadow(true)
                .center()
                .build()?;

            // The window-state plugin may have restored a saved size during
            // creation, so size the chrome webview from the window itself.
            let inner: LogicalSize<f64> =
                window.inner_size()?.to_logical(window.scale_factor()?);

            // The chrome webview hosts the browser UI (tabs, toolbar, sidebar,
            // dashboard). Tab webviews are stacked on top of its content area.
            window.add_child(
                tauri::webview::WebviewBuilder::new(
                    tabs::CHROME_LABEL,
                    WebviewUrl::App(Default::default()),
                )
                // Tauri's native drag-drop handler swallows HTML5 drag events
                // on Windows; without this, dragging dashboard tiles is dead.
                .disable_drag_drop_handler()
                .auto_resize(),
                LogicalPosition::new(0.0, 0.0),
                inner,
            )?;

            // Keep tab webviews glued to the content area when the window resizes.
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    tabs::apply_bounds_to_all(&app_handle);
                }
            });

            // Hidden webview that anchors the extension profile so the installed
            // set can be listed with no tab open, and so extensions load at
            // launch (they persist in the browsing profile across sessions).
            extensions::spawn_host(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running UWebBrowser");
}
