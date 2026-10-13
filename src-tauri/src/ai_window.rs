use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
#[derive(Clone)]
struct Geometry { size: PhysicalSize<u32>, position: PhysicalPosition<i32>, expanded_size: PhysicalSize<u32>, expanded_position: PhysicalPosition<i32>, added: u32 }
#[derive(Default)]
pub struct AiWindowState(Mutex<Option<Geometry>>);
#[derive(Serialize)]
pub struct ExpandResult { expanded: bool, reason: Option<String> }
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("窗口布局只能由阅读主窗口调整。".into()) } }
fn fallback(reason: &str) -> ExpandResult { ExpandResult { expanded: false, reason: Some(reason.into()) } }
#[tauri::command]
pub async fn ai_window_expand(window: tauri::WebviewWindow, state: tauri::State<'_, AiWindowState>) -> Result<ExpandResult, String> {
    main_only(&window)?;
    if window.is_maximized().map_err(|_| "无法读取窗口状态。")? || window.is_fullscreen().map_err(|_| "无法读取窗口状态。")? { return Ok(fallback("主窗口已最大化或全屏，使用独立助手，主窗口不变。")); }
    let mut snapshot = state.0.lock().map_err(|_| "窗口状态暂不可用。")?;
    if snapshot.is_some() { return Ok(ExpandResult { expanded: true, reason: None }); }
    let monitor = window.current_monitor().map_err(|_| "无法读取工作区。")?.ok_or("无法读取工作区。")?;
    let work = monitor.work_area(); let density = window.scale_factor().map_err(|_| "无法读取缩放。")?;
    let size = window.inner_size().map_err(|_| "无法读取窗口尺寸。")?; let outer = window.outer_size().map_err(|_| "无法读取窗口边框。")?;
    let position = window.outer_position().map_err(|_| "无法读取窗口位置。")?;
    let added = (420.0 * density).round() as u32; let margin = (12.0 * density).round() as i32;
    let outer_width = outer.width.saturating_add(added);
    if outer_width.saturating_add((margin * 2) as u32) > work.size.width { return Ok(fallback(&format!("工作区宽度约 {:.0}px；当前窗口 {:.0}px，加助手 420px 与边缘余量后需要约 {:.0}px，空间不足，已使用独立助手，主窗口不变。", work.size.width as f64 / density, outer.width as f64 / density, outer_width.saturating_add((margin * 2) as u32) as f64 / density))); }
    let max_x = work.position.x + work.size.width as i32 - outer_width as i32 - margin;
    let x = position.x.min(max_x).max(work.position.x + margin);
    let expanded_position = PhysicalPosition::new(x, position.y);
    let expanded_size = PhysicalSize::new(size.width.saturating_add(added), size.height);
    window.set_position(expanded_position).map_err(|_| "扩窗移动失败，原窗口未调整。")?;
    if window.set_size(expanded_size).is_err() {
        window.set_size(size).map_err(|_| "扩窗失败且恢复尺寸失败，请检查窗口。")?;
        window.set_position(position).map_err(|_| "扩窗失败且恢复位置失败，请检查窗口。")?;
        return Ok(fallback("扩窗失败，已恢复原窗口，使用独立助手。"));
    }
    *snapshot = Some(Geometry { size, position, expanded_size, expanded_position, added });
    Ok(ExpandResult { expanded: true, reason: None })
}
#[tauri::command]
pub async fn ai_window_restore(window: tauri::WebviewWindow, state: tauri::State<'_, AiWindowState>) -> Result<(), String> {
    main_only(&window)?; let mut snapshot = state.0.lock().map_err(|_| "窗口状态暂不可用。")?;
    if let Some(original) = snapshot.as_ref() {
        if !window.is_maximized().map_err(|_| "无法读取窗口状态。")? && !window.is_fullscreen().map_err(|_| "无法读取窗口状态。")? {
            let now = window.inner_size().map_err(|_| "无法读取尺寸。")?; let pos = window.outer_position().map_err(|_| "无法读取位置。")?;
            let untouched = now == original.expanded_size && pos == original.expanded_position;
            let size = if untouched { original.size } else { PhysicalSize::new(now.width.saturating_sub(original.added).max(240), now.height) };
            let mut position = if untouched { original.position } else { pos };
            if let Some(monitor) = window.current_monitor().map_err(|_| "无法读取工作区。")? { let work = monitor.work_area(); position.x = position.x.max(work.position.x).min(work.position.x + work.size.width.saturating_sub(size.width) as i32); position.y = position.y.max(work.position.y).min(work.position.y + work.size.height.saturating_sub(size.height) as i32); }
            window.set_size(size).map_err(|_| "无法恢复阅读窗口尺寸。")?; window.set_position(position).map_err(|_| "无法恢复阅读窗口位置。")?;
        }
    }
    *snapshot = None; Ok(())
}
// Expansion adds only width. Existing height/vertical frame overflow must not
// invalidate a layout that passed horizontal preflight; allow small DPI rounding.
fn expansion_width_fits(outer_width: u32, work_width: u32, density: f64) -> bool {
    outer_width <= work_width.saturating_add((2.0 * density).ceil() as u32)
}
#[tauri::command]
pub async fn ai_expansion_fits(window: tauri::WebviewWindow) -> Result<bool, String> {
    main_only(&window)?;
    if window.is_maximized().map_err(|_| "无法读取窗口状态。")? || window.is_fullscreen().map_err(|_| "无法读取窗口状态。")? { return Ok(false); }
    let monitor = window.current_monitor().map_err(|_| "无法读取工作区。")?.ok_or("无法读取工作区。")?;
    let size = window.outer_size().map_err(|_| "无法读取尺寸。")?;
    let density = window.scale_factor().map_err(|_| "无法读取缩放。")?;
    Ok(expansion_width_fits(size.width, monitor.work_area().size.width, density))
}
#[tauri::command]
// WebView2 window creation must not run in the synchronous IPC/event-loop callback.
// Building on a blocking worker leaves the native message pump free to finish initialization.
pub async fn ai_detached_open(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || create_detached(&window, &app)).await.map_err(|_| "独立助手创建任务失败，会话已保留。".to_string())?
}
#[cfg(test)]
mod fit_tests {
    use super::expansion_width_fits;
    #[test]
    fn fits_uses_horizontal_space_not_existing_height() {
        assert!(expansion_width_fits(1500, 1920, 1.0));
        assert!(!expansion_width_fits(2000, 1920, 1.0));
    }
    #[test]
    fn only_bounded_dpi_rounding_is_tolerated() {
        for density in [1.0, 1.25, 1.5, 1.75, 2.0] {
            let tolerance = (2.0_f64 * density).ceil() as u32;
            assert!(expansion_width_fits(1920 + tolerance, 1920, density));
            assert!(!expansion_width_fits(1921 + tolerance, 1920, density));
        }
    }
}
fn create_detached(window: &tauri::WebviewWindow, app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(assistant) = app.get_webview_window("ai-assistant") { let _ = assistant.emit("quiet-ai-ping", ()); return Ok(()); }
    let monitor = window.current_monitor().map_err(|_| "无法读取工作区。")?.ok_or("无法读取工作区。")?;
    let density = monitor.scale_factor(); let work = monitor.work_area();
    let width = (440.0_f64).min(work.size.width as f64 / density - 24.0).max(200.0); let height = (780.0_f64).min(work.size.height as f64 / density - 24.0).max(200.0);
    let mut builder = WebviewWindowBuilder::new(app, "ai-assistant", WebviewUrl::App("index.html?ai-assistant=1".into())).title("静读 · AI 阅读助手").inner_size(width, height).min_inner_size(200.0, 200.0).center().decorations(false).background_color(tauri::utils::config::Color(250, 250, 248, 255)).resizable(true).visible(false);
    // WebView2 rejects a second controller sharing a profile with incompatible environment options.
    if let Some(config) = app.config().app.windows.iter().find(|config| config.label == "main") {
        if let Some(args) = config.additional_browser_args.as_deref() { builder = builder.additional_browser_args(args); }
        if let Some(directory) = config.data_directory.as_ref() { builder = builder.data_directory(directory.clone()); }
    }
    builder.build().map_err(|_| "独立助手窗口创建失败，会话已保留。")?; Ok(())
}
#[tauri::command]
pub async fn ai_detached_show(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    main_only(&window)?;
    let assistant = app.get_webview_window("ai-assistant").ok_or("独立助手尚未创建。")?;
    assistant.show().map_err(|_| "无法显示独立助手。")?;
    assistant.set_focus().map_err(|_| "无法聚焦独立助手。")?;
    Ok(())
}
#[tauri::command]
pub async fn ai_detached_hide(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> { main_only(&window)?; if let Some(assistant) = app.get_webview_window("ai-assistant") { assistant.hide().map_err(|_| "无法关闭助手视图。")?; } Ok(()) }
