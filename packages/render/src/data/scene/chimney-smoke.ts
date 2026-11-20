import { indexesOf, type SnapshotIndexSpec, type WorldSnapshot } from '@open-northland/sim';
import { clamp01 } from '../math.js';
import { countTarget, moveTarget } from './snapshot-index.js';
import { readCraftWorkplace } from './snapshot-readers/index.js';

/** The fire under a chimney: a house's hearth, or the forge a workshop burns for its craft. */
export type ChimneySmokeKind = 'hearth' | 'forge';

/** A chimney's top opening on a building body, in bob-anchor px (+y down), and the fire under it. */
export interface ChimneyPoint {
  readonly x: number;
  readonly y: number;
  readonly smoke: ChimneySmokeKind;
}

/** The chimneys drawn on the body `bob` of atlas `layer`; a body with none, or one the content places
 *  none on, has no entry. An absent `layer` is the building kind's default atlas. */
export type ChimneyLookup = (layer: string | undefined, bob: number) => readonly ChimneyPoint[] | undefined;

/** The building whose fire a settler tends this tick: the workplace it crafts inside, or the house it
 *  eats a meal of. */
function tendedHearthOf(components: Readonly<Record<string, unknown>>): number | null {
  const workplace = readCraftWorkplace(components);
  if (workplace !== null) return workplace;
  const effect = (components.CurrentAtomic as { effect?: { kind?: unknown; from?: unknown } } | undefined)
    ?.effect;
  return effect?.kind === 'eat' && typeof effect.from === 'number' ? effect.from : null;
}

const TENDED_HEARTHS: SnapshotIndexSpec<Map<number, number>> = {
  name: 'tended hearths',
  reads: { values: ['CurrentAtomic'] },
  empty: () => new Map(),
  add: (counts, entity) => countTarget(counts, tendedHearthOf(entity.components), 1),
  remove: (counts, entity) => countTarget(counts, tendedHearthOf(entity.components), -1),
  replace: (counts, previous, next) =>
    moveTarget(counts, tendedHearthOf(previous.components), tendedHearthOf(next.components)),
};

/** Each building someone crafts inside or eats a meal of this tick, with how many do, kept per change.
 *  A mirror edits the map in place as it advances, so read it within the frame. */
export function tendedHearthsOf(snapshot: WorldSnapshot): ReadonlyMap<number, number> {
  return indexesOf(snapshot).get(TENDED_HEARTHS);
}

/** Sim ticks a cold chimney takes to draw fully once its fire is tended, a hot one keeps smoking at
 *  full strength after the last settler stops, and it then takes to die down. The hold bridges the walks
 *  between two crafts, so a busy workshop smokes without a break. Our choice, tuned by eye. */
export const CHIMNEY_KINDLE_TICKS = 30;
export const CHIMNEY_HOLD_TICKS = 180;
export const CHIMNEY_COOL_TICKS = 120;

/** One chimney fire's state between frames. */
export interface ChimneyFire {
  /** How strongly the chimney smokes, 0..1. */
  draught: number;
  /** Ticks of full smoke left after the tending stopped. */
  hold: number;
}

/** Advance `fire` by `ticks` (never backwards): tending kindles it, neglect holds and then cools it. */
export function stokeChimney(fire: ChimneyFire, tended: boolean, ticks: number): void {
  const dt = Math.max(0, ticks);
  if (tended) {
    fire.draught = clamp01(fire.draught + dt / CHIMNEY_KINDLE_TICKS);
    fire.hold = CHIMNEY_HOLD_TICKS;
    return;
  }
  const held = Math.min(fire.hold, dt);
  fire.hold -= held;
  fire.draught = clamp01(fire.draught - (dt - held) / CHIMNEY_COOL_TICKS);
}
