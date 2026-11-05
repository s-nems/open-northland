import { VERTEX_PALETTE_ENTRIES, type VertexPalette } from '@open-northland/data';
import type { DayNightMode } from '@open-northland/lockstep';
import {
  gradeLuma,
  type LightGrade,
  NEUTRAL_GRADE,
  nightLevel,
  shownGrade,
} from '@open-northland/render/data';
import type { SimEvent } from '@open-northland/sim';
import { loadVertexPalette } from '../../content/vertex-palette.js';
import { diag } from '../../diag/index.js';
import type { SessionHost } from '../../session/index.js';
import {
  cycleStepAtTick,
  type ScriptedCycleProbe,
  scriptsDayNightCycle,
  scriptsWeatherTints,
} from './day-night.js';

/** Share of the map's cells one palette index must cover to be the scene's tint rather than a local one. */
export const WHOLE_MAP_SHARE = 0.6;
/** The palette entry a cell never tinted holds: neutral grey. */
const NEUTRAL_INDEX = 0;
/** vertexcolors.pcx channels use 128 as neutral and multiply the lit colour. */
const NEUTRAL_CHANNEL = 128;
/** A scene channel this dark or darker divides a local tint as one palette step, not as zero. */
const MIN_SCENE_CHANNEL = 1 / NEUTRAL_CHANNEL;
const RGB = 3;
/** Share of a brightening local tint's excess over 1 the ground keeps under a scene tint. Tuned by eye. */
const LOCAL_GLOW_SHARE = 0.2;

/** A script's tint state, split into what grades the whole scene and what stays on the ground. */
export interface ScriptTintSplit {
  /** The palette colour the whole-map tint asks for; null for daylight or no whole-map tint. */
  readonly scene: LightGrade | null;
  /** RGB terrain multipliers per map cell over the scene's multiply: the map's tint as the scene
   *  light shows it, clamped to 1; a cell of the whole-map tint is 1, so the ground brightens only as
   *  the scene pass does. */
  readonly colors: Float32Array;
}

function channels(color: number): LightGrade {
  return [
    ((color >>> 16) & 255) / NEUTRAL_CHANNEL,
    ((color >>> 8) & 255) / NEUTRAL_CHANNEL,
    (color & 255) / NEUTRAL_CHANNEL,
  ];
}

const shown = (grade: LightGrade | null): LightGrade =>
  grade === null ? NEUTRAL_GRADE : shownGrade(grade, [1, 1, 1]);

/** `cycle` under `tint`'s darkening, or null for plain daylight. */
function darkenedBy(cycle: LightGrade, tint: LightGrade | null): LightGrade | null {
  const dark = (c: number): number => (cycle[c] ?? 1) * Math.min(1, tint?.[c] ?? 1);
  const scene: LightGrade = [dark(0), dark(1), dark(2)];
  return scene.every((channel) => channel === 1) ? null : scene;
}

/** The palette index covering at least {@link WHOLE_MAP_SHARE} of `tints`, or null. */
function dominantIndex(tints: Uint8Array): number | null {
  const counts = new Uint32Array(VERTEX_PALETTE_ENTRIES);
  for (const value of tints) counts[value] = (counts[value] ?? 0) + 1;
  const needed = tints.length * WHOLE_MAP_SHARE;
  for (let index = 0; index < counts.length; index++) if ((counts[index] ?? 0) >= needed) return index;
  return null;
}

/**
 * The dominant index is the scene tint, the colour the script author gave the whole map. Every other
 * index is a local tint, its palette colour divided by the scene's multiply, so the product on screen
 * is the colour the script asked for. Under a darkening scene a brightening local tint (a fire's glow)
 * keeps {@link LOCAL_GLOW_SHARE} of its excess instead: the night lights brighten it again, and divided
 * it would blow out under them. The dominant index and the neutral entry leave the ground at 1.
 * `sceneFor` picks the scene index from the dominant one; the neutral entry holds a daylight the
 * dominant index does not reach the ground under. `cycle` is a light of the game's own under the map's
 * tint: the tint darkens it and cannot brighten it, so a clearing's sun never shines at night. No
 * script cleared the ground for that light, so local tints are divided by the map's tint alone and
 * darken with the cycle. `out` is reused when it fits.
 */
