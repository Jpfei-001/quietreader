import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { MAX_ENTRY_SIZE, MAX_FILE_SIZE, validateArchive, validateFile } from './files';

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
async function sample() {
  return bufferOf(await readFile(new URL('../../public/demo/minimal.epub', import.meta.url)));
}

describe('EPUB 文件校验', () => {
  it('接受大小写扩展名', () => expect(() => validateFile({ name: '书.EPUB', size: 100 })).not.toThrow());
  it('拒绝非 EPUB、空文件和大文件', () => {
    expect(() => validateFile({ name: 'a.pdf', size: 1 })).toThrow('.epub');
    expect(() => validateFile({ name: 'a.epub', size: 0 })).toThrow('为空');
    expect(() => validateFile({ name: 'a.epub', size: MAX_FILE_SIZE + 1 })).toThrow('20 MB');
  });
  it('接受生成的 EPUB 3 和 EPUB 2', async () => {
    const epub3 = await sample();
    const epub2 = bufferOf(await readFile(new URL('../../public/demo/epub2.epub', import.meta.url)));
    expect(() => validateArchive(epub3)).not.toThrow();
    expect(() => validateArchive(epub2)).not.toThrow();
  });
  it('拒绝无效与截断的 ZIP', async () => {
    expect(() => validateArchive(new ArrayBuffer(10))).toThrow('压缩包');
    const data = await sample();
    expect(() => validateArchive(data.slice(0, data.byteLength - 10))).toThrow();
  });
  it('拒绝声明解压资源超限的 ZIP', async () => {
    const data = await sample();
    const view = new DataView(data);
    const end = data.byteLength - 22;
    const central = view.getUint32(end + 16, true);
    view.setUint32(central + 24, MAX_ENTRY_SIZE + 1, true);
    expect(() => validateArchive(data)).toThrow('资源过大');
  });
  it('拒绝结构文件缺失、路径穿越和加密声明', async () => {
    const missing = new JSZip();
    missing.file('test.txt', 'not an epub');
    const missingData = await missing.generateAsync({ type: 'arraybuffer' });
    expect(() => validateArchive(missingData)).toThrow('结构文件');
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', '<container/>');
    zip.file('META-INF/encryption.xml', '<encryption/>');
    const encrypted = await zip.generateAsync({ type: 'arraybuffer' });
    expect(() => validateArchive(encrypted)).toThrow('加密');
    zip.remove('META-INF/encryption.xml');
    zip.file('../outside.xhtml', 'test');
    const traversal = await zip.generateAsync({ type: 'arraybuffer' });
    expect(() => validateArchive(traversal)).toThrow('ZIP');
  });
});
