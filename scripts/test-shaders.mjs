#!/usr/bin/env node
// Compiles every GL program in the shader catalogue through one ANGLE backend in headless Chromium and
// fails on a compile or link error, a slow program, or a renderer that is not the backend asked for
// (docs/TESTING.md "Shader compile check"). Needs no game content.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { repoRoot } from './content-dir.mjs';

/** The renderer string each backend reports; any other string means Chromium fell back elsewhere. */
const BACKEND_RENDERERS = {
  d3d11: /Direct3D11/,
  metal: /Metal/,
  swiftshader: /SwiftShader/,
};
const DEFAULT_BACKENDS = { win32: 'd3d11', darwin: 'metal' };
/**
 * Default budgets per backend, from the catalogue as it stands. Direct3D 11 on a GitHub runner is WARP
 * on a slow CPU, which compiles each program with FXC and then again into its own CPU code: there
 * `world-batch/textures16/xbr`, `shaded-terrain` and `decor-shadow` take 5 to 9 s each and the whole
 * set 60 to 110 s between runs, on shaders real hardware plays fine; the batch shader that walked
 * the sampler chain in every magnifier tap took 31 to 64 s, and the one that froze 0.2.1 held eight
 * times its inlined work. Metal and SwiftShader finish the set within seconds. A budget is a tripwire
 * against that order of growth over a runner that varies twofold, not a frame budget.
 */
const BACKEND_LIMITS = {
  d3d11: { maxMs: 180_000, maxTotalMs: 480_000 },
  metal: { maxMs: 5_000, maxTotalMs: 30_000 },
  swiftshader: { maxMs: 5_000, maxTotalMs: 30_000 },
};
/** How long the browser gets to start, load the probe and create its context. */
const SETUP_TIMEOUT_MS = 60000;
const CLOSE_TIMEOUT_MS = 10000;
/** A compile still running past this multiple of the per-program budget is reported as hung and ends
 *  the run: the page stays blocked behind it. Programs that merely break the budgets are all timed, so
 *  one run names every slow one. */
const HUNG_COMPILE_FACTOR = 2;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

function usage(message) {
  console.error(`test:shaders: ${message}`);
  console.error(
    'usage: npm run test:shaders -- [--angle=d3d11|metal|swiftshader] [--max-ms=N] [--max-total-ms=N] [--relink] [--json=path]',
  );
  process.exit(EXIT_USAGE);
}

function positiveNumber(text, option) {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0)
    usage(`--${option} must be a positive number of ms, not '${text}'`);
  return value;
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      angle: { type: 'string', default: DEFAULT_BACKENDS[process.platform] ?? 'swiftshader' },
      'max-ms': { type: 'string' },
      'max-total-ms': { type: 'string' },
      json: { type: 'string' },
      // Links every program a second time in another context, timing the browser's program cache.
      relink: { type: 'boolean', default: false },
    },
    strict: true,
  }).values;
} catch (error) {
  usage(error.message);
}
const backend = parsed.angle;
const relink = parsed.relink;
const expectedRenderer = BACKEND_RENDERERS[backend];
if (expectedRenderer === undefined)
  usage(`unknown --angle '${backend}'; known: ${Object.keys(BACKEND_RENDERERS).join(', ')}`);
const limits = BACKEND_LIMITS[backend];
const maxMs = parsed['max-ms'] === undefined ? limits.maxMs : positiveNumber(parsed['max-ms'], 'max-ms');
const maxTotalMs =
  parsed['max-total-ms'] === undefined
    ? limits.maxTotalMs
    : positiveNumber(parsed['max-total-ms'], 'max-total-ms');
const hungCompileMs = maxMs * HUNG_COMPILE_FACTOR;
// npm runs the script from the repository root; a relative path names the caller's directory.
const jsonPath =
  parsed.json === undefined ? undefined : resolve(process.env.INIT_CWD ?? process.cwd(), parsed.json);

function withTimeout(promise, ms, describeTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(describeTimeout())), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function bundleProbePage(dir) {
  const { outputFiles } = await build({
    entryPoints: [resolve(repoRoot, 'scripts/shader-probe/probe.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    conditions: ['source'],
    write: false,
    logLevel: 'silent',
  });
  const [bundle] = outputFiles;
  await writeFile(join(dir, 'probe.js'), bundle.contents);
  const page = join(dir, 'index.html');
  await writeFile(page, '<!doctype html><meta charset="utf-8"><script src="probe.js"></script>\n');
  return pathToFileURL(page).href;
}

function printReport(report) {
  const sorted = [...report.programs].sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name));
  const width = Math.max(...sorted.map((program) => program.name.length));
  console.log(`\n${'program'.padEnd(width)}  compile+link ms${relink ? '  relink ms' : ''}`);
  for (const program of sorted) {
    if (program.status === 'skipped') {
      console.log(
        `${program.name.padEnd(width)}  ${'skipped'.padStart(15)}  needs ${program.textureUnits} texture units`,
      );
      continue;
    }
    const flag = !program.linked ? '  FAILED' : program.ms > maxMs ? '  SLOW' : '';
    const again = program.relinkMs === undefined ? '' : `  ${program.relinkMs.toFixed(1).padStart(9)}`;
    console.log(`${program.name.padEnd(width)}  ${program.ms.toFixed(1).padStart(15)}${again}${flag}`);
  }
  console.log(`\nbackend:   --use-angle=${report.backend} (${report.browser})`);
  console.log(`renderer:  ${report.renderer}`);
  console.log(`vendor:    ${report.vendor}`);
  console.log(`context:   ${report.version}, ${report.maxTextureUnits} fragment texture units`);
  console.log(`warm-up:   ${report.warmUpMs.toFixed(1)} ms`);
  const compiled = report.programs.filter((program) => program.status === 'compiled').length;
  console.log(
    `total:     ${report.totalMs.toFixed(1)} ms over ${compiled} programs` +
      `, ${report.programs.length - compiled} skipped for this device's texture units` +
      `; limits ${maxMs} ms each, ${maxTotalMs} ms total`,
  );
}

