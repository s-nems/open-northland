/** The sessions, rows and report shape of `npm run bench:gpu-settings`; pure, so it unit-tests. */

const USAGE = 'usage: npm run bench:gpu-settings -- checkpoint origin [output-dir] [cycles]';
const DEFAULT_OUTPUT = 'bench-out/gpu-settings';
const DEFAULT_CYCLES = 10;

const DENSE_ZOOM = 1;
const WIDE_ZOOM = 0.5;
/** The night step of the game's own day and night cycle (`view/script/day-night.ts`), held with `?tint=`. */
const NIGHT_TINT = 58;
const SCALED_RENDER = 1.5;

/** The art filters a session can switch to live; `off` is enhanced sampling disabled. */
const PRESCALED_FILTERS = ['xbrz', 'superxbr', 'mmpx'];

/**
 * How a row switches its state in the page: `enhancements` patches the renderer's graphics
 * enhancements over the session's own, `weather` shows or hides the weather, `vignette` the post-effect
 * quad, `none` nothing.
 */
const row = (toggle, kind, on, off, prescaled = false) => ({ toggle, kind, on, off, prescaled });

const enhancement = (key) => row(key, 'enhancements', { [key]: true }, { [key]: false });

/** The rows every daylight view of the densest town measures. */
function townRows(zoom) {
  return [
    row('control', 'none', null, null),
    row(
      'xbr',
      'enhancements',
      { enhancedSampling: true, pixelArtScaler: 'xbr' },
      { enhancedSampling: false },
    ),
    ...(zoom === DENSE_ZOOM
      ? PRESCALED_FILTERS.map((filter) =>
          row(
            filter,
            'enhancements',
            { enhancedSampling: true, pixelArtScaler: filter },
            { enhancedSampling: false },
            true,
          ),
        )
      : []),
    enhancement('softShadows'),
    enhancement('enhancedWater'),
    enhancement('environmentMotion'),
    enhancement('groundedBuildings'),
    enhancement('buildingDamage'),
    row('postFx', 'vignette', true, false),
  ];
}

/**
 * One page load each: its URL parameters, settings patch and the views it frames. `town` frames the
 * densest buildings, `coast` the shore waves nearest them. Rows read on against off with every other
 * setting on; `control` sets nothing and gives the view's frame time and the loop's noise. Settings a
 * map reads only as it starts (render scale, sprite smoothing) get a session of their own, read by its
 * control rows against the `day` session's.
 */
export function settingsSessions() {
  return [
    {
      id: 'day',
      params: {},
      settings: {},
      views: [
        { id: 'town', zoom: DENSE_ZOOM, rows: townRows(DENSE_ZOOM) },
        { id: 'town', zoom: WIDE_ZOOM, rows: townRows(WIDE_ZOOM) },
        {
          id: 'coast',
          zoom: DENSE_ZOOM,
          rows: [
            row('control', 'none', null, null),
            enhancement('environmentMotion'),
            enhancement('enhancedWater'),
          ],
        },
      ],
    },
    {
      id: 'night',
      params: { tint: String(NIGHT_TINT) },
      settings: {},
      views: [DENSE_ZOOM, WIDE_ZOOM].map((zoom) => ({
        id: 'town',
        zoom,
        rows: [row('control', 'none', null, null), enhancement('dayNight')],
      })),
    },
    ...['rain', 'snow'].map((weather) => ({
      id: weather,
      params: { weather },
      settings: {},
      views: [
        {
          id: 'town',
          zoom: DENSE_ZOOM,
          rows: [row('control', 'none', null, null), row('weather', 'weather', true, false)],
        },
      ],
    })),
    {
      id: 'smoothing-off',
      params: {},
      settings: { spriteSmoothing: false },
      views: [DENSE_ZOOM, WIDE_ZOOM].map((zoom) => ({
        id: 'town',
        zoom,
        rows: [row('control', 'none', null, null)],
      })),
    },
    {
      id: `scale${SCALED_RENDER}`,
      params: {},
      settings: { renderScale: SCALED_RENDER },
      views: [{ id: 'town', zoom: DENSE_ZOOM, rows: [row('control', 'none', null, null)] }],
    },
  ];
}

