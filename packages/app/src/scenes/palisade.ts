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
 * Palisade acceptance field. The upper enclosure converts five standing walls into a commanded gate,
 * the eastern section is breached by a commanded enemy attack, and the lower work yard raises walls from
 * carried wood while retaining claimed and unclaimed construction markers. The yard's builders also mend
 * a wall the map authored below its maximum, unasked.
 * The detached seven-post rosette makes all six source wall-connection directions visible at once.
 *
 * Source basis: readable wall records pin 100 maximum valency and +3 repair progress. Original
 * behavior: one wood per placed anchor, interpolated posts along three canonical neighbour directions,
 * and the instant conversion of a straight five-wall span into a gate, which lives in
 * `palisadeGateProbe`. The original reserves a segment before travel; the physical visit before its
 * flag appears is a lifecycle adaptation. Treating valency as hitpoints and unfinished walls as
 * passable are also adaptations. Shared catalog data owns the rules rather than this scene.
 */

const MAP_W = 34;
const MAP_H = 22;
const BARRIER_HY = 22;
export const PALISADE_GATE = { hx: 18, hy: BARRIER_HY } as const;
const GATE = PALISADE_GATE;
const BREACH = { hx: 50, hy: BARRIER_HY } as const;
const CONNECTION_HUB = { hx: 38, hy: 8 } as const;
export const PALISADE_WORK_SITES = {
  owned: [
    { hx: 4, hy: 36 },
    { hx: 5, hy: 36 },
    { hx: 6, hy: 36 },
  ],
  // Enemy ground, north of the barrier: a civilian flees any hostile structure inside its sight radius,
  // so an enemy marker beside the work yard would freeze the builders instead of demonstrating them.
  unclaimed: { hx: 44, hy: 12 },
} as const;
/** Authored at 70 of 100 valency: ten repair swings. */
const DAMAGED_YARD_WALL = { hx: 8, hy: 40, valency: 70 } as const;
const COMMAND_CHAIN = [
  { hx: 30, hy: 36 },
  { hx: 31, hy: 36 },
  { hx: 32, hy: 36 },
] as const;
const SOUTH = { hx: GATE.hx, hy: 34 } as const;
const RAIDER_GOAL = { hx: BREACH.hx, hy: 34 } as const;

/** Exported phase boundaries let the focused test inspect the real mid-scene gate states. */
export const PALISADE_GATE_CLOSE_TICK = 400;
export const PALISADE_GATE_REOPEN_TICK = 600;
export const PALISADE_RUN_TICKS = 1_100;

/** The scene's scripted orders take the last position of their tick. The session numbers a live order
 *  from 0 up within its tick, so a player's order in the same tick can never claim the same position. */
const SCRIPTED_SEQUENCE = Number.MAX_SAFE_INTEGER;

const { Damaged, Health, Owner, Palisade, Position, Settler, Stockpile, UnderConstruction } = components;

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

