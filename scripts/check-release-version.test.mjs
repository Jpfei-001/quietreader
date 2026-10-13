import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkReleaseVersion } from './check-release-version.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'quiet-reader-version-')); roots.push(root);
  await mkdir(path.join(root, 'src-tauri'));
  const files = {
    'package.json': JSON.stringify({ name: 'reader', version: '0.2.0' }),
    'package-lock.json': JSON.stringify({ version: '0.2.0', packages: { '': { version: '0.2.0' }, 'node_modules/dependency': { version: '0.1.0' } } }),
    'src-tauri/tauri.conf.json': JSON.stringify({ version: '0.2.0', productName: 'Quiet Reader', identifier: 'com.quietreader.app' }),
    'src-tauri/Cargo.toml': '[package]\nname = "quiet-reader"\nversion = "0.2.0"\n[dependencies]\ntauri = "2"\n',
    'src-tauri/Cargo.lock': 'version = 4\n[[package]]\nname = "dependency"\nversion = "0.1.0"\n[[package]]\nname = "quiet-reader"\nversion = "0.2.0"\ndependencies = ["dependency"]\n',
  };
  await Promise.all(Object.entries(files).map(([file, content]) => writeFile(path.join(root, file), content)));
  return { root, files };
}

describe('Windows 发布版本校验', () => {
  it('当前项目所有应用版本为 0.3.7，保留原应用 identifier', async () => {
    const report = await checkReleaseVersion();
    expect(report.version).toBe('0.3.7');
    expect(report.identifier).toBe('com.quietreader.app');
    expect(Object.values(report.versions)).toEqual(Array(6).fill('0.3.7'));
  });
  it('忽略依赖版本且不修改输入文件', async () => {
    const { root, files } = await fixture();
    expect((await checkReleaseVersion(root)).version).toBe('0.2.0');
    for (const [file, content] of Object.entries(files)) expect(await readFile(path.join(root, file), 'utf8')).toBe(content);
  });
  for (const file of ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
    it(`${file} 不同步时停止，而不是生成混用版本的安装包`, async () => {
      const { root, files } = await fixture();
      await writeFile(path.join(root, file), files[file].replace('0.2.0', '0.1.0'));
      await expect(checkReleaseVersion(root)).rejects.toThrow('发布版本不一致');
    });
  }
  for (const part of ['root', 'package']) {
    it(`npm 锁文件 ${part} 版本不一致时拒绝`, async () => {
      const { root, files } = await fixture();
      const lock = JSON.parse(files['package-lock.json']);
      if (part === 'root') lock.version = '0.1.0'; else lock.packages[''].version = '0.1.0';
      await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
      await expect(checkReleaseVersion(root)).rejects.toThrow('package-lock.json');
    });
  }
  it('Cargo 锁文件缺失应用条目时停止', async () => {
    const { root, files } = await fixture();
    await writeFile(path.join(root, 'src-tauri/Cargo.lock'), files['src-tauri/Cargo.lock'].replace('name = "quiet-reader"', 'name = "other-reader"'));
    await expect(checkReleaseVersion(root)).rejects.toThrow('Cargo.lock application = 缺失');
  });
  it('版本不能包含路径或后缀', async () => {
    const { root } = await fixture();
    for (const version of ['../0.2.0', '0.2.0-beta', '0.2.0+build', '02.0.0', 2]) {
      await writeFile(path.join(root, 'package.json'), JSON.stringify({ version }));
      await expect(checkReleaseVersion(root)).rejects.toThrow('三段数字');
    }
  });
  it('打包前重建指南，并在发布前执行锁定依赖的 Rust 单测，不启用真实 API 测试', async () => {
    const script = await readFile(new URL('./Build-Windows.ps1', import.meta.url), 'utf8');
    const guide = script.indexOf("@('run', 'guide:build')");
    const unit = script.indexOf("@('test')");
    const build = script.indexOf("@('run', 'desktop:build')");
    const native = script.indexOf("@('test', '--locked', '--lib', '--manifest-path', 'src-tauri/Cargo.toml')");
    const audit = script.indexOf("@('run', 'desktop:audit')");
    expect(guide).toBeGreaterThan(script.indexOf("@('ci')"));
    expect(unit).toBeGreaterThan(guide);
    expect(build).toBeGreaterThan(unit);
    expect(native).toBeGreaterThan(build);
    expect(audit).toBeGreaterThan(native);
    expect(script.indexOf('$Installers =')).toBeGreaterThan(audit);
    expect(script).not.toContain('--ignored');
    expect(script).not.toContain('--include-ignored');
  });
  it('打包脚本在安装依赖前校验快照版本，输出目录不再读取可变的源配置', async () => {
    const script = await readFile(new URL('./Build-Windows.ps1', import.meta.url), 'utf8');
    expect(script.charCodeAt(0)).toBe(0xfeff); // Windows PowerShell 5.1 needs UTF-8 BOM for Chinese text.
    expect(script).toContain('param([switch]$CheckOnly)');
    expect(script.indexOf("@('scripts/check-release-version.mjs')")).toBeLessThan(script.indexOf("@('ci')"));
    expect(script).toContain('$SnapshotInfo.version -ne $ReleaseVersion');
    expect(script).toContain('"release\\$ReleaseVersion\\$BuildId"');
    expect(script).toContain('"${ProductName}_${ReleaseVersion}_x64-setup.exe"');
    expect(script).not.toContain('$Config.version');
  });
});
