import { MapModules } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  Equipment,
  type EquipmentSlot,
  Health,
  MISC_EQUIP_SLOTS,
  Owner,
  Position,
  Stockpile,
  Vehicle,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../../src/index.js';
import { nodeOfPosition } from '../../../src/nav/halfcell.js';
import type { NodeId } from '../../../src/nav/terrain/index.js';
import { cleanupSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { grassCellMap } from '../../fixtures/terrain.js';

/**
 * A dying character leaves its load and gear on the ground, through the same spill seam a razed store's
 * stock takes (`test/systems/economy/raze-spill.test.ts`); `droppedOnDeathOf` owns the rule.
 */

/** The fixture's equippables (`test/fixtures/content/economy.ts`). */
const SWORD = 9;
const MAIL = 18;
const SHOES = 8;
const TOOL = 11;
const DRAUGHT = 13;
const HEAL_DRAUGHT = 16;
const STRENGTH_AMULET = 25;
const STONE = 4;
const SOLDIER = 31;
const HERO = 45;
const CIVILIST = 6;

const DEATH_TILE = { x: fx.fromInt(6), y: fx.fromInt(6) };
const HALF_USED = fx.div(ONE, fx.fromInt(2));
/** The fixture's ratings: shoes walk 10000 points, a tool lasts 100 uses. */
const SHOE_POINTS = 10_000;
const TOOL_USES = 100;
/** `uses` steps of a `rating`-use good's rounded-up wear step, as wearing it writes them. */
const usedSteps = (uses: number, rating: number): Fixed =>
  fx.mul(fx.fromInt(uses), fx.divCeil(ONE, fx.fromInt(rating)));

/** A worn slot at `degreeOfUse` (ZERO = fresh, ONE = spent). */
const worn = (goodType: number, degreeOfUse = fx.fromInt(0)): EquipmentSlot => ({ goodType, degreeOfUse });

/** The misc row, padded to the component's fixed slot count. */
const misc = (...held: EquipmentSlot[]): ReadonlyArray<EquipmentSlot | null> =>
  Array.from({ length: MISC_EQUIP_SLOTS }, (_, i) => held[i] ?? null);

interface Gear {
  readonly weapon?: EquipmentSlot;
  readonly armor?: EquipmentSlot;
  readonly boots?: EquipmentSlot;
  readonly tool?: EquipmentSlot;
  readonly misc?: ReadonlyArray<EquipmentSlot | null>;
}

function mappedSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassCellMap(16, 16) });
}

/** A settler of `jobType` at {@link DEATH_TILE} wearing `gear`, already drained to 0 hitpoints. */
function doomedWearing(sim: Simulation, gear: Gear, jobType = SOLDIER): Entity {
  const e = settlerAt(sim, { jobType, position: DEATH_TILE });
  sim.world.add(e, Equipment, {
    weapon: gear.weapon ?? null,
    armor: gear.armor ?? null,
    boots: gear.boots ?? null,
    tool: gear.tool ?? null,
    misc: gear.misc ?? misc(),
  });
  sim.world.add(e, Health, { hitpoints: 0, max: 1000 });
  return e;
}

interface Heap {
  readonly node: NodeId;
  readonly good: number;
  readonly amount: number;
}

/** Every loose ground heap in the world (a positioned stockpile that is no persistent store). */
function heaps(sim: Simulation): Heap[] {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  const out: Heap[] = [];
  for (const e of sim.world.query(Stockpile, Position)) {
    if (sim.world.has(e, Building) || sim.world.has(e, Vehicle)) continue;
    const p = sim.world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    for (const [good, amount] of sim.world.get(e, Stockpile).amounts) {
      if (amount > 0) out.push({ node: terrain.nodeAt(n.hx, n.hy), good, amount });
    }
  }
  return out.sort((a, b) => a.node - b.node || a.good - b.good);
}

/** Units of each good lying loose on the ground, keyed by goodType. */
function droppedUnits(sim: Simulation): Map<number, number> {
  const out = new Map<number, number>();
  for (const h of heaps(sim)) out.set(h.good, (out.get(h.good) ?? 0) + h.amount);
  return out;
}

