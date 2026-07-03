pub mod discovery;
mod history;
mod http;
mod news;
mod passwords;
mod stats;
mod sysmon;
mod tabs;
mod unreal;

use tauri::{LogicalPosition, LogicalSize, WebviewUrl};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = passwords::register(tauri::Builder::default());
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(tabs::TabsState::default())
        .manage(unreal::BuildState::default())
        .manage(sysmon::MonitorState::default())
        .invoke_handler(tauri::generate_handler![
            tabs::create_tab,
            tabs::navigate_tab,
            tabs::close_tab,
            tabs::activate_tab,
            tabs::tab_eval,
            tabs::set_content_insets,
            tabs::clear_browsing_data,
            stats::steam_stats,
            stats::reddit_search,
            stats::itch_games,
            news::fetch_feed,
            news::steam_featured,
            news::epic_free_games,
            discovery::check_platform,
            unreal::detect_engines,
            unreal::validate_engine,
            unreal::read_uproject,
            unreal::start_build,
            unreal::cancel_build,
            history::build_history,
            history::build_log,
            history::clear_build_history,
            history::launch_packaged,
            history::reveal_in_explorer,
            sysmon::system_stats,
            passwords::pass_status,
            passwords::pass_providers,
            passwords::pass_select_provider,
            passwords::pass_setup,
            passwords::pass_install_cli,
            passwords::pass_unlock,
            passwords::pass_lock,
            passwords::pass_list,
            passwords::pass_matches,
            passwords::pass_save,
            passwords::pass_fill,
            passwords::pass_commit_capture,
            passwords::pass_dismiss_capture,
            passwords::pass_generate
        ])
        .setup(|app| {
            passwords::init(app.handle()).map_err(|e| format!("password manager: {e}"))?;
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
                LogicalSize::new(width, height),
            )?;

            // Keep tab webviews glued to the content area when the window resizes.
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    tabs::apply_bounds_to_all(&app_handle);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running UWebBrowser");
}
