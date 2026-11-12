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

const TAU = 2 * Math.PI;

/** The aura's slow breath: one swell every this many game seconds, between these shares of its full
 *  strength. Tuned by eye. */
const PULSE_SECONDS = 5;
const PULSE_LOW = 0.8;
const PULSE_HIGH = 1;

/** The share of its full strength a temple's aura shows at `seconds`, each temple breathing at its own
 *  phase from `seed`. */
export function templeGlowPulse(seconds: number, seed: number): number {
  const phase = seconds / PULSE_SECONDS + frac(seed, 0);
  const swell = 0.5 + 0.5 * Math.sin(TAU * phase);
  return PULSE_LOW + (PULSE_HIGH - PULSE_LOW) * swell;
}

/** Game seconds a crest takes from one crest's place to the next, and the radians a second the wall
 *  line's sway and the rays drift by. Tuned by eye. */
const CREST_SECONDS = 2.6;
const SWAY_DRIFT = 0.45;
const RAY_DRIFT = 0.3;

/** The aura's moving parts at `seconds`, each wrapped so a long game loses no precision on the GPU. */
export interface TempleAuraPhases {
  /** The crests' travel between two crest places, 0..1. */
  wave: number;
  /** The drift angles of the sway and the rays, radians in 0..TAU. */
  sway: number;
  rays: number;
}

export function templeAuraPhases(seconds: number, seed: number, out: TempleAuraPhases): TempleAuraPhases {
  out.wave = (seconds / CREST_SECONDS + frac(seed, 1)) % 1;
  out.sway = (seconds * SWAY_DRIFT + frac(seed, 2) * TAU) % TAU;
  out.rays = (seconds * RAY_DRIFT + frac(seed, 3) * TAU) % TAU;
  return out;
}

/** Motes of light rising off a blessing temple's wall line at once. */
export const TEMPLE_MOTES = 14;
/** The shortest and longest rise of a mote in game seconds. Tuned by eye. */
const MOTE_SECONDS_MIN = 2.4;
const MOTE_SECONDS_SPAN = 2.2;
/** How far a mote sways sideways as it rises, as a share of the wall line's half-width, and how many
 *  sways a rise holds. */
const MOTE_SWAY = 0.05;
const MOTE_SWAYS = 1.5;
/** The smallest mote's share of the largest. */
const MOTE_SIZE_MIN = 0.45;

/** One mote of light this frame. */
export interface TempleMote {
  /** Its place on the wall line's front half, in the line's half-widths: -1 the left end, 1 the right. */
  across: number;
  /** How far before the line's middle it stands, 0..1 of the line's half-depth. */
  before: number;
  /** Its rise, 0 on the ground to 1 at the top. */
  rise: number;
  /** Its strength and its size, each 0..1. */
  alpha: number;
  size: number;
}

/**
 * Mote `index` of a temple at `seconds`: it leaves the front of the wall line, where the house cannot
 * hide it, rises swaying and fades, then leaves again from another place. A function of the clock
 * alone, so a pause holds it and a capture repeats.
 */
export function templeMote(seconds: number, seed: number, index: number, out: TempleMote): TempleMote {
  const slot = seed + Math.imul(index + 1, TEMPLE_MOTES);
  const life = seconds / (MOTE_SECONDS_MIN + MOTE_SECONDS_SPAN * frac(slot, 0)) + frac(slot, 1);
  const rise = life % 1;
  const born = slot + Math.floor(life);
  const along = Math.PI * frac(born, 2);
  out.across = Math.cos(along) + MOTE_SWAY * Math.sin(TAU * (MOTE_SWAYS * rise + frac(born, 3)));
  out.before = Math.sin(along);
  out.rise = rise;
  out.alpha = Math.sin(Math.PI * rise) ** 2;
  out.size = MOTE_SIZE_MIN + (1 - MOTE_SIZE_MIN) * frac(born, 4);
  return out;
}
