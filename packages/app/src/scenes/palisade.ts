import {
  components,
  type Entity,
  hexNeighboursOf,
  nodeOfPosition,
  ONE,
  type Simulation,
  setupCommand,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER, JOB_CIVILIST, JOB_SOLDIER_SWORD, JOB_WOMAN } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_WOOD,
  PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX,
  PALISADE_WALL_GFX_INDEX,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Palisade acceptance field. The upper enclosure has a commanded gate crossing, the eastern section is
 * breached by a commanded enemy attack, and the lower work yard raises one wall from exactly one wood.
 * The detached seven-post rosette makes all six source wall-connection directions visible at once.
 *
 * Source basis: readable wall records pin 100 maximum valency and +3 repair progress. Original
 * behavior: one wood per placed anchor and interpolated posts along three canonical neighbour
 * directions. Treating valency as hitpoints and making unfinished walls passable are explicit
 * gameplay adaptations. The rules themselves live in the shared sandbox palisade catalog.
 */

const MAP_W = 34;
const MAP_H = 22;
const BARRIER_HY = 22;
const GATE = { hx: 18, hy: BARRIER_HY } as const;
const GATE_LEFT = GATE.hx - 2;
const GATE_RIGHT = GATE.hx + 2;
const BREACH = { hx: 50, hy: BARRIER_HY } as const;
const CONNECTION_HUB = { hx: 38, hy: 8 } as const;
const BUILD_SITE = { hx: 4, hy: 36 } as const;
const COMMAND_CHAIN = [
  { hx: 30, hy: 36 },
  { hx: 31, hy: 36 },
  { hx: 32, hy: 36 },
] as const;
const SOUTH = { hx: GATE.hx, hy: 34 } as const;
const RAIDER_GOAL = { hx: BREACH.hx, hy: 34 } as const;

/** Exported phase boundaries let the focused test inspect the real mid-scene gate states. */
export const PALISADE_GATE_CLOSE_TICK = 180;
export const PALISADE_GATE_REOPEN_TICK = 350;
export const PALISADE_RUN_TICKS = 1_100;

const { Health, Owner, Palisade, Position, Settler, Stockpile, UnderConstruction } = components;

function standingPalisade(
  sim: Simulation,
  gfxIndex: number,
  hx: number,
  hy: number,
  owner = HUMAN_PLAYER,
): Entity {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('palisade scene requires terrain');
  const type = systems.palisadeType(terrain, gfxIndex);
  if (type === undefined) throw new Error(`palisade scene has no fallback record ${gfxIndex}`);
  const entity = systems.createPalisade(sim.world, type, {
    x: hx,
    y: hy,
    tribe: PRIMARY_TRIBE,
    owner,
    underConstruction: false,
  });
  if (entity === null) throw new Error(`palisade scene could not create record ${gfxIndex}`);
  return entity;
}

function atNode(sim: Simulation, e: Entity, hx: number, hy: number): boolean {
  const p = sim.world.get(e, Position);
  const node = nodeOfPosition(p.x, p.y);
  return node.hx === hx && node.hy === hy;
}

function palisadeAt(sim: Simulation, hx: number, hy: number): Entity | null {
  for (const e of sim.world.query(Palisade, Position)) if (atNode(sim, e, hx, hy)) return e;
  return null;
}

function ownedJobSouthOfBarrier(sim: Simulation, jobType: number): boolean {
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
    if (sim.world.get(e, Settler).jobType !== jobType) continue;
    if (nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y).hy > BARRIER_HY)
      return true;
  }
  return false;
}

function enemySoldierSouthOfBarrier(sim: Simulation): boolean {
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player !== ENEMY_PLAYER) continue;
    if (sim.world.get(e, Settler).jobType !== JOB_SOLDIER_SWORD) continue;
    if (nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y).hy > BARRIER_HY)
      return true;
  }
  return false;
}

export function palisadeBreachIsOpen(sim: Simulation): boolean {
  return palisadeAt(sim, BREACH.hx, BREACH.hy) === null;
}

export function raiderCrossedBreach(sim: Simulation): boolean {
  return enemySoldierSouthOfBarrier(sim);
}

