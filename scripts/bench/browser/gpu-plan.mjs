/** The scenario matrix, settings and report shape of `npm run bench:gpu`; pure, so it unit-tests. */

const USAGE = 'usage: npm run bench:gpu -- checkpoint origin [output-dir] [window-seconds] [repeats]';
const DEFAULT_OUTPUT = 'bench-out/gpu';
const DEFAULT_SECONDS = 5;
const DEFAULT_REPEATS = 3;

/** The settings the startup graphics profile switches (`view/graphics/defaults.ts`), minus the scaler. */
export const ENHANCEMENT_SETTINGS = [
  'enhancedSampling',
  'softShadows',
  'enhancedWater',
  'environmentMotion',
  'groundedBuildings',
  'buildingDamage',
  'weather',
  'postFxEnabled',
];
/**
 * The settings a toggle scenario switches off alone with every other one on: the startup profile's
 * effects plus the presentation settings it leaves to the player. Every scenario pins them (on, unless
 * its patch says otherwise), since a patch stays stored for the next scenario's restore.
 */
export const TOGGLED_SETTINGS = [
  'softShadows',
  'enhancedWater',
  'environmentMotion',
  'groundedBuildings',
  'buildingDamage',
  'blood',
  'bonesFade',
  'postFxEnabled',
  'spriteSmoothing',
];
/** Blood and bone piles show only where fighting is, so their toggles frame the densest battle. */
const BATTLE_SETTINGS = ['blood', 'bonesFade'];
/** The backing-resolution multipliers the render-scale scenarios set; 1 is the default. */
export const RENDER_SCALES = [1.5, 2];
const DEFAULT_RENDER_SCALE = 1;

/** The Graphics menu's world magnifications: `off` is enhanced sampling disabled, the rest its scalers. */
export const MAGNIFIERS = ['off', 'xbr', 'xbrz', 'superxbr', 'mmpx'];
const DEFAULT_MAGNIFIER = 'xbr';

const PAUSED = 0;
const FAST = 3;
const DENSE_ZOOM = 1;
const MAGNIFIED_ZOOM = 2;
const WIDE_ZOOM = 0.35;
/** A `?weather=<kind>:<percent>` amount past every kind's full storm: a thunderstorm with lightning, a
 *  blizzard. A bare kind shows the default heavy shower, which is a full storm for sand already. */
export const FULL_STORM_PERCENT = 100;
const TOGGLE_ZOOMS = [DENSE_ZOOM, 0.5];
/** The magnifier comparison's zooms: 0.5 and 0.7 minify, 1 draws a texel per pixel and 2 magnifies.
 *  xBR minifies its pages there, a prescaled scaler its twins at four times the texels. */
const MAGNIFY_ZOOMS = [0.5, 0.7, DENSE_ZOOM, MAGNIFIED_ZOOM];
/** A single selected settler opens the settler panel and its portrait inset. */
const PANEL_SELECTION = 1;
const FEW_SELECTED = 10;
/** The many-selection box is drawn at this zoom, where enough settlers fit on screen. */
export const MANY_SELECTED = 50;
export const MANY_SELECTION_ZOOM = 0.5;

function scenario(id, overrides = {}) {
  return {
    id,
    enhancements: true,
    magnifier: DEFAULT_MAGNIFIER,
    zoom: DENSE_ZOOM,
    speed: PAUSED,
    selection: 0,
    weather: null,
    view: 'dense',
    patch: {},
    pointer: 'bar',
    hidden: [],
    ...overrides,
  };
}

/**
 * Every scenario frames the densest building cluster, a `battle` view the densest fighting, a `coast`
 * view the shore waves nearest it and a `trade` view a trader whose window shows. The pointer rests on
 * the bottom bar, or over the middle of the world for `pointer: 'world'`; `hidden` names world layers a
 * scenario hides. Pairs to read together: `off-*` against `magnify-*-z1` and `on-x3`; `panel-*` against
 * `magnify-xbr-z1` and `on-x3`; `select*` against `magnify-xbr-z1`; every `weather-*-x3` against
 * `weather-clear-x3`; then the framing scenarios ({@link framingScenarios}).
 */
