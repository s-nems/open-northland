import { describe, expect, it } from 'vitest';
import {
  AiControl,
  aiControlEntity,
  ComputerIntel,
  FOG_MODE,
  mapBriefOf,
  NEVER_SEEN,
  Settler,
  zoneOfNode,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../../../src/index.js';
import { anchorNodeOf } from '../../../../../src/systems/ai-shared/node-geometry.js';
import { ownedBuildings, ownedSettlers } from '../../../../../src/systems/ai-shared/seat-roster.js';
import {
  believedEnemyBuildings,
  believedFighterStrength,
  computerDecisionDue,
  FORCE_PEAK_HALF_LIFE_TICKS,
  INTEL_DECISION_PHASE,
  SCOUT_LOSS_MEMORY_TICKS,
  scoutLossZones,
  summarizeIntel,
  updateComputerIntel,
} from '../../../../../src/systems/computer-player/index.js';
import type { SystemContext } from '../../../../../src/systems/index.js';
import { removeSettlerSilently } from '../../../../../src/systems/lifecycle/death.js';
import { ownedFightersOf } from '../../../../../src/systems/movement/collision/owned-fighters.js';
import { cellOfNode } from '../../../../../src/systems/vision/gates.js';
import type { FogState } from '../../../../../src/systems/vision/state.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';
import {
  BUILDER,
  ctxOf,
  HQ_X,
  HQ_Y,
  makeAiSeat,
  placeHq,
  SCOUT,
  SEAT,
  STOCK_TYPE,
  UNARMED,
  VIKING,
} from '../../support.js';

const MAP_W = 128;
const MAP_H = 64;
const OTHER = 1;
/** The other seat's start building, and a spot far from it for one raised after the scan. */
const OTHER_START = { x: 100, y: 40 };
const OTHER_LATER = { x: 100, y: 10 };
const SIGHT_RADIUS = 2;
const FIGHTERS = 3;

function intelSim(computerEnabled = true): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(MAP_W, MAP_H) });
  makeAiSeat(sim, SEAT);
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier !== null) sim.world.mut(carrier, AiControl).computerEnabled = computerEnabled;
  placeHq(sim);
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: OTHER, tribes: [VIKING] });
  placeOther(sim, OTHER_START);
  sim.step();
  return sim;
}

function placeOther(sim: Simulation, at: { x: number; y: number }): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: STOCK_TYPE, ...at, tribe: VIKING, owner: OTHER });
}

/** The other seat's newest building. */
function newestOther(sim: Simulation): Entity {
  const owned = ownedBuildings(sim.world, OTHER);
  const newest = owned[owned.length - 1];
  if (newest === undefined) throw new Error('setup: the other seat has no building');
  return newest;
}

/** The first tick from `after` on which the seat's intel pass runs. */
function intelTick(after: number): number {
  let tick = after;
  while (!computerDecisionDue(tick - INTEL_DECISION_PHASE, SEAT)) tick++;
  return tick;
}

function observeAt(sim: Simulation, tick: number, fog?: FogState): void {
  const ctx: SystemContext = { ...ctxOf(sim, tick), content: sim.content, ...(fog ? { fog } : {}) };
  updateComputerIntel(sim.world, ctx, [SEAT]);
}

/** The sim's masks under a fog-of-war mode; the tests stamp and lower sight by hand and never step. */
function fogOfWar(sim: Simulation): FogState {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('setup: a mapped sim has fog');
  fog.activeMode = FOG_MODE.CLASSIC_FOG_OF_WAR;
  return fog;
}

function lookAt(fog: FogState, sim: Simulation, e: Entity): void {
  const node = anchorNodeOf(sim.world, e);
  if (node === null) throw new Error('setup: building without a position');
  const { cx, cy } = cellOfNode(node.hx, node.hy);
  fog.stampSight(SEAT, cx, cy, SIGHT_RADIUS);
}

function lookAway(fog: FogState): void {
  fog.downgradeVisible(fog.visionGroupOf(SEAT));
}

const believed = (sim: Simulation): Entity[] => believedEnemyBuildings(sim.world, SEAT).map((b) => b.entity);

/** A sim with a building of the other seat raised after the scan, seen once and then out of sight. */
function seenThenFogged(): { sim: Simulation; fog: FogState; later: Entity; tick: number } {
  const sim = intelSim();
  placeOther(sim, OTHER_LATER);
  sim.step();
  const later = newestOther(sim);
  const fog = fogOfWar(sim);
  const first = intelTick(sim.tick);
  observeAt(sim, first, fog);
  expect(believed(sim)).not.toContain(later);
  lookAt(fog, sim, later);
  const tick = intelTick(first + 1);
  observeAt(sim, tick, fog);
  lookAway(fog);
  return { sim, fog, later, tick };
}

/** The seat's scout spawned at `at`, observed once there. */
function scoutObservedAt(sim: Simulation, at: { x: number; y: number }): { scout: Entity; tick: number } {
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, ...at, tribe: VIKING, owner: SEAT });
  sim.step();
  const scout = ownedSettlers(sim.world, SEAT).find((e) => sim.world.get(e, Settler).jobType === SCOUT);
  if (scout === undefined) throw new Error('setup: the seat has a scout');
  const tick = intelTick(sim.tick);
  observeAt(sim, tick);
  return { scout, tick };
}