describe('a fallen character drops its gear beside the bones', () => {
  it("leaves a soldier's weapon and armor on the ground where it fell", () => {
    const sim = mappedSim();
    const soldier = doomedWearing(sim, { weapon: worn(SWORD), armor: worn(MAIL) });

    cleanupSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(soldier)).toBe(false);
    expect(droppedUnits(sim)).toEqual(
      new Map([
        [SWORD, 1],
        [MAIL, 1],
      ]),
    );
  });

  it('leaves a hero or civilian weapon with the bones, still dropping the rest of the gear', () => {
    for (const jobType of [HERO, CIVILIST]) {
      const sim = mappedSim();
      doomedWearing(sim, { weapon: worn(SWORD), armor: worn(MAIL), boots: worn(SHOES) }, jobType);

      cleanupSystem(sim.world, ctxOf(sim));

      expect(droppedUnits(sim)).toEqual(
        new Map([
          [SHOES, 1],
          [MAIL, 1],
        ]),
      );
    }
  });

  it('drops the loot at the death tile, the way a razed store spills onto its own plot', () => {
    const sim = mappedSim();
    doomedWearing(sim, { weapon: worn(SWORD) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const at = nodeOfPosition(DEATH_TILE.x, DEATH_TILE.y);

    cleanupSystem(sim.world, ctxOf(sim));

    expect(heaps(sim)).toEqual([{ node: terrain.nodeAt(at.hx, at.hy), good: SWORD, amount: 1 }]);
  });

  it('drops an untouched consumable but swallows a part-used one', () => {
    const sim = mappedSim();
    doomedWearing(sim, { misc: misc(worn(DRAUGHT), worn(DRAUGHT, HALF_USED)) });

    cleanupSystem(sim.world, ctxOf(sim));

    expect(droppedUnits(sim)).toEqual(new Map([[DRAUGHT, 1]]));
  });

  it('swallows part-used and spent boots and tools, whatever else it drops', () => {
    const sim = mappedSim();
    doomedWearing(sim, {
      weapon: worn(SWORD),
      boots: worn(SHOES, HALF_USED), // half walked off - lost
      tool: worn(TOOL, ONE), // spent - lost
    });

    cleanupSystem(sim.world, ctxOf(sim));

    expect(droppedUnits(sim)).toEqual(new Map([[SWORD, 1]]));
  });

  it('drops shoes and a tool worn by at most a tenth as new goods', () => {
    const atMost = mappedSim();
    doomedWearing(atMost, {
      boots: worn(SHOES, fx.div(fx.fromInt(SHOE_POINTS / 10), fx.fromInt(SHOE_POINTS))),
      tool: worn(TOOL, usedSteps(TOOL_USES / 10, TOOL_USES)),
    });
    cleanupSystem(atMost.world, ctxOf(atMost));
    expect(droppedUnits(atMost)).toEqual(
      new Map([
        [SHOES, 1],
        [TOOL, 1],
      ]),
    );

    const past = mappedSim();
    doomedWearing(past, { tool: worn(TOOL, usedSteps(TOOL_USES / 10 + 1, TOOL_USES)) });
    cleanupSystem(past.world, ctxOf(past));
    expect(droppedUnits(past)).toEqual(new Map());
  });

  it('drops the load it was carrying beside its gear', () => {
    const sim = mappedSim();
    const porter = doomedWearing(sim, { armor: worn(MAIL) }, CIVILIST);
    sim.world.add(porter, Carrying, { goodType: STONE, amount: 2 });

    cleanupSystem(sim.world, ctxOf(sim));

    expect(droppedUnits(sim)).toEqual(
      new Map([
        [STONE, 2],
        [MAIL, 1],
      ]),
    );
  });

  it('drops nothing for a bare settler (no Equipment component at all)', () => {
    const sim = mappedSim();
    const bare = settlerAt(sim, { jobType: null, position: DEATH_TILE });
    sim.world.add(bare, Health, { hitpoints: 0, max: 1000 });

    cleanupSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(bare)).toBe(false);
    expect(heaps(sim)).toEqual([]);
  });

  it('stacks two men falling on one tile into a single heap per good', () => {
    const sim = mappedSim();
    doomedWearing(sim, { weapon: worn(SWORD), armor: worn(MAIL) });
    doomedWearing(sim, { weapon: worn(SWORD), armor: worn(MAIL) });

    cleanupSystem(sim.world, ctxOf(sim));

    // One heap per good, each holding both men's unit - not four separate piles.
    expect(heaps(sim).map((h) => ({ good: h.good, amount: h.amount }))).toEqual(
      expect.arrayContaining([
        { good: SWORD, amount: 2 },
        { good: MAIL, amount: 2 },
      ]),
    );
    expect(heaps(sim)).toHaveLength(2);
  });

  it('reaps in ascending-id order, so the heaps land the same whatever order the pools drained in', () => {
    // The loot allocates entity ids, which the state hash mixes in - so cleanupSystem's canonical sort
    // is what makes two worlds that lost the same men agree, whichever man was hit first.
    const hashOf = (drainDescending: boolean): string => {
      const sim = mappedSim();
      const west = settlerAt(sim, { jobType: null, position: DEATH_TILE });
      const east = settlerAt(sim, { jobType: null, position: { x: fx.fromInt(9), y: fx.fromInt(6) } });
      for (const e of drainDescending ? [east, west] : [west, east]) {
        sim.world.add(e, Equipment, {
          weapon: worn(SWORD),
          armor: worn(MAIL),
          boots: null,
          tool: null,
          misc: misc(),
        });
        sim.world.add(e, Health, { hitpoints: 0, max: 1000 });
      }
      cleanupSystem(sim.world, ctxOf(sim));
      return sim.hashState();
    };
    expect(hashOf(true)).toBe(hashOf(false));
  });
});

describe("a map's withheld death drops", () => {
  const FORTRESS_SIDE = 6;
  const PLAYER = 0;
  const RULE = MapModules.parse({ deathDrops: { version: 1, withheldSeats: [FORTRESS_SIDE] } });
  const FULL_KIT: Gear = {
    weapon: worn(SWORD),
    armor: worn(MAIL),
    boots: worn(SHOES),
    misc: misc(worn(STRENGTH_AMULET), worn(HEAL_DRAUGHT)),
  };

  function dropsOf(seat: number): Map<number, number> {
    const sim = mappedSim();
    const soldier = doomedWearing(sim, FULL_KIT);
    sim.world.add(soldier, Owner, { player: seat });
    sim.world.add(soldier, Carrying, { goodType: STONE, amount: 1 });
    cleanupSystem(sim.world, { ...ctxOf(sim), mapModules: RULE });
    return droppedUnits(sim);
  }

  it('drops nothing of a ruled seat', () => {
    expect(dropsOf(FORTRESS_SIDE)).toEqual(new Map());
  });

  it("drops another seat's whole kit", () => {
    expect(dropsOf(PLAYER)).toEqual(
      new Map([
        [STONE, 1],
        [SHOES, 1],
        [SWORD, 1],
        [MAIL, 1],
        [STRENGTH_AMULET, 1],
        [HEAL_DRAUGHT, 1],
      ]),
    );
  });
});
