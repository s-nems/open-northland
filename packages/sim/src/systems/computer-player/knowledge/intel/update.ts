import {
  aiControlEntity,
  Building,
  ComputerIntel,
  type ComputerIntelState,
  computerControllerRuns,
  type IntelBuilding,
  MAX_PLAYERS,
  type MapBriefView,
  mapBriefOf,
  NEVER_SEEN,
  Owner,
  Position,
  Settler,
  zoneOfNode,
} from '../../../../components/index.js';
import { isPlayerDead } from '../../../../components/match.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import { computerDecisionDue } from '../../../ai-shared/cadence.js';
import { everyBuildingOf, everySettlerOf } from '../../../ai-shared/home-roster.js';
import { mannedPostOf } from '../../../conflict/tower-post.js';
import type { SystemContext } from '../../../context.js';
import { ownedFightersOf } from '../../../movement/collision/owned-fighters.js';
import { isScoutJob } from '../../../readviews/index.js';
import { playerSeesNode } from '../../../vision/gates.js';
import type { FogState } from '../../../vision/state.js';
import { isLiveFighter, unitPoints } from '../../military/points.js';

/** Ticks after a seat's decision slot its intel is updated (authored): off the seat's own workforce and
 *  build order phases, one phase before its military decision reads it. */
export const INTEL_DECISION_PHASE = 4;

/**
 * Update each running computer seat's memory of the others from its own sight: create it, seeded with the
 * map brief's start buildings, on the seat's first pass, then refresh it on the seat's decision beat.
 * The cost is the other seats' buildings and fighters, the memory, and a few cell samples per zone.
 */
export function updateComputerIntel(world: World, ctx: SystemContext, seats: readonly number[]): void {
  const brief = mapBriefOf(world);
  if (brief === null) return;
  for (const seat of seats) {
    const carrier = aiControlEntity(world, seat);
    if (carrier === null || !computerControllerRuns(world, seat) || isPlayerDead(world, seat)) continue;
    if (!world.has(carrier, ComputerIntel)) world.add(carrier, ComputerIntel, seededIntel(brief, seat));
    if (!computerDecisionDue(ctx.tick - INTEL_DECISION_PHASE, seat)) continue;
    observe(world, ctx, brief, seat, world.mut(carrier, ComputerIntel));
  }
}

/** Record that `seat`'s scout turned back at `tick` from a goal in `zone`; nothing before its intel exists. */
export function recordScoutTurnBack(world: World, seat: number, zone: number, tick: number): void {
  const carrier = aiControlEntity(world, seat);
  if (carrier === null || !world.has(carrier, ComputerIntel)) return;
  world.mut(carrier, ComputerIntel).scoutTurnedBackAt[zone] = tick;
}

/** The memory a seat starts with: every other seat's start buildings, never yet seen. */
function seededIntel(brief: MapBriefView, seat: number): ComputerIntelState {
  const buildings: IntelBuilding[] = [];
  for (const start of brief.seats) {
    if (start.player === seat) continue;
    for (const b of start.buildings) {
      buildings.push({
        entity: b.entity,
        owner: start.player,
        buildingType: b.buildingType,
        hx: b.hx,
        hy: b.hy,
        seenAt: NEVER_SEEN,
        posted: 0,
        postedPoints: 0,
      });
    }
  }
  buildings.sort((a, b) => a.entity - b.entity);
  return {
    buildings,
    forces: [],
    zoneSeenAt: new Array<number>(brief.zonesWide * brief.zonesHigh).fill(NEVER_SEEN),
    scout: null,
    scoutLostAt: new Array<number>(brief.zonesWide * brief.zonesHigh).fill(NEVER_SEEN),
    scoutTurnedBackAt: new Array<number>(brief.zonesWide * brief.zonesHigh).fill(NEVER_SEEN),
  };
}

function observe(
  world: World,
  ctx: SystemContext,
  brief: MapBriefView,
  seat: number,
  intel: ComputerIntelState,
): void {
  const posted = new Map<Entity, PostSighting>();
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat) continue;
    observeForces(world, ctx, brief, seat, other, intel, posted);
    observeBuildings(world, ctx.fog, seat, other, ctx.tick, intel.buildings, posted);
  }
  forgetVanished(world, ctx.fog, seat, intel.buildings);
  sampleZones(ctx.fog, brief, seat, ctx.tick, intel.zoneSeenAt);
  trackScout(world, ctx, brief, seat, intel);
}

