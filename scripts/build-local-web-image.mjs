#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultBasePath = '/game';
const defaultContentRoot = resolve(repoRoot, 'content');
const defaultPlatform = 'linux/amd64';
const defaultTag = 'open-northland-web:local';

function usage() {
  return `usage: npm run web:image:local -- [options]

Build the local-only web image with generated game content embedded.

Options:
  --base-path <path> Public URL prefix (default: /game).
  --game <dir>       Run the asset pipeline from this owned game installation first.
  --mod-root <dir>   Pass an external CulturesNation directory to the pipeline.
  --content <dir>    Generated content directory (default: ./content).
  --platform <value> Target platform (default: linux/amd64).
  --tag <image:tag>  Local image tag (default: open-northland-web:local).
  --help             Show this help.

The resulting image remains in the local Docker daemon. This script never pushes or exports it.`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${String(result.status)}`);
}

async function assertContentRoot(contentRoot) {
  const root = await stat(contentRoot).catch(() => undefined);
  if (root?.isDirectory() !== true) {
    throw new Error(
      `content directory not found: ${contentRoot}; run with --game <dir> or generate it first`,
    );
  }
  const ir = await stat(resolve(contentRoot, 'ir.json')).catch(() => undefined);
  if (ir?.isFile() !== true)
    throw new Error(`content manifest not found: ${resolve(contentRoot, 'ir.json')}`);
}

function normalizeBasePath(raw) {
  if (!/^\/(?:[a-zA-Z0-9._~-]+(?:\/[a-zA-Z0-9._~-]+)*)?\/?$/.test(raw)) {
    throw new Error(
      `base path must be an absolute URL path without query or fragment, got ${JSON.stringify(raw)}`,
    );
  }
  return raw === '/' ? '/' : raw.replace(/\/+$/, '');
}

async function main() {
  const { values } = parseArgs({
    options: {
      'base-path': { type: 'string' },
      content: { type: 'string' },
      game: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      'mod-root': { type: 'string' },
      platform: { type: 'string' },
      tag: { type: 'string' },
    },
  });
  if (values.help === true) {
    console.log(usage());
    return;
  }
  if (values['mod-root'] !== undefined && values.game === undefined)
    throw new Error('--mod-root requires --game');

  const basePath = normalizeBasePath(values['base-path'] ?? defaultBasePath);
  const contentRoot = resolve(values.content ?? defaultContentRoot);
  const gameRoot = values.game === undefined ? undefined : resolve(values.game);
  const modRoot = values['mod-root'] === undefined ? undefined : resolve(values['mod-root']);
  const platform = values.platform ?? defaultPlatform;
  const tag = values.tag ?? defaultTag;

  if (gameRoot !== undefined) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const pipelineArgs = ['run', 'pipeline', '--', '--game', gameRoot, '--out', contentRoot];
    if (modRoot !== undefined) pipelineArgs.push('--mod-root', modRoot);
    run(npm, pipelineArgs);
  }

  await assertContentRoot(contentRoot);
  run('docker', [
    'buildx',
    'build',
    '--platform',
    platform,
    '--load',
    '--build-arg',
    `OPEN_NORTHLAND_BASE_PATH=${basePath}`,
    '--build-context',
    `on_content=${contentRoot}`,
    '--tag',
    tag,
    repoRoot,
  ]);

  console.log(`\nBuilt ${tag} with local generated content.`);
  console.log(`Run it with: docker run --rm --init -p 127.0.0.1:5173:5173 ${tag}`);
  console.log(`Open: http://127.0.0.1:5173${basePath}`);
}

main().catch((error) => {
  console.error(`[web-image] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
