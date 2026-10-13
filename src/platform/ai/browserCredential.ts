/** No plaintext key in preferences, localStorage, sessionStorage, URLs or exports.
 * Remembered keys use AES-GCM + a non-extractable CryptoKey in a separate IndexedDB.
 * This prevents plaintext-at-rest, NOT access by malicious same-origin JavaScript.
 */
const KEY = Symbol.for('quiet-reader:ai:page-credential');
const STATE = Symbol.for('quiet-reader:ai:credential-state');
const DB = 'quiet-reader-ai-credential-v1', STORE = 'credential';
interface CredentialState { loaded: boolean; remembered: boolean; queue: Promise<void>; loading?: Promise<void> }
interface RecordValue { version: 1; key: CryptoKey; iv: Uint8Array; ciphertext: ArrayBuffer }
let nodeKey = ''; const nodeState: CredentialState = { loaded: false, remembered: false, queue: Promise.resolve() };
function page(): Record<symbol, unknown> | undefined { return typeof window === 'undefined' ? undefined : window as unknown as Record<symbol, unknown>; }
function state(): CredentialState {
  const current = page(); if (!current) return nodeState;
  if (!current[STATE]) Object.defineProperty(current, STATE, { configurable: true, enumerable: false, value: { loaded: false, remembered: false, queue: Promise.resolve() } });
  return current[STATE] as CredentialState;
}
export function browserCredential(): string { const current = page(); return current ? (current[KEY] as string | undefined) ?? '' : nodeKey; }
export function setBrowserCredential(value: string) {
  const current = page(); if (current) Object.defineProperty(current, KEY, { configurable: true, writable: true, enumerable: false, value }); else nodeKey = value;
  state().loaded = true;
}
function enqueue<T>(action: () => Promise<T>): Promise<T> { const s = state(), result = s.queue.then(action, action); s.queue = result.then(() => {}, () => {}); return result; }
function supported(): boolean { return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle; }
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new Error('无法访问浏览器密钥存储，请检查站点存储权限。'));
  });
}
async function readRecord(): Promise<RecordValue | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get('deepseek'); request.onsuccess = () => resolve(request.result as RecordValue | undefined); request.onerror = () => reject(new Error('无法读取浏览器保存的密钥。')); }); }
  finally { db.close(); }
}
async function writeRecord(value?: RecordValue) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('无法保存或清除浏览器密钥，请检查站点存储权限。')); if (value) tx.objectStore(STORE).put(value, 'deepseek'); else tx.objectStore(STORE).delete('deepseek'); }); }
  finally { db.close(); }
}
export function loadBrowserCredential(): Promise<void> {
  const s = state(); if (s.loaded) return Promise.resolve(); if (s.loading) return s.loading;
  s.loading = enqueue(async () => {
    if (s.loaded) return;
    if (browserCredential() || !supported()) { s.loaded = true; return; }
    const record = await readRecord();
    if (record) {
      try {
        if (record.version !== 1 || record.key.extractable || record.key.algorithm.name !== 'AES-GCM') throw new Error();
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer> }, record.key, record.ciphertext);
        const value = new TextDecoder().decode(plaintext); if (!/^\S{8,512}$/.test(value)) throw new Error();
        setBrowserCredential(value); s.remembered = true;
      } catch { throw new Error('已保存的密钥无法解密，请在设置中重新配置或清除。'); }
    }
    s.loaded = true;
  }).finally(() => { s.loading = undefined; });
  return s.loading;
}
export async function browserCredentialInfo() { await loadBrowserCredential(); return { configured: !!browserCredential(), remembered: state().remembered }; }
export async function saveBrowserCredential(value: string, remember: boolean) {
  return enqueue(async () => {
    if (remember) {
      if (!supported()) throw new Error('此环境不支持加密记住密钥，请使用正常浏览器的 HTTPS／localhost，或选择仅本次会话。');
      try {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
        await writeRecord({ version: 1, key, iv, ciphertext });
      } catch { throw new Error('浏览器加密保存失败，请检查站点存储权限；配置尚未替换。'); }
    } else if (typeof indexedDB !== 'undefined') await writeRecord();
    setBrowserCredential(value); state().remembered = remember;
  });
}
export async function setBrowserCredentialPersistence(remember: boolean) { await loadBrowserCredential(); const value = browserCredential(); if (!value) throw new Error('请先配置 API Key。'); await saveBrowserCredential(value, remember); }
export async function clearBrowserCredential() { return enqueue(async () => { if (typeof indexedDB !== 'undefined') await writeRecord(); setBrowserCredential(''); state().remembered = false; }); }
