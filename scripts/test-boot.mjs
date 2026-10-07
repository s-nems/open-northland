#!/usr/bin/env node
// Boots the production build with real content in headless Chromium on each requested ANGLE backend
// and fails a boot that hangs, errors or draws nothing (docs/TESTING.md "Boot check"). Local only:
// CI has no game content.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BACKENDS, backendArgs, CONTAINER_DEFAULTS, hostDefaultBackends } from './boot-check/backends.mjs';
import { bootMap } from './boot-check/boot-run.mjs';
import { startStaticServer } from './boot-check/static-server.mjs';
import { contentDir, repoRoot } from './content-dir.mjs';

const DEFAULT_MAP = 'magiczny_las';
const PICKED_MAP_COUNT = 2;
const SEED = 7;
/** Twice the slowest loading screen measured (Linux SwiftShader, 45 s); a frozen boot never ends. */
const DEFAULT_BOOT_TIMEOUT_MS = 90_000;
const MS_PER_SECOND = 1000;
const MAX_ERRORS_SHOWN = 5;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const CONTAINER_WORK = '/work';
const CONTAINER_CONTENT = '/content';
const CONTAINER_SHOTS = '/out';

const distDir = resolve(repoRoot, 'packages/app/dist');
const DEFAULT_SHOTS_DIR = resolve(repoRoot, 'bench-out/boot-check');

function usage(message) {
  console.error(`test:boot: ${message}`);
  console.error(
    'usage: npm run test:boot -- [--maps=a,b] [--angle=metal,swiftshader,gl,d3d11,vulkan] [--boot-timeout-ms=N] [--build] [--docker]',
  );
  process.exit(EXIT_USAGE);
}

function fail(message) {
  console.error(`test:boot: ${message}`);
  process.exit(EXIT_USAGE);
}

let options;
try {
  options = parseArgs({
    options: {
      maps: { type: 'string' },
      angle: { type: 'string' },
      'boot-timeout-ms': { type: 'string', default: String(DEFAULT_BOOT_TIMEOUT_MS) },
      build: { type: 'boolean', default: false },
      docker: { type: 'boolean', default: false },
      // Set by --docker for the run inside the container.
      'inside-docker': { type: 'boolean', default: false },
      screenshots: { type: 'string', default: DEFAULT_SHOTS_DIR },
    },
    strict: true,
  }).values;
} catch (error) {
  usage(error.message);
}
// npm runs the script from the repository root; a relative path names the caller's directory.
const screenshotsDir = resolve(process.env.INIT_CWD ?? process.cwd(), options.screenshots);

const list = (text) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
const inside = options['inside-docker'];
const backends =
  options.angle !== undefined ? list(options.angle) : inside ? CONTAINER_DEFAULTS : hostDefaultBackends();
const unknown = backends.filter((id) => !Object.hasOwn(BACKENDS, id));
if (backends.length === 0 || unknown.length > 0)
  usage(`--angle takes a comma list of ${Object.keys(BACKENDS).join(', ')}`);
const bootTimeoutMs = Number(options['boot-timeout-ms']);
if (!Number.isInteger(bootTimeoutMs) || bootTimeoutMs <= 0)
  usage('--boot-timeout-ms must be a positive integer');
const requestedMaps = options.maps === undefined ? null : list(options.maps);
if (requestedMaps?.length === 0) usage('--maps names no map');

if (options.build && !inside) {
  // npm is npm.cmd on Windows, which only a shell resolves.
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) fail('npm run build failed');
}
if (!existsSync(resolve(distDir, 'index.html'))) {
  fail(`no production build in ${distDir}; run npm run build first, or pass --build`);
}
const content = contentDir();
const REQUIRED_CONTENT = ['ir.json', 'maps-index.json', 'maps', 'bobs'];
const missing = REQUIRED_CONTENT.filter((rel) => !existsSync(resolve(content, rel)));
if (missing.length > 0) {
  console.error(`test:boot needs generated content - missing under ${content}: ${missing.join(', ')}`);
  console.error('Generate it with npm run build:content, or point ON_CONTENT_DIR at a checkout that has it.');
  process.exit(EXIT_USAGE);
}

/** The same check in the Playwright image of the installed Playwright version, under Xvfb so ANGLE's
 *  GL backend can reach Mesa. The checkout's own node_modules supplies the pure-JS playwright package. */
function runInDocker() {
  const { version } = JSON.parse(
    readFileSync(resolve(repoRoot, 'node_modules/playwright/package.json'), 'utf8'),
  );
  const image = `mcr.microsoft.com/playwright:v${version}-noble`;
  mkdirSync(screenshotsDir, { recursive: true });
  const forwarded = [
    ...(options.angle !== undefined ? [`--angle=${options.angle}`] : []),
    ...(options.maps !== undefined ? [`--maps=${options.maps}`] : []),
    `--boot-timeout-ms=${bootTimeoutMs}`,
  ];
  const args = [
    'run',
    '--rm',
    '--init',
    // Chromium's shared memory outgrows the container's 64 MB /dev/shm.
    '--ipc=host',
    '--volume',
    `${repoRoot}:${CONTAINER_WORK}:ro`,
    '--volume',
    `${content}:${CONTAINER_CONTENT}:ro`,
    '--volume',
    `${screenshotsDir}:${CONTAINER_SHOTS}`,
    '--env',
    `ON_CONTENT_DIR=${CONTAINER_CONTENT}`,
    '--workdir',
    CONTAINER_WORK,
    image,
    'xvfb-run',
    '--auto-servernum',
    'node',
    'scripts/test-boot.mjs',
    '--inside-docker',
    `--screenshots=${CONTAINER_SHOTS}`,
    ...forwarded,
  ];
  console.log(`test:boot: running in ${image}`);
  const run = spawnSync('docker', args, { stdio: 'inherit' });
  if (run.error !== undefined) fail(`docker could not start: ${run.error.message}`);
  if (run.status !== 0) console.log(`test:boot: screenshots of failed runs are in ${screenshotsDir}`);
  return run.status ?? EXIT_FAILED;
}

