#!/usr/bin/env node
// Compiles every GL program in the shader catalogue through one ANGLE backend in headless Chromium,
// or a running one reached with --cdp, draws once with each, and fails on a compile or link error, a
// slow program at compile or at its first draw, or a renderer that is not the backend asked for
// (docs/TESTING.md "Shader compile check"). Needs no game content.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { repoRoot } from '../content/dir.mjs';

/** The renderer string each backend reports; any other string means Chromium fell back elsewhere. */
const BACKEND_RENDERERS = {
  d3d11: /Direct3D11/,
  metal: /Metal/,
  swiftshader: /SwiftShader/,
};
const DEFAULT_BACKENDS = { win32: 'd3d11', darwin: 'metal' };
/**
 * Default budgets per backend, applied to a program's compile and link and again to its first draw,
 * from the catalogue as it stands. Direct3D 11 on a GitHub runner is WARP on a slow CPU, which
 * compiles each program with FXC and then again into its own CPU code: there
 * `world-batch/textures16/xbr`, `shaded-terrain` and `decor-shadow` take 5 to 9 s each and the whole
 * set 60 to 110 s between runs, on shaders real hardware plays fine; the batch shader that walked
 * the sampler chain in every magnifier tap took 31 to 64 s, and the one that froze 0.2.1 held eight
 * times its inlined work. Metal finishes the set within seconds. SwiftShader links in milliseconds and
 * compiles in its JIT at the first draw instead: on an M2 Pro the first draws sum to 46 to 51 s, the
 * paletted sprite program's 4.6 s and the 32-slot batch programs' 3.7 to 4.0 s the longest. A budget is a
 * tripwire against that order of growth over a runner that varies twofold, not a frame budget.
 */
const BACKEND_LIMITS = {
  d3d11: { maxMs: 180_000, maxTotalMs: 480_000 },
  metal: { maxMs: 5_000, maxTotalMs: 30_000 },
  swiftshader: { maxMs: 10_000, maxTotalMs: 60_000 },
};
/** How long the browser gets to start, load the probe and create its context. */
const SETUP_TIMEOUT_MS = 60000;
const CLOSE_TIMEOUT_MS = 10000;
/** A compile or first draw still running past this multiple of the per-program budget is reported as
 *  hung and ends the run: the page stays blocked behind it. Programs that merely break the budgets are
 *  all timed, so one run names every slow one. */
const HUNG_COMPILE_FACTOR = 2;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

function usage(message) {
  console.error(`test:shaders: ${message}`);
  console.error(
    'usage: npm run test:shaders -- [--angle=d3d11|metal|swiftshader] [--max-ms=N] [--max-total-ms=N] [--relink] [--json=path] [--dump-translated=dir] [--cdp=url]\n' +
      "  --max-ms bounds a program's compile and link, and separately its first draw; --max-total-ms their sum\n" +
      "  --dump-translated writes each program's backend source (HLSL on d3d11) to dir\n" +
      '  --cdp drives a running Chromium at that DevTools endpoint, started fresh with the --angle backend',
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
      // ANGLE's translated source per program, through WEBGL_debug_shaders: on Direct3D the HLSL that
      // FXC compiles, where a flattened sampler chain shows.
      'dump-translated': { type: 'string' },
      // Links every program a second time in another context, timing the browser's program cache.
      relink: { type: 'boolean', default: false },
      // A browser already running with the backend's flags, e.g. Windows Chrome driven from WSL.
      cdp: { type: 'string' },
    },
    strict: true,
  }).values;
} catch (error) {
  usage(error.message);
}
const backend = parsed.angle;
const relink = parsed.relink;
const cdpEndpoint = parsed.cdp;
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
const callerPath = (path) =>
  path === undefined ? undefined : resolve(process.env.INIT_CWD ?? process.cwd(), path);
const jsonPath = callerPath(parsed.json);
const translatedDir = callerPath(parsed['dump-translated']);

function withTimeout(promise, ms, describeTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(describeTimeout())), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The probe's browser bundle, injected into a blank page so a browser on another machine needs no path
 *  to this one's files. */
