import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  addPerson,
  Building,
  CurrentAtomic,
  Engagement,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  Position,
  Stance,
  Stockpile,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  fx,
  halfCellMapFromCells,
  nodeOfPosition,
  ONE,
  positionOfNode,
  type SimEvent,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { buildingBodyNodes } from '../../src/systems/conflict/target-node.js';
import { combatSystem } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

// Warriors sieging enemy BUILDINGS - the target/order/damage/priority slice: a building joins the combat
// target index (never as a seeker), takes the weapon's vs-building (HOUSE) column, and is razed at 0 HP
// through the demolish path. Auto-focus prefers units + HQ + towers on par, dropping to a plain building
// only when none of those remains in sight (user rule).

const VIKING = 1;
// The soldier trades (`jobtypes.ini` 31 / 40): body collision and the ATTACK default apply only to a job the
// content classifies as a fighter (`readviews/jobs.ts` isFighterJob, keyed on the `soldier_*` slug), so the
// test warriors must carry that slug - a civilian one would make them collisionless ghosts that stack on one
// melee slot.
const SOLDIER = 31;
const ARCHER = 40;
const P1 = 1; // the attacking player
const P2 = 2; // the defending player (owns the buildings)

const GRASS = 0;
const WATER = 1; // the barrier the islet fixture needs - an unwalkable landscape, so a separate walk component

const STONE = 1; // the HOME's build material - a bill keeps a placed site a site instead of finishing free

const HEADQUARTERS = 1;
const TOWER = 2;
const HOME = 3;
const FORT = 4; // the walled type - a 2×2 half-cell body, so contact slots exist on every face

const MELEE_VS_UNARMORED = 40;
const MELEE_VS_BUILDING = 25; // the weapon's HOUSE (material 7) column - distinct from vs-unarmored
const BOW_VS_BUILDING = 15;

/** One tribe fought across two players (the OWNER axis decides hostility), with a soldier mace carrying a
 *  distinct vs-building column and a bow, and four building types: an HQ (by `id`), a defensive tower (by
 *  `kind`), a plain home, and a walled FORT (a real `blocked` footprint) for the encircle tests.
 *  `meleeRange` narrows the mace band (the encircle tests use a strict 1 so a face saturates quickly). */
function siegeContent(opts: { meleeRange?: { min: number; max: number } } = {}): ContentSet {
  const melee = opts.meleeRange ?? { min: 1, max: 2 };
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: SOLDIER, id: 'soldier_unarmed' },
      { typeId: ARCHER, id: 'soldier_bow_short' },
    ],
    buildings: [
      { typeId: HEADQUARTERS, id: 'headquarters', kind: 'storage', hitpoints: 1000 },
      { typeId: TOWER, id: 'watchtower', kind: 'tower', hitpoints: 1000 },
      {
        typeId: HOME,
        id: 'home',
        kind: 'home',
        hitpoints: 1000,
        construction: [{ goodType: STONE, amount: 2 }],
      },
      {
        typeId: FORT,
        id: 'fort',
        kind: 'tower',
        hitpoints: 1000,
        footprint: {
          blocked: [
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: 1, dy: 1 },
          ],
        },
      },
    ],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
    ],
    weapons: [
      {
        typeId: 7,
        id: 'viking_mace',
        tribeType: VIKING,
        jobType: SOLDIER,
        minRange: melee.min,
        maxRange: melee.max,
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
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

/** A grass bank at cells `x < bankWidth`, open water beyond it, and one grass islet cell: a building on the
 *  islet has no walkable contact cell anywhere, and none in the besieger's walk component. */
function bankAndIslet(
  width: number,
  height: number,
  bankWidth: number,
  islet: { x: number; y: number },
): TerrainMap {
  const typeIds: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      typeIds.push(x < bankWidth || (x === islet.x && y === islet.y) ? GRASS : WATER);
    }
  }
  return halfCellMapFromCells({ width, height, typeIds });
}

/** An owned warrior at visual cell (x,y): its Owner + ATTACK stance make it an auto-engaging aggressor. */
function warriorAt(sim: Simulation, x: number, y: number, owner: number, jobType = SOLDIER): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
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

/** An enemy building placed directly (the test-setup exception) at visual cell (x,y) with a full HP pool
 *  (`hp` overridable - the encircle tests need a fort that outlives the whole warband's battering). */
function buildingAt(
  sim: Simulation,
  x: number,
  y: number,
  buildingType: number,
  owner: number,
  hp = 1000,
): Entity {
  const node = { hx: 2 * x, hy: 2 * y }; // cell (x,y) → its half-cell anchor node
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(node.hx, node.hy));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 }); // placed-built
  sim.world.add(e, Health, { hitpoints: hp, max: hp });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

