import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerIntel,
  CurrentAtomic,
  FOG_MODE,
  type MapBriefView,
  MoveGoal,
  mapBriefOf,
  NEVER_SEEN,
  PlayerOrder,
  Position,
  Settler,
  zoneOfNode,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../../src/index.js';
import { type HalfCellNode, nodeManhattan, nodeOfPosition } from '../../../../src/nav/halfcell.js';
import { ownedSettlers } from '../../../../src/systems/ai-shared/seat-roster.js';
import {
  DEFAULT_BUILD_ORDER,
  nextSignpostTarget,
  nextStaleZoneTarget,
  SCOUT_LEG_NODES,
  SCOUT_LEG_SNAP_NODES,
  SCOUT_LOSS_MEMORY_TICKS,
  SCOUT_REVISIT_TICKS,
  SCOUT_STALENESS_CAP_TICKS,
  SCOUT_TURN_BACK_MEMORY_TICKS,
  SCOUTING_DEADLINE_LEAD_TICKS,
  SCOUTING_ROUND_TICKS,
  SMALL_START_SCOUT_FROM_TICKS,
  scoutingLeads,
  scoutModule,
  signpostLatticeOffset,
} from '../../../../src/systems/computer-player/index.js';
import { ASSUMED_PEACE_TICKS } from '../../../../src/systems/computer-player/military/deadline.js';
import type { SystemContext } from '../../../../src/systems/index.js';
import type { FogState } from '../../../../src/systems/vision/state.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import {
  BUILDER,
  collectModule,
  ctxOf,
  HQ_TYPE,
  makeAiSeat,
  placeHq,
  placeResources,
  plantPost,
  RESOURCE_SPOTS,
  SCOUT,
  SEAT,
  SPEARMAN,
  VIKING,
} from '../support.js';

const MAP_W = 256;
const MAP_H = 128;
const OTHER = 1;
const HOME = { x: 40, y: 64 };
const OTHER_START = { x: 200, y: 64 };
/** An entity id above every one the sim spawns, for a remembered building. */
const TOWER_POST = 1_000_000 as Entity;
/** A mud deposit at the scan, in a zone off the walk between the starts. */
const DEPOSIT = { ...RESOURCE_SPOTS.mud, x: 40, y: 112 };
/** Late enough that a never-seen zone's staleness is capped. */
const NOW = 2 * SCOUT_STALENESS_CAP_TICKS;
/** The first ring of the signpost lattice around the base, in lattice coordinates. */
const LATTICE_RING = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
] as const;

/** A computer seat with a scout and an enemy seat's start headquarters, scanned, its intel never having
 *  seen any zone. */
function staleSim(deposits = [DEPOSIT], soldier = false): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(MAP_W, MAP_H) });
  // A scout with a pressing need is left to it, and the tests jump the clock without stepping it.
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  makeAiSeat(sim, SEAT);
  placeHq(sim, HOME.x, HOME.y);
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: OTHER, tribes: [VIKING] });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    ...OTHER_START,
    tribe: VIKING,
    owner: OTHER,
  });
  placeResources(sim, deposits);
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: SCOUT,
    x: HOME.x + 6,
    y: HOME.y,
    tribe: VIKING,
    owner: SEAT,
  });
  // Scouting opens only once the seat holds a soldier.
  if (soldier)
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      x: HOME.x - 6,
      y: HOME.y,
      tribe: VIKING,
      owner: SEAT,
    });
  sim.step();
  sim.step();
  zoneSeenAt(sim).fill(NEVER_SEEN);
  return sim;
}

function scoutLostAt(sim: Simulation): number[] {
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null || !sim.world.has(carrier, ComputerIntel))
    throw new Error('setup: the seat has intel');
  return sim.world.mut(carrier, ComputerIntel).scoutLostAt;
}

function zoneSeenAt(sim: Simulation): number[] {
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null || !sim.world.has(carrier, ComputerIntel))
    throw new Error('setup: the seat has intel');
  return sim.world.mut(carrier, ComputerIntel).zoneSeenAt;
}

function briefOf(sim: Simulation): MapBriefView {
  const brief = mapBriefOf(sim.world);
  if (brief === null) throw new Error('setup: the seat scanned the map');
  return brief;
}

function fogOfWar(sim: Simulation): FogState {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('setup: a mapped sim has fog');
  fog.activeMode = FOG_MODE.CLASSIC_FOG_OF_WAR;
  return fog;
}

function ctxAt(sim: Simulation, tick: number, fog?: FogState): SystemContext {
  return { ...ctxOf(sim, tick), ...(fog ? { fog } : {}) };
}

function zoneOf(sim: Simulation, node: HalfCellNode | null): number | null {
  return node === null ? null : zoneOfNode(briefOf(sim), node.hx, node.hy);
}

