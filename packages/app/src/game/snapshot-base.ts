import type { Fixed, WorldSnapshot } from '@open-northland/sim';

/**
 * Typed read helpers over the frozen {@link WorldSnapshot} — the shared owner/position/kind reads the
 * controls and panels all need, so they stop re-inventing the same `as {...}` casts per file (display
 * panels still cast their own presentation-only fields, e.g. the details panel's needs/carry/stance).
 * These read the snapshot (the allowed one-way flow), never live component stores; every read is
 * defensive (`undefined` on a missing component/field) because a snapshot entity carries only the
 * components it has.
 */

/** One serialized entity of a snapshot. */
export type SnapshotEntity = WorldSnapshot['entities'][number];

/** The entity with `id`, or undefined (linear — panels only resolve the selected few). */
export function entityById(snapshot: WorldSnapshot, id: number): SnapshotEntity | undefined {
  return snapshot.entities.find((e) => e.id === id);
}

/** Narrow an unknown component field to a number, else undefined. */
export function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** The owning player of an entity (its `Owner.player`), or undefined for a neutral/unowned entity. */
export function ownerPlayerOf(e: SnapshotEntity): number | undefined {
  const owner = e.components.Owner as { player?: unknown } | undefined;
  return num(owner?.player);
}

/** The entity's fixed-point `Position`, or undefined. The snapshot serializes the sim's branded
 *  `Fixed` values as plain numbers; this reader is the one place the brand is restored (by the
 *  sim's own invariant a snapshot Position is fixed-point), so consumers can feed grid seams like
 *  `nodeOfPosition` without minting the brand themselves. */
export function positionOf(e: SnapshotEntity): { x: Fixed; y: Fixed } | undefined {
  const pos = e.components.Position as { x?: unknown; y?: unknown } | undefined;
  const x = num(pos?.x);
  const y = num(pos?.y);
  return x !== undefined && y !== undefined ? { x: x as Fixed, y: y as Fixed } : undefined;
}

/** Whether profession progression gates trades — the `ProgressionRules` singleton in the snapshot;
 *  an absent singleton means the sim default (enabled), mirroring the sim-side reader. */
export function professionProgressionEnabledIn(snapshot: WorldSnapshot): boolean {
  for (const e of snapshot.entities) {
    const rules = e.components.ProgressionRules as { professionProgressionEnabled?: unknown } | undefined;
    if (rules !== undefined) return rules.professionProgressionEnabled !== false;
  }
  return true;
}

/** Whether `player`'s seat is AI-driven — an `AiPlayer` carrier for it in the snapshot. */
export function isAiPlayerIn(snapshot: WorldSnapshot, player: number): boolean {
  return snapshot.entities.some((e) => {
    const ai = e.components.AiPlayer as { player?: unknown } | undefined;
    return ai !== undefined && num(ai.player) === player;
  });
}

/** Whether the experience tech tree gates this settler's trades and wares — the app mirror of the sim's
 *  `experienceGatesApply`: the `ProgressionRules` toggle, except that an AI-owned settler is never gated
 *  (the toggle is a human-player setting). Read once per model build; the menus filter off it. */
export function progressionGatesSettler(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  if (!professionProgressionEnabledIn(snapshot)) return false;
  const owner = ownerPlayerOf(e);
  return owner === undefined || !isAiPlayerIn(snapshot, owner);
}

/** A settler's `Settler.experience` map as the snapshot serializes it (sorted `[spec, points]` pairs)
 *  parsed into a Map — shared by the panel's experience rows, its unlock forecast, and the profession
 *  picker's qualification filter. Empty for a non-settler or a malformed field. */
export function settlerExperienceOf(components: Readonly<Record<string, unknown>>): Map<number, number> {
  const points = new Map<number, number>();
  const exp = (components.Settler as { experience?: unknown } | undefined)?.experience;
  if (!Array.isArray(exp)) return points;
  for (const pair of exp) {
    if (!Array.isArray(pair)) continue;
    const spec = num(pair[0]);
    const value = num(pair[1]);
    if (spec !== undefined && value !== undefined) points.set(spec, value);
  }
  return points;
}