/** The hitpoints a fresh site stands at, in the type's own full pool - what `placeBuilding` stamps. */
const FOUNDATION_HP = 1;

/** An enemy construction site at visual cell (x,y): a foundation with nothing hammered or delivered, at
 *  1 hitpoint of the type's pool. Its own {@link Stockpile} is the (empty) build hold the
 *  ConstructionSystem reads, so the build ramp actually visits it. */
function siteAt(sim: Simulation, x: number, y: number, buildingType: number, owner: number): Entity {
  const e = buildingAt(sim, x, y, buildingType, owner);
  sim.world.get(e, Health).hitpoints = FOUNDATION_HP;
  sim.world.get(e, Building).built = fx.fromInt(0);
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
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

  it('razes a fresh enemy construction site - a 1-HP foundation falls to a single blow', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(6, 1) });
    warriorAt(sim, 0, 0, P1);
    const site = siteAt(sim, 1, 0, HOME, P2);

    let razed: Extract<SimEvent, { kind: 'buildingDestroyed' }> | undefined;
    for (let i = 0; i < 40 && sim.world.isAlive(site); i++) {
      sim.step();
      for (const ev of sim.events.current()) {
        if (ev.kind === 'buildingDestroyed' && ev.entity === site) razed = ev;
      }
    }

    // The build ramp runs later in the same tick than the swing that landed, so it must add what the build
    // gained and never re-set the pool - a ramp that owns the pool outright outlives any warband.
    expect(sim.world.isAlive(site)).toBe(false);
    expect(razed?.built).toBe(0); // razed at built 0 - the cue render collapses as scaffolding
  });

  it('razes a fresh site by arrow too - a shot and a swing reach the same rubble', () => {
    // The two damage sources land on opposite sides of the build ramp in the tick (atomic → construction →
    // projectile), so a foundation's fate must not depend on which of them struck it.
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(12, 1) });
    warriorAt(sim, 0, 0, P1, ARCHER);
    const site = siteAt(sim, 6, 0, HOME, P2); // beyond melee, within bow reach

    for (let i = 0; i < 120 && sim.world.isAlive(site); i++) sim.step();

    expect(sim.world.isAlive(site)).toBe(false);
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

  it('honours an explicit attack order on a building beyond sight radius', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(24, 1) });
    const soldier = warriorAt(sim, 0, 0, P1);
    // Node distance 40 - far beyond SIGHT_RADIUS_NODES (16), so ATTACK-stance auto-engagement can never
    // acquire it: only the order itself can drive this siege (the regression: attackUnit once rejected any
    // non-Settler target, silently dropping the order, while an in-sight fixture let auto-engage mask it).
    const home = buildingAt(sim, 20, 0, HOME, P2);

    sim.enqueueSetup({ kind: 'attackUnit', entity: soldier, target: home });
    sim.step();
    expect(sim.world.has(soldier, AttackOrder)).toBe(true); // the order is stamped, not dropped

    // Enough ticks to walk across the map AND land the ~40 swings (× 4-tick swing) that raze a 1000-HP home.
    for (let i = 0; i < 900 && sim.world.isAlive(home); i++) sim.step();
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
    // An unowned viking "soldier" - no Owner, so not a player's warrior. It carries a weapon but no side.
    const feral = sim.world.create();
    sim.world.add(feral, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    addPerson(sim.world, feral, {
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

  // The FORT placed at visual cell (3,3): anchor node (6,6), body nodes (6,6),(7,6),(6,7),(7,7) - a 2×2
  // half-cell block with exactly 8 orthogonal contact cells (the melee-1 slots) spread over four faces.
  const FORT_WALLS: readonly (readonly [number, number])[] = [
    [6, 6],
    [7, 6],
    [6, 7],
    [7, 7],
  ];

  /** The half-cell node a settler stands on. */
  function nodeOf(sim: Simulation, e: Entity): { hx: number; hy: number } {
    const p = sim.world.get(e, Position);
    return nodeOfPosition(p.x, p.y);
  }

  /** Manhattan distance (half-cell nodes) from a settler's node to the fort's nearest wall cell. */
  function distToFort(sim: Simulation, e: Entity): number {
    const n = nodeOf(sim, e);
    let min = Number.POSITIVE_INFINITY;
    for (const [wx, wy] of FORT_WALLS) min = Math.min(min, Math.abs(n.hx - wx) + Math.abs(n.hy - wy));
    return min;
  }

  it('encircles a walled building: the warband mans contact slots on every face, not just the near one', () => {
    const sim = new Simulation({
      seed: 1,
      content: siegeContent({ meleeRange: { min: 1, max: 1 } }),
      map: grass(7, 7),
    });
    buildingAt(sim, 3, 3, FORT, P2, 1_000_000); // outlives the whole warband's battering
    const soldiers: Entity[] = [];
    for (const [x, y] of [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ] as const) {
      soldiers.push(warriorAt(sim, x, y, P1));
    }

    for (let i = 0; i < 400; i++) sim.step();

    // All 8 contact cells around the 2×2 body are manned, each by its own soldier - the whole warband
    // wrapped around the fort. A single-face slot deal could only ever fill the west band and left the
    // rest holding behind it.
    const manned = soldiers.filter((s) => distToFort(sim, s) === 1);
    expect(manned.length).toBe(8);
    const slots = manned.map((s) => {
      const p = sim.world.get(s, Position);
      const n = nodeOfPosition(p.x, p.y);
      return `${n.hx},${n.hy}`;
    });
    expect(new Set(slots).size).toBe(8);
  });

  it('holds surplus chasers as an idle second rank (no nav state) once every face slot is manned', () => {
    const sim = new Simulation({
      seed: 1,
      content: siegeContent({ meleeRange: { min: 1, max: 1 } }),
      map: grass(7, 7),
    });
    buildingAt(sim, 3, 3, FORT, P2, 1_000_000);
    const soldiers: Entity[] = [];
    for (const [x, y] of [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
    ] as const) {
      soldiers.push(warriorAt(sim, x, y, P1));
    }

    for (let i = 0; i < 400; i++) sim.step();

    // 10 chasers, 8 slots: the surplus stands fast with NO nav components - the render sprite-state rule
    // (PathFollow/PathRequest/MoveGoal ⇒ walking) then reads it as idle, not frozen mid-stride.
    const front = soldiers.filter((s) => distToFort(sim, s) === 1);
    expect(front.length).toBe(8);
    const held = soldiers.filter((s) => distToFort(sim, s) > 1);
    expect(held.length).toBe(2);
    for (const s of held) {
      expect(sim.world.has(s, MoveGoal)).toBe(false);
      expect(sim.world.has(s, PathFollow)).toBe(false);
      expect(sim.world.has(s, PathRequest)).toBe(false);
    }
  });

  it('hands back from a building across water: an empty slot deal is not a manned front', () => {
    const sim = new Simulation({
      seed: 1,
      content: siegeContent(),
      map: bankAndIslet(9, 5, 4, { x: 6, y: 2 }),
    });
    const soldier = warriorAt(sim, 1, 2, P1);
    buildingAt(sim, 6, 2, FORT, P2); // its 2×2 body fills the islet, so no contact cell survives at all

    for (let i = 0; i < 60; i++) sim.step();

    // The encircle deal comes back empty - the same `null` a fully manned front returns. Reading it as a
    // front would hold the warrior engaged for the rest of the game, because the planner leaves an engaged
    // settler to combat.
    expect(sim.world.has(soldier, Engagement)).toBe(false);
    expect(sim.world.has(soldier, MoveGoal)).toBe(false);
  });

  it('walks up its own bank to a firing cell rather than giving up on a target across water', () => {
    // The release refuses only the cells a unit cannot stand on, never the target itself. A bow band reaches
    // past the water, so contact cells on the archer's OWN bank are in it: it must advance to one and shoot.
    // Deciding the release from the target's bank instead would send an archer with a live shot home.
    const sim = new Simulation({
      seed: 1,
      content: siegeContent(),
      map: bankAndIslet(10, 5, 4, { x: 8, y: 2 }),
    });
    warriorAt(sim, 0, 2, P1, ARCHER); // 16 nodes out - inside sight, outside the bow's 12-node band
    const home = buildingAt(sim, 8, 2, HOME, P2);

    for (let i = 0; i < 200 && sim.world.get(home, Health).hitpoints === 1000; i++) sim.step();

    expect(sim.world.get(home, Health).hitpoints).toBeLessThan(1000);
  });

  it('deals no slot under a neighbouring body: an ordered siege routes around, never cancels', () => {
    const sim = new Simulation({
      seed: 1,
      content: siegeContent({ meleeRange: { min: 1, max: 1 } }),
      map: grass(8, 3),
    });
    const fort = buildingAt(sim, 4, 1, FORT, P2, 1_000_000);
    buildingAt(sim, 3, 1, FORT, P1); // the attacker's own fort hugging the target's west face
    const soldier = warriorAt(sim, 1, 1, P1);

    sim.enqueueSetup({ kind: 'attackUnit', entity: soldier, target: fort });
    // The target's whole west contact band lies under the friendly fort's body - statically walkable
    // grass, blocked only by the dynamic nav overlay, and routing denies a stand-in for such a goal.
    // Dealing one of those cells would fail the route and silently cancel the attack order; the slot
    // deal must skip them, so the soldier walks around to an open face and lands its swings.
    const before = sim.world.get(fort, Health).hitpoints;
    for (let i = 0; i < 300 && sim.world.get(fort, Health).hitpoints === before; i++) sim.step();
    expect(sim.world.get(fort, Health).hitpoints).toBeLessThan(before);
  });

  it('swings on the tick it arrives, goal not yet retired - it does not pace between two slots', () => {
    const sim = new Simulation({
      seed: 1,
      content: siegeContent({ meleeRange: { min: 1, max: 1 } }),
      map: grass(7, 7),
    });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('fixture has no map');
    buildingAt(sim, 3, 3, FORT, P2, 1_000_000);
    const soldier = warriorAt(sim, 2, 3, P1); // node (5,6): one west of the fort's (6,6) wall - a contact cell

    // The state the schedule leaves a chaser in on the tick its last leg lands: movement has taken its route
    // away, but the goal that walked it there is retired only by NEXT tick's planner, which runs before
    // combat. Combat is driven directly here, because a `step()` would retire the goal before combat saw it.
    sim.world.add(soldier, Engagement, { repathAt: 0 }); // the cadence expires this tick too
    sim.world.add(soldier, MoveGoal, { cell: terrain.nodeAt(5, 6) });

    combatSystem(sim.world, ctxOf(sim));

    // Read as still travelling it could not swing, and the chase re-dealt it a slot - never its own, which
    // its standing body marks as taken - walking it off the cell it was already fighting from, for the next
    // cadence to walk it back.
    expect(sim.world.has(soldier, CurrentAtomic)).toBe(true); // swinging…
    expect(sim.world.has(soldier, MoveGoal)).toBe(false); // …instead of aimed at the next contact cell
  });

  it('closes on a wall and settles, over the real schedule - the arrival tick is not a repath', () => {
    const sim = new Simulation({
      seed: 1,
      content: siegeContent({ meleeRange: { min: 1, max: 1 } }),
      map: grass(7, 7),
    });
    const fort = buildingAt(sim, 3, 3, FORT, P2, 1_000_000);
    // This approach lands the last leg on a repath tick (planner → movement → combat, all in one tick), the
    // window the direct-drive case above builds by hand. Untreated, the soldier walked the two nearest
    // contact cells forever and the fort took no damage in 600 ticks.
    const soldier = warriorAt(sim, 0, 6, P1);

    for (let i = 0; i < 300; i++) sim.step();
    const settled = nodeOf(sim, soldier);
    for (let i = 0; i < 60; i++) sim.step();

    expect(sim.world.get(fort, Health).hitpoints).toBeLessThan(sim.world.get(fort, Health).max);
    expect(nodeOf(sim, soldier)).toEqual(settled); // parked on one slot, not pacing between two
  });
});

/**
 * A building's wall nodes are held across ticks - it never moves - so what a besieger measures reach to is
 * only as fresh as the two Building store generations keying that cache. A tier upgrade swaps `buildingType`
 * in place, moving the footprint with no membership change.
 */
describe('a held building body follows its footprint', () => {
  it('re-derives after an in-place buildingType swap, and reports no stale cache', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(8, 8) });
    const ctx = ctxOf(sim);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('no terrain');
    const building = buildingAt(sim, 3, 3, HOME, P2); // footprint-less: the door/anchor fallback

    const asHome = buildingBodyNodes(sim.world, ctx, terrain, building);
    sim.world.write(building, Building, (b) => {
      b.buildingType = FORT;
    });
    const asFort = buildingBodyNodes(sim.world, ctx, terrain, building);

    expect(asHome).toHaveLength(1);
    expect(asFort).toHaveLength(4); // the fort's 2×2 blocked body
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('drops a razed building from the held bodies', () => {
    const sim = new Simulation({ seed: 1, content: siegeContent(), map: grass(8, 8) });
    const ctx = ctxOf(sim);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('no terrain');
    const fort = buildingAt(sim, 3, 3, FORT, P2);

    expect(buildingBodyNodes(sim.world, ctx, terrain, fort)).toHaveLength(4);
    sim.world.destroy(fort);

    expect(buildingBodyNodes(sim.world, ctx, terrain, fort)).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
