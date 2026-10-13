// The browser destination is fixed: no caller-controlled URLs, schemes, arguments or credentials.
const API_KEYS_URL: &str = "https://platform.deepseek.com/api_keys";

fn main_only(label: &str) -> Result<(), String> {
    if label == "main" { Ok(()) } else { Err("请从阅读主窗口打开密钥管理页面。".into()) }
}

#[tauri::command]
pub async fn ai_open_key_page(window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(window.label())?;
    tauri::async_runtime::spawn_blocking(open_key_page).await
        .map_err(|_| "无法打开系统浏览器，请复制密钥页面链接后打开。".to_string())?
}

#[cfg(windows)]
fn open_key_page() -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let url: Vec<u16> = API_KEYS_URL.encode_utf16().chain(std::iter::once(0)).collect();
    // ShellExecuteW uses the user's registered HTTPS browser, not the app's WebView.
    let com = unsafe { CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32) };
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), url.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
    if com >= 0 { unsafe { CoUninitialize(); } }
    if result as isize <= 32 { Err("无法打开系统浏览器，请复制密钥页面链接后打开。".into()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn open_key_page() -> Result<(), String> {
    let _ = API_KEYS_URL;
    Err("当前桌面系统暂不支持直接打开，请复制密钥页面链接后打开。".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_main_may_launch_the_browser() {
        assert!(super::main_only("main").is_ok());
        assert!(super::main_only("ai-assistant").is_err());
    }
    #[test]
    fn destination_is_the_fixed_https_api_key_page() {
        assert_eq!(super::API_KEYS_URL, "https://platform.deepseek.com/api_keys");
    }
}