describe('scout staleness scouting', () => {
  it('scouts a stale enemy start zone before unexplored zones on the walk and a deposit zone', () => {
    const sim = staleSim();
    const brief = briefOf(sim);
    const enemyZone = zoneOfNode(brief, OTHER_START.x, OTHER_START.y);
    zoneSeenAt(sim)[enemyZone] = NOW - SCOUT_REVISIT_TICKS;
    const target = nextStaleZoneTarget(sim.world, ctxAt(sim, NOW, fogOfWar(sim)), SEAT, DEFAULT_BUILD_ORDER);
    expect(zoneOf(sim, target)).toBe(enemyZone);
  });

  it('does not revisit a zone just seen until its staleness grows back', () => {
    const sim = staleSim();
    const enemyZone = zoneOfNode(briefOf(sim), OTHER_START.x, OTHER_START.y);
    const fog = fogOfWar(sim);
    zoneSeenAt(sim)[enemyZone] = NOW - 1;
    const soon = nextStaleZoneTarget(sim.world, ctxAt(sim, NOW, fog), SEAT, DEFAULT_BUILD_ORDER);
    expect(soon).not.toBeNull();
    expect(zoneOf(sim, soon)).not.toBe(enemyZone);
    const later = NOW - 1 + SCOUT_REVISIT_TICKS;
    const due = nextStaleZoneTarget(sim.world, ctxAt(sim, later, fog), SEAT, DEFAULT_BUILD_ORDER);
    expect(zoneOf(sim, due)).toBe(enemyZone);
  });

  it('scouts on the near side of a zone that took a scout, and past it once the loss is old', () => {
    const sim = staleSim();
    const brief = briefOf(sim);
    const fog = fogOfWar(sim);
    const enemyZone = zoneOfNode(brief, OTHER_START.x, OTHER_START.y);
    const midX = (HOME.x + OTHER_START.x) / 2;
    scoutLostAt(sim)[zoneOfNode(brief, midX, HOME.y)] = NOW;
    const near = nextStaleZoneTarget(sim.world, ctxAt(sim, NOW, fog), SEAT, DEFAULT_BUILD_ORDER);
    if (near === null) throw new Error('the scout keeps scouting elsewhere');
    expect(near.hx).toBeLessThan(midX);
    const later = NOW + SCOUT_LOSS_MEMORY_TICKS;
    const due = nextStaleZoneTarget(sim.world, ctxAt(sim, later, fog), SEAT, DEFAULT_BUILD_ORDER);
    expect(zoneOf(sim, due)).toBe(enemyZone);
  });

  it('aims the next look elsewhere for a while after a tower on the way turns the scout back', () => {
    const sim = staleSim([DEPOSIT], true);
    const fog = fogOfWar(sim);
    const enemyZone = zoneOfNode(briefOf(sim), OTHER_START.x, OTHER_START.y);
    const goal = nextStaleZoneTarget(sim.world, ctxAt(sim, NOW, fog), SEAT, DEFAULT_BUILD_ORDER);
    if (goal === null || zoneOf(sim, goal) !== enemyZone) throw new Error('setup: the enemy start is due');
    const { world } = sim;
    const scout = ownedSettlers(world, SEAT).find((e) => world.get(e, Settler).jobType === SCOUT);
    const terrain = sim.terrain;
    const carrier = aiControlEntity(world, SEAT);
    if (scout === undefined || terrain === undefined || carrier === null) throw new Error('setup: a scout');
    // Halfway there, beside a tower post the seat saw manned.
    const midX = (HOME.x + OTHER_START.x) / 2;
    world.mut(scout, Position).x = positionOfNode(midX, HOME.y).x;
    world.mut(scout, Position).y = positionOfNode(midX, HOME.y).y;
    world.add(scout, PlayerOrder, {});
    world.add(scout, MoveGoal, { cell: terrain.nodeAt(goal.hx, goal.hy) });
    world.remove(scout, CurrentAtomic);
    world.mut(carrier, ComputerIntel).buildings.push({
      entity: TOWER_POST,
      owner: OTHER,
      buildingType: HQ_TYPE,
      hx: midX,
      hy: HOME.y,
      seenAt: NOW,
      posted: 1,
      postedPoints: 1,
    });
    const [order] = scoutModule(DEFAULT_BUILD_ORDER).run(world, ctxAt(sim, NOW, fog), SEAT);
    expect(order).toMatchObject({ kind: 'moveUnit', entity: scout });
    const next = nextStaleZoneTarget(world, ctxAt(sim, NOW, fog), SEAT, DEFAULT_BUILD_ORDER);
    expect(zoneOf(sim, next)).not.toBe(enemyZone);
    const later = NOW + SCOUT_TURN_BACK_MEMORY_TICKS;
    expect(zoneOf(sim, nextStaleZoneTarget(world, ctxAt(sim, later, fog), SEAT, DEFAULT_BUILD_ORDER))).toBe(
      enemyZone,
    );
  });

  it('erects no signpost in a zone that took a scout', () => {
    const sim = staleSim();
    const ctx = ctxAt(sim, NOW);
    const post = nextSignpostTarget(sim.world, ctx, SEAT, DEFAULT_BUILD_ORDER);
    if (post === null) throw new Error('setup: the lattice wants a post');
    const lostZone = zoneOf(sim, post);
    if (lostZone === null) throw new Error('setup: a zone');
    scoutLostAt(sim)[lostZone] = NOW;
    expect(zoneOf(sim, nextSignpostTarget(sim.world, ctx, SEAT, DEFAULT_BUILD_ORDER))).not.toBe(lostZone);
  });

  it('keeps the old orders with the fog off', () => {
    const sim = staleSim();
    // The seat starts small, so its scout waits until then.
    const tick = SMALL_START_SCOUT_FROM_TICKS;
    expect(scoutingLeads(tick)).toBe(true);
    const ctx = ctxAt(sim, tick);
    expect(nextStaleZoneTarget(sim.world, ctx, SEAT, DEFAULT_BUILD_ORDER)).toBeNull();
    const post = nextSignpostTarget(sim.world, ctx, SEAT, DEFAULT_BUILD_ORDER);
    if (post === null) throw new Error('setup: the lattice wants a post');
    const [order] = scoutModule(DEFAULT_BUILD_ORDER).run(sim.world, ctx, SEAT);
    expect(order).toMatchObject({ kind: 'placeSignpost', x: post.hx, y: post.hy });
  });

  it('keeps a scout with no post to erect for the stale zones once scouting opens', () => {
    const sim = staleSim([], true);
    plantPost(sim, positionOfNode(HOME.x, HOME.y));
    for (const [q, r] of LATTICE_RING) {
      const o = signpostLatticeOffset(q, r);
      plantPost(sim, positionOfNode(HOME.x + o.dx, HOME.y + o.dy));
    }
    const fog = fogOfWar(sim);
    const opensAt = ASSUMED_PEACE_TICKS - SCOUTING_DEADLINE_LEAD_TICKS;
    expect(nextSignpostTarget(sim.world, ctxAt(sim, opensAt, fog), SEAT, DEFAULT_BUILD_ORDER)).toBeNull();
    const scout = ownedSettlers(sim.world, SEAT).find((e) => sim.world.get(e, Settler).jobType === SCOUT);
    if (scout === undefined) throw new Error('setup: the seat has a scout');
    const retrades = (tick: number) =>
      collectModule
        .run(sim.world, ctxAt(sim, tick, fog), SEAT)
        .filter((c) => c.kind === 'setJob' && c.entity === scout);
    expect(retrades(opensAt - 1)).toEqual([{ kind: 'setJob', entity: scout, jobType: BUILDER }]);
    expect(retrades(opensAt)).toEqual([]);
  });

  it('leaves the enemy unscouted until the military deadline nears', () => {
    const sim = staleSim([DEPOSIT], true);
    const fog = fogOfWar(sim);
    const leadingRound = (from: number): number => {
      const round = Math.ceil(from / SCOUTING_ROUND_TICKS);
      return (round % 2 === 1 ? round : round + 1) * SCOUTING_ROUND_TICKS;
    };
    const opensAt = ASSUMED_PEACE_TICKS - SCOUTING_DEADLINE_LEAD_TICKS;
    const early = leadingRound(NOW);
    const open = leadingRound(opensAt);
    expect(early).toBeLessThan(opensAt);
    const guide = scoutModule(DEFAULT_BUILD_ORDER);
    expect(guide.run(sim.world, ctxAt(sim, early, fog), SEAT)[0]).toMatchObject({ kind: 'placeSignpost' });
    const zone = nextStaleZoneTarget(sim.world, ctxAt(sim, open, fog), SEAT, DEFAULT_BUILD_ORDER);
    if (zone === null) throw new Error('setup: a zone is stale');
    const walk = guide.run(sim.world, ctxAt(sim, open, fog), SEAT)[0];
    if (walk?.kind !== 'moveUnit') throw new Error('expected a walk');
    // The zone lies past one leg: the walk goes a leg's length along the way to it.
    const at = scoutNode(sim);
    const leg = { hx: walk.x, hy: walk.y };
    expect(nodeManhattan(at, zone)).toBeGreaterThan(SCOUT_LEG_NODES);
    expect(nodeManhattan(at, leg)).toBeLessThanOrEqual(SCOUT_LEG_NODES + SCOUT_LEG_SNAP_NODES);
    expect(nodeManhattan(leg, zone)).toBeLessThan(nodeManhattan(at, zone) - SCOUT_LEG_NODES / 2);
  });
});

function scoutNode(sim: Simulation): HalfCellNode {
  const scout = ownedSettlers(sim.world, SEAT).find((e) => sim.world.get(e, Settler).jobType === SCOUT);
  if (scout === undefined) throw new Error('setup: a scout');
  const p = sim.world.get(scout, Position);
  return nodeOfPosition(p.x, p.y);
}
