import { indexesOf, type SnapshotIndexSpec, type WorldSnapshot } from '@open-northland/sim';
import { frac } from '../effects/random.js';

/** Whether a temple blesses the people around it this tick (its `TempleFire.blessing`); undefined for an
 *  entity the sim keeps no temple fire on, such as the headquarters. */
export function readTempleBlessing(components: Readonly<Record<string, unknown>>): boolean | undefined {
  const fire = components.TempleFire as { readonly blessing?: unknown } | undefined;
  return typeof fire?.blessing === 'boolean' ? fire.blessing : undefined;
}

const BLESSING_TEMPLES: SnapshotIndexSpec<Set<number>> = {
  name: 'blessing temples',
  reads: { values: ['TempleFire'] },
  empty: () => new Set(),
  add: (ids, entity) => {
    if (readTempleBlessing(entity.components) === true) ids.add(entity.id);
  },
  remove: (ids, entity) => {
    ids.delete(entity.id);
  },
  replace: (ids, _previous, next) => {
    if (readTempleBlessing(next.components) === true) ids.add(next.id);
    else ids.delete(next.id);
  },
};

/** The temples blessing this tick, kept per change: a player's temples are few, so a frame walks them
 *  all and culls each. A mirror edits the set in place as it advances, so read it within the frame. */
export function blessingTemplesOf(snapshot: WorldSnapshot): ReadonlySet<number> {
  return indexesOf(snapshot).get(BLESSING_TEMPLES);
}

/** The glow's slow breath: one swell every this many game seconds, between these shares of its full
 *  strength. Tuned by eye. */
const PULSE_SECONDS = 4;
const PULSE_LOW = 0.55;
const PULSE_HIGH = 1;

/** The share of its full strength a temple's glow shows at `seconds`, each temple breathing at its own
 *  phase from `seed`. */
export function templeGlowPulse(seconds: number, seed: number): number {
  const phase = seconds / PULSE_SECONDS + frac(seed, 0);
  const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
  return PULSE_LOW + (PULSE_HIGH - PULSE_LOW) * swell;
}
