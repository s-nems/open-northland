import { MANY_SELECTION_ZOOM } from './gpu-plan.mjs';

/** The scenario list, settings and report folds of `npm run bench:hud`; pure, so it unit-tests. */

const USAGE = 'usage: npm run bench:hud -- checkpoint origin [output-dir] [window-seconds]';
const DEFAULT_OUTPUT = 'bench-out/hud';
const DEFAULT_SECONDS = 5;
/** The seat whose HUD the scenarios show: a spectator watching the whole map has no residents, notices or
 *  counters of its own. */
const DEFAULT_SEAT = 0;
const DENSE_ZOOM = 1;

function scenario(id, setup, overrides = {}) {
  return {
    id,
    setup,
    zoom: DENSE_ZOOM,
    fpsCounter: false,
    groupNumbers: false,
    ...overrides,
  };
}

/** Every scenario frames the densest building cluster at x3 with the pointer on the bottom bar, unless
 *  it is about the pointer. `none` is the baseline the others add one HUD surface to, and `none-zoomed`
 *  the one of `select50`, which draws at another zoom and so another world cost. The `-world` twins
 *  rest the pointer over the world with the panel open, `build-tabs` switches the construction
 *  window's tab on a timer, and `presses` presses and releases the mouse button on one. */
export function hudScenarios() {
  return [
    scenario('none', 'none'),
    scenario('settler', 'settler'),
    scenario('settler-world', 'settler-world'),
    scenario('building', 'building'),
    scenario('building-world', 'building-world'),
    scenario('residents', 'residents'),
    scenario('mission', 'mission'),
    scenario('diplomacy', 'diplomacy'),
    scenario('build', 'build'),
    scenario('build-tabs', 'build-tabs'),
    scenario('notices', 'notices'),
    scenario('none-zoomed', 'none', { zoom: MANY_SELECTION_ZOOM }),
    scenario('select50', 'select50', { zoom: MANY_SELECTION_ZOOM }),
    scenario('hover', 'hover'),
    scenario('presses', 'presses'),
    scenario('fps', 'none', { fpsCounter: true }),
    scenario('groups', 'groups', { groupNumbers: true }),
  ];
}

/** The player-settings patch a scenario loads under: every graphics setting at its default, frames
 *  uncapped and edge scrolling off so the resting pointer never pans. */
export function hudSettings(entry) {
  return {
    fpsLimit: null,
    fpsCounter: entry.fpsCounter,
    groupNumbers: entry.groupNumbers,
    soundEnabled: true,
    edgeScrollEnabled: false,
  };
}