/** True when the entity is a settler / a building (carries the marker component). */
export function isSettler(e: SnapshotEntity): boolean {
  return e.components.Settler !== undefined;
}
export function isBuilding(e: SnapshotEntity): boolean {
  return e.components.Building !== undefined;
}
export function isSignpost(e: SnapshotEntity): boolean {
  return e.components.Signpost !== undefined;
}
/** The `buildingType` typeId of a building entity, or undefined if it isn't one / carries none. */
export function buildingTypeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { buildingType?: unknown } | undefined;
  return num(b?.buildingType);
}

/** The building's tribe (`Building.tribe`), or undefined if it isn't one / carries none. */
export function buildingTribeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { tribe?: unknown } | undefined;
  return num(b?.tribe);
}

/** The building's construction progress (`Building.built`, fixed-point — `ONE` is finished), or
 *  undefined if it isn't a building / carries none. */
export function builtFractionOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { built?: unknown } | undefined;
  return num(b?.built);
}

/** The settler's current trade (`Settler.jobType`), or undefined for a jobless/idle settler (jobType
 *  `null`) or a non-settler. Drives the right-click "keep the current trade" assignment preference. */
export function settlerJobType(e: SnapshotEntity): number | undefined {
  const s = e.components.Settler as { jobType?: unknown } | undefined;
  return num(s?.jobType);
}

/** The building a settler is employed at (`JobAssignment.workplace`), or undefined when unbound. */
export function workplaceOf(e: SnapshotEntity): number | undefined {
  const a = e.components.JobAssignment as { workplace?: unknown } | undefined;
  return num(a?.workplace);
}

/** The drop-off flag entity a gatherer carries (its `WorkFlag.flag`), or undefined for a non-gatherer. */
export function workFlagOf(e: SnapshotEntity): number | undefined {
  const wf = e.components.WorkFlag as { flag?: unknown } | undefined;
  return num(wf?.flag);
}

/** The settler's tribe (`Settler.tribe`), or undefined for a non-settler. */
export function settlerTribeOf(e: SnapshotEntity): number | undefined {
  const settler = e.components.Settler as { tribe?: unknown } | undefined;
  return num(settler?.tribe);
}

/** The settler's hunger/fatigue deficits (fixed-point 0..ONE, higher = worse), or undefined for a
 *  non-settler — the need-bubble projection's read. The brand restore mirrors {@link positionOf}. */
export function settlerNeedsOf(e: SnapshotEntity): { hunger: Fixed; fatigue: Fixed } | undefined {
  const settler = e.components.Settler as { hunger?: unknown; fatigue?: unknown } | undefined;
  const hunger = num(settler?.hunger);
  const fatigue = num(settler?.fatigue);
  return hunger !== undefined && fatigue !== undefined
    ? { hunger: hunger as Fixed, fatigue: fatigue as Fixed }
    : undefined;
}

/**
 * Map each gatherer's drop-off flag entity → its owning gatherer, for the human `player` only
 * (`'any'` — the observer session — keeps every player's gatherers) — the inverse of the
 * gatherer→flag {@link workFlagOf} edge (a flag stores no back-reference, so resolving
 * "which gatherer owns this flag" needs this scan). Lets a click on a flag resolve to the gatherer to
 * select. A gatherer binds to exactly one flag, so the map is 1:1.
 */
export function gathererByFlag(snapshot: WorldSnapshot, player: number | 'any'): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of snapshot.entities) {
    if (player !== 'any' && ownerPlayerOf(e) !== player) continue;
    const flag = workFlagOf(e);
    if (flag !== undefined) out.set(flag, e.id);
  }
  return out;
}
