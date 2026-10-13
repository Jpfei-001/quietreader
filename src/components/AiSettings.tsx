import { useEffect, useState } from 'react';
import { clearCredential, credentialInfo, listModels, setCredential, setCredentialPersistence, testConnection } from '../platform/ai/deepseek';
import { loadAiPreferences, saveAiPreferences } from '../platform/ai/settings';
import { invokeAi, tauriBridge } from '../platform/ai/bridge';
import { aiError } from '../platform/ai/types';
export default function AiSettings() {
  const native = !!tauriBridge();
  const [model, setModel] = useState(() => loadAiPreferences().model);
  const [models, setModels] = useState<string[]>([model]);
  const [key, setKey] = useState(''), [show, setShow] = useState(false), [remember, setRemember] = useState(!native);
  const [saved, setSaved] = useState(false), [credentialReadFailed, setCredentialReadFailed] = useState(false);
  const [configured, setConfigured] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  useEffect(() => { let active = true; void credentialInfo().then(info => { if (active) { setConfigured(info.configured); setRemember(info.configured ? info.remembered : !native); setSaved(info.remembered); } }).catch(error => { if (active) { setCredentialReadFailed(true); setStatus(aiError(error)); } }); return () => { active = false; }; }, []);
  function changed() { window.dispatchEvent(new Event('quiet-ai-config-changed')); }
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setStatus(''); try { await action(); } catch (error) { setStatus(aiError(error)); } finally { setBusy(false); } }
  return <fieldset className="ai-settings" data-ai-ui><legend>AI 服务 · DeepSeek</legend>
    <p className="ai-setting-hint">使用你自己的 API Key，API 使用可能单独计费。<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" onClick={event => { if (!native) return; event.preventDefault(); void invokeAi('ai_open_key_page').catch(error => setStatus(aiError(error))); }}>获取密钥 ↗</a></p>
    <label htmlFor="ai-key">API Key {configured && <small>已配置 · {saved ? native ? '系统已安全保存' : '当前浏览器已加密保存' : '仅当前页面／应用会话'}（密钥不回显）</small>}</label>
    <div className="ai-key-row"><input id="ai-key" autoComplete="off" spellCheck={false} type={show ? 'text' : 'password'} value={key} placeholder={configured ? '留空保留密钥；输入以替换' : '输入 API Key'} onChange={e => { setKey(e.target.value); setStatus('配置已变更，请重新测试。'); }} /><button type="button" disabled={busy} onClick={() => setShow(!show)} aria-label={show ? '隐藏 API Key' : '显示 API Key'}>{show ? '隐藏' : '显示'}</button></div>
    <label htmlFor="ai-model">模型</label><div className="ai-model-row"><select id="ai-model" value={model} onChange={e => { setModel(e.target.value); setStatus('模型已变更，请重新测试。'); }}>{models.map(id => <option key={id}>{id}</option>)}</select><button type="button" disabled={busy || !key && !configured} onClick={() => void run(async () => { const available = await listModels(key.trim() || undefined); setModels(available.includes(model) ? available : [model, ...available]); setStatus('模型列表已刷新，请选择并保存。'); })}>刷新模型</button></div>
    <label className="ai-remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />{native ? '安全记住新密钥（系统凭据存储）' : '记住 API Key（当前浏览器，加密保存）'}</label>
    {!native && <p className="ai-setting-hint">勾选并保存后，刷新或重新打开同一浏览器地址仍可使用；取消勾选则仅本页面会话。密钥与不可导出的加密密钥保存在专用浏览器存储，不等同于系统保险库；同源恶意脚本仍可能访问。隐私模式、清除站点数据或更换地址可能丢失配置。已有密钥无需重填，勾选后保存即可。</p>}
    <div className="ai-setting-actions"><button type="button" disabled={busy || !key && !configured} onClick={() => void run(async () => { const elapsed = await testConnection(model, key.trim() || undefined); setStatus(`连接成功 · ${model} · ${(elapsed / 1000).toFixed(1)} 秒（本次测试）`); })}>测试连接</button><button type="button" className="button-primary" disabled={busy || !model || !key && !configured} onClick={() => void run(async () => { if (key.trim()) await setCredential(key.trim(), remember); else await setCredentialPersistence(remember); saveAiPreferences({ ...loadAiPreferences(), model }); setKey(''); const info = await credentialInfo(); setConfigured(info.configured); setSaved(info.remembered); setCredentialReadFailed(false); setStatus(`AI 配置已保存。${info.remembered ? native ? '密钥已保存到系统凭据，重启仍可用。' : '密钥已在当前浏览器加密保存，刷新后仍可用。' : '密钥仅本次页面／应用会话可用，刷新或重启需重新填写。'}`); changed(); })}>保存配置</button></div>
    <p className="ai-setting-hint">测试将发送极短问题，可能产生少量费用。模型只在这里设置；切换后下一次提问生效。阅读问答默认关闭思考模式，优先正式回答。</p>
    {(configured || credentialReadFailed) && <button type="button" className="ai-clear-key" disabled={busy} onClick={() => { if (window.confirm('清除 AI 密钥？不会删除书籍、笔记或阅读设置。')) void run(async () => { await clearCredential(); setConfigured(false); setSaved(false); setCredentialReadFailed(false); setKey(''); changed(); setStatus('密钥已清除。'); }); }}>清除密钥</button>}
    {(busy || status) && <p className="ai-setting-status" role="status">{busy ? '正在连接，请稍候…' : status}</p>}
  </fieldset>;
}
