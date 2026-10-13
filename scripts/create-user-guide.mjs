import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDir = path.join(root, 'docs/使用指南');
const sourceFile = path.join(sourceDir, '静读操作指南.md');
const output = path.join(root, 'public/books/user-guide.epub');
const source = await readFile(sourceFile, 'utf8');
const title = source.match(/^# (.+)$/m)?.[1];
if (title !== '静读操作指南') throw new Error('指南缺少正确的一级标题。');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const inline = text => escape(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
const imagePaths = [...new Set([...source.matchAll(/^!\[[^\]]*\]\(([^)]+)\)$/gm)].map(match => match[1]))];
if (imagePaths.length < 10) throw new Error('指南必须包含实际操作截图。');
const assets = new Map();
for (const [index, relative] of imagePaths.entries()) {
  const file = path.resolve(sourceDir, relative);
  if (!file.startsWith(sourceDir + path.sep) || !relative.endsWith('.png')) throw new Error(`不允许的图片路径：${relative}`);
  const data = await readFile(file);
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`图片不是 PNG：${relative}`);
  assets.set(relative, { name: `image-${String(index + 1).padStart(2, '0')}.png`, data });
}
const cover = await readFile(path.join(sourceDir, 'images/00-cover.png'));
const digest = createHash('sha256').update(source).update(cover);
for (const { data } of assets.values()) digest.update(data);
const sourceDigest = digest.digest('hex');
const chapters = [];
let chapter = { title: '欢迎使用静读', lines: [] };
for (const line of source.split(/\r?\n/)) {
  if (line.startsWith('# ')) continue;
  if (line.startsWith('## ')) {
    if (chapter.lines.some(line => line.trim())) chapters.push(chapter);
    chapter = { title: line.slice(3), lines: [] };
  } else chapter.lines.push(line);
}
if (chapter.lines.some(line => line.trim())) chapters.push(chapter);

