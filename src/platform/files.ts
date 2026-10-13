export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_EXPANDED_SIZE = 100 * 1024 * 1024;
export const MAX_ENTRY_SIZE = 20 * 1024 * 1024;
const MAX_ENTRIES = 2000;

export function validateFile(file: Pick<File, 'name' | 'size'>): void {
  if (!file.name.toLowerCase().endsWith('.epub')) throw new Error('请选择 .epub 格式的电子书。');
  if (file.size === 0) throw new Error('文件为空，请选择有效的 EPUB。');
  if (file.size > MAX_FILE_SIZE) throw new Error('目前仅支持不超过 20 MB 的 EPUB。');
}

// 在交给 EPUB 引擎解压前读取 ZIP 中央目录。限制声明大小；这不是完整 ZIP 安全审计。
export function validateArchive(data: ArrayBuffer): void {
  const view = new DataView(data);
  const invalid = () => new Error('EPUB 压缩包损坏或使用了暂不支持的 ZIP 格式。');
  if (view.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50) throw invalid();
  let end = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === view.byteLength) {
      end = i;
      break;
    }
  }
  if (end < 0) throw invalid();
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 ||
      view.getUint16(end + 8, true) !== count || count === 0 || count > MAX_ENTRIES ||
      size === 0xffffffff || start === 0xffffffff || start + size !== end) throw invalid();
  let offset = start;
  let expanded = 0;
  const names = new Set<string>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalid();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const original = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if ((flags & 1) || ![0, 8].includes(method) || compressed === 0xffffffff || next > end) throw invalid();
    expanded += original;
    if (original > MAX_ENTRY_SIZE || expanded > MAX_EXPANDED_SIZE) {
      throw new Error('EPUB 解压后的资源过大，已停止导入。');
    }
    const name = decoder.decode(new Uint8Array(data, offset + 46, nameLength));
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || names.has(name)) throw invalid();
    names.add(name);
    offset = next;
  }
  if (offset !== end || !names.has('mimetype') || !names.has('META-INF/container.xml')) {
    throw new Error('文件不是有效的 EPUB：缺少必要的结构文件。');
  }
  if (names.has('META-INF/encryption.xml')) {
    throw new Error('目前暂不支持加密或字体混淆的 EPUB，请使用无加密样书。');
  }
}

export async function readEpub(file: File): Promise<ArrayBuffer> {
  validateFile(file);
  const data = await file.arrayBuffer();
  validateArchive(data);
  return data;
}
