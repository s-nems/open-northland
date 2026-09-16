import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, resolveConfig, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { devCheckout } from '../vite/dev-checkout.js';

let root: string;
const servers: ViteDevServer[] = [];
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'on-preview-')));
  git('init', '--initial-branch=main');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  );
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await rm(root, { recursive: true, force: true });
});

async function app(checkout: string, dependencyRoot = checkout) {
  const appRoot = join(checkout, 'packages/app');
  await mkdir(join(appRoot, 'src'), { recursive: true });
  await writeFile(
    join(appRoot, 'package.json'),
    JSON.stringify({ dependencies: { '@open-northland/sim': '*' } }),
  );
  const sim = join(dependencyRoot, 'packages/sim');
  await mkdir(join(sim, 'src'), { recursive: true });
  await writeFile(join(sim, 'src/index.ts'), 'export const origin = "fixture";');
  await writeFile(
    join(sim, 'package.json'),
    JSON.stringify({
      name: '@open-northland/sim',
      exports: { source: './src/index.ts', default: './dist/index.js' },
    }),
  );
  await mkdir(join(checkout, 'node_modules/@open-northland'), { recursive: true });
  await symlink(sim, join(checkout, 'node_modules/@open-northland/sim'), 'junction');
  return appRoot;
}

async function server(checkout: string, port?: number) {
  const result = await createServer({
    configFile: false,
    root: join(checkout, 'packages/app'),
    plugins: [devCheckout(checkout, join(checkout, 'content'))],
    define: { __CLIENT_BUILD__: JSON.stringify('fixture-build') },
    resolve: { conditions: ['source'] },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { ...(port === undefined ? {} : { port }), ws: false },
    logLevel: 'silent',
  });
  servers.push(result);
  return result;
}

it('reserves 5173 for primary main and rejects a primary task branch', async () => {
  await app(root);
  expect((await server(root)).config.server.port).toBe(5173);
  git('switch', '-c', 'task');
  await expect(server(root)).rejects.toThrow(':5173 is reserved');
});

it('recognizes a nested worktree and refuses an explicit 5173 override', async () => {
  const task = join(root, '.codex/worktrees/task');
  git('worktree', 'add', '-b', 'task', task);
  await app(task);
  const preview = await server(task);
  expect(preview.config.server.port).toBe(5174);
  expect(preview.config.server.strictPort).toBe(true);
  await expect(server(task, 5173)).rejects.toThrow(':5173 is reserved');
  const automatic = await server(task, 0);
  await automatic.listen();
  const address = automatic.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP listener');
  expect(address.port).toBeGreaterThanOrEqual(5174);
});

it('leaves production preview outside the development port policy', async () => {
  await app(root);
  git('switch', '-c', 'task');
  const config = await resolveConfig(
    { configFile: false, root, plugins: [devCheckout(root, join(root, 'content'))] },
    'serve',
    'production',
    'production',
    true,
  );
  expect(config.plugins.some((plugin) => plugin.name === 'dev-checkout')).toBe(false);
});

it('rejects workspace links pointing at the primary checkout', async () => {
  const task = join(root, 'task');
  git('worktree', 'add', '-b', 'task', task);
  await app(task, root);
  await expect(server(task, 5175)).rejects.toThrow('do not share node_modules');
});

it('reports the actual checkout and build over HTTP and never drifts from a busy port', async () => {
  await app(root);
  const preview = await server(root, 0);
  await preview.listen();
  const address = preview.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP listener');
  const response = await fetch(`http://127.0.0.1:${address.port}/__dev/checkout`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({
    checkout: root,
    branch: 'main',
    pid: process.pid,
    clientBuild: 'fixture-build',
  });
  const collision = await server(root, address.port);
  await expect(collision.listen()).rejects.toThrow(/already in use/);
});