/** Record the zone the seat's scout of the last observation stood in as a loss when he is gone now, then
 *  remember the scout of this one; one out of sight inside a building or ship keeps his last zone. A scout
 *  who changed trade is alive and lost nowhere, and a zone holding one of the seat's buildings is its
 *  settlement, never avoided. */
function trackScout(
  world: World,
  ctx: SystemContext,
  brief: MapBriefView,
  seat: number,
  intel: ComputerIntelState,
): void {
  const last = intel.scout;
  const gone =
    last !== null && (!world.has(last.entity, Settler) || world.tryGet(last.entity, Owner)?.player !== seat);
  if (gone && !settledZone(world, brief, seat, last.zone)) intel.scoutLostAt[last.zone] = ctx.tick;
  const scout = everySettlerOf(world, seat).find((e) =>
    isScoutJob(ctx.content, world.get(e, Settler).jobType),
  );
  if (scout === undefined) {
    intel.scout = null;
    return;
  }
  const pos = world.tryGet(scout, Position);
  if (pos !== undefined) {
    const zone = zoneOfNode(brief, nodeHxOfPosition(pos.x, pos.y), nodeHyOfPosition(pos.x, pos.y));
    intel.scout = { entity: scout, zone };
  } else if (last?.entity !== scout) intel.scout = null;
}

/** The men seen holding one post and their points. */
interface PostSighting {
  men: number;
  points: number;
}

/** Count the fighters of `other` the seat sees now and their points, tallying the posts they hold into
 *  `posted`. */
function observeForces(
  world: World,
  ctx: SystemContext,
  brief: MapBriefView,
  seat: number,
  other: number,
  intel: ComputerIntelState,
  posted: Map<Entity, PostSighting>,
): void {
  let seen = 0;
  let seenPoints = 0;
  const byZone = new Map<number, number>();
  for (const e of ownedFightersOf(world, ctx.content, other)) {
    if (!isLiveFighter(world, e)) continue;
    const pos = world.tryGet(e, Position);
    if (pos === undefined) continue;
    const hx = nodeHxOfPosition(pos.x, pos.y);
    const hy = nodeHyOfPosition(pos.x, pos.y);
    if (!playerSeesNode(ctx.fog, seat, hx, hy)) continue;
    const points = unitPoints(world, ctx, e);
    seen++;
    seenPoints += points;
    const zone = zoneOfNode(brief, hx, hy);
    byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
    const post = mannedPostOf(world, ctx, e);
    if (post === null) continue;
    const sighting = posted.get(post);
    if (sighting === undefined) posted.set(post, { men: 1, points });
    else {
      sighting.men++;
      sighting.points += points;
    }
  }
  if (seen === 0) return;
  let record = intel.forces.find((f) => f.player === other);
  if (record === undefined) {
    record = {
      player: other,
      peak: 0,
      peakAt: ctx.tick,
      peakPoints: 0,
      peakPointsAt: ctx.tick,
      lastSeenAt: ctx.tick,
      lastZone: 0,
    };
    intel.forces.push(record);
    intel.forces.sort((a, b) => a.player - b.player);
  }
  if (seen >= decayedPeak(record.peak, record.peakAt, ctx.tick)) {
    record.peak = seen;
    record.peakAt = ctx.tick;
  }
  if (seenPoints >= decayedPeak(record.peakPoints, record.peakPointsAt, ctx.tick)) {
    record.peakPoints = seenPoints;
    record.peakPointsAt = ctx.tick;
  }
  record.lastSeenAt = ctx.tick;
  record.lastZone = busiestZone(byZone);
}

/** The zone holding the most of the sighting, the lowest index on a tie. */
function busiestZone(byZone: ReadonlyMap<number, number>): number {
  let best = -1;
  let bestCount = 0;
  for (const [zone, count] of byZone) {
    if (count > bestCount || (count === bestCount && zone < best)) {
      best = zone;
      bestCount = count;
    }
  }
  return best;
}

/** Ticks over which a remembered peak of fighters halves (authored): two game minutes, about the time
 *  an army seen at the border can march off or be rebuilt. */
