import { type Fixed, ONE, type WorldSnapshot } from '@open-northland/sim';

// Typed read helpers over the frozen WorldSnapshot, never over live component stores. Every read returns
// `undefined` for a missing component or field, because a snapshot entity carries only the components it
// has.

export type SnapshotEntity = WorldSnapshot['entities'][number];

export function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

export function ownerPlayerOf(e: SnapshotEntity): number | undefined {
  const owner = e.components.Owner as { player?: unknown } | undefined;
  return num(owner?.player);
}

/** The snapshot serializes `Fixed` as plain numbers; this reader restores the brand. */
export function positionOf(e: SnapshotEntity): { x: Fixed; y: Fixed } | undefined {
  const pos = e.components.Position as { x?: unknown; y?: unknown } | undefined;
  const x = num(pos?.x);
  const y = num(pos?.y);
  return x !== undefined && y !== undefined ? { x: x as Fixed, y: y as Fixed } : undefined;
}

export function healthOf(e: SnapshotEntity): { hitpoints: number; max: number } | undefined {
  const health = e.components.Health as { hitpoints?: unknown; max?: unknown } | undefined;
  const hitpoints = num(health?.hitpoints);
  const max = num(health?.max);
  return hitpoints !== undefined && max !== undefined ? { hitpoints, max } : undefined;
}

/**
 * Whether the experience tech tree gates this settler's trades and wares: the app mirror of the sim's
 * `experienceGatesApply`. The `ProgressionRules` toggle is a human-player setting, so an AI-owned
 * settler is never gated.
 */
export function progressionGatesSettler(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  const { progressionEnabled, aiSeats } = worldRuleFacts(snapshot);
  if (!progressionEnabled) return false;
  const owner = ownerPlayerOf(e);
  return owner === undefined || !aiSeats.has(owner);
}

/** Whether the needs mechanic runs, so a surface can drop what the rule has stopped moving. */
export function needsRuleEnabled(snapshot: WorldSnapshot): boolean {
  return worldRuleFacts(snapshot).needsEnabled;
}

/** Keyed by snapshot: a snapshot is a frozen per-frame value, so an entry lives exactly one frame. */
const RULE_FACTS = new WeakMap<WorldSnapshot, WorldRuleFacts>();

interface WorldRuleFacts {
  /** The `ProgressionRules` singleton's toggle; an absent singleton means the sim default (enabled). */
  readonly progressionEnabled: boolean;
  /** The `WorldRules` singleton's needs toggle; an absent singleton means the sim default (enabled). */
  readonly needsEnabled: boolean;
  /** The player slots driven by the strategic AI (their `AiPlayer` carriers). */
  readonly aiSeats: ReadonlySet<number>;
}

/** The world-wide facts a HUD surface consults, resolved in one pass over the snapshot. Each rule stays
 *  null until its first carrier decides it, so a later duplicate cannot overwrite the winner. */
function worldRuleFacts(snapshot: WorldSnapshot): WorldRuleFacts {
  const cached = RULE_FACTS.get(snapshot);
  if (cached !== undefined) return cached;
  const aiSeats = new Set<number>();
  let progressionEnabled: boolean | null = null;
  let needsEnabled: boolean | null = null;
  for (const e of snapshot.entities) {
    const progression = e.components.ProgressionRules as
      | { professionProgressionEnabled?: unknown }
      | undefined;
    if (progression !== undefined && progressionEnabled === null) {
      progressionEnabled = progression.professionProgressionEnabled !== false;
    }
    const needs = e.components.WorldRules as { needsEnabled?: unknown } | undefined;
    if (needs !== undefined && needsEnabled === null) needsEnabled = needs.needsEnabled !== false;
    const seat = num((e.components.AiPlayer as { player?: unknown } | undefined)?.player);
    if (seat !== undefined) aiSeats.add(seat);
  }
  const facts: WorldRuleFacts = {
    progressionEnabled: progressionEnabled ?? true,
    needsEnabled: needsEnabled ?? true,
    aiSeats,
  };
  RULE_FACTS.set(snapshot, facts);
  return facts;
}

/** The snapshot serializes `Settler.experience` as sorted `[spec, points]` pairs. Empty for a non-settler
 *  or a malformed field. */
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

export function isSettler(e: SnapshotEntity): boolean {
  return e.components.Settler !== undefined;
}
export function isBuilding(e: SnapshotEntity): boolean {
  return e.components.Building !== undefined;
}
export function isSignpost(e: SnapshotEntity): boolean {
  return e.components.Signpost !== undefined;
}

const ACTORS = new WeakMap<WorldSnapshot, readonly SnapshotEntity[]>();

/**
 * Every settler and building of a snapshot, as an ascending-id subsequence of its `entities`. Iterate
 * it; it is not a snapshot's own entity lane, so never hand it to `entityById`, whose binary search
 * would miss everything this filtered out.
 */
export function actorsOf(snapshot: WorldSnapshot): readonly SnapshotEntity[] {
  const cached = ACTORS.get(snapshot);
  if (cached !== undefined) return cached;
  const actors = snapshot.entities.filter((e) => isSettler(e) || isBuilding(e));
  ACTORS.set(snapshot, actors);
  return actors;
}

export function buildingTypeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { buildingType?: unknown } | undefined;
  return num(b?.buildingType);
}

