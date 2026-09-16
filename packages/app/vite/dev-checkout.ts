import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Fail before listening when a preview could silently serve another checkout's code. */
export function devCheckout(root: string, contentRoot: string): Plugin {
  const checkout = realpathSync(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
  let automaticPort = false;
  return {
    name: 'dev-checkout',
    apply: (_config, { command, isPreview }) => command === 'serve' && !isPreview,
    config(config) {
      const primary = git('rev-parse', '--git-dir') === git('rev-parse', '--git-common-dir');
      // Vite treats 0 as its default 5173. Harnesses use 0 to request any free task port.
      automaticPort = config.server?.port === 0;
      return {
        server: {
          host: config.server?.host ?? '127.0.0.1',
          port: automaticPort ? 5174 : (config.server?.port ?? (primary ? 5173 : 5174)),
          strictPort: !automaticPort,
        },
      };
    },
    configResolved(config) {
      const primary = git('rev-parse', '--git-dir') === git('rev-parse', '--git-common-dir');
      if (config.server.port === 5173 && (!primary || git('branch', '--show-current') !== 'main'))
        throw new Error(
          ':5173 is reserved for the primary checkout on main. Choose --port 5174 (or another free port).',
        );
      config.server.strictPort = !automaticPort;
      if (realpathSync(config.root) !== realpathSync(join(checkout, 'packages/app')))
        throw new Error(`Vite root must be ${join(checkout, 'packages/app')}`);
    },
    async configureServer(server) {
      const app = join(checkout, 'packages/app');
      const { dependencies } = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
      };
      for (const name of Object.keys(dependencies).filter((name) => name.startsWith('@open-northland/'))) {
        const resolved = await server.pluginContainer.resolveId(name, join(app, 'src/main.ts'));
        const source = join(checkout, 'packages', name.slice('@open-northland/'.length), 'src');
        const child = resolved && relative(source, realpathSync(resolved.id));
        if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
          throw new Error(
            `${name} must resolve to ${source}; got ${resolved?.id ?? 'no module'}. Run npm ci in this checkout; do not share node_modules.`,
          );
      }
      const build = server.config.define?.__CLIENT_BUILD__;
      if (typeof build !== 'string') throw new Error('Missing client build identity');
      const identity = {
        checkout,
        branch: git('branch', '--show-current'),
        head: git('rev-parse', 'HEAD'),
        pid: process.pid,
        contentRoot,
        clientBuild: JSON.parse(build),
      };
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/__dev/checkout') return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(identity));
      });
    },
  };
}
