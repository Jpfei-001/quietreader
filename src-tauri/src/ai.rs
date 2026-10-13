//! AI requests are explicitly initiated by the main UI. Keys never enter frontend snapshots/logs.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Mutex, OnceLock}, time::Duration};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct AiService { key: Mutex<Option<String>>, requests: Mutex<HashMap<String, oneshot::Sender<()>>> }
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("此操作仅限阅读主窗口。".into()) } }
fn valid_key(key: &str) -> bool { (8..=512).contains(&key.len()) && !key.chars().any(char::is_whitespace) }
fn valid_model(model: &str) -> bool { !model.is_empty() && model.len() <= 100 && model.bytes().all(|c| c.is_ascii_alphanumeric() || b"._:/-".contains(&c)) }
fn client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(120)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "无法建立安全网络连接。".into())).clone()
}
fn network_error() -> String { "网络异常或超时，请检查连接后手动重试。".into() }
fn status_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() { 401 => "密钥无效，请重新填写。", 403 => "密钥没有调用权限。", 402 => "API 余额不足，请检查平台账户。", 429 => "请求过于频繁，请稍后手动重试。", 404 => "所选模型不可用，请刷新模型。", 400 => "模型或参数不兼容，请检查设置。", _ => "AI 服务暂时不可用，请稍后重试。" }.into()
}
fn stored_key(state: &AiService) -> Result<String, String> {
    let mut current = state.key.lock().map_err(|_| "密钥状态暂不可用。")?;
    if let Some(key) = current.as_ref() { return Ok(key.clone()); }
    *current = credential_read()?;
    current.clone().ok_or_else(|| "请先在设置中配置 API Key。".into())
}
fn request_key(state: &AiService, key: Option<String>) -> Result<String, String> {
    match key { Some(k) if valid_key(&k) => Ok(k), Some(_) => Err("密钥格式无效。".into()), None => stored_key(state) }
}
#[cfg(windows)]
fn target() -> Vec<u16> { "com.quietreader.app/ai/deepseek".encode_utf16().chain(Some(0)).collect() }
#[cfg(windows)]
fn credential_read() -> Result<Option<String>, String> {
    use windows_sys::Win32::{Foundation::GetLastError, Security::Credentials::*};
    let mut ptr: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        if CredReadW(target().as_ptr(), CRED_TYPE_GENERIC, 0, &mut ptr) == 0 {
            return if GetLastError() == 1168 { Ok(None) } else { Err("无法读取系统凭据，请检查账户权限。".into()) };
        }
        if ptr.is_null() { return Err("系统凭据格式异常。".into()); }
        let credential = &*ptr;
        let result = if credential.CredentialBlobSize > 512 || credential.CredentialBlob.is_null() { Err("系统凭据格式异常。".into()) } else {
            String::from_utf8(std::slice::from_raw_parts(credential.CredentialBlob, credential.CredentialBlobSize as usize).to_vec()).map(Some).map_err(|_| "系统凭据格式异常。".into())
        };
        CredFree(ptr.cast()); result
    }
}
#[cfg(not(windows))]
fn credential_read() -> Result<Option<String>, String> { Ok(None) }
#[cfg(windows)]
fn credential_delete() -> Result<(), String> {
    use windows_sys::Win32::{Foundation::GetLastError, Security::Credentials::*};
    unsafe { if CredDeleteW(target().as_ptr(), CRED_TYPE_GENERIC, 0) == 0 && GetLastError() != 1168 { return Err("无法清除系统凭据，请检查权限。".into()); } } Ok(())
}
#[cfg(not(windows))]
fn credential_delete() -> Result<(), String> { Ok(()) }
#[cfg(windows)]
fn credential_write(key: &str) -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::*;
    let mut name = target(); let mut user: Vec<u16> = "Quiet Reader".encode_utf16().chain(Some(0)).collect(); let mut bytes = key.as_bytes().to_vec();
    let credential = CREDENTIALW { Type: CRED_TYPE_GENERIC, TargetName: name.as_mut_ptr(), CredentialBlobSize: bytes.len() as u32, CredentialBlob: bytes.as_mut_ptr(), Persist: CRED_PERSIST_LOCAL_MACHINE, UserName: user.as_mut_ptr(), ..Default::default() };
    let success = unsafe { CredWriteW(&credential, 0) }; bytes.fill(0);
    if success == 0 { Err("无法保存系统凭据；密钥未保存，请检查权限。".into()) } else { Ok(()) }
}
#[cfg(not(windows))]
fn credential_write(_: &str) -> Result<(), String> { Err("此系统暂不支持安全记住密钥，请使用仅本次会话。".into()) }