function positiveNumber(text, name) {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

/** `argv` without node and script; the environment picks scenarios, seat, trace, profile and an A/B. */
export function parseHudBenchArgs(argv, env = {}) {
  const [checkpoint, origin, output = DEFAULT_OUTPUT, secondsText] = argv;
  if (!checkpoint || !origin || argv.length > 4) throw new Error(USAGE);
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Origin must be an HTTP development server');
  const all = hudScenarios();
  const names = env.ON_BENCH_HUD_SCENARIOS?.split(',');
  const unknown = names?.filter((name) => !all.some((entry) => entry.id === name)) ?? [];
  if (unknown.length > 0)
    throw new Error(`Unknown ON_BENCH_HUD_SCENARIOS ${unknown}; scenarios: ${all.map((e) => e.id)}`);
  const seat = env.ON_BENCH_HUD_SEAT === undefined ? DEFAULT_SEAT : Number(env.ON_BENCH_HUD_SEAT);
  if (!Number.isInteger(seat) || seat < 0) throw new Error('ON_BENCH_HUD_SEAT must be a seat');
  return {
    checkpoint,
    origin: url,
    output,
    seconds: secondsText === undefined ? DEFAULT_SECONDS : positiveNumber(secondsText, 'window seconds'),
    seat,
    trace: ['1', 'keep'].includes(env.ON_BENCH_HUD_TRACE) || env.ON_BENCH_HUD_INVALIDATIONS === '1',
    keepTraces: env.ON_BENCH_HUD_TRACE === 'keep',
    invalidations: env.ON_BENCH_HUD_INVALIDATIONS === '1',
    abCss: env.ON_BENCH_HUD_AB_CSS ?? null,
    headed: env.ON_BENCH_HUD_HEADED === '1',
    profile: env.ON_BENCH_HUD_PROFILE === '1',
    scenarios: names === undefined ? all : all.filter((entry) => names.includes(entry.id)),
  };
}

/** `Performance.getMetrics` counters per rendered frame; durations in milliseconds. */
export function metricDeltas(before, after, frames) {
  const value = (list, name) => list.find((metric) => metric.name === name)?.value ?? 0;
  const delta = (name) => value(after, name) - value(before, name);
  const per = (n) => (frames === 0 ? 0 : n / frames);
  const SECONDS_TO_MS = 1000;
  return {
    layoutsPerFrame: per(delta('LayoutCount')),
    styleRecalcsPerFrame: per(delta('RecalcStyleCount')),
    layoutMsPerFrame: per(delta('LayoutDuration') * SECONDS_TO_MS),
    styleMsPerFrame: per(delta('RecalcStyleDuration') * SECONDS_TO_MS),
    scriptMsPerFrame: per(delta('ScriptDuration') * SECONDS_TO_MS),
    taskMsPerFrame: per(delta('TaskDuration') * SECONDS_TO_MS),
    nodes: value(after, 'Nodes'),
    layoutObjects: value(after, 'LayoutObjects'),
  };
}

/**
 * The composited layers at a window's end with each one's repaints per frame over the window, most
 * repainted first. `before` is the layer list at the window's start, matched by layer id.
 */
/** The most repainted layers `report.json` lists per scenario. */
const LAYER_TOP = 12;

export function foldLayers(after, before, frames) {
  const paintsBefore = new Map(before.map((layer) => [layer.layerId, layer.paintCount ?? 0]));
  const rows = after.map((layer) => ({
    owner: layer.owner,
    size: `${Math.round(layer.width)}x${Math.round(layer.height)}`,
    drawsContent: layer.drawsContent,
    reasons: layer.reasons,
    paintsPerFrame:
      frames === 0 ? 0 : ((layer.paintCount ?? 0) - (paintsBefore.get(layer.layerId) ?? 0)) / frames,
  }));
  rows.sort((a, b) => b.paintsPerFrame - a.paintsPerFrame);
  const owners = {};
  for (const row of rows) {
    const owner = `${row.owner ?? '(none)'} ${row.reasons.join('|')}`;
    owners[owner] = (owners[owner] ?? 0) + 1;
  }
  return {
    count: after.length,
    drawing: after.filter((layer) => layer.drawsContent).length,
    byOwner: Object.fromEntries(Object.entries(owners).sort((a, b) => b[1] - a[1])),
    paintedPerFrame: rows.reduce((sum, row) => sum + row.paintsPerFrame, 0),
    top: rows.slice(0, LAYER_TOP),
  };
}

const MICROS_PER_MS = 1000;

/**
 * The trace events the fold keeps, per thread: the renderer's frame lifecycle (script in animation
 * frames, style, layout, paint, layerize, hit tests, worker messages, GC), the compositor's commit and
 * draw, the raster workers' tiles and image decodes, and the GPU process's WebGL, compositing frame
 * and swap. Each names a phase a frame pays; nested phases count in full under their own name.
 */
const TRACE_PHASES = {
  'Renderer/CrRendererMain': [
    'FireAnimationFrame',
    'HandlePostMessage',
    'TimerFire',
    'EventDispatch',
    'UpdateLayoutTree',
    'Layout',
    'PrePaint',
    'Paint',
    'Layerize',
    'HitTest',
    'Decode Image',
    'MinorGC',
    'MajorGC',
    'ProxyMain::BeginMainFrame',
  ],
  'Renderer/Compositor': ['ProxyImpl::ScheduledActionCommit', 'ProxyImpl::ScheduledActionDraw'],
  'Renderer/ThreadPoolForegroundWorker': ['RasterTask', 'ImageDecodeTask'],
  'GPU Process/CrGpuMain': [
    'WebGL',
    'SkiaOutputSurfaceImplOnGpu::FinishPaintRenderPass',
    'SkiaOutputSurfaceImplOnGpu::SwapBuffers',
  ],
  'GPU Process/VizCompositorThread': [
    'Display::DrawAndSwap',
    'DirectRenderer::DrawFrame',
    'DirectRenderer::DrawRenderPass',
  ],
};

/**
 * Trace time of {@link TRACE_PHASES} in milliseconds per frame, with each phase's count per frame and,
 * for style and layout, the elements or objects it touched. Complete events count by their duration and
 * begin/end pairs by their span. Threads of a name sum across processes.
 */
export function foldTrace(events, frames) {
  const threadNames = new Map();
  const processNames = new Map();
  for (const event of events) {
    if (event.ph !== 'M') continue;
    if (event.name === 'thread_name') threadNames.set(`${event.pid}:${event.tid}`, event.args.name);
    if (event.name === 'process_name') processNames.set(event.pid, event.args.name);
  }
  const totals = new Map();
  const open = new Map();
  const add = (event, durUs) => {
    const thread = `${processNames.get(event.pid) ?? event.pid}/${threadNames.get(`${event.pid}:${event.tid}`) ?? event.tid}`;
    if (!TRACE_PHASES[thread]?.includes(event.name)) return;
    const key = `${thread} ${event.name}`;
    const row = totals.get(key) ?? { us: 0, count: 0, touched: 0 };
    row.us += durUs;
    row.count++;
    row.touched += event.args?.elementCount ?? event.args?.beginData?.dirtyObjects ?? 0;
    totals.set(key, row);
  };
  for (const event of events) {
    if (event.ph === 'X' && typeof event.dur === 'number') add(event, event.dur);
    else if (event.ph === 'B') {
      const key = `${event.pid}:${event.tid}`;
      const stack = open.get(key) ?? [];
      stack.push(event);
      open.set(key, stack);
    } else if (event.ph === 'E') {
      const begin = open.get(`${event.pid}:${event.tid}`)?.pop();
      if (begin !== undefined) add({ ...begin, args: { ...begin.args, ...event.args } }, event.ts - begin.ts);
    }
  }
  const per = (n) => (frames === 0 ? 0 : n / frames);
  const phases = {};
  for (const [thread, names] of Object.entries(TRACE_PHASES))
    for (const name of names) {
      const row = totals.get(`${thread} ${name}`);
      if (row === undefined) continue;
      phases[`${thread} ${name}`] = {
        msPerFrame: per(row.us / MICROS_PER_MS),
        perFrame: per(row.count),
        ...(row.touched > 0 ? { touchedPerFrame: per(row.touched) } : {}),
      };
    }
  return { frames, phases };
}

/**
 * One side of an interleaved A/B: each phase's mean over the side's trace windows, and the mean of each
 * per-frame metric. `windows` holds `{ trace, metrics }` folds from {@link foldTrace} and
 * {@link metricDeltas}.
 */
export function meanOfWindows(windows) {
  const phases = {};
  const names = new Set(windows.flatMap((window) => Object.keys(window.trace.phases)));
  for (const name of names) {
    const rows = windows.map((window) => window.trace.phases[name] ?? { msPerFrame: 0, perFrame: 0 });
    phases[name] = {
      msPerFrame: rows.reduce((sum, row) => sum + row.msPerFrame, 0) / rows.length,
      perFrame: rows.reduce((sum, row) => sum + row.perFrame, 0) / rows.length,
    };
  }
  const metrics = {};
  for (const key of Object.keys(windows[0]?.metrics ?? {}))
    metrics[key] = windows.reduce((sum, window) => sum + window.metrics[key], 0) / windows.length;
  return { windows: windows.length, phases, metrics };
}

/** The trace category whose events name each style, layout and paint invalidation's node and cause. */
export const INVALIDATION_CATEGORY = 'disabled-by-default-devtools.timeline.invalidationTracking';
const INVALIDATION_TOP = 25;

/**
 * Invalidations per frame by kind, cause and node, with the script frame that caused it where the
 * trace has one, most frequent first: what makes the HUD restyle, relayout or repaint every frame.
 */
export function foldInvalidations(events, frames) {
  const counts = new Map();
  for (const event of events) {
    if (!event.name?.endsWith('InvalidationTracking')) continue;
    const data = event.args?.data ?? {};
    const cause =
      data.reason ??
      (data.changedClass && `class ${data.changedClass}`) ??
      (data.changedAttribute && `attribute ${data.changedAttribute}`) ??
      (data.changedId && `id ${data.changedId}`) ??
      (data.changedPseudo && `pseudo ${data.changedPseudo}`) ??
      '';
    const frame = data.stackTrace?.[0];
    const where =
      frame === undefined
        ? ''
        : ` @ ${frame.functionName || '(anonymous)'} ${frame.url.replace(/^.*\/src\//, '').replace(/\?.*$/, '')}:${frame.lineNumber}`;
    const key = `${event.name.replace('InvalidationTracking', '')} ${cause} ${data.nodeName ?? ''}${where}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, INVALIDATION_TOP)
      .map(([key, count]) => [key, frames === 0 ? 0 : count / frames]),
  );
}

/** The source areas the CPU fold attributes self time to, first match wins. The dev server serves the
 *  app package at `/src/` and the others under their package paths. */
const APP = '^https?://[^/]+/src/';
const SOURCE_AREAS = [
  ['app/hud/dom', new RegExp(`${APP}hud/dom/`)],
  ['app/hud/minimap', new RegExp(`${APP}hud/minimap/`)],
  ['app/hud/figures', new RegExp(`${APP}hud/figures/`)],
  ['app/hud/tool-panel', new RegExp(`${APP}hud/tool-panel/`)],
  ['app/hud (other)', new RegExp(`${APP}hud/`)],
  ['app/view/unit-controls', new RegExp(`${APP}view/unit-controls/`)],
  ['app/view/projections', new RegExp(`${APP}view/projections/`)],
  ['app/view/runtime', new RegExp(`${APP}view/runtime/`)],
  ['app/view (other)', new RegExp(`${APP}view/`)],
  ['app/session', new RegExp(`${APP}session/`)],
  ['app (other)', new RegExp(APP)],
  ['render', /\/packages\/render\//],
  ['audio', /\/packages\/audio\//],
  ['sim', /\/packages\/sim\//],
  ['pixi', /pixi|RenderTargetSystem|Filter-/],
];

const ENGINE_FRAMES = ['(idle)', '(program)', '(garbage collector)'];

/** A CPU profile's self time per source area and its top functions, in milliseconds per frame. */
export function foldCpuProfile(profile, frames) {
  const byNode = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const id = profile.samples[i];
    byNode.set(id, (byNode.get(id) ?? 0) + (profile.timeDeltas?.[i] ?? 0));
  }
  const areas = new Map();
  const functions = new Map();
  for (const node of profile.nodes) {
    const us = byNode.get(node.id) ?? 0;
    if (us === 0) continue;
    const { url, functionName, lineNumber } = node.callFrame;
    // A frame with no script URL is the engine's own (idle, the program, the GC) or a native call,
    // such as a WebGL or DOM method.
    const area =
      SOURCE_AREAS.find(([, pattern]) => pattern.test(url))?.[0] ??
      (url !== '' ? 'other' : ENGINE_FRAMES.includes(functionName) ? functionName : 'native calls');
    areas.set(area, (areas.get(area) ?? 0) + us);
    const where = url
      .replace(/^.*\/packages\//, '')
      .replace(/^https?:\/\/[^/]+\/src\//, 'app/')
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/\?.*$/, '');
    const key = `${functionName || '(anonymous)'} ${where}:${lineNumber + 1}`;
    functions.set(key, (functions.get(key) ?? 0) + us);
  }
  const per = (us) => (frames === 0 ? 0 : us / MICROS_PER_MS / frames);
  const ranked = (map, top) =>
    Object.fromEntries(
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([key, us]) => [key, per(us)]),
    );
  const AREA_TOP = 20;
  const FUNCTION_TOP = 30;
  return { frames, areas: ranked(areas, AREA_TOP), functions: ranked(functions, FUNCTION_TOP) };
}

const fixed = (value, digits) => (value === null || value === undefined ? '-' : value.toFixed(digits));

/** The markdown table `report.md` holds, one row per measured scenario. */
export function markdownTable(results) {
  const rows = [
    '| scenario | setup | frames | RAF p50/p95/max ms | layouts/f | recalcs/f | layout ms/f | style ms/f | script ms/f | task ms/f | mutations/f | layers (drawing) | layer paints/f | insets | HUD nodes | void because |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of results) {
    const { metrics, frames, layers } = result;
    const mutations = frames.frames === 0 ? 0 : result.mutations.records / frames.frames;
    rows.push(
      `| ${result.id} | ${result.setupNote || '-'} | ${frames.frames} | ${fixed(frames.rafP50, 1)}/${fixed(frames.rafP95, 1)}/${fixed(frames.rafMax, 1)} | ${fixed(metrics.layoutsPerFrame, 2)} | ${fixed(metrics.styleRecalcsPerFrame, 2)} | ${fixed(metrics.layoutMsPerFrame, 3)} | ${fixed(metrics.styleMsPerFrame, 3)} | ${fixed(metrics.scriptMsPerFrame, 2)} | ${fixed(metrics.taskMsPerFrame, 2)} | ${fixed(mutations, 1)} | ${layers.count} (${layers.drawing}) | ${fixed(layers.paintedPerFrame, 2)} | ${result.insets} | ${result.hudNodes} | ${result.invalid.join(', ') || '-'} |`,
    );
  }
  return rows.join('\n');
}
