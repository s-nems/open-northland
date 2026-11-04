import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Chest,
  type ChestKind,
  DeferredOrder,
  MealBreak,
  OpenedChest,
  OrderQueue,
  Settler,
} from '../../../../src/components/index.js';
import { aiCommand, type PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../../src/index.js';
import type { TerrainMap } from '../../../../src/nav/terrain/index.js';
import { createChest } from '../../../../src/systems/chests/index.js';
import {
  DEFAULT_BUILD_ORDER,
  scoutModule,
  signpostLatticeOffset,
} from '../../../../src/systems/computer-player/index.js';
import type { SystemContext } from '../../../../src/systems/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap, waterColumnMap } from '../../../fixtures/terrain.js';
import { collectModule, ctxOf, placeHq, plantPost, SCOUT, SEAT, VIKING } from '../support.js';

/** The seat opens the chests inside its signpost reach: wooden ones by its scout, magical ones by a druid. */

const guideBuild = scoutModule(DEFAULT_BUILD_ORDER);

const DRUID = 50;
const HERO = 45;
/** Any authored chest type: the errand never reads what is inside. */
const CHEST_CONTENTS = 20;
const CENTER = { x: 128, y: 128 };
/** North of the HQ within his home radius, so with nothing to do he stays put. */
const SCOUT_AT = { x: CENTER.x, y: CENTER.y - 10 };
/** A chest past the eastern lattice post's reach. */
const FAR_EAST = { x: CENTER.x + 90, y: CENTER.y };
/** The cell column of the river east of the base, which leaves the lattice's east post on the near bank. */
const RIVER_COLUMN = 80;
/** Cell rows of grass under the river's foot, the only way round it. */
const FORD_ROWS = 4;
/** Just across the river from the lattice's east post, well inside a post's hex range. */
const ACROSS_RIVER = { x: 2 * RIVER_COLUMN + 6, y: CENTER.y };
const NEAR_BANK = { x: CENTER.x + 12, y: CENTER.y };
/** Ample for a ten-node walk and the open-chest clip. */
const OPEN_WITHIN_TICKS = 2000;

function druidContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: DRUID, id: 'druid' }, { typeId: HERO, id: 'hero_viking' }],
  });
}

/** A seat confined to its signposts, whose HQ and first lattice ring stand, with a scout at home. */
function tiledSim(map: TerrainMap = grassNodeMap(512, 256)): Simulation {
  const sim = new Simulation({ seed: 1, content: druidContent(), map });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  placeHq(sim, CENTER.x, CENTER.y);
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, ...SCOUT_AT, tribe: VIKING, owner: SEAT });
  sim.step();
  plantPost(sim, positionOfNode(CENTER.x, CENTER.y));
  for (const [q, r] of [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ] as const) {
    const o = signpostLatticeOffset(q, r);
    plantPost(sim, positionOfNode(CENTER.x + o.dx, CENTER.y + o.dy));
  }
  return sim;
}

function placeChest(sim: Simulation, kind: ChestKind, at: { x: number; y: number }): Entity {
  return createChest(sim.world, sim.content, { kind, contents: CHEST_CONTENTS, ...at });
}

/** {@link ctxOf} over the sim's own content, which knows the druid. */
function contextOf(sim: Simulation): SystemContext {
  return { ...ctxOf(sim), content: sim.content };
}

/** A fresh settler of `jobType` for the seat at `at`, standing once the sim steps. */
function spawn(sim: Simulation, jobType: number, at: { x: number; y: number }): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType, ...at, tribe: VIKING, owner: SEAT });
  sim.step();
  const born = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (born === undefined) throw new Error(`setup: no settler of job ${jobType} spawned`);
  return born;
}

function scoutOf(sim: Simulation): Entity | undefined {
  return [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === SCOUT);
}

function decide(sim: Simulation): readonly PlayerCommand[] {
  return [...guideBuild.run(sim.world, contextOf(sim), SEAT)];
}

