import { diag } from '../../diag/index.js';
import { type ColorBlindFilter, onStoredSettingsChange, readStoredSettings } from '../settings/store.js';

/**
 * Whole-viewport colour-blindness correction (daltonization) as one SVG `feColorMatrix` behind a CSS
 * `filter`, so it covers the world and the UI alike. The error a deficient eye loses, `(I - M_sim)`,
 * is routed into channels it still separates: `M_correct = I + M_shift · (I - M_sim)`, after
 * Fidaner, Lin and Ozguven's daltonization. An approximation: `M_sim` are the widely published
 * single-matrix sRGB simulations (not Brettel's LMS projection), applied to gamma-encoded values, and
 * the tritanopia shift is our own.
 */

type Deficiency = Exclude<ColorBlindFilter, 'off'>;
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

/** What each deficiency sees of an sRGB colour, as one matrix per deficiency. */
const CVD_SIMULATION: Record<Deficiency, Mat3> = {
  protanopia: [
    [0.567, 0.433, 0],
    [0.558, 0.442, 0],
    [0, 0.242, 0.758],
  ],
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7],
  ],
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

function corrected3x3(type: Deficiency): Mat3 {
  const sim = CVD_SIMULATION[type];
  const shift = type === 'tritanopia' ? SHIFT_BLUE_YELLOW : SHIFT_RED_GREEN;
  return matAdd(IDENTITY3, matMul(shift, matSub(IDENTITY3, sim)));
}

const CORRECTION: Record<Deficiency, Mat3> = {
  protanopia: corrected3x3('protanopia'),
  deuteranopia: corrected3x3('deuteranopia'),
  tritanopia: corrected3x3('tritanopia'),
};

/** Expand a 3×3 correction into the 20-value `feColorMatrix` form (alpha passes through unchanged). */
function toColorMatrix(m: Mat3): number[] {
  return [...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0];
}

/** The `feColorMatrix` values for a filter, or `undefined` when the filter is `off`. Pure. */
export function correctionMatrix(filter: ColorBlindFilter): number[] | undefined {
  return filter === 'off' ? undefined : toColorMatrix(CORRECTION[filter]);
}

const FILTER_ID = 'open-northland-colorblind';
const SVG_NS = 'http://www.w3.org/2000/svg';

let svgMatrix: SVGFEColorMatrixElement | null = null;

/** The hidden SVG holding the filter, built once. */
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
  filter.appendChild(matrix);
  svg.appendChild(filter);
  // Defined outside <body>, the element it recolours, so the filter is not part of its own subtree.
  document.documentElement.appendChild(svg);
  svgMatrix = matrix;
  return matrix;
}

/** Apply a filter now; `off` clears it. On <body>, since Firefox ignores `filter: url(#...)` on <html>. */
function applyColorBlindFilter(filter: ColorBlindFilter): void {
  const target = document.body;
  if (filter === 'off') {
    target.style.filter = '';
    return;
  }
  const matrix = ensureSvgFilter();
  matrix.setAttribute('values', (correctionMatrix(filter) ?? []).join(' '));
  target.style.filter = `url(#${FILTER_ID})`;
}

/** Keep the viewport filter in step with the local setting; presentation only, never part of the sim. */
export function installColorBlindFilter(): () => void {
  try {
    ensureSvgFilter();
  } catch (error) {
    diag.warn('accessibility', `Colour-blind filter unavailable: ${String(error)}`);
    return () => undefined;
  }
  const update = (): void => applyColorBlindFilter(readStoredSettings().colorBlindFilter);
  const unsubscribe = onStoredSettingsChange(update);
  update();
  return () => {
    unsubscribe();
    document.body.style.filter = '';
  };
}