#[tauri::command]
pub fn ai_key_status(window: tauri::WebviewWindow, state: tauri::State<AiService>) -> Result<bool, String> { main_only(&window)?; match stored_key(&state) { Ok(_) => Ok(true), Err(e) if e == "请先在设置中配置 API Key。" => Ok(false), Err(e) => Err(e) } }
#[derive(Serialize)]
pub struct CredentialInfo { configured: bool, remembered: bool }
#[tauri::command]
pub fn ai_key_info(window: tauri::WebviewWindow, state: tauri::State<AiService>) -> Result<CredentialInfo, String> {
    main_only(&window)?;
    let configured = match stored_key(&state) { Ok(_) => true, Err(e) if e == "请先在设置中配置 API Key。" => false, Err(e) => return Err(e) };
    Ok(CredentialInfo { configured, remembered: configured && credential_read()?.is_some() })
}
#[tauri::command]
pub fn ai_set_persistence(window: tauri::WebviewWindow, state: tauri::State<AiService>, remember: bool) -> Result<(), String> {
    main_only(&window)?; let key = stored_key(&state)?;
    if remember { credential_write(&key) } else { credential_delete() }
}
#[tauri::command]
pub fn ai_set_key(window: tauri::WebviewWindow, state: tauri::State<AiService>, key: String, remember: bool) -> Result<(), String> {
    main_only(&window)?; if !valid_key(&key) { return Err("密钥格式无效。".into()); }
    if remember { credential_write(&key)?; } else { credential_delete()?; }
    *state.key.lock().map_err(|_| "密钥状态暂不可用。")? = Some(key); Ok(())
}
#[tauri::command]
pub fn ai_clear_key(window: tauri::WebviewWindow, state: tauri::State<AiService>) -> Result<(), String> { main_only(&window)?; credential_delete()?; *state.key.lock().map_err(|_| "密钥状态暂不可用。")? = None; Ok(()) }
#[tauri::command]
pub async fn ai_models(window: tauri::WebviewWindow, state: tauri::State<'_, AiService>, key: Option<String>) -> Result<Vec<String>, String> {
    main_only(&window)?; let key = request_key(&state, key)?;
    let response = client()?.get("https://api.deepseek.com/models").bearer_auth(key).timeout(Duration::from_secs(20)).send().await.map_err(|_| network_error())?;
    if !response.status().is_success() { return Err(status_error(response.status())); }
    let data: Value = response.json().await.map_err(|_| "模型列表格式异常。")?;
    let models: Vec<String> = data["data"].as_array().ok_or("模型列表格式异常。")?.iter().filter_map(|v| v["id"].as_str().filter(|s| valid_model(s)).map(str::to_owned)).collect();
    if models.is_empty() { return Err("当前账户没有可用模型。".into()); } Ok(models)
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Message { role: String, content: String }
fn validate_request(model: &str, messages: &[Message]) -> Result<(), String> {
    if !valid_model(model) || messages.is_empty() || messages.len() > 12 || messages.iter().any(|m| !["system", "user", "assistant"].contains(&m.role.as_str())) || messages.iter().map(|m| m.content.len()).sum::<usize>() > 200000 { Err("问题或上下文超出允许范围。".into()) } else { Ok(()) }
}
#[tauri::command]
pub async fn ai_test(window: tauri::WebviewWindow, state: tauri::State<'_, AiService>, model: String, key: Option<String>) -> Result<(), String> {
    main_only(&window)?; if !valid_model(&model) { return Err("模型名称无效。".into()); } let key = request_key(&state, key)?;
    let response = client()?.post("https://api.deepseek.com/chat/completions").bearer_auth(key).timeout(Duration::from_secs(30)).json(&json!({"model": model, "messages": [{"role":"user", "content":"只回答：连接成功"}], "stream":false, "thinking":{"type":"disabled"}, "max_tokens":64})).send().await.map_err(|_| network_error())?;
    if !response.status().is_success() { return Err(status_error(response.status())); }
    let data: Value = response.json().await.map_err(|_| "测试响应格式异常。")?;
    if data["choices"][0]["message"]["content"].as_str().is_some_and(|s| !s.trim().is_empty()) { Ok(()) } else { Err("模型没有返回有效正式回答，请换模型测试。".into()) }
}
#[derive(Default)]
pub struct SseLines { bytes: Vec<u8>, data: Vec<String> }
impl SseLines {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.bytes.extend_from_slice(bytes); if self.bytes.len() > 1024 * 1024 { return Err("流式响应过大。".into()); }
        let mut result = Vec::new();
        while let Some(end) = self.bytes.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = self.bytes.drain(..=end).collect();
            let line = std::str::from_utf8(&raw[..raw.len()-1]).map_err(|_| "流式字符格式异常。")?.trim_end_matches('\r');
            if line.is_empty() { if !self.data.is_empty() { result.push(self.data.join("\n")); self.data.clear(); } }
            else if let Some(data) = line.strip_prefix("data:") { self.data.push(data.strip_prefix(' ').unwrap_or(data).to_owned()); }
            if self.data.iter().map(String::len).sum::<usize>() > 1024 * 1024 { return Err("流式事件过大。".into()); }
        } Ok(result)
    }
}
async fn stream_answer(app: &tauri::AppHandle, id: &str, key: String, model: String, messages: Vec<Message>) -> Result<(), String> {
    let response = client()?.post("https://api.deepseek.com/chat/completions").bearer_auth(key).json(&json!({"model":model,"messages":messages,"stream":true,"thinking":{"type":"disabled"},"max_tokens":2048})).send().await.map_err(|_| network_error())?;
    if !response.status().is_success() { return Err(status_error(response.status())); }
    let mut stream = response.bytes_stream(); let mut parser = SseLines::default(); let mut received = false; let mut finished = false; let mut reason = String::new(); let mut total = 0; let mut thinking_reported = false;
    'outer: while let Some(chunk) = stream.next().await {
        for data in parser.push(&chunk.map_err(|_| network_error())?)? {
            if data == "[DONE]" { finished = true; break 'outer; }
            let value: Value = serde_json::from_str(&data).map_err(|_| "流式格式异常。")?;
            if value.get("error").is_some() { return Err("AI 服务返回错误，请手动重试。".into()); }
            let choice = &value["choices"][0];
            if let Some(r) = choice["finish_reason"].as_str() { reason = r.to_owned(); }
            if !thinking_reported && choice["delta"]["reasoning_content"].as_str().is_some_and(|s| !s.is_empty()) { thinking_reported = true; let _ = app.emit_to("main", "quiet-ai-stream", json!({"requestId":id,"thinking":true})); }
            if let Some(text) = choice["delta"]["content"].as_str() { if !text.is_empty() { received = true; total += text.len(); if total > 64000 { return Err("回答达到上限，已保留部分内容。".into()); } let _ = app.emit_to("main", "quiet-ai-stream", json!({"requestId":id,"text":text})); } }
        }
    }
    if !received { return Err("模型没有返回正式回答。".into()); }
    if !finished && reason.is_empty() { return Err("连接中断，回答可能未完成。".into()); }
    let _ = app.emit_to("main", "quiet-ai-stream", json!({"requestId":id,"done":true,"incomplete": reason != "stop"})); Ok(())
}
#[tauri::command]
pub fn ai_chat(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<AiService>, request_id: String, model: String, messages: Vec<Message>) -> Result<(), String> {
    main_only(&window)?; validate_request(&model, &messages)?;
    if request_id.len() > 100 || request_id.is_empty() { return Err("请求标识无效。".into()); }
    let key = stored_key(&state)?; let (sender, receiver) = oneshot::channel();
    { let mut requests = state.requests.lock().map_err(|_| "请求状态暂不可用。")?; if !requests.is_empty() { return Err("已有回答生成中，请停止后再发送。".into()); } requests.insert(request_id.clone(), sender); }
    tauri::async_runtime::spawn(async move {
        tokio::select! { _ = receiver => {}, result = stream_answer(&app, &request_id, key, model, messages) => { if let Err(error) = result { let _ = app.emit_to("main", "quiet-ai-stream", json!({"requestId":request_id,"error":error})); } } }
        if let Ok(mut requests) = app.state::<AiService>().requests.lock() { requests.remove(&request_id); }
    }); Ok(())
}
#[tauri::command]
pub fn ai_cancel(window: tauri::WebviewWindow, state: tauri::State<AiService>, request_id: String) -> Result<(), String> {
    main_only(&window)?; if let Some(cancel) = state.requests.lock().map_err(|_| "请求状态暂不可用。")?.remove(&request_id) { let _ = cancel.send(()); } Ok(())
}
pub fn cancel_all(app: &tauri::AppHandle) { if let Ok(mut requests) = app.state::<AiService>().requests.lock() { for (_, cancel) in requests.drain() { let _ = cancel.send(()); } } }
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn sse_preserves_split_utf8_and_crlf() { let mut p = SseLines::default(); let data = "data: {\"text\":\"中文\"}\r\n\r\n".as_bytes(); let mut output = Vec::new(); for b in data { output.extend(p.push(&[*b]).unwrap()); } assert_eq!(output, vec!["{\"text\":\"中文\"}"]); }
    #[test] fn validates_models_and_request_limits() { assert!(!valid_model("../../ x")); assert!(valid_model("deepseek-chat")); assert!(!valid_key("Bearer key")); assert!(validate_request("deepseek-chat", &[]).is_err()); }
    // Opt-in only: never exercised by CI; uses the same credential store and transport as the app.
    #[tokio::test]
    #[ignore = "真实付费请求，必须由用户明确授权后单独运行"]
    async fn live_connection_uses_stored_credential() {
        let model = std::env::var("QUIET_READER_LIVE_MODEL").unwrap_or_else(|_| "deepseek-flash".into());
        assert!(valid_model(&model), "模型名称无效");
        let key = stored_key(&AiService::default()).expect("未找到系统保存的密钥。仅本次会话的密钥请在已打开应用中点击测试连接。");
        let started = std::time::Instant::now();
        let response = client().expect("网络客户端初始化失败").post("https://api.deepseek.com/chat/completions").bearer_auth(key).timeout(Duration::from_secs(30)).json(&json!({"model":model,"messages":[{"role":"user","content":"只回答：连接成功"}],"stream":false,"thinking":{"type":"disabled"},"max_tokens":64})).send().await.map_err(|_| network_error()).expect("真实连接失败");
        assert!(response.status().is_success(), "{}", status_error(response.status()));
        let value: Value = response.json().await.map_err(|_| "测试响应格式异常").expect("真实响应解析失败");
        assert!(value["choices"][0]["message"]["content"].as_str().is_some_and(|v| !v.trim().is_empty()), "模型未返回正式回答");
        println!("真实连接测试成功 · {} · {} ms（无书籍内容、密钥或回答正文输出）", model, started.elapsed().as_millis());
    }
}