export function gpuScenarios() {
  return [
    scenario('off-paused', { enhancements: false, magnifier: 'off' }),
    scenario('off-x3', { enhancements: false, magnifier: 'off', speed: FAST }),
    ...MAGNIFY_ZOOMS.flatMap((zoom) =>
      MAGNIFIERS.map((magnifier) => scenario(`magnify-${magnifier}-z${zoom}`, { magnifier, zoom })),
    ),
    scenario('on-x3', { speed: FAST }),
    scenario('panel-paused', { selection: PANEL_SELECTION }),
    scenario('panel-x3', { selection: PANEL_SELECTION, speed: FAST }),
    scenario('select10-paused', { selection: FEW_SELECTED }),
    scenario(`select${MANY_SELECTED}-paused`, { selection: MANY_SELECTED }),
    // A paused field stands still, so the weather pass is compared moving.
    scenario('weather-rain-x3', { weather: 'rain', speed: FAST }),
    scenario('weather-snow-x3', { weather: 'snow', speed: FAST }),
    scenario('weather-sand-x3', { weather: 'sand', speed: FAST }),
    scenario('weather-storm-x3', { weather: `rain:${FULL_STORM_PERCENT}`, speed: FAST }),
    scenario('weather-blizzard-x3', { weather: `snow:${FULL_STORM_PERCENT}`, speed: FAST }),
    scenario('weather-clear-x3', { weather: 'clear', speed: FAST }),
    scenario('wide-paused', { zoom: WIDE_ZOOM }),
    scenario('wide-x3', { zoom: WIDE_ZOOM, speed: FAST }),
    ...toggleScenarios(),
    ...renderScaleScenarios(),
    ...framingScenarios(),
  ];
}

/** The world layers a scenario can hide through the renderer. */
export const HIDEABLE_LAYERS = ['roads'];

/**
 * `coast-x3` against `coast-no-environmentMotion-x3`, which drops the shore-wave pass; the paused view
 * with the road layer hidden, `roads-hidden-paused` against `magnify-xbr-z1` and
 * `roads-hidden-off-paused` against `magnify-off-z1`; `panel-hover-x3`, the settler panel with the
 * pointer over the world, against `panel-x3`; `trade-x3`, a trader's trade window with its two house
 * portraits, against `panel-x3`.
 */
function framingScenarios() {
  const coast = { view: 'coast', speed: FAST };
  return [
    scenario('coast-x3', coast),
    scenario('coast-no-environmentMotion-x3', { ...coast, patch: { environmentMotion: false } }),
    scenario('roads-hidden-paused', { hidden: ['roads'] }),
    scenario('roads-hidden-off-paused', { magnifier: 'off', hidden: ['roads'] }),
    scenario('panel-hover-x3', { selection: PANEL_SELECTION, speed: FAST, pointer: 'world' }),
    scenario('trade-x3', { view: 'trade', selection: PANEL_SELECTION, speed: FAST }),
  ];
}

const zoomSuffix = (zoom) => (zoom === DENSE_ZOOM ? '' : `-z${zoom}`);

/**
 * Everything on against each toggled setting off alone, at x3 and zoom 1 and 0.5: read `no-<setting>-x3`
 * against `on-x3`, and `battle-no-<setting>-x3` against `battle-x3`, at the same zoom suffix.
 */
function toggleScenarios() {
  return TOGGLE_ZOOMS.flatMap((zoom) => {
    const z = zoomSuffix(zoom);
    const battle = { speed: FAST, zoom, view: 'battle' };
    return [
      ...(zoom === DENSE_ZOOM ? [] : [scenario(`on-x3${z}`, { speed: FAST, zoom })]),
      ...TOGGLED_SETTINGS.filter((key) => !BATTLE_SETTINGS.includes(key)).map((key) =>
        scenario(`no-${key}-x3${z}`, { speed: FAST, zoom, patch: { [key]: false } }),
      ),
      scenario(`battle-x3${z}`, battle),
      ...BATTLE_SETTINGS.map((key) =>
        scenario(`battle-no-${key}-x3${z}`, { ...battle, patch: { [key]: false } }),
      ),
    ];
  });
}

/** Everything on at a higher backing resolution: read `scale<n>-x3` against `on-x3`. */
function renderScaleScenarios() {
  return RENDER_SCALES.map((renderScale) =>
    scenario(`scale${renderScale}-x3`, { speed: FAST, patch: { renderScale } }),
  );
}

/** The player-settings patch a scenario loads under; the FPS counter feeds `perf().gpu.ms`. */
export function scenarioSettings(entry) {
  const settings = Object.fromEntries(TOGGLED_SETTINGS.map((key) => [key, true]));
  for (const key of ENHANCEMENT_SETTINGS) settings[key] = entry.enhancements;
  settings.enhancedSampling = entry.magnifier !== 'off';
  if (entry.magnifier !== 'off') settings.pixelArtScaler = entry.magnifier;
  return {
    ...settings,
    renderScale: DEFAULT_RENDER_SCALE,
    ...entry.patch,
    fpsCounter: true,
    soundEnabled: true,
    edgeScrollEnabled: false,
  };
}

