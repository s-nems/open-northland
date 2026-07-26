import { Building, PlayerOrder, Position } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { MILITARY_MODE } from '../../readviews/stances.js';
import { type BuildOrderEntry, barracksEntryIndex, type EntryStatus } from '../build-order/index.js';
import { anchorNodeOf, BARRACKS_BUILDING_ID, firstRingNode, isBuilt, ownedBuildings } from '../shared.js';
import type { SpareForce } from './pool.js';

// RECRUITS — the army investment while barracks training is unimplemented (user decision
// 2026-07-25, mechanism revised 2026-07-26): the ramp's share of the surplus takes the UNARMED
// soldier trade and musters at the barracks under a DEFEND stance, so they hold the post instead of
// charging out bare-handed. The unarmed trade is the honest interim: the sim resolves a weapon from
// the (tribe, job) binding, so any armed trade would equip an army the economy never paid for.
// TODO(barracks-training): when barracks recruitment/training lands
// (docs/tickets/features/barracks-recruitment.md, barracks-training.md), these mustered men are the
// ones to train and equip there — the ramp below decides how many, that flow decides what they become.

/** The recruit trade, by stable content id — `jobtypes.ini` type 31, the soldier band's unarmed
 *  bottom. A content set without it hires nobody. */
export const RECRUIT_JOB_ID = 'soldier_unarmed';

/** The surplus share sent to the barracks the moment one stands (percent). */
export const RECRUIT_PERCENT_AT_BARRACKS = 50;
/** The surplus share once every build-order entry after the barracks is satisfied (percent). */
export const RECRUIT_PERCENT_FULL = 100;
const PERCENT_DENOMINATOR = 100;

/** How far from its barracks a mustered recruit may stand before it is sent back — the muster ring
 *  plus room to step aside (named approximation). */
const MUSTER_RADIUS_NODES = 10;

/** The recruit trade's typeId in this content set, or null when it declares none. */
export function recruitJobOf(ctx: SystemContext): number | null {
  return ctx.content.jobs.find((j) => j.id === RECRUIT_JOB_ID)?.typeId ?? null;
}

/**
 * The surplus share (percent) the seat invests in recruits — the army ramp: {@link
 * RECRUIT_PERCENT_AT_BARRACKS} at the barracks entry, growing linearly with the satisfied share of
 * the entries after it to {@link RECRUIT_PERCENT_FULL} at list completion (`skip` counts as
 * satisfied — an inexpressible entry must not stall the ramp). An order with no barracks entry
 * ramps straight to full — a map-granted barracks is the only gate then (`allocateRecruits`).
 * Statuses regress with the world (a razed home), so the share can temporarily drop — the release
 * path handles it.
 */
export function recruitPercent(order: readonly BuildOrderEntry[], statuses: readonly EntryStatus[]): number {
  const barracksAt = barracksEntryIndex(order);
  if (barracksAt < 0) return RECRUIT_PERCENT_FULL;
  const after = statuses.slice(barracksAt + 1);
  if (after.length === 0) return RECRUIT_PERCENT_FULL;
  const satisfied = after.filter((s) => s !== 'unmet').length;
  return (
    RECRUIT_PERCENT_AT_BARRACKS +
    Math.floor(((RECRUIT_PERCENT_FULL - RECRUIT_PERCENT_AT_BARRACKS) * satisfied) / after.length)
  );
}

/** The `n`-th walkable node in canonical ring order around the barracks (the ring itself starts one
 *  node out, so nobody is sent onto the door tile), or null when the ring holds none. Indexing the
 *  ring rather than reusing one spot spreads the muster out deterministically. */
function musterNode(terrain: TerrainGraph, barracks: HalfCellNode, n: number): HalfCellNode | null {
  let seen = 0;
  return firstRingNode(barracks.hx, barracks.hy, MUSTER_RADIUS_NODES, (x, y) => {
    if (!terrain.inBounds(x, y) || !terrain.isWalkable(terrain.nodeAt(x, y))) return false;
    if (x === barracks.hx && y === barracks.hy) return false;
    return seen++ === n;
  });
}

/** Whether the recruit already stands within {@link MUSTER_RADIUS_NODES} of its barracks. */
function atMuster(world: World, recruit: Entity, barracks: HalfCellNode): boolean {
  const p = world.tryGet(recruit, Position);
  if (p === undefined) return false;
  const here = nodeOfPosition(p.x, p.y);
  return Math.abs(here.hx - barracks.hx) + Math.abs(here.hy - barracks.hy) <= MUSTER_RADIUS_NODES;
}

/**
 * Recruit keeping: the ramp share of the surplus takes the unarmed trade and musters at the seat's
 * first built barracks. The surplus is the men this phase may govern — current recruits plus the
 * still unclaimed pool — so the ramp-down releases as naturally as the ramp-up hires; releases walk
 * the classification order backwards (highest entity id first — a deterministic pick, not a tenure
 * rule) and rejoin the pool as builders. A recruit that wandered off its post is sent back, which is
 * also how a recruit inherited from a razed barracks re-forms on the surviving one.
 */
export function allocateRecruits(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
  recruits: readonly Entity[],
  force: SpareForce,
  builderJob: number | null,
): Command[] {
  const terrain = ctx.terrain;
  const recruitJob = recruitJobOf(ctx);
  if (terrain === undefined || recruitJob === null) return [];
  const index = contentIndex(ctx.content);
  let barracks: HalfCellNode | null = null;
  for (const e of ownedBuildings(world, player)) {
    if (!isBuilt(world, e)) continue;
    if (index.buildings.get(world.get(e, Building).buildingType)?.id !== BARRACKS_BUILDING_ID) continue;
    barracks = anchorNodeOf(world, e);
    if (barracks !== null) break; // the muster point: the seat's first built barracks
  }
  const percent = barracks === null ? 0 : recruitPercent(order, statuses);
  const surplus = recruits.length + force.remaining().length;
  const desired = Math.floor((surplus * percent) / PERCENT_DENOMINATOR);

  const commands: Command[] = [];
  if (recruits.length > desired) {
    // Ramp-down (or a lost barracks): release the newest posts back to the builder pool.
    for (let i = recruits.length - 1; i >= desired; i--) {
      const recruit = recruits[i];
      if (recruit !== undefined && builderJob !== null) {
        commands.push({ kind: 'setJob', entity: recruit, jobType: builderJob });
      }
    }
    return commands;
  }
  if (barracks === null) return commands;
  // Send back whoever drifted (an order in flight is already a walk home — leave it be).
  for (const [i, recruit] of recruits.entries()) {
    if (atMuster(world, recruit, barracks) || world.has(recruit, PlayerOrder)) continue;
    const spot = musterNode(terrain, barracks, i);
    if (spot !== null) commands.push({ kind: 'moveUnit', entity: recruit, x: spot.hx, y: spot.hy });
  }
  for (let posted = recruits.length; posted < desired; posted++) {
    const spare = force.take();
    if (spare === null) break;
    const spot = musterNode(terrain, barracks, posted);
    if (spot === null) break;
    // Order matters: the trade change re-stamps the trade's default stance (ATTACK for the soldier
    // band), and the move re-anchors the DEFEND post onto the muster node it walks to.
    commands.push({ kind: 'setJob', entity: spare, jobType: recruitJob });
    commands.push({ kind: 'setStance', entity: spare, mode: MILITARY_MODE.DEFEND });
    commands.push({ kind: 'moveUnit', entity: spare, x: spot.hx, y: spot.hy });
  }
  return commands;
}
