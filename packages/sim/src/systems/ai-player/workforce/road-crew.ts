import { Settler, SiteAssignment } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type OwnedRoadSite, ownedRoadSites } from '../../roads/site-index.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { LATE_ROAD_CREW_FROM_TICKS } from '../game-phase.js';
import { anchorNodeOf } from '../node-geometry.js';
import type { SpareForce } from './pool.js';

/** The builders the seat keeps on a road run while any of its road sites is pending (authored). */
export const ROAD_CREW = 1;

/** The road crew while the pending road sites pile up (authored). */
export const BACKLOG_ROAD_CREW = 2;

/** The backlog road crew from {@link LATE_ROAD_CREW_FROM_TICKS} on, when the grown seat has men to spare
 *  and a network wide enough to keep a third builder paving (authored). */
export const LATE_BACKLOG_ROAD_CREW = 3;

/** From how many pending road sites the seat puts {@link BACKLOG_ROAD_CREW} builders on roads, and under
 *  how many it lets the extra ones go again (authored): the gap keeps a crew from flipping at one line. */
export const ROAD_BACKLOG_SITES = 12;
export const ROAD_BACKLOG_RELEASE_SITES = 6;

/** The road crew the seat wants at `tick` with `pending` road sites and `held` builders already on a run. */
export function roadCrewTarget(pending: number, held: number, tick: number): number {
  if (pending === 0) return 0;
  const backlogCrew = tick >= LATE_ROAD_CREW_FROM_TICKS ? LATE_BACKLOG_ROAD_CREW : BACKLOG_ROAD_CREW;
  if (pending >= ROAD_BACKLOG_SITES) return backlogCrew;
  if (held > ROAD_CREW && pending >= ROAD_BACKLOG_RELEASE_SITES) return Math.min(held, backlogCrew);
  return ROAD_CREW;
}

/**
 * Keep the seat's road crew at {@link roadCrewTarget}: put the free spare builder nearest one of its
 * unclaimed road sites on a road run there, or with no builder in the pool at all train a spare man as one, whom a later
 * decision posts. A roadster stays off the pool until the builder drive ends his run with no site left,
 * so no other rung takes him; one over the target is called off. Returns the commands and the crew the
 * seat counts on, which the builder reserve leaves out.
 */
export function allocateRoadCrew(
  world: World,
  ctx: SystemContext,
  player: number,
  roadsters: readonly Entity[],
  force: SpareForce,
  builderJob: number | null,
): { commands: PlayerCommand[]; crew: number } {
  const terrain = ctx.terrain;
  if (terrain === undefined || builderJob === null) return { commands: [], crew: roadsters.length };
  const sites = ownedRoadSites(world, terrain, player);
  const target = roadCrewTarget(sites.size, roadsters.length, ctx.tick);
  const commands: PlayerCommand[] = [];
  for (const e of roadsters.slice(target)) {
    if (!atomicHoldsSettler(world, e)) commands.push({ kind: 'unassignBuilder', entity: e });
  }
  const isBuilder = (e: Entity): boolean => world.get(e, Settler).jobType === builderJob;
  const free = (e: Entity): boolean =>
    world.tryGet(e, SiteAssignment)?.pinned !== true && !atomicHoldsSettler(world, e);
  const posted = new Set<Entity>();
  const siteFor = (e: Entity) => nearestOpenSite(world, terrain, e, sites, posted);
  let crew = roadsters.length;
  while (crew < target) {
    const man = force.take(
      (e) => isBuilder(e) && free(e),
      (e) => -(siteFor(e)?.distance ?? Number.POSITIVE_INFINITY),
    );
    const site = man === null ? null : siteFor(man);
    if (man !== null && site !== null) {
      commands.push({ kind: 'assignBuilder', entity: man, site: site.site });
      posted.add(site.site);
      crew++;
      continue;
    }
    // A busy builder is posted once he is free, and a site another builder holds needs nobody more; only
    // a seat with no builder at all trains one.
    if (man === null && !force.any(isBuilder) && hasOpenSite(sites, posted)) {
      const spare = force.take(free);
      if (spare !== null) {
        commands.push({ kind: 'setJob', entity: spare, jobType: builderJob });
        crew++;
      }
    }
    break;
  }
  return { commands, crew: Math.min(crew, target) };
}

function hasOpenSite(sites: ReadonlyMap<Entity, OwnedRoadSite>, posted: ReadonlySet<Entity>): boolean {
  for (const [e, site] of sites) if (site.open && !posted.has(e)) return true;
  return false;
}

/** The seat's unclaimed road site nearest `e` by Manhattan node distance, ties to the lower entity id,
 *  leaving out those `posted` this decision: a road site takes one builder, so one another builder holds
 *  has no room for a roadster. */
function nearestOpenSite(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  sites: ReadonlyMap<Entity, OwnedRoadSite>,
  posted: ReadonlySet<Entity>,
): { site: Entity; distance: number } | null {
  const here = anchorNodeOf(world, e);
  if (here === null) return null;
  let best: { site: Entity; distance: number } | null = null;
  for (const [site, { node, open }] of sites) {
    if (!open || posted.has(site)) continue;
    const distance = Math.abs(terrain.xOf(node) - here.hx) + Math.abs(terrain.yOf(node) - here.hy);
    if (best === null || distance < best.distance || (distance === best.distance && site < best.site)) {
      best = { site, distance };
    }
  }
  return best;
}
