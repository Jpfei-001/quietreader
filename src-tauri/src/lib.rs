mod ai;
mod ai_window;
mod ai_links;
use tauri::Emitter;
#[cfg(desktop)]
mod window_layout;
#[cfg(desktop)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ai::AiService::default())
        .manage(ai_window::AiWindowState::default())
        .invoke_handler(tauri::generate_handler![ai_links::ai_open_key_page, ai::ai_key_status, ai::ai_key_info, ai::ai_set_persistence, ai::ai_set_key, ai::ai_clear_key, ai::ai_models, ai::ai_test, ai::ai_chat, ai::ai_cancel, ai_window::ai_window_expand, ai_window::ai_window_restore, ai_window::ai_expansion_fits, ai_window::ai_detached_open, ai_window::ai_detached_show, ai_window::ai_detached_hide])
        .on_window_event(|window, event| {
            if window.label() == "ai-assistant" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.app_handle().emit_to("main", "quiet-ai-action", serde_json::json!({"type":"close"}));
                }
            } else if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                ai::cancel_all(window.app_handle());
                if let Some(assistant) = window.app_handle().get_webview_window("ai-assistant") { let _ = assistant.destroy(); }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                if let (Ok(Some(monitor)), Some(config)) = (
                    window.current_monitor(),
                    app.config().app.windows.iter().find(|config| config.label == "main"),
                ) {
                    let density = monitor.scale_factor();
                    let work = monitor.work_area();
                    let available = (
                        (work.size.width as f64 / density - 32.0).max(1.0),
                        (work.size.height as f64 / density - 32.0).max(1.0),
                    );
                    let minimum = (config.min_width.unwrap_or(0.0), config.min_height.unwrap_or(0.0));
                    let size = window_layout::fit_initial_size((config.width, config.height), minimum, available);
                    window.set_min_size(Some(tauri::LogicalSize::new(minimum.0.min(size.0), minimum.1.min(size.1))))?;
                    let logical = tauri::LogicalSize::new(size.0, size.1);
                    let physical = logical.to_physical::<u32>(density);
                    window.set_size(logical)?;
                    window.set_position(tauri::PhysicalPosition::new(
                        work.position.x + ((work.size.width as i64 - physical.width as i64) / 2) as i32,
                        work.position.y + ((work.size.height as i64 - physical.height as i64) / 2) as i32,
                    ))?;
                }
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动静读失败");
}