function render(lines) {
  const result = []; let paragraph = [], list = [], listType = '', quote = [];
  const flushParagraph = () => { if (paragraph.length) result.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; };
  const flushList = () => { if (list.length) result.push(`<${listType}>${list.map(item => `<li>${inline(item)}</li>`).join('')}</${listType}>`); list = []; listType = ''; };
  const flushQuote = () => { if (quote.length) result.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`); quote = []; };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };
  for (const line of lines) {
    if (!line.trim()) { flush(); continue; }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flush(); const asset = assets.get(image[2]); if (!asset) throw new Error('未收录的图片。');
      result.push(`<figure><img src="images/${asset.name}" alt="${escape(image[1])}"/><figcaption>${inline(image[1])}</figcaption></figure>`); continue;
    }
    if (line.startsWith('### ')) { flush(); result.push(`<h2>${inline(line.slice(4))}</h2>`); continue; }
    if (line.startsWith('> ')) { flushParagraph(); flushList(); quote.push(line.slice(2)); continue; }
    const item = line.match(/^(?:(-) |(\d+)\. )(.+)$/);
    if (item) {
      flushParagraph(); flushQuote(); const type = item[1] ? 'ul' : 'ol';
      if (listType && type !== listType) flushList(); listType = type; list.push(item[3]); continue;
    }
    flushList(); flushQuote(); paragraph.push(line);
  }
  flush(); return result.join('\n');
}
const xhtml = (label, body) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN"><head><meta charset="UTF-8"/><title>${escape(label)}</title><link rel="stylesheet" href="guide.css"/></head><body>${body}</body></html>`;
const css = `body{font-family:serif;color:#2d302d}h1{font-size:1.55em;font-weight:500;line-height:1.45;margin:0 0 1.1em}h2{font-size:1.15em;line-height:1.5;margin:1.4em 0 .6em}p{margin:0 0 .95em}ul,ol{padding-left:1.5em;margin:0 0 1em}li{margin-bottom:.4em}strong{font-weight:700}code{font-family:inherit;border:1px solid #bcc5b5;border-radius:.2em;padding:0 .2em}blockquote{border-left:.2em solid #80987b;margin:1em 0;padding:.1em .7em}figure{margin:1.1em 0;break-inside:avoid;page-break-inside:avoid}figure img{display:block;width:100%;height:auto;max-height:70vh;object-fit:contain}figcaption{font-size:.78em;line-height:1.6;margin:.5em 0 0;color:inherit}a{color:inherit}.cover{height:60vh;width:auto;max-width:100%;object-fit:contain;display:block;margin:0 auto 1.1em}`;
const expected = new Map();
expected.set('mimetype', Buffer.from('application/epub+zip'));
expected.set('META-INF/container.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'));
expected.set('OEBPS/guide.css', Buffer.from(css));
expected.set('OEBPS/images/cover.png', cover);
for (const { name, data } of assets.values()) expected.set(`OEBPS/images/${name}`, data);
chapters.forEach((c, index) => expected.set(`OEBPS/chapter-${index + 1}.xhtml`, Buffer.from(xhtml(c.title, `<h1>${inline(c.title)}</h1>${index === 0 ? '<img class="cover" src="images/cover.png" alt="静读操作指南封面"/>' : ''}${render(c.lines)}`))));
expected.set('OEBPS/nav.xhtml', Buffer.from(xhtml('目录', `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${chapters.map((c, i) => `<li><a href="chapter-${i + 1}.xhtml">${escape(c.title)}</a></li>`).join('')}</ol></nav>`)));
expected.set('OEBPS/toc.ncx', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:quiet-reader:user-guide:2"/></head><docTitle><text>${title}</text></docTitle><navMap>${chapters.map((c, i) => `<navPoint id="chapter-${i + 1}" playOrder="${i + 1}"><navLabel><text>${escape(c.title)}</text></navLabel><content src="chapter-${i + 1}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`));
expected.set('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:quiet-reader:user-guide:2</dc:identifier><dc:title>${title}</dc:title><dc:creator>静读</dc:creator><dc:language>zh-CN</dc:language><dc:description>面向日常使用者的图文操作指南，介绍阅读、标注、思考、AI 阅读助手配置与使用及笔记备份。</dc:description><meta property="dcterms:modified">2026-10-12T00:00:00Z</meta><dc:source>urn:sha256:${sourceDigest}</dc:source></metadata><manifest><item id="css" href="guide.css" media-type="text/css"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cover" href="images/cover.png" properties="cover-image" media-type="image/png"/>${chapters.map((_, i) => `<item id="chapter-${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}${[...assets.values()].map(({ name }, i) => `<item id="image-${i + 1}" href="images/${name}" media-type="image/png"/>`).join('')}</manifest><spine toc="ncx">${chapters.map((_, i) => `<itemref idref="chapter-${i + 1}"/>`).join('')}</spine></package>`));

if (process.argv.includes('--check')) {
  const zip = await JSZip.loadAsync(await readFile(output));
  for (const [name, content] of expected) {
    const file = zip.file(name);
    if (!file || !(await file.async('nodebuffer')).equals(content)) throw new Error(`内置指南与 Markdown / 截图不同步：${name}。请重新生成。`);
  }
  console.log(`内置指南校验通过：${chapters.length} 章、${assets.size} 张操作截图，全部图片在 EPUB 内。`);
} else {
  const zip = new JSZip();
  // 固定 ZIP 时间，内容不变时重复构建得到相同文件，避免同一本指南被重复导入。
  const date = new Date('2026-01-01T00:00:00Z');
  // 不创建带当前时间的隐式目录条目；否则即使正文不变，文件哈希也会随构建时间变化。
  for (const [name, content] of expected) zip.file(name, content, { date, createFolders: false, compression: name === 'mimetype' ? 'STORE' : 'DEFLATE' });
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (data.length > 20 * 1024 * 1024) throw new Error('指南超过阅读器的单本文件上限。');
  await mkdir(path.dirname(output), { recursive: true });
  let previous;
  try { previous = await readFile(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!previous?.equals(data)) {
    // 原子替换，避免运行中的阅读器读到写入了一半的 EPUB。
    const temporary = `${output}.${process.pid}.tmp`;
    try { await writeFile(temporary, data); await rename(temporary, output); }
    finally { await rm(temporary, { force: true }); }
  }
  console.log(`Markdown 操作指南已就绪：public/books/user-guide.epub，${chapters.length} 章、${assets.size} 张截图，${(data.length / 1024 / 1024).toFixed(2)} MB。`);
}
