import { describe, expect, it } from 'vitest';
import { Building, Owner, Settler } from '../../../../src/components/index.js';
import { CommandQueue } from '../../../../src/core/command-queue.js';
import type { Command } from '../../../../src/core/commands/index.js';
import { PersonalNames } from '../../../../src/core/personal-names.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { EventBuffer, Rng, Simulation } from '../../../../src/index.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../../../src/nav/terrain/index.js';
import { planSettlementDefence } from '../../../../src/systems/ai-shared/military/settlement-defence.js';
import {
  militaryModule,
  TOWER_GARRISON_ARCHERS,
  threatWatchNodes,
} from '../../../../src/systems/computer-player/index.js';
import type { StandGround } from '../../../../src/systems/computer-player/military/temple-station.js';
import {
  STAND_BEHIND_TOWERS_NODES,
  towerStandToward,
} from '../../../../src/systems/computer-player/military/tower-stand.js';
import { standsAtPost } from '../../../../src/systems/conflict/tower-post.js';
import type { SystemContext } from '../../../../src/systems/context.js';
import { dynamicBlockOverlay } from '../../../../src/systems/footprint/index.js';
import { TEMPLE_AURA_RANGE } from '../../../../src/systems/lifecycle/temple-aura.js';
import { entityNode } from '../../../../src/systems/spatial/nodes.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

/** Where a seat awaiting a scripted attack stands its army: behind its manned towers facing the attacks. */

const VIKING = 1;
const SEAT = 2;
const HQ_TYPE = 1;
const BARRACKS_TYPE = 12;
const TOWER_TYPE = 15;
const BOWMAN = 40;
/** Long enough for a posted archer to walk the few nodes to his tower and step inside. */
const WALK_IN_TICKS = 200;
const ROW_SPAWNS = 8;
/** The defence suite's seed, so the garrison posting rolls as it does there. */
const SEED = 7;
/** A tower east of the barracks, toward where the attacks come from, and the base west of both. */
const STAND_TOWER = { x: 56, y: 40 };
const STAND_BASE = { x: 16, y: 40 };
const ATTACK_ORIGIN = { hx: 120, hy: 40 };
const BASE: HalfCellNode = { hx: STAND_BASE.x, hy: STAND_BASE.y };

function aiSim(): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(128, 96) });
}

function terrainOf(sim: Simulation): TerrainGraph {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return terrain;
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: aiContent(),
    rng: new Rng(SEED),
    names: new PersonalNames(1, []),
    tick: 0,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    terrain: terrainOf(sim),
  };
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }): Entity {
  const before = new Set(sim.world.query(Building));
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner: SEAT });
  sim.step();
  const placed = [...sim.world.query(Building)].find((e) => !before.has(e));
  if (placed === undefined) throw new Error(`setup: building ${buildingType} was refused`);
  return placed;
}

/** Standing archers, two nodes apart so no two share a node, {@link ROW_SPAWNS} to a row. */
function spawnArchers(sim: Simulation, count: number, at: { x: number; y: number }): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (let i = 0; i < count; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: BOWMAN,
      x: at.x + 2 * (i % ROW_SPAWNS),
      y: at.y + 2 * Math.floor(i / ROW_SPAWNS),
      tribe: VIKING,
      owner: SEAT,
    });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

function nodeOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const terrain = terrainOf(sim);
  return terrain.coordsOf(entityNode(sim.world, terrain, e));
}

function owned(sim: Simulation): Entity[] {
  return [...sim.world.query(Building)].filter((e) => sim.world.get(e, Owner).player === SEAT);
}

/** The seat with its base, barracks and a tower whose archers have walked in and taken their posts. */
function mannedTowerSim(): { sim: Simulation; tower: Entity } {
  const sim = aiSim();
  place(sim, HQ_TYPE, STAND_BASE);
  place(sim, BARRACKS_TYPE, { x: STAND_TOWER.x - 8, y: STAND_TOWER.y - 10 });
  const tower = place(sim, TOWER_TYPE, STAND_TOWER);
  const archers = spawnArchers(sim, TOWER_GARRISON_ARCHERS, { x: STAND_TOWER.x - 4, y: STAND_TOWER.y - 6 });
  const ctx = ctxOf(sim);
  const commands: Command[] = [
    ...planSettlementDefence(sim.world, ctx, terrainOf(sim), SEAT, true).commands,
    ...militaryModule.run(sim.world, ctx, SEAT),
  ];
  for (const command of commands) sim.enqueueSetup(command);
  sim.step();
  for (let i = 0; i < WALK_IN_TICKS; i++) sim.step();
  if (!archers.every((e) => standsAtPost(sim.world, e) === tower)) throw new Error('setup: tower not manned');
  return { sim, tower };
}

function standOf(sim: Simulation, temples: readonly HalfCellNode[] = []): { x: number; y: number } | null {
  const terrain = terrainOf(sim);
  const ctx = ctxOf(sim);
  const ground: StandGround = { temples, blocked: dynamicBlockOverlay(sim.world, ctx, terrain) };
  const door = terrain.nodeAt(STAND_BASE.x, STAND_BASE.y);
  const stand = towerStandToward(sim.world, ctx, terrain, owned(sim), BASE, ATTACK_ORIGIN, door, ground);
  return stand === null ? null : terrain.coordsOf(stand);
}

describe('towerStandToward - the stand under the tower line', () => {
  it('stands behind the manned tower facing the attacks, toward the base and under its reach', () => {
    const { sim, tower } = mannedTowerSim();
    const towerAt = nodeOf(sim, tower);
    const at = standOf(sim);
    if (at === null) throw new Error('expected a stand behind the tower');
    expect(at.x).toBeLessThan(towerAt.x);
    expect(at.x).toBeGreaterThan(STAND_BASE.x);
    expect(towerAt.x - at.x).toBeLessThanOrEqual(STAND_BEHIND_TOWERS_NODES + 1);
    expect(Math.abs(at.y - towerAt.y)).toBeLessThanOrEqual(1);
  });

  it('moves the stand into a temple aura the front tower still reaches, and keeps it under the towers else', () => {
    const { sim, tower } = mannedTowerSim();
    const towerAt = nodeOf(sim, tower);
    const plain = standOf(sim);
    if (plain === null) throw new Error('expected a stand behind the tower');

    // A temple behind the base: the stand steps back to its aura, still under the tower.
    const behind = { hx: STAND_BASE.x - 10, hy: STAND_BASE.y };
    const blessed = standOf(sim, [behind]);
    if (blessed === null) throw new Error('expected a stand behind the tower');
    expect(blessed.x).toBeLessThan(plain.x);
    expect(hexDistanceBetween(behind.hx, behind.hy, blessed.x, blessed.y)).toBeLessThanOrEqual(
      TEMPLE_AURA_RANGE,
    );
    expect(hexDistanceBetween(towerAt.x, towerAt.y, blessed.x, blessed.y)).toBeLessThanOrEqual(
      threatWatchNodes(ctxOf(sim), VIKING),
    );

    // A temple in a far corner: its aura lies out of the tower's reach, so the stand stays.
    expect(standOf(sim, [{ hx: 0, hy: 95 }])).toEqual(plain);
  });

  it('has no stand without a manned tower', () => {
    const sim = aiSim();
    place(sim, HQ_TYPE, STAND_BASE);
    place(sim, TOWER_TYPE, STAND_TOWER);
    expect(standOf(sim)).toBeNull();
  });
});