function failuresOf(report) {
  const failures = [];
  if (!expectedRenderer.test(report.renderer))
    failures.push(
      `renderer '${report.renderer}' is not the ${backend} backend (expected ${expectedRenderer}); ` +
        'Chromium fell back to another compiler, so these timings do not measure the one asked for',
    );
  for (const program of report.programs) {
    if (program.status === 'skipped') continue;
    if (program.contextLost) failures.push(`${program.name}: the WebGL context was lost while compiling`);
    else if (!program.linked) {
      const logs = [
        ['vertex', program.vertexLog],
        ['fragment', program.fragmentLog],
        ['program', program.programLog],
      ].filter(([, log]) => log.trim() !== '');
      failures.push(
        `${program.name}: failed to compile or link\n${logs.map(([stage, log]) => `  ${stage} log: ${log.trim()}`).join('\n')}`,
      );
    }
    if (program.ms > maxMs)
      failures.push(`${program.name}: ${program.ms.toFixed(1)} ms exceeds --max-ms ${maxMs}`);
  }
  if (report.totalMs > maxTotalMs)
    failures.push(`total ${report.totalMs.toFixed(1)} ms exceeds --max-total-ms ${maxTotalMs}`);
  return failures;
}

async function probe(pageUrl, failures) {
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--mute-audio', '--use-gl=angle', `--use-angle=${backend}`, '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const device = await withTimeout(
      (async () => {
        await page.goto(pageUrl);
        if (pageErrors.length > 0) throw new Error(`the probe page failed to load: ${pageErrors.join('; ')}`);
        return page.evaluate(() => globalThis.shaderProbe.describe());
      })(),
      SETUP_TIMEOUT_MS,
      () => `the probe page did not start within ${SETUP_TIMEOUT_MS} ms`,
    );
    const { programNames, ...context } = device;
    const report = {
      backend,
      browser: `Chromium ${browser.version()}`,
      platform: `${process.platform} ${process.arch}`,
      ...context,
      totalMs: 0,
      limits: { maxMs, maxTotalMs },
      programs: [],
    };
    console.log(`test:shaders: ${programNames.length} programs through --use-angle=${backend}`);
    console.log(`renderer: ${device.renderer}`);
    for (const [index, name] of programNames.entries()) {
      try {
        const result = await withTimeout(
          page.evaluate((at) => globalThis.shaderProbe.compile(at), index),
          hungCompileMs,
          () =>
            `${name} was still compiling after ${hungCompileMs} ms; ` +
            `${programNames.length - index - 1} programs after it untried`,
        );
        if (relink && result.status === 'compiled' && !result.contextLost) {
          const again = await withTimeout(
            page.evaluate((at) => globalThis.shaderProbe.relink(at), index),
            hungCompileMs,
            () => `${name} was still relinking after ${hungCompileMs} ms`,
          );
          result.relinkMs = again.ms;
        }
        report.programs.push(result);
        report.totalMs += result.ms;
        if (result.contextLost) break;
      } catch (error) {
        failures.push(error.message);
        break;
      }
    }
    return report;
  } catch (error) {
    failures.push(error.message);
    return null;
  } finally {
    // A hung GPU process can stall a graceful close; the run's verdict is already settled.
    await withTimeout(browser.close(), CLOSE_TIMEOUT_MS, () => 'close timed out').catch(() => undefined);
  }
}

const dir = await mkdtemp(join(tmpdir(), 'on-shader-probe-'));
const failures = [];
let report = null;
try {
  report = await probe(await bundleProbePage(dir), failures);
} finally {
  await rm(dir, { recursive: true, force: true });
}
if (report !== null) {
  printReport(report);
  failures.push(...failuresOf(report));
  if (jsonPath !== undefined) {
    await writeFile(jsonPath, `${JSON.stringify({ ...report, failures }, null, 2)}\n`);
    console.log(`report:    ${jsonPath}`);
  }
}
if (failures.length > 0) {
  // stdout, like the table: CI interleaves two streams out of order.
  console.log(`\ntest:shaders FAILED (${failures.length}):`);
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(EXIT_FAILED);
}
console.log('\ntest:shaders passed');