function positiveNumber(text, name, integer) {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 1 || (integer && !Number.isInteger(value)))
    throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}`);
  return value;
}

/** `argv` without node and script; `ON_BENCH_GPU_SCENARIOS` keeps the named scenarios only. */
export function parseGpuBenchArgs(argv, env = {}) {
  const [checkpoint, origin, output = DEFAULT_OUTPUT, secondsText, repeatsText] = argv;
  if (!checkpoint || !origin || argv.length > 5) throw new Error(USAGE);
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Origin must be an HTTP development server');
  const all = gpuScenarios();
  const names = env.ON_BENCH_GPU_SCENARIOS?.split(',');
  const unknown = names?.filter((name) => !all.some((entry) => entry.id === name)) ?? [];
  if (unknown.length > 0)
    throw new Error(`Unknown ON_BENCH_GPU_SCENARIOS ${unknown}; scenarios: ${all.map((e) => e.id)}`);
  return {
    checkpoint,
    origin: url,
    output,
    seconds:
      secondsText === undefined ? DEFAULT_SECONDS : positiveNumber(secondsText, 'window seconds', false),
    repeats: repeatsText === undefined ? DEFAULT_REPEATS : positiveNumber(repeatsText, 'repeats', true),
    scenarios: names === undefined ? all : all.filter((entry) => names.includes(entry.id)),
  };
}

/** The `q` quantile of `values` by nearest rank; null for none. */
export function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const GL_FIELDS = [
  'drawsPerFrame',
  'textureBindsPerFrame',
  'programsPerFrame',
  'uploadsPerFrame',
  'uploadKbPerFrame',
  'textureUploadsPerFrame',
  'textureUploadKbPerFrame',
];

/**
 * One scenario's repeats folded: the GPU figure is the lowest per-repeat median, the floor contention
 * cannot fake; GL counts are the mean per frame over every repeat. Each repeat names the reasons it is
 * void (`invalid`), and any one voids the scenario.
 */
export function summarizeRepeats(repeats) {
  const p50s = repeats.map((repeat) => quantile(repeat.gpuMs, 0.5));
  const measured = p50s.filter((p50) => p50 !== null);
  const frames = repeats.reduce((sum, repeat) => sum + repeat.gl.frames, 0);
  const gl = Object.fromEntries(
    GL_FIELDS.map((field) => [
      field,
      frames === 0
        ? null
        : repeats.reduce((sum, repeat) => sum + repeat.gl[field] * repeat.gl.frames, 0) / frames,
    ]),
  );
  return {
    gpuMs: { minP50: measured.length === 0 ? null : Math.min(...measured), p50s },
    gl: { frames, ...gl },
    invalid: [...new Set(repeats.flatMap((repeat) => repeat.invalid))],
  };
}

const fixed = (value, digits) => (value === null || value === undefined ? '-' : value.toFixed(digits));

const BYTES_PER_MB = 1024 * 1024;

/** A scenario's prescaled twins as `pages (MB)`, with the pages the memory budget held back. */
function prescaledCell(prescale) {
  if (prescale === null || prescale === undefined) return '-';
  const held = prescale.overBudget > 0 ? `, ${prescale.overBudget} over budget` : '';
  return `${prescale.pages} (${fixed(prescale.bytes / BYTES_PER_MB, 0)}${held})`;
}

/** The markdown table `report.md` holds, one row per measured scenario. */
export function markdownTable(results) {
  const rows = [
    '| scenario | zoom | speed | selected | insets | prescaled pages (MB) | GPU ms (min p50) | p50 per repeat | draws | texture binds | programs | uploads (KB) | texture uploads (KB) | void because |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of results) {
    const { gl, gpuMs } = result.summary;
    rows.push(
      `| ${result.id} | ${result.zoom} | ${result.speed === PAUSED ? 'paused' : `x${result.speed}`} | ${result.selected} | ${result.insets} | ${prescaledCell(result.prescale)} | ${fixed(gpuMs.minP50, 2)} | ${gpuMs.p50s.map((p50) => fixed(p50, 2)).join(' / ')} | ${fixed(gl.drawsPerFrame, 0)} | ${fixed(gl.textureBindsPerFrame, 0)} | ${fixed(gl.programsPerFrame, 0)} | ${fixed(gl.uploadsPerFrame, 0)} (${fixed(gl.uploadKbPerFrame, 0)}) | ${fixed(gl.textureUploadsPerFrame, 1)} (${fixed(gl.textureUploadKbPerFrame, 0)}) | ${result.summary.invalid.join(', ') || '-'} |`,
    );
  }
  return rows.join('\n');
}
