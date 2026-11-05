import { diag } from '../../diag/index.js';
import { onStoredSettingsChange, readStoredSettings, type ColorBlindFilter } from '../settings/store.js';

/**
 * Whole-viewport colour-blindness *correction* (daltonization) as a single SVG `feColorMatrix`, applied
 * as a CSS `filter` over the whole document so it covers both the game world and the UI with no engine
 * change.
 *
 * Unlike a plain simulation matrix (which only shows what a colour-blind viewer already struggles with),
 * daltonization restores separability: it takes the colour error a deficient eye cannot recover —
 * `(I − M_sim)·source`, where `M_sim` is the standard RGB-space CVD *simulation* matrix — and shifts that
 * error into a channel the viewer *can* still tell apart. Red-green deficiencies (protanopia, deuteranopia)
 * push the error into blue (weight 0.7, matching the ReShade `Daltonize.fx` / Viénot-Brettel convention);
 * tritanopia pushes it into red/green. The closed form is a single matrix:
 *
 *     M_correct = M_sim + M_shift · (I − M_sim)
 *
 * which is exactly what `feColorMatrix` consumes. Hue will move (a red may read slightly magenta, a green
 * slightly cyan) — that is expected and, for a colour-blind player, visually consistent with the colours
 * they already perceive, so it is accepted.
 */
type Vec3 = readonly [number, number, number];
type Mat3 = readonly [Vec3, Vec3, Vec3];

const IDENTITY3: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function matAdd(a: Mat3, b: Mat3): Mat3 {
  return [
    [a[0][0] + b[0][0], a[0][1] + b[0][1], a[0][2] + b[0][2]],
    [a[1][0] + b[1][0], a[1][1] + b[1][1], a[1][2] + b[1][2]],
    [a[2][0] + b[2][0], a[2][1] + b[2][1], a[2][2] + b[2][2]],
  ];
}

function matSub(a: Mat3, b: Mat3): Mat3 {
  return [
    [a[0][0] - b[0][0], a[0][1] - b[0][1], a[0][2] - b[0][2]],
    [a[1][0] - b[1][0], a[1][1] - b[1][1], a[1][2] - b[1][2]],
    [a[2][0] - b[2][0], a[2][1] - b[2][1], a[2][2] - b[2][2]],
  ];
}

function matMul(a: Mat3, b: Mat3): Mat3 {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
    ],
    [
      a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
      a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
      a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
    ],
  ];
}

/** Standard RGB-space CVD *simulation* matrices (ColorJack / Brettel simplified form). */
const SIM: Record<'protanopia' | 'deuteranopia' | 'tritanopia', Mat3> = {
  // Red-blind: red and green collapse toward the same yellow.
  protanopia: [
    [0.567, 0.433, 0],
    [0.558, 0.442, 0],
    [0, 0.242, 0.758],
  ],
  // Red-green: the most common, ~6% of men.
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7],
  ],
  // Blue-yellow: rare, ~0.01%.
  tritanopia: [
    [0.95, 0.05, 0],
    [0, 0.433, 0.567],
    [0, 0.475, 0.525],
  ],
};

/** Red-green deficiencies: route the lost red/green error into the blue channel. */
const SHIFT_RED_GREEN: Mat3 = [
  [0, 0, 0],
  [0.7, 1, 0],
  [0.7, 0, 1],
];

/** Blue-yellow deficiency: route the lost blue error into the red/green channels. */
const SHIFT_BLUE_YELLOW: Mat3 = [
  [1, 0, 0.7],
  [0, 1, 0.7],
  [0, 0, 0],
];

/** Daltonization correction `M_sim + M_shift·(I − M_sim)` for one concrete deficiency. */
function corrected3x3(type: 'protanopia' | 'deuteranopia' | 'tritanopia'): Mat3 {
  const sim = SIM[type];
  const shift = type === 'tritanopia' ? SHIFT_BLUE_YELLOW : SHIFT_RED_GREEN;
  // `M_shift` left-multiplies the lost-error term `(I − M_sim)·source`: it is the matrix that
  // routes that error into a channel the deficient eye can still separate.
  return matAdd(sim, matMul(shift, matSub(IDENTITY3, sim)));
}