describe('scout module (guideBuild) - opening chests', () => {
  it('sends the scout to the nearest wooden chest inside the signpost reach', () => {
    const sim = tiledSim();
    placeChest(sim, 'wooden', { x: CENTER.x - 30, y: CENTER.y });
    const near = placeChest(sim, 'wooden', { x: CENTER.x, y: CENTER.y - 20 });
    expect(decide(sim)).toEqual([{ kind: 'openChest', entity: scoutOf(sim), chest: near }]);
  });

  it('leaves a chest past the signpost reach shut', () => {
    const sim = tiledSim();
    placeChest(sim, 'wooden', FAR_EAST);
    expect(decide(sim)).toEqual([]);
  });

  it('leaves a chest across a river shut when the only way over is a long walk round', () => {
    const map = waterColumnMap(256, 128, RIVER_COLUMN, FORD_ROWS);
    const across = tiledSim(map);
    placeChest(across, 'wooden', ACROSS_RIVER);
    expect(decide(across)).toEqual([]);

    const near = tiledSim(map);
    const chest = placeChest(near, 'wooden', NEAR_BANK);
    expect(decide(near)).toEqual([{ kind: 'openChest', entity: scoutOf(near), chest }]);
  });

  it('sends a druid, never the scout, to a magical chest', () => {
    const sim = tiledSim();
    const chest = placeChest(sim, 'magical', { x: CENTER.x + 20, y: CENTER.y });
    expect(decide(sim)).toEqual([]);

    const druid = spawn(sim, DRUID, { x: CENTER.x - 4, y: CENTER.y });
    expect(decide(sim)).toEqual([{ kind: 'openChest', entity: druid, chest }]);
  });

  it('never sends a hero to a magical chest, even one standing beside it', () => {
    const sim = tiledSim();
    const chest = placeChest(sim, 'magical', { x: CENTER.x + 20, y: CENTER.y });
    spawn(sim, HERO, { x: CENTER.x + 18, y: CENTER.y });
    expect(decide(sim)).toEqual([]);
    const druid = spawn(sim, DRUID, { x: CENTER.x - 10, y: CENTER.y });
    expect(decide(sim)).toEqual([{ kind: 'openChest', entity: druid, chest }]);
  });

  it('sends no second druid while the first has the chest queued behind a meal or parked', () => {
    for (const hold of ['meal', 'parked'] as const) {
      const sim = tiledSim();
      const chest = placeChest(sim, 'magical', { x: CENTER.x + 20, y: CENTER.y });
      const first = spawn(sim, DRUID, { x: CENTER.x - 4, y: CENTER.y });
      spawn(sim, DRUID, { x: CENTER.x - 8, y: CENTER.y });
      const order = { kind: 'openChest', entity: first, chest } as const;
      if (hold === 'meal') {
        sim.world.add(first, MealBreak, { hungry: true });
        sim.world.add(first, OrderQueue, { orders: [order], owner: SEAT });
      } else {
        sim.world.add(first, DeferredOrder, { command: order });
      }
      expect(decide(sim)).toEqual([]);
    }
  });

  it('keeps an idle scout on while a wooden chest waits in reach', () => {
    const retires = (withChest: boolean): boolean => {
      const sim = tiledSim();
      if (withChest) placeChest(sim, 'wooden', { x: CENTER.x + 20, y: CENTER.y });
      const scout = scoutOf(sim);
      return [...collectModule.run(sim.world, contextOf(sim), SEAT)].some(
        (c) => c.kind === 'setJob' && c.entity === scout,
      );
    };
    expect(retires(false)).toBe(true);
    expect(retires(true)).toBe(false);
  });

  it("opens the chest under the seat's own command authority", () => {
    const sim = tiledSim();
    const chest = placeChest(sim, 'wooden', { x: CENTER.x + 10, y: CENTER.y });
    for (const command of decide(sim)) sim.enqueue(aiCommand(SEAT, command));
    for (let t = 0; t < OPEN_WITHIN_TICKS && sim.world.has(chest, Chest); t++) sim.step();
    expect(sim.world.has(chest, OpenedChest)).toBe(true);
  });
});