export function splitScriptTints(
  tints: Uint8Array,
  palette: readonly number[],
  out?: Float32Array,
  sceneFor: (dominant: number | null) => number | null = (dominant) => dominant,
  cycle: LightGrade | null = null,
): ScriptTintSplit {
  const colors = out?.length === tints.length * RGB ? out : new Float32Array(tints.length * RGB);
  const dominant = dominantIndex(tints);
  const chosen = sceneFor(dominant);
  const writtenColor = chosen === null ? undefined : palette[chosen];
  const written = chosen !== NEUTRAL_INDEX && writtenColor !== undefined ? channels(writtenColor) : null;
  const scene = cycle === null ? written : darkenedBy(cycle, written);
  const divisor = shown(written);
  const darkened = gradeLuma(shown(scene)) < 1;
  const byIndex = new Float32Array(VERTEX_PALETTE_ENTRIES * RGB);
  for (let index = 0; index < VERTEX_PALETTE_ENTRIES; index++) {
    const color = palette[index];
    const local =
      index === NEUTRAL_INDEX ||
      index === chosen ||
      (index === dominant && chosen === NEUTRAL_INDEX) ||
      color === undefined
        ? null
        : channels(color);
    const glows = darkened && local !== null && gradeLuma(local) > 1;
    for (let c = 0; c < RGB; c++) {
      const want = local?.[c] ?? 1;
      byIndex[index * RGB + c] =
        local === null
          ? 1
          : glows
            ? 1 + (want - 1) * LOCAL_GLOW_SHARE
            : want / Math.max(MIN_SCENE_CHANNEL, Math.min(1, divisor[c] ?? 1));
    }
  }
  for (let cell = 0; cell < tints.length; cell++) {
    const from = (tints[cell] ?? NEUTRAL_INDEX) * RGB;
    const to = cell * RGB;
    colors[to] = byIndex[from] ?? 1;
    colors[to + 1] = byIndex[from + 1] ?? 1;
    colors[to + 2] = byIndex[from + 2] ?? 1;
  }
  return { scene, colors };
}

/**
 * Per-node RGB multipliers from per-cell ones on a map `columns` cells wide: each cell's colour on its
 * corner node `(2c + (r & 1), 2r)`, every other node neutral. The ground mesh's vertices are those
 * corners, so the GPU shades each triangle between its three corner colours as the original does.
 */
export function cellColorsToCorners(
  cellColors: Float32Array,
  columns: number,
  out?: Float32Array,
): Float32Array {
  const rows = columns === 0 ? 0 : cellColors.length / RGB / columns;
  const nodesX = 2 * columns;
  const size = nodesX * 2 * rows * RGB;
  const colors = out?.length === size ? out : new Float32Array(size);
  colors.fill(1);
  for (let cy = 0; cy < rows; cy++) {
    const hy = 2 * cy;
    for (let cx = 0; cx < columns; cx++) {
      const from = (cy * columns + cx) * RGB;
      const to = (hy * nodesX + 2 * cx + (cy & 1)) * RGB;
      for (let c = 0; c < RGB; c++) colors[to + c] = cellColors[from + c] ?? 1;
    }
  }
  return colors;
}

interface ScriptTintSurface {
  /** `snap` takes the grade at once instead of fading: the state the world was loaded in. */
  setSceneLight(target: LightGrade | null, snap?: boolean): void;
  applyTerrainVertexColors(colors: Float32Array): void;
}

/** The map's tints kept on the surface: the author's and the script's, synced on the script's events,
 *  and never after `dispose`. */
export interface ScriptTints {
  readonly onEvents: (events: readonly SimEvent[]) => void;
  /** Per rendered frame: moves the game's own cycle on when its step changes. */
  readonly frame: (tick: number) => void;
  /** The player's day and night setting; off holds the cycle at daylight. */
  readonly setDayNightShown: (shown: boolean) => void;
  /** Whether weather shows: the match's rule and the player's setting. Off clears the tints of a
   *  script's weather. */
  readonly setWeatherShown: (shown: boolean) => void;
  readonly dispose: () => void;
}