async function bundleProbe() {
  const { outputFiles } = await build({
    entryPoints: [resolve(repoRoot, 'scripts/test-modes/shader-probe.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    conditions: ['source'],
    write: false,
    logLevel: 'silent',
  });
  return outputFiles[0].text;
}

/** A program's compile and link plus its first draw. */
const programMs = (program) => program.ms + (program.drawMs ?? 0);

function printReport(report) {
  const sorted = [...report.programs].sort(
    (a, b) => programMs(b) - programMs(a) || a.name.localeCompare(b.name),
  );
  const width = Math.max(...sorted.map((program) => program.name.length));
  console.log(`\n${'program'.padEnd(width)}  compile+link ms   first draw ms${relink ? '  relink ms' : ''}`);
  for (const program of sorted) {
    if (program.status === 'skipped') {
      console.log(`${program.name.padEnd(width)}  ${'skipped'.padStart(15)}  needs ${program.needs}`);
      continue;
    }
    const flag =
      !program.linked || program.drawError !== 0
        ? '  FAILED'
        : program.ms > maxMs || (program.drawMs ?? 0) > maxMs
          ? '  SLOW'
          : '';
    const draw = program.drawMs === null ? '-' : program.drawMs.toFixed(1);
    const again = program.relinkMs === undefined ? '' : `  ${program.relinkMs.toFixed(1).padStart(9)}`;
    console.log(
      `${program.name.padEnd(width)}  ${program.ms.toFixed(1).padStart(15)}   ${draw.padStart(13)}${again}${flag}`,
    );
  }
  console.log(`\nbackend:   --use-angle=${report.backend} (${report.browser})`);
  console.log(`renderer:  ${report.renderer}`);
  console.log(`vendor:    ${report.vendor}`);
  console.log(`context:   ${report.version}, ${report.maxTextureUnits} fragment texture units`);
  console.log(
    `warm-up:   ${report.warmUpMs.toFixed(1)} ms compile+link, ${report.warmUpDrawMs.toFixed(1)} ms first draw`,
  );
  const compiled = report.programs.filter((program) => program.status === 'compiled').length;
  console.log(
    `total:     ${report.totalMs.toFixed(1)} ms over ${compiled} programs` +
      `, ${report.programs.length - compiled} skipped for this device` +
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
    if (program.drawError !== 0)
      failures.push(
        `${program.name}: the first draw was refused with GL error 0x${program.drawError.toString(16)}, so its time measures nothing`,
      );
    if (program.ms > maxMs)
      failures.push(`${program.name}: compile+link ${program.ms.toFixed(1)} ms exceeds --max-ms ${maxMs}`);
    if (program.drawMs !== null && program.drawMs > maxMs)
      failures.push(`${program.name}: first draw ${program.drawMs.toFixed(1)} ms exceeds --max-ms ${maxMs}`);
  }
  if (report.totalMs > maxTotalMs)
    failures.push(`total ${report.totalMs.toFixed(1)} ms exceeds --max-total-ms ${maxTotalMs}`);
  return failures;
}

/** Writes and drops a program's translated stages; a browser without WEBGL_debug_shaders gives none. */
async function writeTranslated(result) {
  const { translated } = result;
  delete result.translated;
  if (result.status !== 'compiled') return;
  if (translated === undefined) {
    console.log(`${result.name}: no translated source (WEBGL_debug_shaders unavailable)`);
    return;
  }
  const base = resolve(translatedDir, result.name.replaceAll('/', '__'));
  await writeFile(`${base}.vert.txt`, translated.vertex);
  await writeFile(`${base}.frag.txt`, translated.fragment);
}

function openBrowser() {
  if (cdpEndpoint !== undefined) return chromium.connectOverCDP(cdpEndpoint);
  return chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--mute-audio', '--use-gl=angle', `--use-angle=${backend}`, '--ignore-gpu-blocklist'],
  });
}

async function relinkAll(page, programNames, programs, failures) {
  for (const program of programs) {
    if (program.status !== 'compiled' || program.contextLost) continue;
    const index = programNames.indexOf(program.name);
    try {
      const again = await withTimeout(
        page.evaluate((at) => globalThis.shaderProbe.relink(at), index),
        hungCompileMs,
        () => `${program.name} was still relinking after ${hungCompileMs} ms`,
      );
      program.relinkMs = again.ms;
    } catch (error) {
      failures.push(error.message);
      return;
    }
  }
}

async function probe(probeSource, failures) {
  const browser = await openBrowser();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const device = await withTimeout(
      (async () => {
        await page.addScriptTag({ content: probeSource });
        if (pageErrors.length > 0) throw new Error(`the probe page failed to load: ${pageErrors.join('; ')}`);
        return page.evaluate(() => globalThis.shaderProbe.describe());
      })(),
      SETUP_TIMEOUT_MS,
      () => `the probe page did not start within ${SETUP_TIMEOUT_MS} ms`,
    );
    const { programNames, ...context } = device;
    const report = {
      backend,
      browser: `Chromium ${browser.version()}${cdpEndpoint === undefined ? '' : ` over CDP at ${cdpEndpoint}`}`,
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
          page.evaluate(
            ([at, translate]) => globalThis.shaderProbe.compile(at, translate),
            [index, translatedDir !== undefined],
          ),
          hungCompileMs,
          () =>
            `${name} was still compiling or drawing after ${hungCompileMs} ms; ` +
            `${programNames.length - index - 1} programs after it untried`,
        );
        if (translatedDir !== undefined) await writeTranslated(result);
        report.programs.push(result);
        report.totalMs += programMs(result);
        if (result.contextLost) break;
      } catch (error) {
        failures.push(error.message);
        break;
      }
    }
    // After every first link, as the warm-up links its whole set before the renderer links any: a
    // cache that has evicted early entries by then shows as a relink as slow as the first.
    if (relink) await relinkAll(page, programNames, report.programs, failures);
    return report;
  } catch (error) {
    failures.push(error.message);
    return null;
  } finally {
    // A hung GPU process can stall a graceful close; the run's verdict is already settled.
    await withTimeout(browser.close(), CLOSE_TIMEOUT_MS, () => 'close timed out').catch(() => undefined);
  }
}

if (translatedDir !== undefined) await mkdir(translatedDir, { recursive: true });
const failures = [];
const report = await probe(await bundleProbe(), failures);
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
