import {
  Building,
  JobAssignment,
  playerPlacementTribes,
  professionProgressionEnabled,
  Settler,
  SettlerProgress,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { buildingTypeByContentId, goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { heldGatherGood } from '../../economy/gather-goods.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { goodEnabled, jobEnabled, requirementRepeats } from '../../progression/index.js';
import { type BuildOrder, type BuildOrderEntry, isLaneEntry } from '../build-order/entries.js';
import type { LineStatuses } from '../build-order/progress.js';
import { technologyReach } from './reach.js';
import {
  type CreditedTrack,
  type DiscoveryGate,
  type TechnologyTable,
  technologyTable,
} from './requirements.js';

/** How many unmet steps of each line, from its first, the seat earns the discoveries of ahead of time
 *  (authored): the line's own lookahead and one step more, so a step's trade is mostly earned by the
 *  time its line reaches it. */
export const APPRENTICE_LOOKAHEAD_STEPS = 4;

const NO_APPRENTICES: ReadonlySet<Entity> = new Set();

/**
 * The seat's apprentices this decision: for each discovery the next {@link APPRENTICE_LOOKAHEAD_STEPS}
 * unmet steps of every line still lack (a house row's job or good, a collector step's good, and the
 * discoveries those wait on in turn), the man of an enabling trade the discovery's rows credit most, on
 * the crediting work now or with repeats on it, ascending id on ties. Each is pinned on that work, never
 * released, retired, promoted or reposted, until he crosses the threshold, when the discovery is made
 * and drops out of the set. Derived from live state, so it needs no save and survives a reload. Empty
 * while the match's progression toggle is off or the seat's tribe has no technology table.
 */
export function seatApprentices(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  statuses: LineStatuses,
): ReadonlySet<Entity> {
  if (!professionProgressionEnabled(world)) return NO_APPRENTICES;
  const tribe = playerPlacementTribes(world, player)?.[0];
  const table = tribe === undefined ? null : technologyTable(ctx.content, tribe);
  const reach = technologyReach(world, ctx, player, statuses);
  if (tribe === undefined || table === null || reach === null) return NO_APPRENTICES;
  const missing: DiscoveryGate[] = [];
  const seen = new Set<DiscoveryGate>();
  const want = (gate: DiscoveryGate | undefined): void => {
    if (gate === undefined || seen.has(gate)) return;
    seen.add(gate);
    const enabled = gate.kind === 'job' ? jobEnabled : goodEnabled;
    if (enabled(world, ctx, player, tribe, gate.typeId) || !reach.target(gate.kind, gate.typeId)) return;
    missing.push(gate);
    // What the gate waits on: an enabling trade not discovered yet, the goods its gatherers must be let
    // gather (the iron the future smith digs) and the trade a crediting workshop employs.
    if (!gate.enablingJobs.some((job) => jobEnabled(world, ctx, player, tribe, job)))
      for (const job of gate.enablingJobs) want(table.jobs.get(job));
    for (const row of gate.needs) {
      for (const { job, work } of row.tracks) {
        if (work.kind === 'gather') for (const good of work.goods) want(table.goods.get(good));
        if (job !== null) want(table.jobs.get(job));
      }
    }
  };
  for (const line of order.lines) {
    const lineStatus = statuses.get(line.id) ?? [];
    let ahead = 0;
    for (const [step, entry] of line.steps.entries()) {
      if (isLaneEntry(entry) || lineStatus[step] !== 'unmet') continue;
      for (const gate of stepGates(ctx, table, entry)) want(gate);
      if (++ahead >= APPRENTICE_LOOKAHEAD_STEPS) break;
    }
  }
  if (missing.length === 0) return NO_APPRENTICES;
  return pickApprentices(world, ctx, player, missing);
}

/** The discovery gates a step's building row or collector good names. */
function stepGates(
  ctx: SystemContext,
  table: TechnologyTable,
  entry: BuildOrderEntry,
): readonly (DiscoveryGate | undefined)[] {
  switch (entry.kind) {
    case 'place':
    case 'upgrade': {
      const type = buildingTypeByContentId(ctx.content, entry.building);
      const row = type === undefined ? undefined : table.houses.get(type.typeId);
      return row === undefined ? [] : [...row.jobs, ...row.goods];
    }
    case 'collector': {
      const good = goodTypeByContentId(ctx.content, entry.good);
      return good === undefined ? [] : [table.goods.get(good.typeId)];
    }
    case 'towerCoverage':
    case 'storeCoverage':
      return [];
  }
}

interface Candidate {
  readonly man: Entity;
  readonly score: number;
}

/** One apprentice per gate, from one walk over the seat's settlers. */
function pickApprentices(
  world: World,
  ctx: SystemContext,
  player: number,
  missing: readonly DiscoveryGate[],
): ReadonlySet<Entity> {
  const best = new Map<DiscoveryGate, Candidate>();
  const tracks = ctx.content.jobExperience;
  for (const e of ownedSettlers(world, player)) {
    if (!isAllocatableMan(world, ctx, e)) continue;
    const job = world.get(e, Settler).jobType;
    if (job === null) continue;
    let work: CurrentWork | undefined;
    const { experience } = world.get(e, SettlerProgress);
    for (const gate of missing) {
      if (!gate.enablingJobs.includes(job)) continue;
      work ??= currentWork(world, ctx, e);
      const now = work;
      let score = 0;
      let onWork = false;
      for (const row of gate.needs) {
        score += Math.min(
          row.amount,
          requirementRepeats(
            tracks,
            experience,
            row.tracks.map((t) => t.track),
          ),
        );
        onWork ||= row.tracks.some((t) => t.job === job && credits(t, now));
      }
      if (score === 0 && !onWork) continue;
      const known = best.get(gate);
      // The settler walk ascends by id, so the first of equal scores keeps the post.
      if (known === undefined || score > known.score) best.set(gate, { man: e, score });
    }
  }
  const pinned = new Set<Entity>();
  for (const { man } of best.values()) pinned.add(man);
  return pinned;
}

/** What a man works at now: the good his flag holds him to, and the building type employing him. */
interface CurrentWork {
  readonly flagged: boolean;
  readonly gathers: number | undefined;
  readonly workplaceType: number | undefined;
}

function currentWork(world: World, ctx: SystemContext, e: Entity): CurrentWork {
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  const flagged = liveWorkFlag(world, e) !== undefined;
  return {
    flagged,
    gathers: flagged ? heldGatherGood(world, ctx, e) : undefined,
    workplaceType: workplace === undefined ? undefined : world.tryGet(workplace, Building)?.buildingType,
  };
}

/** Whether `work` credits `track`. */
function credits(track: CreditedTrack, work: CurrentWork): boolean {
  const { work: crediting } = track;
  switch (crediting.kind) {
    case 'gather':
      return (
        (work.flagged &&
          (crediting.goods.length === 0 ||
            (work.gathers !== undefined && crediting.goods.includes(work.gathers)))) ||
        (work.workplaceType !== undefined && crediting.workshops.includes(work.workplaceType))
      );
    case 'hunt':
      return work.workplaceType !== undefined;
    case 'craft':
      return work.workplaceType !== undefined && crediting.workshops.includes(work.workplaceType);
    case 'other':
      return false;
  }
}