export interface ScriptTintOptions {
  /** `?tint=`: the palette index held as the whole-map tint in this view. */
  readonly pinnedIndex?: number | null;
  /** The match's day and night rule. */
  readonly dayNight?: DayNightMode;
  /** The player's day and night setting. */
  readonly dayNightShown?: boolean;
  /** Whether weather shows: the match's rule and the player's setting. */
  readonly weatherShown?: boolean;
  /** The match tick the world was loaded at, which places the game's own cycle. */
  readonly tick?: number;
}

/** The whole-map tint writes of the host's map scripts. */
function scriptTintOps(host: Pick<SessionHost, 'missions'>): ScriptedCycleProbe[] {
  return (host.missions?.missions ?? [])
    .flatMap((mission) => mission.results)
    .flatMap((op): ScriptedCycleProbe[] =>
      op.opcode === 'SetVertexColor' || op.opcode === 'SetVertexColorOnLand'
        ? [{ range: op.range, index: op.amount }]
        : [],
    );
}

/** The palette indices the scene's tint can take, neutral left out: the pinned one alone, or the map's
 *  dominant one and every index its scripts write, since a local write may grow to cover the map. */
function sceneTintCandidates(
  tints: Uint8Array,
  tintOps: readonly ScriptedCycleProbe[],
  pinnedIndex: number | null,
): readonly number[] {
  if (pinnedIndex !== null) return pinnedIndex === NEUTRAL_INDEX ? [] : [pinnedIndex];
  const dominant = dominantIndex(tints);
  const indices = new Set(tintOps.map((op) => op.index));
  if (dominant !== null) indices.add(dominant);
  indices.delete(NEUTRAL_INDEX);
  return [...indices];
}

/** Whether one of `candidates` lights the night lamps, unless the match turned off the script's own
 *  day and night, which holds the scene at daylight. */
function sceneTintReachesNight(
  candidates: readonly number[],
  tintOps: readonly ScriptedCycleProbe[],
  pinnedIndex: number | null,
  dayNight: DayNightMode,
  palette: readonly number[],
): boolean {
  const gradeOf = (index: number): LightGrade | null => {
    const color = palette[index];
    return color === undefined ? null : channels(color);
  };
  if (pinnedIndex === null && dayNight === 'off' && scriptsDayNightCycle(tintOps, gradeOf)) return false;
  return candidates.some((index) => {
    const grade = gradeOf(index);
    return grade !== null && nightLevel(grade) > 0;
  });
}

/**
 * Whether this world's scene light can fall to a night, where it composites the world through the lit
 * mask (`gpu/lighting/scene-light.ts`): the player's setting shows day and night, and the game's own
 * cycle runs, a siege can bring its attack night, or a whole-map tint the map holds or its scripts
 * write is dark enough to light the lamps. A cave's static dark counts, as does a weather darkening.
 * Turning the setting on mid-game is not foreseen.
 */
export async function worldCanShowNight(
  host: Pick<SessionHost, 'missions' | 'landscapeEdits' | 'mapEscalation'>,
  {
    pinnedIndex = null,
    dayNight = 'map',
    dayNightShown = true,
  }: Pick<ScriptTintOptions, 'pinnedIndex' | 'dayNight' | 'dayNightShown'>,
): Promise<boolean> {
  if (!dayNightShown) return false;
  if (dayNight === 'on' || host.mapEscalation() !== null) return true;
  try {
    const tintOps = scriptTintOps(host);
    const candidates = sceneTintCandidates((await host.landscapeEdits()).tints, tintOps, pinnedIndex);
    if (candidates.length === 0) return false;
    const palette = await loadVertexPalette();
    return palette !== null && sceneTintReachesNight(candidates, tintOps, pinnedIndex, dayNight, palette);
  } catch (err) {
    // Answered as no night: the first night then compiles its programs, as without the answer.
    diag.warn('boot', 'could not tell whether the world shows a night', err);
    return false;
  }
}