/** A row's report id: `<session>-<view>-z<zoom>-<toggle>`. */
export const rowId = (session, view, entry) => `${session.id}-${view.id}-z${view.zoom}-${entry.toggle}`;

/** Every graphics setting on, xBR the art filter, render scale 1, the FPS counter's timer queries off. */
export function sessionSettings(session) {
  return {
    enhancedSampling: true,
    pixelArtScaler: 'xbr',
    softShadows: true,
    enhancedWater: true,
    environmentMotion: true,
    groundedBuildings: true,
    buildingDamage: true,
    dayNight: true,
    weather: true,
    postFxEnabled: true,
    spriteSmoothing: true,
    blood: true,
    bonesFade: true,
    renderScale: 1,
    ...session.settings,
    fpsCounter: false,
    soundEnabled: false,
    edgeScrollEnabled: false,
  };
}

function positiveInteger(text, name) {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

/** `argv` without node and script; `ON_BENCH_SETTINGS_ROWS` keeps the named rows and the sessions they need. */
export function parseSettingsBenchArgs(argv, env = {}) {
  const [checkpoint, origin, output = DEFAULT_OUTPUT, cyclesText] = argv;
  if (!checkpoint || !origin || argv.length > 4) throw new Error(USAGE);
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Origin must be an HTTP development server');
  const names = env.ON_BENCH_SETTINGS_ROWS?.split(',');
  const sessions = settingsSessions();
  const all = sessions.flatMap((session) =>
    session.views.flatMap((view) => view.rows.map((entry) => rowId(session, view, entry))),
  );
  const unknown = names?.filter((name) => !all.includes(name)) ?? [];
  if (unknown.length > 0) throw new Error(`Unknown ON_BENCH_SETTINGS_ROWS ${unknown}; rows: ${all}`);
  const kept = (session, view, entry) => names === undefined || names.includes(rowId(session, view, entry));
  return {
    checkpoint,
    origin: url,
    output,
    cycles: cyclesText === undefined ? DEFAULT_CYCLES : positiveInteger(cyclesText, 'cycles'),
    sessions: sessions
      .map((session) => ({
        ...session,
        views: session.views
          .map((view) => ({ ...view, rows: view.rows.filter((entry) => kept(session, view, entry)) }))
          .filter((view) => view.rows.length > 0),
      }))
      .filter((session) => session.views.length > 0),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * One row's cycles folded: `on` and `off` are milliseconds per redraw, `onSubmit` the page's own script
 * time per redraw in the on state. The medians of each state and of the per-cycle on-minus-off
 * differences, with the differences' range.
 */
export function summarizeCycles(cycles) {
  const deltas = cycles.map((cycle) => cycle.on - cycle.off);
  return {
    submitMs: median(cycles.map((cycle) => cycle.onSubmit)),
    onMs: median(cycles.map((cycle) => cycle.on)),
    offMs: median(cycles.map((cycle) => cycle.off)),
    costMs: median(deltas),
    minMs: Math.min(...deltas),
    maxMs: Math.max(...deltas),
  };
}

const fixed = (value) => value.toFixed(2);

/** The markdown table `report.md` holds, one line per measured row. */
export function markdownTable(results) {
  const rows = [
    '| row | on ms | off ms | cost ms (median) | range | on submit ms | cycles |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of results) {
    const { summary } = result;
    rows.push(
      `| ${result.id} | ${fixed(summary.onMs)} | ${fixed(summary.offMs)} | ${fixed(summary.costMs)} | ${fixed(summary.minMs)} to ${fixed(summary.maxMs)} | ${fixed(summary.submitMs)} | ${result.cycles.length} |`,
    );
  }
  return rows.join('\n');
}
