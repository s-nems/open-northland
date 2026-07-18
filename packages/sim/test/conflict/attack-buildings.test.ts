import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Health, Owner, Position, Settler, Stance } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  fx,
  halfCellMapFromCells,
  ONE,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';

// Warriors sieging enemy BUILDINGS — the target/order/damage/priority slice: a building joins the combat
// target index (never as a seeker), takes the weapon's vs-building (HOUSE) column, and is razed at 0 HP
// through the demolish path. Auto-focus prefers units + HQ + towers on par, dropping to a plain building
// only when none of those remains in sight (user rule).

const VIKING = 1;
const SOLDIER = 1;
const ARCHER = 2;
const P1 = 1; // the attacking player
const P2 = 2; // the defending player (owns the buildings)

const HEADQUARTERS = 1;
const TOWER = 2;
const HOME = 3;

const MELEE_VS_UNARMORED = 40;
const MELEE_VS_BUILDING = 25; // the weapon's HOUSE (material 7) column — distinct from vs-unarmored
const BOW_VS_BUILDING = 15;

/** One tribe fought across two players (the OWNER axis decides hostility), with a soldier mace carrying a
 *  distinct vs-building column and a bow, and three building types spanning the siege-priority classes:
 *  an HQ (by `id`), a defensive tower (by `kind`), and a plain home. */
function siegeContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: SOLDIER, id: 'soldier' },
      { typeId: ARCHER, id: 'archer' },
    ],
    buildings: [
      { typeId: HEADQUARTERS, id: 'headquarters', kind: 'storage', hitpoints: 1000 },
      { typeId: TOWER, id: 'watchtower', kind: 'tower', hitpoints: 1000 },
      { typeId: HOME, id: 'home', kind: 'home', hitpoints: 1000 },
    ],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [
      {
        typeId: 7,
        id: 'viking_mace',
        tribeType: VIKING,
        jobType: SOLDIER,
        minRange: 1,
        maxRange: 2,
        damage: { '0': MELEE_VS_UNARMORED, '7': MELEE_VS_BUILDING },
      },
      {
        typeId: 8,
        id: 'viking_bow',
        tribeType: VIKING,
        jobType: ARCHER,
        minRange: 3,
        maxRange: 12,
        munitionType: 1,
        speed: 3,
        damage: { '0': 20, '7': BOW_VS_BUILDING },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          { jobType: SOLDIER, atomicId: 81, animation: 'viking_attack' },
          { jobType: ARCHER, atomicId: 81, animation: 'viking_attack' },
        ],
        jobEnables: [{ jobType: SOLDIER, kind: 'house', targetId: HOME }],
      },
    ],
    atomicAnimations: [{ id: 'viking_attack', name: 'viking_attack', length: 4 }],
  });
}

/** An all-grass w×h-cell terrain map, upsampled to the half-cell lattice. */
function grass(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(0) });
}

/** An owned warrior at visual cell (x,y): its Owner + ATTACK stance make it an auto-engaging aggressor. */
function warriorAt(sim: Simulation, x: number, y: number, owner: number, jobType = SOLDIER): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints: 1_000_000, max: 1_000_000 });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
  return e;
}

/** An enemy building placed directly (the test-setup exception) at visual cell (x,y) with a full HP pool. */
function buildingAt(sim: Simulation, x: number, y: number, buildingType: number, owner: number): Entity {
  const node = { hx: 2 * x, hy: 2 * y }; // cell (x,y) → its half-cell anchor node
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(node.hx, node.hy));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 }); // placed-built
  const HP = 1000;
  sim.world.add(e, Health, { hitpoints: HP, max: HP });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

