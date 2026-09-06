import { readNumField, readNumFieldOrNull } from '../../snapshot/index.js';
import type { SpriteState } from '../draw-item.js';

/** The atomic a settler is mid-execution on (`CurrentAtomic.atomicId`, the `setatomic` animation join
 *  key), or `null` when it runs none. */
export function readActingAtomic(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'CurrentAtomic', 'atomicId');
}

/** Whole ticks executed in the current atomic (`CurrentAtomic.elapsed`, a plain integer with no
 *  fixed-point rescale), or `null` when not mid-atomic. */
export function readAtomicElapsed(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'CurrentAtomic', 'elapsed');
}

/**
 * The entity a settler's current atomic acts on (`CurrentAtomic.targetEntity`), or `null` when it runs
 * no atomic or its atomic has no entity target. The id rather than the target's tile, because the
 * target moves and the scene resolves its live position each frame.
 */
export function readAtomicTargetEntity(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'CurrentAtomic', 'targetEntity');
}

/** The store a settler's running atomic exchanges goods with, or `null` for any other or no atomic. */
export function readStoreExchangeRef(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { effect?: unknown } | undefined;
  const effect = a?.effect as { kind?: unknown; store?: unknown; from?: unknown } | undefined;
  if (effect === undefined || effect === null) return null;
  if (effect.kind === 'pileup' && typeof effect.store === 'number') return effect.store;
  if (effect.kind === 'pickup' && typeof effect.from === 'number') return effect.from;
  return null;
}

export interface CraftPerformance {
  readonly workplace: number;
  readonly elapsed: number;
  readonly duration: number;
}

/** A settler's running craft: the workplace it is inside and the clip clock an in-house program reads,
 *  or `null` when its atomic is anything else. */
export function readCraftPerformance(components: Readonly<Record<string, unknown>>): CraftPerformance | null {
  const a = components.CurrentAtomic as
    | { effect?: { kind?: unknown }; targetEntity?: unknown; elapsed?: unknown; duration?: unknown }
    | undefined;
  if (a?.effect?.kind !== 'produce') return null;
  const { targetEntity, elapsed, duration } = a;
  if (typeof targetEntity !== 'number' || typeof elapsed !== 'number' || typeof duration !== 'number') {
    return null;
  }
  return { workplace: targetEntity, elapsed, duration };
}

/** Whether a settler carries the `Engagement` marker (advancing on or fighting an enemy). Presence is
 *  the whole signal; the marker's `repathAt` field stays sim-internal. */
export function readEngaged(components: Readonly<Record<string, unknown>>): boolean {
  return 'Engagement' in components;
}

/**
 * A sprite's coarse state. `acting` wins over `moving`: a settler that began an atomic has stopped to
 * act even if a stale path lingers. "In transit" is wider than a live `PathFollow` - a unit re-issuing
 * its route drops that component for a tick while it still holds a `MoveGoal` or a queued
 * `PathRequest`, and reading the gap as `idle` drops the walk to the standing pose once per tile. A
 * *failed* `PathRequest` is the opposite case: the goal is unreachable, so the unit stays `idle`.
 */
export function readSpriteState(components: Readonly<Record<string, unknown>>): SpriteState {
  if (readActingAtomic(components) !== null) return 'acting';
  if ('PathFollow' in components) return 'moving';
  const req = components.PathRequest as { failed?: unknown } | undefined;
  if (req !== undefined) return req.failed === true ? 'idle' : 'moving';
  if ('MoveGoal' in components) return 'moving';
  return 'idle';
}

/**
 * What a settler is hauling (`Carrying.goodType`), or `null` when it carries nothing. A present but
 * malformed component still reads as carrying, with no `goodType` - the generic loaded look.
 */
export function readCarrying(components: Readonly<Record<string, unknown>>): { goodType?: number } | null {
  const c = components.Carrying as { goodType?: unknown } | undefined;
  if (c === undefined) return null;
  return typeof c.goodType === 'number' ? { goodType: c.goodType } : {};
}

/** A settler's `Settler.jobType`, the per-character body/head join key, or `undefined` for a jobless
 *  settler. */
export function readJobType(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Settler', 'jobType');
}

/** A settler's `Settler.tribe`: its civilization's look table, or the species key for a wildlife entity. */
export function readSettlerTribe(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Settler', 'tribe');
}

/**
 * The good in a settler's `Equipment.weapon` slot. Tri-state: `undefined` when it carries no
 * `Equipment` at all (the `jobType` look stands), `null` when the slot is empty or malformed (a warrior
 * job then draws bare-handed), else the worn weapon's good id.
 */
export function readEquipmentWeaponGood(
  components: Readonly<Record<string, unknown>>,
): number | null | undefined {
  return readEquipSlotGood(components, 'weapon');
}

/** {@link readEquipmentWeaponGood}'s twin for the `Equipment.armor` slot, same tri-state. */
export function readEquipmentArmorGood(
  components: Readonly<Record<string, unknown>>,
): number | null | undefined {
  return readEquipSlotGood(components, 'armor');
}

/** The shared tri-state slot read behind the two readers above. */
function readEquipSlotGood(
  components: Readonly<Record<string, unknown>>,
  slot: 'weapon' | 'armor',
): number | null | undefined {
  const eq = components.Equipment as
    | Partial<Record<'weapon' | 'armor', { goodType?: unknown } | null>>
    | undefined;
  if (eq === undefined) return undefined;
  const goodType = eq[slot]?.goodType;
  return typeof goodType === 'number' ? goodType : null;
}

/** The owning player slot (`Owner.player`), the team-colour key, or `undefined` for an unowned settler
 *  (wildlife, a neutral fixture) that draws in the base palette. */
export function readOwnerPlayer(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Owner', 'player');
}