const CORRECTION: Record<Exclude<ColorBlindFilter, 'off'>, Mat3> = {
  protanopia: corrected3x3('protanopia'),
  deuteranopia: corrected3x3('deuteranopia'),
  // Most common single case (red-green); the pragmatic default for an unspecified deficiency.
  generic: corrected3x3('deuteranopia'),
  tritanopia: corrected3x3('tritanopia'),
};

/** Expand a 3×3 correction into the 20-value `feColorMatrix` form (alpha passes through unchanged). */
function toColorMatrix(m: Mat3): number[] {
  return [
    m[0][0], m[0][1], m[0][2], 0, 0,
    m[1][0], m[1][1], m[1][2], 0, 0,
    m[2][0], m[2][1], m[2][2], 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** The `feColorMatrix` values for a filter, or `undefined` when the filter is `off`. Pure. */
export function correctionMatrix(filter: ColorBlindFilter): number[] | undefined {
  return filter === 'off' ? undefined : toColorMatrix(CORRECTION[filter]);
}

const FILTER_ID = 'open-northland-colorblind';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lazily-built `feColorMatrix`; created on first use so a toggle applies even before boot finished. */
let svgMatrix: SVGFEColorMatrixElement | null = null;

/** Build the hidden SVG carrying the single recolouring filter, returning its `feColorMatrix`. Idempotent. */
function ensureSvgFilter(): SVGFEColorMatrixElement {
  if (svgMatrix !== null) return svgMatrix;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.pointerEvents = 'none';
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.id = FILTER_ID;
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const matrix = document.createElementNS(SVG_NS, 'feColorMatrix');
  matrix.setAttribute('type', 'matrix');
  matrix.setAttribute('values', (correctionMatrix('deuteranopia') ?? []).join(' '));
  filter.appendChild(matrix);
  svg.appendChild(filter);
  // The filter *definition* lives on <html>, outside the element we recolour, so it is never part of its
  // own subtree. (Firefox silently ignores `filter: url(#…)` when applied to the root <html> element, so we
  // apply the filter to <body> instead — see `applyColorBlindFilter`.)
  document.documentElement.appendChild(svg);
  svgMatrix = matrix;
  return matrix;
}

/**
 * Apply the chosen filter immediately; `off` clears it. Safe to call any time.
 *
 * The filter is attached to `<body>`, not `<html>`: Firefox silently ignores `filter: url(#…)` when it is
 * set on the root element, so the recolouring would do nothing there. `<body>` contains the whole UI and
 * the game canvas, so attaching here covers the entire viewport in every engine.
 */
export function applyColorBlindFilter(filter: ColorBlindFilter): void {
  const target = document.body;
  if (filter === 'off') {
    target.style.filter = '';
    return;
  }
  const matrix = ensureSvgFilter();
  matrix.setAttribute('values', (correctionMatrix(filter) ?? []).join(' '));
  target.style.filter = `url(#${FILTER_ID})`;
}

/**
 * Install the viewport-wide colour-blind correction filter and keep it in step with the local setting.
 * Returns a teardown that stops listening and clears the filter. Presentation only: nothing here reaches
 * the simulation, the network or a replay, so two clients may disagree without a desync.
 */
export function installColorBlindFilter(): () => void {
  let unsubscribe: () => void;
  try {
    ensureSvgFilter();
  } catch (error) {
    diag.warn('accessibility', `Colour-blind filter unavailable: ${String(error)}`);
    return () => undefined;
  }
  const update = (): void => applyColorBlindFilter(readStoredSettings().colorBlindFilter);
  unsubscribe = onStoredSettingsChange(update);
  update();
  return () => {
    unsubscribe();
    document.body.style.filter = '';
  };
}