/** Every indexed map with a claimable seat 0, in id order; the defaults are the map the other checks
 *  use plus two from the thirds of that list, so the pick only moves when the content does. */
function pickMaps(index) {
  const playable = index.filter((entry) =>
    entry.players?.some((seat) => seat.player === 0 && seat.claimable),
  );
  const others = playable
    .map((entry) => entry.id)
    .filter((id) => id !== DEFAULT_MAP)
    .sort();
  const picked = Array.from(
    { length: PICKED_MAP_COUNT },
    (_, n) => others[Math.floor(((n + 1) * others.length) / (PICKED_MAP_COUNT + 1))],
  );
  return [DEFAULT_MAP, ...picked].filter((id) => id !== undefined);
}

async function runHere() {
  const startedAt = Date.now();
  const { chromium } = await import('playwright');
  const server = await startStaticServer([content, distDir]);
  const results = [];
  try {
    const index = await (await fetch(`${server.origin}/maps-index.json`)).json();
    const maps = requestedMaps ?? pickMaps(index);
    const absent = maps.filter((id) => !existsSync(resolve(content, 'maps', `${id}.json`)));
    if (absent.length > 0) fail(`no decoded map under ${content}/maps for: ${absent.join(', ')}`);
    mkdirSync(screenshotsDir, { recursive: true });
    console.log(`test:boot: ${server.origin} serves ${distDir} over ${content}`);
    console.log(
      `test:boot: maps ${maps.join(', ')}; backends ${backends.join(', ')}; budget ${bootTimeoutMs} ms per boot`,
    );
    for (const backend of backends) {
      for (const mapId of maps) {
        const screenshotPath = resolve(screenshotsDir, `${backend}-${mapId}.png`);
        rmSync(screenshotPath, { force: true });
        const result = await bootMap({
          chromium,
          // The full Chromium build, not the headless shell: it is the browser players run. Inside
          // the container it runs headed on Xvfb, where ANGLE's GL backend reaches Mesa.
          launch: { channel: 'chromium', headless: !inside, args: backendArgs(backend) },
          origin: server.origin,
          mapId,
          seed: SEED,
          timeoutMs: bootTimeoutMs,
          matchesBackend: BACKENDS[backend].matches,
          screenshotPath,
        });
        console.log(`test:boot: ${backend} ${mapId}: ${result.failure ?? 'ok'}`);
        results.push({ backend, ...result });
      }
    }
  } finally {
    await server.close();
  }
  printReport(results);
  console.log(`test:boot: ${seconds(Date.now() - startedAt)} s wall time`);
  return results.some((result) => result.failure !== null) ? EXIT_FAILED : 0;
}

function seconds(ms) {
  return (ms / MS_PER_SECOND).toFixed(1);
}

function printReport(results) {
  const phaseNames = [...new Set(results.flatMap((result) => result.phases.map((entry) => entry.phase)))];
  const header = ['backend', 'map', 'renderer', ...phaseNames, 'boot s', 'frames', 'drawn', 'result'];
  const rows = results.map((result) => [
    result.backend,
    result.mapId,
    result.renderer ?? result.launchedRenderer ?? '-',
    ...phaseNames.map((name) => {
      const entry = result.phases.find((phase) => phase.phase === name);
      return entry === undefined ? '-' : seconds(entry.ms);
    }),
    result.readyMs === null ? '-' : seconds(result.readyMs),
    String(result.frames ?? '-'),
    String(result.drawn ?? '-'),
    result.failure === null ? 'ok' : 'FAIL',
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) => `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  console.log(
    '\nSeconds from navigation: a phase column is when that boot phase began, boot s when the loading screen closed.',
  );
  console.log(line(header));
  console.log(line(widths.map((width) => '-'.repeat(width))));
  for (const row of rows) console.log(line(row));
  for (const result of results.filter((entry) => entry.failure !== null)) {
    console.log(`\n${result.backend} ${result.mapId}: ${result.failure}`);
    const counts = new Map();
    for (const error of result.errors) {
      // Pixi's shader errors start with a blank line and repeat per program.
      const line = error.trim().split('\n')[0] ?? '';
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    const distinct = [...counts];
    for (const [line, count] of distinct.slice(0, MAX_ERRORS_SHOWN)) {
      console.log(`  ${count > 1 ? `${count}x ` : ''}${line}`);
    }
    if (distinct.length > MAX_ERRORS_SHOWN) {
      console.log(`  ... ${distinct.length - MAX_ERRORS_SHOWN} more distinct errors`);
    }
    if (result.screenshot !== null) console.log(`  screenshot: ${result.screenshot}`);
    else if (result.launchedRenderer !== null && result.phases.length > 0) {
      console.log('  no screenshot: the page no longer composited');
    }
  }
}

process.exit(options.docker ? runInDocker() : await runHere());
