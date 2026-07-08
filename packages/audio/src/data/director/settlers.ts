import type { Camera } from '@vinland/render/data';
import type { WorldSnapshot } from '@vinland/sim';
import { computeSpatial } from '../spatial.js';
import { entityTile } from './snapshot.js';

/**
 * One on-screen settler as a chatter candidate: its id, the spatialisation of a sound from it, and the
 * facts that classify its voice (so a male crowd sounds male).
 */
export interface OnScreenSettler {
  readonly entity: number;
  /** Stereo pan for a voice from this settler, -1..1. */
  readonly pan: number;
  /** Distance-attenuated gain for a voice from this settler, 0..1. */
  readonly gain: number;
  /** The settler's `jobType` (null when unemployed) — the sex split key (the mod's `woman` job is female). */
  readonly jobType: number | null;
  /** Whether the settler still carries an `Age` (a baby/child) — a young settler gets a child voice. */
  readonly young: boolean;
}

/**
 * The settlers currently on screen (a `Settler` component + an in-view `Position`), each with its
 * spatialisation — the PURE candidate list the voice-chatter layer picks from. Kept here (not in the
 * web layer) so the "who could speak" half stays headless-testable; the STOCHASTIC "who speaks now"
 * half lives in the impure {@link import('../../web/chatter.js').ChatterEmitter} (it needs randomness + time).
 */
export function onScreenSettlers(
  snapshot: WorldSnapshot,
  camera: Camera,
  canvasW: number,
  canvasH: number,
): OnScreenSettler[] {
  const out: OnScreenSettler[] = [];
  for (const e of snapshot.entities) {
    if (!('Settler' in e.components)) continue;
    const tile = entityTile(e.components);
    if (tile === null) continue;
    const spatial = computeSpatial(tile.col, tile.row, camera, canvasW, canvasH);
    if (spatial === null) continue;
    // Read the sex/age classifiers straight off the plain snapshot (Settler.jobType + Age-presence) — the
    // same facts render's roster join uses, so a settler sounds like the body it draws.
    const settler = e.components.Settler as { jobType?: unknown };
    const jobType = typeof settler.jobType === 'number' ? settler.jobType : null;
    out.push({ entity: e.id, pan: spatial.pan, gain: spatial.gain, jobType, young: 'Age' in e.components });
  }
  return out;
}
