import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rootPackagePath = join(repoRoot, 'package.json');
const extensionPackagePath = join(repoRoot, 'vscode-extension', 'package.json');
const extensionLockPath = join(repoRoot, 'vscode-extension', 'package-lock.json');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const rootPackage = readJson(rootPackagePath);
const extensionPackage = readJson(extensionPackagePath);
const extensionLock = readJson(extensionLockPath);
const version = rootPackage.version;

if (!version) {
  throw new Error('Root package.json is missing version.');
}

extensionPackage.version = version;
extensionLock.version = version;

if (extensionLock.packages?.['']) {
  extensionLock.packages[''].version = version;
  extensionLock.packages[''].license = extensionPackage.license;
}

writeJson(extensionPackagePath, extensionPackage);
writeJson(extensionLockPath, extensionLock);

console.log(`VS Code extension version synced to ${version}.`);