describe('warriors attack enemy buildings', () => {
  it('razes an adjacent enemy building with no enemy unit present (the dormancy gate wakes)', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(6, 1) });
    warriorAt(sim, 0, 0, P1);
    const home = buildingAt(sim, 1, 0, HOME, P2);

    const razed: Entity[] = [];
    const died: Entity[] = [];
    for (let i = 0; i < 200 && sim.world.isAlive(home); i++) {
      sim.step();
      for (const ev of sim.events.current()) {
        if (ev.kind === 'buildingDestroyed') razed.push(ev.entity);
        if (ev.kind === 'settlerDied') died.push(ev.entity);
      }
    }

    expect(sim.world.isAlive(home)).toBe(false); // battered down to 0 HP and reaped
    expect(razed).toContain(home); // announced as a razed BUILDING…
    expect(died).not.toContain(home); // …never as a fallen settler
  });

  it('drains a building on the weapon vs-building (HOUSE) column, not the vs-unarmored one', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(6, 1) });
    const soldier = warriorAt(sim, 0, 0, P1);
    const home = buildingAt(sim, 1, 0, HOME, P2);
    const before = sim.world.get(home, Health).hitpoints;

    // Step until exactly one swing has landed (HP first drops), then read the delta.
    for (let i = 0; i < 30 && sim.world.get(home, Health).hitpoints === before; i++) sim.step();
    const dealt = before - sim.world.get(home, Health).hitpoints;

    expect(sim.world.isAlive(soldier)).toBe(true);
    expect(dealt).toBe(MELEE_VS_BUILDING); // the HOUSE column, not MELEE_VS_UNARMORED
  });

  it('prefers an enemy unit over a plain building in sight (units are the high-priority tier)', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(8, 1) });
    warriorAt(sim, 0, 0, P1);
    const enemyUnit = warriorAt(sim, 2, 0, P2); // an enemy soldier in sight
    const home = buildingAt(sim, 1, 0, HOME, P2); // a plain building even CLOSER

    // While the enemy unit lives, the plain building is never struck (unit tier wins over 'other').
    for (let i = 0; i < 40; i++) {
      sim.step();
      if (!sim.world.isAlive(enemyUnit)) break;
    }
    expect(sim.world.get(home, Health).hitpoints).toBe(sim.world.get(home, Health).max);
  });

  it('prefers HQ / tower over a nearer plain building (high-value structures are on par with units)', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(8, 1) });
    warriorAt(sim, 0, 0, P1);
    const home = buildingAt(sim, 1, 0, HOME, P2); // plain building, adjacent
    const tower = buildingAt(sim, 2, 0, TOWER, P2); // defensive tower, one cell farther

    for (let i = 0; i < 60; i++) sim.step();

    expect(sim.world.get(tower, Health).hitpoints).toBeLessThan(sim.world.get(tower, Health).max); // struck
    expect(sim.world.get(home, Health).hitpoints).toBe(sim.world.get(home, Health).max); // spared
  });

  it('honours an explicit attack order on a building', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(8, 1) });
    const soldier = warriorAt(sim, 0, 0, P1);
    const home = buildingAt(sim, 4, 0, HOME, P2); // out of the way, ordered anyway

    sim.enqueue({ kind: 'attackUnit', entity: soldier, target: home });
    // Enough ticks to walk across the map AND land the ~40 swings (× 4-tick swing) that raze a 1000-HP home.
    for (let i = 0; i < 400 && sim.world.isAlive(home); i++) sim.step();

    expect(sim.world.isAlive(home)).toBe(false);
  });

  it('lets a ranged warrior batter a building from afar', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(12, 1) });
    warriorAt(sim, 0, 0, P1, ARCHER);
    const home = buildingAt(sim, 6, 0, HOME, P2); // beyond melee, within bow reach

    const before = sim.world.get(home, Health).hitpoints;
    for (let i = 0; i < 120 && sim.world.get(home, Health).hitpoints === before; i++) sim.step();

    expect(sim.world.get(home, Health).hitpoints).toBeLessThan(before);
  });

  it('never lets wildlife (an unowned attacker) target a building', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(6, 1) });
    // An unowned viking "soldier" — no Owner, so not a player's warrior. It carries a weapon but no side.
    const feral = sim.world.create();
    sim.world.add(feral, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(feral, Settler, {
      tribe: VIKING,
      jobType: SOLDIER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });
    sim.world.add(feral, Health, { hitpoints: 1000, max: 1000 });
    const home = buildingAt(sim, 1, 0, HOME, P2);

    for (let i = 0; i < 60; i++) sim.step();

    expect(sim.world.get(home, Health).hitpoints).toBe(sim.world.get(home, Health).max);
  });
});
