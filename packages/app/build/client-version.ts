import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export function clientBuildIdentity(root: string): string {
  const hash = createHash('sha256');
  const paths = ['package-lock.json'];
  for (const name of ['app', 'data', 'sim', 'lockstep', 'net-client', 'net-protocol']) {
    const source = join(root, 'packages', name, 'src');
    for (const entry of readdirSync(source, { recursive: true, withFileTypes: true })) {
      if (entry.isFile())
        paths.push(relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
    }
  }
  for (const path of paths.sort()) {
    const bytes = Buffer.from(readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n'));
    hash.update(JSON.stringify([path, bytes.length]));
    hash.update(bytes);
  }
  return hash.digest('hex');
}
