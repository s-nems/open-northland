import { VERTEX_PALETTE_ENTRIES, type VertexPalette } from '@open-northland/data';
import { type LightGrade, NEUTRAL_GRADE } from '@open-northland/render/data';
import type { SimEvent } from '@open-northland/sim';
import { loadVertexPalette } from '../../content/vertex-palette.js';
import type { SessionHost } from '../../session/index.js';

/** Share of the map's nodes one palette index must cover to be the scene's tint rather than a local one. */
export const WHOLE_MAP_SHARE = 0.6;
/** The palette entry a node never tinted holds: neutral grey. */
const NEUTRAL_INDEX = 0;
/** vertexcolors.pcx channels use 128 as neutral and multiply the lit colour. */
const NEUTRAL_CHANNEL = 128;
/** A scene channel this dark or darker divides a local tint as one palette step, not as zero. */
const MIN_SCENE_CHANNEL = 1 / NEUTRAL_CHANNEL;
const RGB = 3;

/** A script's tint state, split into what grades the whole scene and what stays on the ground. */
export interface ScriptTintSplit {
  /** The palette colour the whole-map tint asks for; null for daylight or no whole-map tint. */
  readonly scene: LightGrade | null;
  /** RGB terrain multipliers per node id over the scene's multiply, which is {@link scene} clamped
   *  to 1; a node of the whole-map tint is 1, so the ground brightens only as the scene pass does. */
  readonly colors: Float32Array;
}

function channels(color: number): LightGrade {
  return [
    ((color >>> 16) & 255) / NEUTRAL_CHANNEL,
    ((color >>> 8) & 255) / NEUTRAL_CHANNEL,
    (color & 255) / NEUTRAL_CHANNEL,
  ];
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
 * is the colour the script asked for. The dominant index and the neutral entry leave the ground at 1.
 * `pinned` replaces the dominant index (`?tint=`); `out` is reused when it fits.
 */
export function splitScriptTints(
  tints: Uint8Array,
  palette: readonly number[],
  out?: Float32Array,
  pinned: number | null = null,
): ScriptTintSplit {
  const colors = out?.length === tints.length * RGB ? out : new Float32Array(tints.length * RGB);
  const sceneIndex = pinned ?? dominantIndex(tints);
  const sceneColor = sceneIndex === null ? undefined : palette[sceneIndex];
  const scene = sceneIndex !== NEUTRAL_INDEX && sceneColor !== undefined ? channels(sceneColor) : null;
  const grade = scene ?? NEUTRAL_GRADE;
  const byIndex = new Float32Array(VERTEX_PALETTE_ENTRIES * RGB);
  for (let index = 0; index < VERTEX_PALETTE_ENTRIES; index++) {
    const color = palette[index];
    const local =
      index === NEUTRAL_INDEX || index === sceneIndex || color === undefined ? null : channels(color);
    for (let c = 0; c < RGB; c++) {
      const channel = grade[c] ?? 1;
      byIndex[index * RGB + c] =
        local === null ? 1 : (local[c] ?? 1) / Math.max(MIN_SCENE_CHANNEL, Math.min(1, channel));
    }
  }
  for (let node = 0; node < tints.length; node++) {
    const from = (tints[node] ?? NEUTRAL_INDEX) * RGB;
    const to = node * RGB;
    colors[to] = byIndex[from] ?? 1;
    colors[to + 1] = byIndex[from + 1] ?? 1;
    colors[to + 2] = byIndex[from + 2] ?? 1;
  }
  return { scene, colors };
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
  readonly dispose: () => void;
}

export interface ScriptTintOptions {
  /** `?tint=`: the palette index held as the whole-map tint in this view. */
  readonly pinnedIndex?: number | null;
}

export async function mountScriptTints(
  host: Pick<SessionHost, 'missions' | 'landscapeEdits'>,
  surface: ScriptTintSurface,
  { pinnedIndex = null }: ScriptTintOptions = {},
): Promise<ScriptTints> {
  const scripted =
    host.missions?.missions.some((mission) =>
      mission.results.some((op) => op.opcode === 'SetVertexColor' || op.opcode === 'SetVertexColorOnLand'),
    ) === true;
  // The palette is fetched once, and only for a map whose author or script tints a node.
  let paletteLoad: Promise<VertexPalette | null> | null = null;
  const paletteFor = (tints: Uint8Array): Promise<VertexPalette | null> => {
    if (paletteLoad === null) {
      const tinted = scripted || pinnedIndex !== null || tints.some((index) => index !== NEUTRAL_INDEX);
      paletteLoad = tinted ? loadVertexPalette() : Promise.resolve(null);
    }
    return paletteLoad;
  };
  let colors: Float32Array = new Float32Array(0);
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
      const split = splitScriptTints(edits.tints, palette, colors, pinnedIndex);
      colors = split.colors;
      surface.setSceneLight(split.scene, !applied);
      applied = true;
      surface.applyTerrainVertexColors(colors);
    });
  };
  sync();
  return {
    onEvents: (events) => {
      if (events.some((event) => event.kind === 'missionVertexColor')) sync();
    },
    dispose: () => {
      disposed = true;
    },
  };
}
