import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DATA_PACK_VERSION } from '../../data-pack.mjs';
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function syntheticPack(root, extra = {}, campaigns = []) {
  const files = { 'base/rules/types/example.ini': '[synthetic]', ...extra };
  const manifest = {
    format: 'open-northland-data',
    version: DATA_PACK_VERSION,
    base: 'base',
    components: [{ id: 'synthetic', kind: 'base', sha256: hash('synthetic') }],
    campaigns,
    files: Object.entries(files).map(([path, bytes]) => ({
      path,
      size: Buffer.byteLength(bytes),
      sha256: hash(bytes),
    })),
  };
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
