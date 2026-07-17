import { readNumField, readNumFieldOrNull } from '../../snapshot/index.js';
import type { SpriteState } from '../draw-item.js';

/**
 * Per-settler (unit) component reads: coarse state, cargo, the atomic it runs, its job/weapon/owner.
 * Pure, total decoders — a missing or malformed component reads as its absent value.
 */

/**
 * The atomic id a snapshot entity is mid-execution on, or `null` — `CurrentAtomic.atomicId`, the same
 * numeric id the sim stores as the `setatomic` animation join key.
 */
export function readActingAtomic(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'CurrentAtomic', 'atomicId');
}

/**
 * The whole ticks the settler has executed in its current atomic — the sim's `CurrentAtomic.elapsed`
 * (a plain integer, no fixed-point rescale). The action's animation clock: a directional swing advances
 * at a fixed cadence over these ticks, so its speed never depends on the action's duration. `null` when
 * not mid-atomic.
 */
export function readAtomicElapsed(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'CurrentAtomic', 'elapsed');
}

/**
 * The entity a settler's current atomic acts on — `CurrentAtomic.targetEntity` (the enemy it swings at,
 * the resource it harvests). The scene builder looks up the target's live position to face an attacker at
 * it during a stationary swing; the id, not a snapshot of its tile, is the stable handle because targets
 * move. `null` when the settler runs no atomic or its atomic has no entity target.
 * (`CurrentAtomic.targetTile` stays sim-internal and is never populated today, so it is not read.)
 */
export function readAtomicTargetEntity(components: Readonly<Record<string, unknown>>): number | null {
  return readNumFieldOrNull(components, 'CurrentAtomic', 'targetEntity');
}

/**
 * The store a settler's running atomic exchanges goods with — the `pileup` deposit's `store` or the
 * `pickup` lift's `from` — or `null` for any other/no atomic. The scene builder hides a settler whose
 * exchange partner is a completed building for the atomic's duration: the original's carrier walks into
 * the house and vanishes for the exchange (observed), rather than pantomiming the deposit at the door.
 */
export function readStoreExchangeRef(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { effect?: unknown } | undefined;
  const effect = a?.effect as { kind?: unknown; store?: unknown; from?: unknown } | undefined;
  if (effect === undefined || effect === null) return null;
  if (effect.kind === 'pileup' && typeof effect.store === 'number') return effect.store;
  if (effect.kind === 'pickup' && typeof effect.from === 'number') return effect.from;
  return null;
}

/**
 * Whether the sim stamped the `Engagement` marker on a settler (it is advancing on or fighting an enemy).
 * A render fact orthogonal to {@link readSpriteState}: a binding reads it to pick the readied
 * `..._agressive` gait ({@link import('../draw-item.js').DrawItem.engaged}). Presence is the whole signal
 * — the marker's `repathAt` field is sim-internal, never read here.
 */
export function readEngaged(components: Readonly<Record<string, unknown>>): boolean {
  return 'Engagement' in components;
}

/**
 * Derive a sprite's coarse {@link SpriteState} from its snapshot components, in priority order:
 * mid-atomic (`CurrentAtomic`) ⇒ `acting`, else in transit (a live path or a pending goal) ⇒ `moving`,
 * else `idle`. Acting wins over moving because a settler that started an atomic has stopped to act even
 * if a stale path lingers.
 *
 * "In transit" is more than a live {@link PathFollow}: a unit re-issuing its route drops the PathFollow
 * for a tick while it still holds a {@link MoveGoal} / a freshly-queued {@link PathRequest} — most
 * visibly a combat chaser, which re-paths toward a moving enemy every few ticks (systems/conflict
 * `REPATH_CADENCE`). Treating that gap as `idle` drops the walk animation to the standing pose for a
 * frame each tile. A failed PathRequest is the opposite case: the goal is unreachable and the unit is
 * genuinely stuck, so it stays `idle` rather than moonwalk in place.
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
 * What a snapshot settler is hauling — the `Carrying` component's `goodType` (the sim adds the component
 * on harvest, removes it on deposit), or `null` when it carries nothing. Orthogonal to
 * {@link readSpriteState} so a binding can pick the loaded gait (and the per-good look) while the settler
 * still reads as `moving`/`acting`. A present-but-malformed component still reads as carrying (goodType
 * `undefined` → the generic loaded look).
 */
export function readCarrying(components: Readonly<Record<string, unknown>>): { goodType?: number } | null {
  const c = components.Carrying as { goodType?: unknown } | undefined;
  if (c === undefined) return null;
  return typeof c.goodType === 'number' ? { goodType: c.goodType } : {};
}

/**
 * A settler's `Settler.jobType` — the per-character body/head join key
 * ({@link import('../draw-item.js').DrawItem.jobType}) — or `undefined` for a jobless (`null`) settler /
 * malformed component (the binding then falls back to its default look).
 */
export function readJobType(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Settler', 'jobType');
}

/**
 * The `typeId` of the good in a settler's `Equipment.weapon` slot ({@link import('../draw-item.js').DrawItem.weaponGood}),
 * so the drawn warrior weapon follows the equipment slot. `undefined` when the settler has no `Equipment`
 * component or its weapon slot is empty/malformed (the binding then falls back to the `jobType` look).
 */
export function readEquipmentWeaponGood(components: Readonly<Record<string, unknown>>): number | undefined {
  const eq = components.Equipment as { weapon?: { goodType?: unknown } | null } | undefined;
  const goodType = eq?.weapon?.goodType;
  return typeof goodType === 'number' ? goodType : undefined;
}

/**
 * The owning player slot of a settler — the sim `Owner.player`, the render team-colour key
 * ({@link import('../draw-item.js').DrawItem.player}). `undefined` when the settler carries no `Owner`
 * (wildlife / a neutral fixture), which the renderer draws in the base palette.
 */
export function readOwnerPlayer(components: Readonly<Record<string, unknown>>): number | undefined {
  return readNumField(components, 'Owner', 'player');
}
