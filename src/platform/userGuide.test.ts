import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateArchive, validateFile } from './files';

const epubUrl = new URL('../../public/books/user-guide.epub', import.meta.url);
const sourceUrl = new URL('../../docs/使用指南/静读操作指南.md', import.meta.url);

describe('内置日常使用指南', () => {
  it('是符合阅读器限制的普通 EPUB，mimetype 位于第一个且不压缩', async () => {
    const data = await readFile(epubUrl);
    expect(() => validateFile({ name: '静读操作指南.epub', size: data.length })).not.toThrow();
    expect(() => validateArchive(Uint8Array.from(data).buffer)).not.toThrow();
    expect(data.readUInt32LE(0)).toBe(0x04034b50);
    expect(data.readUInt16LE(8)).toBe(0);
    expect(data.subarray(30, 30 + data.readUInt16LE(26)).toString()).toBe('mimetype');
    const zip = await JSZip.loadAsync(data);
    // 隐式目录可能带构建时刻，从而把同一份指南误判成新书。所有条目必须固定。
    for (const file of Object.values(zip.files)) {
      expect(file.dir).toBe(false);
      expect(file.date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    }
  });

  it('目录、正文、封面和每张截图都在书内，不依赖网络图片', async () => {
    const zip = await JSZip.loadAsync(await readFile(epubUrl));
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('<dc:title>静读操作指南</dc:title>');
    expect(opf).toContain('properties="cover-image"');
    const source = await readFile(sourceUrl, 'utf8');
    const chapterTitles = [...source.matchAll(/^## (.+)$/gm)].map(m => m[1]);
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string');
    expect(chapterTitles).toHaveLength(16);
    for (const title of chapterTitles) expect(nav).toContain(title);
    const imageReferences = [...source.matchAll(/^!\[([^\]]+)\]\(([^)]+)\)$/gm)];
    expect(imageReferences).toHaveLength(15);
    const bodies = await Promise.all(Object.keys(zip.files).filter(file => /chapter-\d+\.xhtml$/.test(file)).map(file => zip.file(file)!.async('string')));
    expect(bodies).toHaveLength(17);
    const body = bodies.join('\n');
    for (const [index, match] of imageReferences.entries()) {
      const asset = `image-${String(index + 1).padStart(2, '0')}.png`;
      expect(body).toContain(`images/${asset}`);
      const packed = await zip.file(`OEBPS/images/${asset}`)!.async('nodebuffer');
      expect(packed.equals(await readFile(new URL(`../../docs/使用指南/${match[2]}`, import.meta.url)))).toBe(true);
    }
    expect(body).not.toMatch(/<script\b|src="https?:|href="https?:/);
    expect(body).not.toContain('**');
    expect(body).toContain('<strong>');
    expect(body).toContain('<figcaption>');
    for (const label of ['配置 AI 阅读助手', '选文提问与追加引用', '助手模式、保存回答与会话保护', 'Enter', 'Shift + Enter', '保存为思考', '不会因为打开一本书就自动上传整本书']) expect(body).toContain(label);
    expect(opf).toContain('urn:quiet-reader:user-guide:2');
  });

  it('正文面向普通用户，不混入开发命令或内部存储术语', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    expect(source).not.toMatch(/npm run|localhost|127\.0\.0\.1|IndexedDB|Rust|Vite|CFI|开发模式|测试文本/);
    for (const word of ['添加书籍', '使用指南', '专注阅读', '草稿', 'JSON', '原始 EPUB', 'API Key', 'DeepSeek', '关闭助手', '系统凭据', '加密保存']) expect(source).toContain(word);
  });

  it('生成文件与 Markdown、截图逐项一致', () => {
    const script = fileURLToPath(new URL('../../scripts/create-user-guide.mjs', import.meta.url));
    const result = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8', timeout: 30000 });
    expect(result).toContain('内置指南校验通过');
  });
});
