import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type { Plugin } from 'vite';

const CLIENT_PACKAGES = ['app', 'data', 'sim', 'lockstep', 'net-client', 'net-protocol'];

export function clientBuildIdentity(root: string): string {
  const hash = createHash('sha256');
  const paths = ['package-lock.json'];
  for (const name of CLIENT_PACKAGES) {
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

/** A live session cannot hot-swap sim code while retaining its previous multiplayer identity. */
export function refreshClientBuild(root: string): Plugin {
  const sources = CLIENT_PACKAGES.map((name) => resolve(root, 'packages', name, 'src'));
  const lockfile = resolve(root, 'package-lock.json');
  return {
    name: 'refresh-client-build',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add([...sources, lockfile]);
      server.watcher.on('all', (event, file) => {
        if (event !== 'change' && event !== 'add' && event !== 'unlink') return;
        const path = resolve(file);
        if (
          path === lockfile ||
          sources.some((source) => {
            const child = relative(source, path);
            return child !== '' && !child.startsWith('..');
          })
        )
          void server.restart();
      });
    },
  };
}
