import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function field(section, name) {
  return section?.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"\\s*(?:#.*)?$`, 'm'))?.[1];
}

/** Read only: validate application metadata without changing dependency versions or user data. */
export async function checkReleaseVersion(root = projectRoot) {
  const load = relative => readFile(path.join(root, relative), 'utf8');
  const [packageText, npmLockText, configText, cargoText, cargoLockText] = await Promise.all([
    load('package.json'), load('package-lock.json'), load('src-tauri/tauri.conf.json'),
    load('src-tauri/Cargo.toml'), load('src-tauri/Cargo.lock'),
  ]);
  const pkg = JSON.parse(packageText), npmLock = JSON.parse(npmLockText), config = JSON.parse(configText);
  const cargoPackage = cargoText.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const cargoName = field(cargoPackage, 'name');
  const lockedPackage = cargoLockText.split(/^\[\[package\]\]\s*$/m).slice(1).find(section => field(section, 'name') === cargoName);
  const versions = {
    'package.json': pkg.version,
    'package-lock.json': npmLock.version,
    'package-lock.json packages[""]': npmLock.packages?.['']?.version,
    'src-tauri/tauri.conf.json': config.version,
    'src-tauri/Cargo.toml [package]': field(cargoPackage, 'version'),
    'src-tauri/Cargo.lock application': field(lockedPackage, 'version'),
  };
  // A plain three-part version gives an unambiguous NSIS filename and release directory.
  if (typeof pkg.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) {
    throw new Error('发布版本必须使用三段数字（例如 0.3.0），不能包含路径、预发布或构建后缀。');
  }
  const mismatches = Object.entries(versions).filter(([, version]) => version !== pkg.version);
  if (mismatches.length) throw new Error(`发布版本不一致，目标 ${pkg.version}：${mismatches.map(([file, version]) => `${file} = ${version ?? '缺失'}`).join('；')}`);
  if (!cargoName || !config.productName || !config.identifier) throw new Error('缺少应用名称或 identifier，停止打包。');
  return { version: pkg.version, productName: config.productName, identifier: config.identifier, versions };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await checkReleaseVersion(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