function build(sim: Simulation): void {
  let breach: Entity | null = null;
  for (let hx = 0; hx < MAP_W * 2; hx++) {
    if (hx >= GATE_LEFT && hx <= GATE_RIGHT) continue;
    const wall = standingPalisade(sim, PALISADE_WALL_GFX_INDEX, hx, BARRIER_HY);
    if (hx === BREACH.hx) breach = wall;
  }
  if (breach === null) throw new Error('palisade scene did not create its breach target');
  const gate = standingPalisade(sim, PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX, GATE.hx, GATE.hy);

  standingPalisade(sim, PALISADE_WALL_GFX_INDEX, CONNECTION_HUB.hx, CONNECTION_HUB.hy);
  for (const neighbour of hexNeighboursOf(CONNECTION_HUB.hx, CONNECTION_HUB.hy)) {
    standingPalisade(sim, PALISADE_WALL_GFX_INDEX, neighbour.hx, neighbour.hy);
  }

  // These neighbouring anchors deliberately pass through the normal placement check. Their build
  // margins overlap, while their blocking cells do not, matching the way a continuous wall is placed.
  for (const node of COMMAND_CHAIN) {
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: PALISADE_WALL_GFX_INDEX,
      x: node.hx,
      y: node.hy,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
      underConstruction: false,
    });
  }

  // One source-corroborated wood unit in a real store, hauled and spent by a real builder after the
  // public placement command creates the unfinished anchor on tick 1.
  const warehouse = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 7, 18, HUMAN_PLAYER);
  sim.world.mut(warehouse, Stockpile).amounts.set(GOOD_WOOD, 1);
  spawnSettlerDirect(sim, JOB_BUILDER, 5, 18, HUMAN_PLAYER);
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: PALISADE_WALL_GFX_INDEX,
    x: BUILD_SITE.hx,
    y: BUILD_SITE.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    underConstruction: true,
    force: true,
  });

  const firstTraveller = spawnSettlerDirect(sim, JOB_WOMAN, 9, 6, HUMAN_PLAYER);
  const secondTraveller = spawnSettlerDirect(sim, JOB_CIVILIST, 9, 7, HUMAN_PLAYER);
  const raider = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, 25, 7, ENEMY_PLAYER);

  sim.enqueueAt(setupCommand({ kind: 'setPalisadeGate', palisade: gate, open: true }), 20, 0);
  sim.enqueueAt(setupCommand({ kind: 'moveUnit', entity: firstTraveller, x: SOUTH.hx, y: SOUTH.hy }), 25, 0);
  sim.enqueueAt(
    setupCommand({ kind: 'setPalisadeGate', palisade: gate, open: false }),
    PALISADE_GATE_CLOSE_TICK,
    0,
  );
  sim.enqueueAt(
    setupCommand({ kind: 'moveUnit', entity: secondTraveller, x: SOUTH.hx, y: SOUTH.hy }),
    200,
    0,
  );
  sim.enqueueAt(
    setupCommand({ kind: 'setPalisadeGate', palisade: gate, open: true }),
    PALISADE_GATE_REOPEN_TICK,
    0,
  );
  sim.enqueueAt(
    setupCommand({ kind: 'moveUnit', entity: secondTraveller, x: SOUTH.hx, y: SOUTH.hy }),
    360,
    0,
  );
  sim.enqueueAt(setupCommand({ kind: 'setPalisadeGate', palisade: gate, open: false }), 700, 0);

  sim.enqueueAt(setupCommand({ kind: 'attackUnit', entity: raider, target: breach }), 1, 0);
  // Once the focused attack has landed its tenth blow, hold fire so autonomous target selection does
  // not pull the soldier sideways onto the neighbouring posts. The later player move is issued after
  // the gate has closed and can succeed only through the destroyed segment.
  sim.enqueueAt(
    setupCommand({ kind: 'setStance', entity: raider, mode: systems.MILITARY_MODE.IGNORE }),
    320,
    0,
  );
  sim.enqueueAt(
    setupCommand({ kind: 'moveUnit', entity: raider, x: RAIDER_GOAL.hx, y: RAIDER_GOAL.hy }),
    720,
    0,
  );
}

export function palisadeGateIsOpen(sim: Simulation): boolean {
  const gate = palisadeAt(sim, GATE.hx, GATE.hy);
  return gate !== null && sim.world.get(gate, Palisade).gate?.open === true;
}

export function firstTravellerCrossed(sim: Simulation): boolean {
  return ownedJobSouthOfBarrier(sim, JOB_WOMAN);
}

export function secondTravellerCrossed(sim: Simulation): boolean {
  return ownedJobSouthOfBarrier(sim, JOB_CIVILIST);
}

export const palisadeScene: SceneDefinition = {
  id: 'palisade',
  seed: 67,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: PALISADE_RUN_TICKS,
  initialZoom: 2,
  checks: [
    {
      label: 'all six wall-neighbour directions are represented around the connection hub',
      predicate: (sim) =>
        palisadeAt(sim, CONNECTION_HUB.hx, CONNECTION_HUB.hy) !== null &&
        hexNeighboursOf(CONNECTION_HUB.hx, CONNECTION_HUB.hy).every(
          (node) => palisadeAt(sim, node.hx, node.hy) !== null,
        ),
    },
    {
      label: 'ordinary placement commands accepted a continuous three-anchor wall chain',
      predicate: (sim) => COMMAND_CHAIN.every((node) => palisadeAt(sim, node.hx, node.hy) !== null),
    },
    {
      label: 'one stored wood and one builder raised the commanded wall anchor to full health',
      predicate: (sim) => {
        const wall = palisadeAt(sim, BUILD_SITE.hx, BUILD_SITE.hy);
        if (wall === null || sim.world.has(wall, UnderConstruction)) return false;
        const health = sim.world.get(wall, Health);
        if (sim.world.get(wall, Palisade).built !== ONE || health.hitpoints !== 100 || health.max !== 100)
          return false;
        for (const e of sim.world.query(Stockpile)) {
          if ((sim.world.get(e, Stockpile).amounts.get(GOOD_WOOD) ?? 0) > 0) return false;
        }
        return true;
      },
    },
    {
      label: 'both travellers crossed through commanded open phases and the gate closed behind them',
      predicate: (sim) =>
        firstTravellerCrossed(sim) && secondTravellerCrossed(sim) && !palisadeGateIsOpen(sim),
    },
    {
      label: 'the enemy soldier destroyed the commanded segment',
      predicate: palisadeBreachIsOpen,
    },
    {
      label: 'the enemy soldier crossed through the destroyed segment while the gate was closed',
      predicate: raiderCrossedBreach,
    },
  ],
};
