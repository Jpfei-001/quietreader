import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Product-owned resources only. Never copy public/, a browser profile or a database wholesale.
export const DESKTOP_RESOURCES = Object.freeze(['books/user-guide.epub', 'demo/minimal.epub']);
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');

async function regularFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`资源不是普通文件：${file}`);
  return readFile(file);
}
async function regularDirectory(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`禁止使用链接或非目录资源路径：${directory}`);
}
async function productSource(projectRoot, relative) {
  const publicRoot = path.join(projectRoot, 'public');
  await regularDirectory(publicRoot);
  await regularDirectory(path.join(publicRoot, path.dirname(relative)));
  return regularFile(path.join(publicRoot, relative));
}
async function listFiles(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error(`禁止打包符号链接：${relative}`);
    if (item.isDirectory()) files.push(...await listFiles(path.join(directory, item.name), relative + '/'));
    else if (item.isFile()) files.push(relative);
    else throw new Error(`禁止打包特殊文件：${relative}`);
  }
  return files.sort();
}
export async function auditDesktopResources(projectRoot, output) {
  const config = JSON.parse(await readFile(path.join(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  if (config.build.frontendDist !== '../dist-desktop') throw new Error('桌面构建必须使用专用的 dist-desktop。');
  if (config.bundle.resources && Object.keys(config.bundle.resources).length) throw new Error('禁止配置未审核的额外 bundle.resources。');
  await regularDirectory(output);
  const files = await listFiles(output);
  for (const required of ['index.html', ...DESKTOP_RESOURCES]) {
    if (!files.includes(required)) throw new Error(`缺少桌面资源：${required}`);
  }
  const inventory = [];
  for (const file of files) {
    const productResource = DESKTOP_RESOURCES.includes(file);
    const generatedAsset = /^assets\/[a-zA-Z0-9_-]+\.(js|css|png|svg|woff2?)$/.test(file);
    if (file !== 'index.html' && !productResource && !generatedAsset) throw new Error(`发现白名单外文件，停止打包：${file}`);
    const data = await regularFile(path.join(output, file));
    if (productResource) {
      const source = await productSource(projectRoot, file);
      if (!data.equals(source)) throw new Error(`内置资源与已审核来源不一致：${file}`);
    }
    inventory.push({ file, bytes: data.length, sha256: hash(data) });
  }
  return {
    status: 'passed',
    policy: 'product-assets-only; no user library, notes, drafts, exports or browser profiles',
    files: inventory,
  };
}
export async function prepareDesktopResources(projectRoot, output) {
  await regularDirectory(output);
  for (const file of DESKTOP_RESOURCES) {
    const source = path.join(projectRoot, 'public', file);
    await productSource(projectRoot, file);
    const target = path.join(output, file);
    await mkdir(path.dirname(target), { recursive: true });
    await regularDirectory(path.dirname(target));
    // Reject existing links before copying; normal builds start from an empty Vite output directory.
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error(`禁止写入链接文件：${file}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await copyFile(source, target);
  }
  return auditDesktopResources(projectRoot, output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.join(root, 'dist-desktop');
  const report = process.argv.includes('--check')
    ? await auditDesktopResources(root, output)
    : await prepareDesktopResources(root, output);
  await mkdir(path.join(root, '.tools'), { recursive: true });
  await writeFile(path.join(root, '.tools/windows-package-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`桌面资源审计通过：${report.files.length} 个文件；仅含应用资源、使用指南和自有样书，不复制用户书架、笔记或草稿。`);
}
