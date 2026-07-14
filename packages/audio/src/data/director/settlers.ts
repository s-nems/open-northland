import type { Camera } from '@open-northland/render/data';
import type { WorldSnapshot } from '@open-northland/sim';
import { computeSpatial } from '../spatial.js';
import { entityTile } from './snapshot.js';

/**
 * One on-screen settler as a chatter candidate: its id, the spatialisation of a sound from it, and the
 * facts that classify its voice.
 */
export interface OnScreenSettler {
  readonly entity: number;
  /** Stereo pan for a voice from this settler, -1..1. */
  readonly pan: number;
  /** Distance-attenuated gain for a voice from this settler, 0..1. */
  readonly gain: number;
  /** The settler's `jobType` (null when unemployed) — the sex split key. */
  readonly jobType: number | null;
  /** Whether the settler still carries an `Age` (a baby/child) — a young settler gets a child voice. */
  readonly young: boolean;
}

/**
 * The settlers currently on screen (a `Settler` component + an in-view `Position`), each with its
 * spatialisation — the pure candidate list the voice-chatter layer picks from. The stochastic "who
 * speaks now" half is the impure {@link import('../../web/chatter.js').ChatterEmitter}.
 */
export function onScreenSettlers(
  snapshot: WorldSnapshot,
  camera: Camera,
  canvasW: number,
  canvasH: number,
  visibleTile?: (col: number, row: number) => boolean,
): OnScreenSettler[] {
  const out: OnScreenSettler[] = [];
  for (const e of snapshot.entities) {
    if (!('Settler' in e.components)) continue;
    const tile = entityTile(e.components);
    if (tile === null) continue;
    // Fog-of-war gate (absent = no fog): a settler the viewer cannot see must not speak.
    if (visibleTile !== undefined && !visibleTile(tile.col, tile.row)) continue;
    const spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
    if (spatial === null) continue;
    // Read the sex/age classifiers off the plain snapshot (Settler.jobType + Age-presence).
    const settler = e.components.Settler as { jobType?: unknown };
    const jobType = typeof settler.jobType === 'number' ? settler.jobType : null;
    out.push({ entity: e.id, pan: spatial.pan, gain: spatial.gain, jobType, young: 'Age' in e.components });
  }
  return out;
}