export async function mountScriptTints(
  host: Pick<SessionHost, 'missions' | 'landscapeEdits'>,
  surface: ScriptTintSurface,
  {
    pinnedIndex = null,
    dayNight = 'map',
    dayNightShown = true,
    weatherShown = true,
    tick = 0,
  }: ScriptTintOptions = {},
): Promise<ScriptTints> {
  const results = (host.missions?.missions ?? []).flatMap((mission) => mission.results);
  const tintOps = scriptTintOps(host);
  const scripted = tintOps.length > 0;
  const setsWeather = results.some((op) => op.opcode === 'SetWeather');
  let light: 'cycle' | 'weather' | 'fixed' | null = null;
  const scriptLight = (palette: readonly number[]): 'cycle' | 'weather' | 'fixed' => {
    light ??= scriptsDayNightCycle(tintOps, (index) => {
      const color = palette[index];
      return color === undefined ? null : channels(color);
    })
      ? 'cycle'
      : setsWeather && scriptsWeatherTints(tintOps, palette)
        ? 'weather'
        : 'fixed';
    return light;
  };
  let cycleShown = dayNightShown;
  let weatherOn = weatherShown;
  let step = cycleStepAtTick(tick);
  const ownCycle = dayNight === 'on';
  // The palette is fetched once, and only for a map with a tint or a light of the game's own to show.
  let paletteLoad: Promise<VertexPalette | null> | null = null;
  const paletteFor = (tints: Uint8Array): Promise<VertexPalette | null> => {
    if (paletteLoad === null) {
      const tinted =
        scripted || ownCycle || pinnedIndex !== null || tints.some((index) => index !== NEUTRAL_INDEX);
      paletteLoad = tinted ? loadVertexPalette() : Promise.resolve(null);
    }
    return paletteLoad;
  };
  let cellColors: Float32Array = new Float32Array(0);
  let nodeColors: Float32Array = new Float32Array(0);
  // Each answer is the whole tint state, so only the latest asked is applied, and none once disposed
  // or once the map proved to have no tint to show.
  let asked = 0;
  let disposed = false;
  let untinted = false;
  // The first answer applied is the state the world was loaded in, not a step to fade into, even
  // when a script's first-tick write made an earlier answer stale.
  let applied = false;
  const sync = (): void => {
    if (untinted) return;
    const request = ++asked;
    void host.landscapeEdits().then(async (edits) => {
      const palette = await paletteFor(edits.tints);
      untinted = palette === null;
      if (palette === null || request !== asked || disposed) return;
      const lit = scriptLight(palette);
      const held =
        (lit === 'cycle' && (dayNight === 'off' || !cycleShown)) || (lit === 'weather' && !weatherOn);
      const cycleColor =
        ownCycle && cycleShown && pinnedIndex === null && lit !== 'cycle' ? palette[step.index] : undefined;
      const split = splitScriptTints(
        edits.tints,
        palette,
        cellColors,
        (dominant) => pinnedIndex ?? (held ? NEUTRAL_INDEX : dominant),
        cycleColor === undefined ? null : channels(cycleColor),
      );
      cellColors = split.colors;
      nodeColors = cellColorsToCorners(cellColors, edits.tintColumns, nodeColors);
      surface.setSceneLight(split.scene, !applied);
      applied = true;
      surface.applyTerrainVertexColors(nodeColors);
    });
  };
  sync();
  return {
    onEvents: (events) => {
      if (events.some((event) => event.kind === 'missionVertexColor')) sync();
    },
    frame: (now) => {
      if (!ownCycle) return;
      const next = cycleStepAtTick(now);
      if (next === step) return;
      step = next;
      sync();
    },
    setDayNightShown: (next) => {
      if (next === cycleShown) return;
      cycleShown = next;
      sync();
    },
    setWeatherShown: (next) => {
      if (next === weatherOn) return;
      weatherOn = next;
      sync();
    },
    dispose: () => {
      disposed = true;
    },
  };
}
