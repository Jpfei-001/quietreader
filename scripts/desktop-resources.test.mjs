import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditDesktopResources, DESKTOP_RESOURCES, prepareDesktopResources } from './desktop-resources.mjs';

const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'quiet-reader-packaging-')); temporary.push(root);
  const output = path.join(root, 'dist-desktop');
  for (const directory of ['public/books', 'public/demo', 'src-tauri', 'dist-desktop/assets']) await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ build: { frontendDist: '../dist-desktop' }, bundle: {} }));
  await writeFile(path.join(output, 'index.html'), '<script type="module" src="/assets/index-approved.js"></script>');
  await writeFile(path.join(output, 'assets/index-approved.js'), '// product code');
  for (const file of DESKTOP_RESOURCES) await writeFile(path.join(root, 'public', file), `product-owned fixture: ${file}`);
  return { root, output };
}

describe('桌面安装包资源隐私边界', () => {
  it('Windows 隔离构建复制 EPUB 2 测试夹具，但发行白名单不包含它', async () => {
    const script = await readFile(new URL('./Build-Windows.ps1', import.meta.url), 'utf8');
    expect(script).toContain("Copy-ProductPath 'public\\demo\\epub2.epub'");
    expect(DESKTOP_RESOURCES).not.toContain('demo/epub2.epub');
  });
  it('只复制使用指南与自有样书，不复制 public 中的个人书籍、笔记或备份', async () => {
    const { root, output } = await fixture();
    for (const file of ['private-book.epub', 'notes.json', 'drafts.sqlite', 'library-backup.zip', 'demo/epub2.epub']) await writeFile(path.join(root, 'public', file), 'PRIVATE_SENTINEL');
    const report = await prepareDesktopResources(root, output);
    expect(report.status).toBe('passed');
    expect(report.files.map(item => item.file)).toEqual(['assets/index-approved.js', 'books/user-guide.epub', 'demo/minimal.epub', 'index.html']);
    for (const item of report.files) {
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect((await readFile(path.join(output, item.file), 'utf8'))).not.toContain('PRIVATE_SENTINEL');
    }
    expect(await readdir(path.join(root, 'public'))).toContain('private-book.epub'); // Do not delete source data.
  });
  for (const file of ['private.epub', 'demo/epub2.epub', 'notes.json', 'drafts.sqlite', 'profile.db', 'backup.zip', 'assets/index-approved.js.map']) {
    it(`发现产物中的 ${file} 时停止打包，而不是静默包含或删除`, async () => {
      const { root, output } = await fixture(); await prepareDesktopResources(root, output);
      await writeFile(path.join(output, file), 'PRIVATE_SENTINEL');
      await expect(auditDesktopResources(root, output)).rejects.toThrow('白名单外文件');
      expect(await readFile(path.join(output, file), 'utf8')).toBe('PRIVATE_SENTINEL');
    });
  }
  it('拒绝不同来源的同名内置资源', async () => {
    const { root, output } = await fixture(); await prepareDesktopResources(root, output);
    await writeFile(path.join(output, 'books/user-guide.epub'), 'unapproved replacement');
    await expect(auditDesktopResources(root, output)).rejects.toThrow('来源不一致');
  });
  it('拒绝额外 bundle.resources 和旧浏览器构建目录', async () => {
    const { root, output } = await fixture(); await prepareDesktopResources(root, output);
    const config = path.join(root, 'src-tauri/tauri.conf.json');
    await writeFile(config, JSON.stringify({ build: { frontendDist: '../dist-desktop' }, bundle: { resources: ['user-data/*'] } }));
    await expect(auditDesktopResources(root, output)).rejects.toThrow('额外 bundle.resources');
    await writeFile(config, JSON.stringify({ build: { frontendDist: '../dist' }, bundle: {} }));
    await expect(auditDesktopResources(root, output)).rejects.toThrow('专用的 dist-desktop');
  });
  it.skipIf(process.platform === 'win32')('拒绝产物链接，避免间接带入用户文件', async () => {
    const { root, output } = await fixture(); await prepareDesktopResources(root, output);
    await writeFile(path.join(root, 'private.json'), 'PRIVATE_SENTINEL');
    await symlink(path.join(root, 'private.json'), path.join(output, 'assets/linked.js'));
    await expect(auditDesktopResources(root, output)).rejects.toThrow('符号链接');
  });
  it.skipIf(process.platform === 'win32')('复制前拒绝资源目录链接，不读取链接指向的文件', async () => {
    const { root, output } = await fixture();
    await rm(path.join(root, 'public/books'), { recursive: true });
    await mkdir(path.join(root, 'private')); await writeFile(path.join(root, 'private/user-guide.epub'), 'PRIVATE_SENTINEL');
    await symlink(path.join(root, 'private'), path.join(root, 'public/books'));
    await expect(prepareDesktopResources(root, output)).rejects.toThrow('禁止使用链接');
    expect(await readdir(output)).toEqual(['assets', 'index.html']);
  });
});
