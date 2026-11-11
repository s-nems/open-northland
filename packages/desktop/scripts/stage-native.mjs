/**
 * electron-builder `beforePack` hook: stages koffi's native binary for the platform being packaged.
 * npm installs only the build host's binary, and one host packages every platform, so the others
 * come from the registry tarball `package-lock.json` pins, checked against its integrity hash. The
 * packaged shell finds the binary at `resources/koffi/<platform>_<arch>/koffi.node`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arch } from 'electron-builder';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(packageRoot, '../..');
const BINARY = 'koffi.node';
/** The platforms whose shell holds the cursor (`src/cursor/hold.ts`); the others load no native code. */
const HOLDING_PLATFORMS = ['win32', 'darwin'];

export default async function stageNative({ electronPlatformName, arch }) {
  const archName = Arch[arch];
  const triplet = `${electronPlatformName}_${archName}`;
  if (!HOLDING_PLATFORMS.includes(electronPlatformName)) return;
  const staged = join(packageRoot, 'dist-native/koffi', triplet);
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(staged, { recursive: true });

  const name = `@koromix/koffi-${electronPlatformName}-${archName}`;
  const installed = join(repoRoot, 'node_modules', name, triplet, BINARY);
  if (existsSync(installed)) {
    copyFileSync(installed, join(staged, BINARY));
    return;
  }
  const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
  const pinned = lock.packages?.[`node_modules/${name}`];
  if (typeof pinned?.resolved !== 'string' || typeof pinned.integrity !== 'string') {
    throw new Error(`package-lock.json pins no ${name}`);
  }
  const response = await fetch(pinned.resolved);
  if (!response.ok) throw new Error(`${pinned.resolved}: HTTP ${response.status}`);
  const tarball = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = pinned.integrity.split('-', 2);
  if (createHash(algorithm).update(tarball).digest('base64') !== expected) {
    throw new Error(`${name}: the downloaded tarball does not match package-lock.json`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'koffi-'));
  try {
    const archive = join(scratch, 'package.tgz');
    writeFileSync(archive, tarball);
    execFileSync('tar', ['-xzf', archive, '-C', scratch, `package/${triplet}/${BINARY}`]);
    copyFileSync(join(scratch, 'package', triplet, BINARY), join(staged, BINARY));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