export const FORCE_PEAK_HALF_LIFE_TICKS = 1440;
/** Halvings past which any peak a map can field reads 0. */
const PEAK_FORGOTTEN_HALVINGS = 31;

/** `peak` aged from `peakAt` to `tick`, halved per {@link FORCE_PEAK_HALF_LIFE_TICKS}. */
export function decayedPeak(peak: number, peakAt: number, tick: number): number {
  const halvings = Math.floor((tick - peakAt) / FORCE_PEAK_HALF_LIFE_TICKS);
  return halvings >= PEAK_FORGOTTEN_HALVINGS ? 0 : peak >> halvings;
}

/** Remember or refresh every building of `other` the seat sees now. */
function observeBuildings(
  world: World,
  fog: FogState | undefined,
  seat: number,
  other: number,
  tick: number,
  memory: IntelBuilding[],
  posted: ReadonlyMap<Entity, PostSighting>,
): void {
  for (const e of everyBuildingOf(world, other)) {
    const pos = world.tryGet(e, Position);
    if (pos === undefined) continue;
    const hx = nodeHxOfPosition(pos.x, pos.y);
    const hy = nodeHyOfPosition(pos.x, pos.y);
    if (!playerSeesNode(fog, seat, hx, hy)) continue;
    const seen: IntelBuilding = {
      entity: e,
      owner: other,
      buildingType: world.get(e, Building).buildingType,
      hx,
      hy,
      seenAt: tick,
      posted: posted.get(e)?.men ?? 0,
      postedPoints: posted.get(e)?.points ?? 0,
    };
    const at = lowerBound(memory, e);
    if (memory[at]?.entity === e) memory[at] = seen;
    else memory.splice(at, 0, seen);
  }
}

/** Drop the remembered buildings whose spot the seat sees with the building gone or under another owner. */
function forgetVanished(
  world: World,
  fog: FogState | undefined,
  seat: number,
  memory: IntelBuilding[],
): void {
  let kept = 0;
  for (const b of memory) {
    const stands = world.has(b.entity, Building) && world.tryGet(b.entity, Owner)?.player === b.owner;
    if (stands || !playerSeesNode(fog, seat, b.hx, b.hy)) memory[kept++] = b;
  }
  memory.length = kept;
}

function lowerBound(memory: readonly IntelBuilding[], e: Entity): number {
  let lo = 0;
  let hi = memory.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((memory[mid] as IntelBuilding).entity < e) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Whether one of the seat's buildings stands in `zone`. */
function settledZone(world: World, brief: MapBriefView, seat: number, zone: number): boolean {
  return everyBuildingOf(world, seat).some((e) => {
    const pos = world.tryGet(e, Position);
    return (
      pos !== undefined &&
      zoneOfNode(brief, nodeHxOfPosition(pos.x, pos.y), nodeHyOfPosition(pos.x, pos.y)) === zone
    );
  });
}

/** Where in a zone, in eighths of its edge, the seat's sight is sampled: the centre and the four quarter
 *  centres (authored: one sight radius covers a quarter, so a scout crossing the zone hits a sample). */
const ZONE_SAMPLE_EIGHTHS: readonly (readonly [number, number])[] = [
  [4, 4],
  [2, 2],
  [6, 2],
  [2, 6],
  [6, 6],
];
const EIGHTHS = 8;

function sampleZones(
  fog: FogState | undefined,
  brief: MapBriefView,
  seat: number,
  tick: number,
  zoneSeenAt: number[],
): void {
  for (let zy = 0; zy < brief.zonesHigh; zy++) {
    for (let zx = 0; zx < brief.zonesWide; zx++) {
      const minX = zx * brief.zoneNodes;
      const minY = zy * brief.zoneNodes;
      const edgeX = Math.min(brief.width, minX + brief.zoneNodes) - minX;
      const edgeY = Math.min(brief.height, minY + brief.zoneNodes) - minY;
      const sees = ZONE_SAMPLE_EIGHTHS.some(([ex, ey]) =>
        playerSeesNode(
          fog,
          seat,
          minX + Math.floor((edgeX * ex) / EIGHTHS),
          minY + Math.floor((edgeY * ey) / EIGHTHS),
        ),
      );
      if (sees) zoneSeenAt[zy * brief.zonesWide + zx] = tick;
    }
  }
}