export function buildingTribeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { tribe?: unknown } | undefined;
  return num(b?.tribe);
}

/** Fixed-point construction progress, where `ONE` is finished. */
export function builtFractionOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { built?: unknown } | undefined;
  return num(b?.built);
}

/** A building that stands finished: its shell is complete and no construction is running on it. */
export function isFinishedBuilding(e: SnapshotEntity): boolean {
  if (!isBuilding(e) || e.components.UnderConstruction !== undefined) return false;
  const built = builtFractionOf(e);
  return built !== undefined && built >= ONE;
}

/** Undefined for a jobless settler, whose `jobType` is `null`, as well as for a non-settler. */
export function settlerJobType(e: SnapshotEntity): number | undefined {
  const s = e.components.Settler as { jobType?: unknown } | undefined;
  return num(s?.jobType);
}

/** The building entity a settler is employed at. */
export function workplaceOf(e: SnapshotEntity): number | undefined {
  const a = e.components.JobAssignment as { workplace?: unknown } | undefined;
  return num(a?.workplace);
}

/** The unit's military mode, or undefined before the simulation has stamped one. */
export function stanceModeOf(e: SnapshotEntity): number | undefined {
  const stance = e.components.Stance as { mode?: unknown } | undefined;
  return num(stance?.mode);
}

/** The foundation a builder is assigned to. */
export function buildSiteOf(e: SnapshotEntity): number | undefined {
  const a = e.components.SiteAssignment as { site?: unknown } | undefined;
  return num(a?.site);
}

/** The foundation an `assignBuilder` order pinned a builder to - the one the player can take back. */
export function pinnedSiteOf(e: SnapshotEntity): number | undefined {
  const a = e.components.SiteAssignment as { site?: unknown; pinned?: unknown } | undefined;
  return a?.pinned === true ? num(a.site) : undefined;
}

/** Whether the settler still leaves what it is doing to answer a need, the original's regeneration flag. */
export function regeneratesInWorld(e: SnapshotEntity): boolean {
  return e.components.NoRegeneration === undefined;
}

/** A creature rather than a person: the {@link Settler} model covers both, only people carry `Person`. */
export function isWildlife(e: SnapshotEntity): boolean {
  return isSettler(e) && e.components.Person === undefined;
}

/** The training house a settler walks to or drills at. */
export function trainingHouseOf(e: SnapshotEntity): number | undefined {
  const order = e.components.TrainingOrder as { house?: unknown } | undefined;
  return num(order?.house);
}

/** The drop-off flag entity a gatherer carries. */
export function workFlagOf(e: SnapshotEntity): number | undefined {
  const wf = e.components.WorkFlag as { flag?: unknown } | undefined;
  return num(wf?.flag);
}

/** A gatherer's work-area binding: the flag it works around and that area's radius in half-cell nodes. */
export function workAreaOf(e: SnapshotEntity): { flag: number; radius: number } | undefined {
  const wf = e.components.WorkFlag as { flag?: unknown; radius?: unknown } | undefined;
  const flag = num(wf?.flag);
  const radius = num(wf?.radius);
  return flag !== undefined && radius !== undefined ? { flag, radius } : undefined;
}

export function settlerTribeOf(e: SnapshotEntity): number | undefined {
  const settler = e.components.Settler as { tribe?: unknown } | undefined;
  return num(settler?.tribe);
}

/** The settler's need deficits, fixed-point 0..ONE where higher is worse. */
export function settlerNeedsOf(
  e: SnapshotEntity,
): { hunger: Fixed; fatigue: Fixed; piety: Fixed } | undefined {
  const settler = e.components.Settler as
    | { hunger?: unknown; fatigue?: unknown; piety?: unknown }
    | undefined;
  const hunger = num(settler?.hunger);
  const fatigue = num(settler?.fatigue);
  const piety = num(settler?.piety);
  return hunger !== undefined && fatigue !== undefined && piety !== undefined
    ? { hunger: hunger as Fixed, fatigue: fatigue as Fixed, piety: piety as Fixed }
    : undefined;
}

/**
 * Map each gatherer's drop-off flag entity to its owning gatherer, restricted to one player or `'any'`.
 * A flag stores no back-reference, so this scan is the only way to invert the edge; a gatherer binds to
 * exactly one flag, so the map is 1:1.
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

/** The defence-mode building a settler has claimed, or undefined when it is not running for cover. */
export function shelterOf(e: SnapshotEntity): number | undefined {
  const claim = e.components.Sheltering as { shelter?: unknown } | undefined;
  return num(claim?.shelter);
}

/** How many settlers have claimed `building` as their shelter. Counts claimants whether en route or
 *  already inside, matching the sim's own capacity ledger, so the HUD cannot advertise room a runner
 *  already holds. */
export function shelterClaimCount(snapshot: WorldSnapshot, building: number): number {
  let count = 0;
  for (const e of actorsOf(snapshot)) {
    if (isSettler(e) && shelterOf(e) === building) count++;
  }
  return count;
}

export function settlerLearnedOf(
  components: Readonly<Record<string, unknown>>,
  kind: 'job' | 'good',
): readonly number[] {
  const learned = (components.Settler as { learned?: { job?: unknown; good?: unknown } } | undefined)
    ?.learned;
  const ids = learned?.[kind];
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : [];
}