export function palisadeAt(sim: Simulation, hx: number, hy: number): Entity | null {
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
  let gate: Entity | null = null;
  for (let hx = 0; hx < MAP_W * 2; hx++) {
    const wall = standingPalisade(sim, PALISADE_WALL_GFX_INDEX, hx, BARRIER_HY);
    if (hx === BREACH.hx) breach = wall;
    if (hx === GATE.hx) gate = wall;
  }
  if (breach === null) throw new Error('palisade scene did not create its breach target');
  if (gate === null) throw new Error('palisade scene did not create its gate conversion target');

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

  // Two source-corroborated wood units in a real store are hauled and spent by two real builders.
  // Three owned sites retain one exclusive claim after two completions; the enemy-owned site across
  // the barrier has no eligible builder and remains the unclaimed stake marker.
  const warehouse = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, 7, 18, HUMAN_PLAYER);
  sim.world.mut(warehouse, Stockpile).amounts.set(GOOD_WOOD, 2);
  spawnSettlerDirect(sim, JOB_BUILDER, 5, 18, HUMAN_PLAYER);
  spawnSettlerDirect(sim, JOB_BUILDER, 6, 18, HUMAN_PLAYER);
  for (const site of PALISADE_WORK_SITES.owned) {
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: PALISADE_WALL_GFX_INDEX,
      x: site.hx,
      y: site.hy,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
      underConstruction: true,
    });
  }
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: PALISADE_WALL_GFX_INDEX,
    x: DAMAGED_YARD_WALL.hx,
    y: DAMAGED_YARD_WALL.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    valency: DAMAGED_YARD_WALL.valency,
  });
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: PALISADE_WALL_GFX_INDEX,
    x: PALISADE_WORK_SITES.unclaimed.hx,
    y: PALISADE_WORK_SITES.unclaimed.hy,
    tribe: PRIMARY_TRIBE,
    owner: ENEMY_PLAYER,
    underConstruction: true,
  });

  const firstTraveller = spawnSettlerDirect(sim, JOB_WOMAN, 9, 6, HUMAN_PLAYER);
  const secondTraveller = spawnSettlerDirect(sim, JOB_CIVILIST, 9, 7, HUMAN_PLAYER);
  const raider = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, 25, 7, ENEMY_PLAYER);

  sim.enqueueSetup({
    kind: 'convertPalisadeGate',
    palisade: gate,
    gfxIndex: PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX,
  });
  const at = (tick: number, command: Parameters<typeof setupCommand>[0]): void =>
    sim.enqueueAt(setupCommand(command), tick, SCRIPTED_SEQUENCE);
  at(20, { kind: 'setPalisadeGate', palisade: gate, open: true });
  at(25, { kind: 'moveUnit', entity: firstTraveller, x: SOUTH.hx, y: SOUTH.hy });
  at(PALISADE_GATE_CLOSE_TICK, { kind: 'setPalisadeGate', palisade: gate, open: false });
  at(420, { kind: 'moveUnit', entity: secondTraveller, x: SOUTH.hx, y: SOUTH.hy });
  at(PALISADE_GATE_REOPEN_TICK, { kind: 'setPalisadeGate', palisade: gate, open: true });
  at(610, { kind: 'moveUnit', entity: secondTraveller, x: SOUTH.hx, y: SOUTH.hy });
  at(900, { kind: 'setPalisadeGate', palisade: gate, open: false });

  at(1, { kind: 'attackUnit', entity: raider, target: breach });
  // Once the focused attack has landed its tenth blow, hold fire so autonomous target selection does
  // not pull the soldier sideways onto the neighbouring posts. The later player move is issued after
  // the gate has closed and can succeed only through the destroyed segment.
  at(320, { kind: 'setStance', entity: raider, mode: systems.MILITARY_MODE.IGNORE });
  at(720, { kind: 'moveUnit', entity: raider, x: RAIDER_GOAL.hx, y: RAIDER_GOAL.hy });
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
      label: 'two stored wood and two real builders raised two commanded anchors to full health',
      predicate: (sim) => {
        const completed = PALISADE_WORK_SITES.owned.flatMap((node) => {
          const wall = palisadeAt(sim, node.hx, node.hy);
          return wall !== null && !sim.world.has(wall, UnderConstruction) ? [wall] : [];
        });
        return (
          completed.length === 2 &&
          completed.every((wall) => {
            const health = sim.world.get(wall, Health);
            return (
              sim.world.get(wall, Palisade).built === ONE && health.hitpoints === 100 && health.max === 100
            );
          })
        );
      },
    },
    {
      label: 'the yard builders mended the authored damaged wall to full health with no order',
      predicate: (sim) => {
        const wall = palisadeAt(sim, DAMAGED_YARD_WALL.hx, DAMAGED_YARD_WALL.hy);
        return (
          wall !== null && !sim.world.has(wall, Damaged) && sim.world.get(wall, Health).hitpoints === 100
        );
      },
    },
    {
      label: 'gate conversion kept the outer posts of its span and cleared only the two neighbours',
      predicate: (sim) => {
        const gate = palisadeAt(sim, GATE.hx, GATE.hy);
        if (gate === null || sim.world.get(gate, Palisade).gate === null) return false;
        return (
          palisadeAt(sim, GATE.hx - 2, GATE.hy) !== null &&
          palisadeAt(sim, GATE.hx - 1, GATE.hy) === null &&
          palisadeAt(sim, GATE.hx + 1, GATE.hy) === null &&
          palisadeAt(sim, GATE.hx + 2, GATE.hy) !== null
        );
      },
    },
    {
      label: 'the work yard retains one exclusive claim and one unclaimed staked site',
      predicate: (sim) => {
        const claimed = PALISADE_WORK_SITES.owned.filter((node) => {
          const wall = palisadeAt(sim, node.hx, node.hy);
          return (
            wall !== null &&
            sim.world.has(wall, UnderConstruction) &&
            sim.world.get(wall, Palisade).reservation !== null
          );
        });
        const unclaimed = palisadeAt(sim, PALISADE_WORK_SITES.unclaimed.hx, PALISADE_WORK_SITES.unclaimed.hy);
        return (
          claimed.length === 1 &&
          unclaimed !== null &&
          sim.world.has(unclaimed, UnderConstruction) &&
          sim.world.get(unclaimed, Palisade).reservation === null
        );
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