describe('computer seat intel - lost scouts', () => {
  it('remembers the zone a scout was lost in for the loss memory', () => {
    const sim = intelSim();
    const { scout, tick } = scoutObservedAt(sim, OTHER_LATER);
    removeSettlerSilently(sim.world, scout);
    const next = intelTick(tick + 1);
    observeAt(sim, next);
    const brief = mapBriefOf(sim.world);
    if (brief === null) throw new Error('setup: the seat scanned the map');
    const lost = zoneOfNode(brief, OTHER_LATER.x, OTHER_LATER.y);
    expect(scoutLossZones(sim.world, SEAT, next, SCOUT_LOSS_MEMORY_TICKS)).toEqual([lost]);
    expect(scoutLossZones(sim.world, SEAT, next + SCOUT_LOSS_MEMORY_TICKS, SCOUT_LOSS_MEMORY_TICKS)).toEqual(
      [],
    );
  });

  it('records no loss for a scout who changed trade, nor for one lost in the settlement', () => {
    const sim = intelSim();
    const away = scoutObservedAt(sim, OTHER_LATER);
    sim.world.add(away.scout, Settler, { ...sim.world.get(away.scout, Settler), jobType: BUILDER });
    const home = scoutObservedAt(sim, { x: HQ_X - 4, y: HQ_Y });
    removeSettlerSilently(sim.world, home.scout);
    const next = intelTick(home.tick + 1);
    observeAt(sim, next);
    expect(scoutLossZones(sim.world, SEAT, next, SCOUT_LOSS_MEMORY_TICKS)).toEqual([]);
  });
});

describe('computer seat intel', () => {
  it('knows the start buildings of the other seats before seeing them', () => {
    const sim = intelSim();
    expect(believedEnemyBuildings(sim.world, SEAT)).toEqual([
      expect.objectContaining({ owner: OTHER, buildingType: STOCK_TYPE, seenAt: NEVER_SEEN }),
    ]);
  });

  it('remembers a building it saw after the building leaves its sight', () => {
    const { sim, fog, later, tick } = seenThenFogged();
    observeAt(sim, intelTick(tick + 1), fog);
    expect(believedEnemyBuildings(sim.world, SEAT).find((b) => b.entity === later)?.seenAt).toBe(tick);
  });

  it('forgets a building only once it sees the spot empty', () => {
    const { sim, fog, later, tick } = seenThenFogged();
    sim.world.destroy(later);
    const unseen = intelTick(tick + 1);
    observeAt(sim, unseen, fog);
    expect(believed(sim)).toContain(later);
    fog.stampSight(SEAT, OTHER_LATER.x >> 1, OTHER_LATER.y >> 1, SIGHT_RADIUS);
    observeAt(sim, intelTick(unseen + 1), fog);
    expect(believed(sim)).not.toContain(later);
  });

  it('sees every building and zone with the fog off', () => {
    const sim = intelSim();
    placeOther(sim, OTHER_LATER);
    const due = intelTick(sim.tick + 1);
    while (sim.tick <= due) sim.step();
    const later = newestOther(sim);
    expect(believed(sim)).toContain(later);
    const carrier = aiControlEntity(sim.world, SEAT);
    const intel = carrier === null ? undefined : sim.world.tryGet(carrier, ComputerIntel);
    if (intel === undefined) throw new Error('the seat has no intel');
    const summary = summarizeIntel(intel, sim.tick);
    expect(summary.zonesSeen).toBe(summary.zones);
    expect(summary.owners.map((o) => [o.owner, o.unseenBuildings])).toEqual([[OTHER, 0]]);
  });

  it('remembers the most fighters seen at once and lets the peak decay', () => {
    const sim = intelSim();
    for (let i = 0; i < FIGHTERS; i++) {
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: UNARMED,
        x: 90 + 2 * i,
        y: 30,
        tribe: VIKING,
        owner: OTHER,
      });
    }
    sim.step();
    const first = intelTick(sim.tick);
    observeAt(sim, first);
    for (const e of ownedFightersOf(sim.world, sim.content, OTHER).slice(1)) sim.world.destroy(e);
    observeAt(sim, intelTick(first + 1));
    expect(believedFighterStrength(sim.world, SEAT, OTHER, first)).toBe(FIGHTERS);
    expect(believedFighterStrength(sim.world, SEAT, OTHER, first + FORCE_PEAK_HALF_LIFE_TICKS)).toBe(
      FIGHTERS >> 1,
    );
    expect(
      believedFighterStrength(sim.world, SEAT, OTHER, first + 2 * FORCE_PEAK_HALF_LIFE_TICKS),
    ).toBeNull();
  });

  it('keeps no memory for a seat whose computer controller does not run', () => {
    const sim = intelSim(false);
    const due = intelTick(sim.tick);
    while (sim.tick <= due) sim.step();
    expect([...sim.world.query(ComputerIntel)]).toEqual([]);
  });

  it('survives a save and restore unchanged', () => {
    const sim = intelSim();
    const due = intelTick(sim.tick);
    while (sim.tick <= due) sim.step();
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no seat');
    const before = structuredClone(sim.world.get(carrier, ComputerIntel));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: aiContent(),
      map: grassNodeMap(MAP_W, MAP_H),
    });
    const held = aiControlEntity(restored.world, SEAT);
    expect(held === null ? undefined : restored.world.get(held, ComputerIntel)).toEqual(before);
  });
});
