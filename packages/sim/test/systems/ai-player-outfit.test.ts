import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Equipment, Settler } from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command } from '../../src/core/commands/index.js';
import { ZERO } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, Rng, Simulation } from '../../src/index.js';
import { militaryModule, RALLY_HOLD_RADIUS_NODES } from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

// The soldiers' outfit: the heal potion and the defence amulet the military module sends a man waiting at
// the barracks to fetch.

const VIKING = 1;
const SEAT = 2;
const HQ_TYPE = 1;
const BARRACKS_TYPE = 12;
const SPEARMAN = 32;
const FOE = 3;
/** A seed whose opening wave draw is its floor, so a band of that floor charges at once. */
const CHARGING_SEED = 7;
/** A seed whose draw is above the floor, so the same band waits at the door. */
const WAITING_SEED = 1;
const POTION = 60;
const AMULET = 61;
const STRENGTH_AMULET = 62;

const HQ = { x: 20, y: 30 };
const FOE_HQ = { x: 80, y: 50 };
const BARRACKS = { x: 30, y: 30 };

function outfitContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      {
        typeId: POTION,
        id: 'potion_heal_big',
        weight: 1,
        equip: { category: 'misc', wears: true, uses: 5, restorePct: { healthMax: 50 } },
      },
      { typeId: AMULET, id: 'amulet_defense', weight: 1, equip: { category: 'misc', wears: false } },
      {
        typeId: STRENGTH_AMULET,
        id: 'amulet_strength',
        weight: 1,
        equip: { category: 'misc', wears: false },
      },
    ],
  });
}

/** A seat with a stocked headquarters, a barracks and `count` spearmen formed up at its door. No enemy
 *  stands anywhere, so the campaign leaves the formed men alone and the outfit rung sees them all. */
function outfittedSeat(stock: readonly { good: number; amount: number }[], count: number): Simulation {
  const content = outfitContent();
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(96, 64) });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ.x,
    y: HQ.y,
    tribe: VIKING,
    owner: SEAT,
    initialGoods: stock,
  });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BARRACKS_TYPE,
    x: BARRACKS.x,
    y: BARRACKS.y,
    tribe: VIKING,
    owner: SEAT,
  });
  sim.step();
  const door = rallyOf(sim);
  for (let i = 0; i < count; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      x: door.x + i,
      y: door.y,
      tribe: VIKING,
      owner: SEAT,
    });
  }
  sim.step();
  return sim;
}

function ctxOf(sim: Simulation, seed = WAITING_SEED): SystemContext {
  return {
    content: outfitContent(),
    rng: new Rng(seed),
    tick: 0,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function rallyOf(sim: Simulation): { x: number; y: number } {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  const barracks = [...sim.world.query(Building)].find(
    (e) => sim.world.get(e, Building).buildingType === BARRACKS_TYPE,
  );
  if (barracks === undefined) throw new Error('setup: no barracks');
  return terrain.coordsOf(interactionCell(sim.world, ctxOf(sim), terrain, barracks));
}

function soldiers(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === SPEARMAN);
}

function equipOrders(sim: Simulation, seed = WAITING_SEED): Extract<Command, { kind: 'equipGood' }>[] {
  return [...militaryModule.run(sim.world, ctxOf(sim, seed), SEAT)].flatMap((c) =>
    c.kind === 'equipGood' ? [c] : [],
  );
}

describe('military module - the soldiers outfit', () => {
  it('sends a man waiting at the barracks for the potion a store holds', () => {
    const sim = outfittedSeat([{ good: POTION, amount: 1 }], 1);
    const [man] = soldiers(sim);
    expect(equipOrders(sim)).toEqual([
      { kind: 'equipGood', entity: man, group: 'misc', slot: 0, goodType: POTION },
    ]);
  });

  it('sends no more men for a good than the stores hold', () => {
    const sim = outfittedSeat([{ good: POTION, amount: 1 }], 3);
    expect(equipOrders(sim)).toHaveLength(1);
  });

  it('falls through to the amulet when no potion is in stock', () => {
    const sim = outfittedSeat([{ good: AMULET, amount: 2 }], 2);
    expect(equipOrders(sim).map((c) => c.goodType)).toEqual([AMULET, AMULET]);
  });

  it('sends nobody while the stores hold neither good', () => {
    expect(equipOrders(outfittedSeat([], 2))).toEqual([]);
  });

  it('counts the errands already underway against the stock', () => {
    const sim = outfittedSeat([{ good: POTION, amount: 1 }], 2);
    const [sent] = equipOrders(sim);
    if (sent === undefined) throw new Error('expected an errand');
    sim.enqueueSetup(sent);
    sim.step();
    expect(equipOrders(sim)).toEqual([]);
  });

  it('sends a man who already carries the potion for the amulet, into the next free slot', () => {
    const sim = outfittedSeat(
      [
        { good: POTION, amount: 1 },
        { good: AMULET, amount: 1 },
      ],
      1,
    );
    const [man] = soldiers(sim);
    if (man === undefined) throw new Error('setup: no soldier');
    sim.world.add(man, Equipment, {
      boots: null,
      tool: null,
      weapon: null,
      armor: null,
      misc: [{ goodType: POTION, degreeOfUse: ZERO }, null, null, null],
    });
    expect(equipOrders(sim)).toEqual([
      { kind: 'equipGood', entity: man, group: 'misc', slot: 1, goodType: AMULET },
    ]);
  });

  it('sends a man who wears both the potion and the defence amulet for the strength amulet', () => {
    const sim = outfittedSeat([{ good: STRENGTH_AMULET, amount: 1 }], 1);
    const [man] = soldiers(sim);
    if (man === undefined) throw new Error('setup: no soldier');
    sim.world.add(man, Equipment, {
      boots: null,
      tool: null,
      weapon: null,
      armor: null,
      misc: [{ goodType: POTION, degreeOfUse: ZERO }, { goodType: AMULET, degreeOfUse: ZERO }, null, null],
    });
    expect(equipOrders(sim)).toEqual([
      { kind: 'equipGood', entity: man, group: 'misc', slot: 2, goodType: STRENGTH_AMULET },
    ]);
  });

  it('never sends a band that charges this decision, only one that waits', () => {
    const band = (): Simulation => {
      const sim = outfittedSeat([{ good: POTION, amount: 1 }], 5);
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HQ_TYPE,
        x: FOE_HQ.x,
        y: FOE_HQ.y,
        tribe: VIKING,
        owner: FOE,
      });
      sim.step();
      return sim;
    };
    expect(equipOrders(band(), CHARGING_SEED)).toEqual([]);
    expect(equipOrders(band(), WAITING_SEED)).toHaveLength(1);
  });

  it('leaves a man away from the barracks to the recall', () => {
    const sim = outfittedSeat([{ good: POTION, amount: 1 }], 0);
    const door = rallyOf(sim);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      x: door.x + RALLY_HOLD_RADIUS_NODES + 4,
      y: door.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(equipOrders(sim)).toEqual([]);
  });
});
