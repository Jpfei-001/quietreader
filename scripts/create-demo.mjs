import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const folder = new URL('../public/demo/', import.meta.url);
await mkdir(folder, { recursive: true });
const labels = ['第一章 · 留一点空白', '第二章 · On a Quiet Morning', '第三章 · 山间来信'];
const namespace = 'http://www.w3.org/1999/xhtml';
const text = [
  '清晨，窗外的树影慢慢移到书页上。我们不必赶路，也不必急着寻找结论，只需要在一段文字中停留片刻。',
  '阅读不只是在页与页之间移动。它也是一种观察：观察语言的节奏，观察自己的心绪，观察日常生活里那些细小的变化。',
  '把多余的声音放在门外，给文字留一点空白。这是一份自行创作的测试文本，用于验证中文排版、章节目录、分页和阅读位置。',
];
async function createBook(filename, version, unsafe = false) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const title = unsafe ? '安全验证样书' : version === '2.0' ? '静读 · EPUB 2 样书' : '静读 · 给文字留一点空白';
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:quiet-reader:${filename}</dc:identifier><dc:title>${title}</dc:title><dc:creator>静读工作室</dc:creator><dc:language>zh-CN</dc:language>${version === '3.0' ? '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>' : '<meta name="cover" content="cover"/>'}</metadata><manifest>${labels.map((_, i) => `<item id="chapter${i}" href="chapter${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="css" href="style.css" media-type="text/css"/><item id="picture" href="landscape.svg" media-type="image/svg+xml"/><item id="cover" href="cover.svg" media-type="image/svg+xml"${version === '3.0' ? ' properties="cover-image"' : ''}/>${version === '3.0' ? '<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>' : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'}</manifest><spine${version === '2.0' ? ' toc="ncx"' : ''}>${labels.map((_, i) => `<itemref idref="chapter${i}"/>`).join('')}</spine></package>`);
  zip.file('OEBPS/cover.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="#dfe5d9"/><path d="M36 0V900" stroke="#bdc8b6"/><text x="100" y="250" font-size="100" fill="#465a49" font-family="serif">静</text><text x="100" y="390" font-size="100" fill="#465a49" font-family="serif">读</text><text x="100" y="720" font-size="28" fill="#465a49">${version === '2.0' ? 'EPUB 2' : '给文字留一点空白'}</text></svg>`);
  zip.file('OEBPS/style.css', 'body { font-family: serif; } h1 { font-size: 1.5em; font-weight: normal; margin-bottom: 1.5em; } p { text-align: justify; margin: 0 0 1em; } .landscape { width: 100%; max-height: 180px; }');
  zip.file('OEBPS/landscape.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180" viewBox="0 0 600 180"><rect width="600" height="180" fill="#e6ebdf"/><circle cx="465" cy="45" r="22" fill="#e0c995"/><path d="M0 180L150 40L320 180Z" fill="#afbfaa"/><path d="M170 180L390 60L600 180Z" fill="#819a81"/></svg>');
  for (let i = 0; i < labels.length; i++) {
    const paragraphs = Array.from({ length: 36 }, (_, j) => `<p>${i === 1 ? `Paragraph ${j + 1}. On a quiet morning, a book is a small window into another world. Take your time, follow the words, and let the page hold your attention. ` : `第 ${j + 1} 段。${text[j % text.length]}`}</p>`).join('');
    const payload = unsafe && i === 0 ? '<script>localStorage.setItem("quiet-reader:unsafe-script", "executed")</script><img src="https://example.invalid/tracking.png"/><style>@import url("https://example.invalid/tracking.css");</style><iframe src="https://example.invalid/frame"/>' : '';
    zip.file(`OEBPS/chapter${i}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="${namespace}" lang="zh-CN"><head><title>${labels[i]}</title><link rel="stylesheet" href="style.css"/></head><body><h1>${labels[i]}</h1>${i === 0 ? '<img class="landscape" src="landscape.svg" alt="样书插图：山峰与太阳"/>' : ''}${payload}${paragraphs}</body></html>`);
  }
  if (version === '3.0') {
    zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="${namespace}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc" id="toc"><ol>${labels.map((label, i) => `<li><a href="chapter${i}.xhtml">${label}</a></li>`).join('')}</ol></nav></body></html>`);
  } else {
    zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:quiet-reader:${filename}"/></head><docTitle><text>${title}</text></docTitle><navMap>${labels.map((label, i) => `<navPoint id="nav${i}" playOrder="${i + 1}"><navLabel><text>${label}</text></navLabel><content src="chapter${i}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`);
  }
  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await writeFile(new URL(filename, folder), content);
  console.log(`生成 public/demo/${filename} (${content.length} bytes)`);
}
await createBook('minimal.epub', '3.0');
await createBook('epub2.epub', '2.0');
await createBook('security.epub', '3.0', true);

// 生成自有 RGBA PNG 图标，避免依赖第三方图标或在线字体。
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
const width = 128;
const pixels = Buffer.alloc((width * 4 + 1) * width);
for (let y = 0; y < width; y++) {
  for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    const page = x > 31 && x < 97 && y > 26 && y < 102;
    const line = page && x > 42 && x < 85 && [46, 59, 72, 85].some((row) => Math.abs(y - row) < 2);
    pixels.set(page && !line ? [250, 250, 248, 255] : [82, 115, 92, 255], offset);
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(width, 4);
header[8] = 8;
header[9] = 6;
const iconDirectory = new URL('../src-tauri/icons/', import.meta.url);
await mkdir(iconDirectory, { recursive: true });
await writeFile(new URL('icon.png', iconDirectory), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
]), { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; }); // Preserve the approved release icon.
