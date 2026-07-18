import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Age,
  Building,
  ChildOrder,
  Female,
  FoodReserve,
  MakingLove,
  Marriage,
  Residence,
  Settler,
  Stockpile,
  Wedding,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, type SimEvent, Simulation } from '../../src/index.js';
import {
  BABY_FEMALE,
  familiesOf,
  familyOf,
  KISS_ATOMIC_ID,
  KISSED_ATOMIC_ID,
  mayMarry,
} from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * GAME-LEVEL (e2e) — the marriage → household → child loop under the real `Simulation.step()`
 * schedule: a `marry` order pairs the woman with the nearest eligible man (walk together, kiss,
 * marry for life); `assignHouse` moves the family into a built home; `makeChild` has the wife stock
 * the home with {@link CHILD_FOOD_UNITS} food (reserved from eating), wait inside for her husband,
 * make love (hearts on the home), and bear a child of the ordered sex that joins the household.
 *
 * Built with `parseContentSet` so the sex-tagged job slugs and the home's food stock slots are
 * explicit (the shared fixtures carry neither).
 */

const VIKING = 1;
const PLAYER = 0;
const FOOD = 16; // slug `food_simple` — the `food_` prefix is what makes it edible (isFood)
const WOMAN = 5;
const CIVILIST = 6;
const SOLDIER = 31;
const HOME = 2;
const WAREHOUSE = 7;
const GRASS = 0;

function familyContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: FOOD, id: 'food_simple' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: BABY_FEMALE, id: 'baby_female' },
      { typeId: 2, id: 'baby_male' },
      { typeId: 3, id: 'child_female' },
      { typeId: 4, id: 'child_male' },
      { typeId: WOMAN, id: 'woman' },
      { typeId: CIVILIST, id: 'civilist' },
      { typeId: SOLDIER, id: 'soldier_unarmed' },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 3,
        stock: [{ goodType: FOOD, capacity: 5 }],
      },
      // A non-home food store (the settlement HQ): its stock feeds anyone, unlike a home larder.
      { typeId: WAREHOUSE, id: 'warehouse', kind: 'warehouse', stock: [{ goodType: FOOD, capacity: 99 }] },
    ],
  });
}

/** Build the world: a woman and a man near a built home, with loose food piles to stock it from. */
function familySim(seed: number): {
  sim: Simulation;
  woman: () => Entity;
  man: () => Entity;
  home: () => Entity;
} {
  const sim = new Simulation({ seed, content: familyContent(), map: grassMap(28, 4) });
  sim.enqueue({ kind: 'placeBuilding', buildingType: HOME, x: 10, y: 0, tribe: VIKING });
  sim.enqueue({ kind: 'spawnSettler', jobType: WOMAN, x: 2, y: 0, tribe: VIKING, owner: PLAYER });
  sim.enqueue({ kind: 'spawnSettler', jobType: CIVILIST, x: 16, y: 0, tribe: VIKING, owner: PLAYER });
  // Loose food on the ground — the external source the wife hauls the child fund from.
  sim.enqueue({ kind: 'dropGood', good: FOOD, x: 4, y: 2, amount: 3 });
  sim.step(); // apply the setup commands
  const settlers = [...sim.world.query(Settler)].sort((a, b) => a - b);
  const woman = settlers.find((e) => sim.world.get(e, Settler).jobType === WOMAN);
  const man = settlers.find((e) => sim.world.get(e, Settler).jobType === CIVILIST);
  if (woman === undefined || man === undefined) throw new Error('setup: settlers missing');
  const homeEntity = homeOf(sim);
  return { sim, woman: () => woman, man: () => man, home: () => homeEntity };
}

/** The one home building entity. */
function homeOf(sim: Simulation): Entity {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === HOME) return e;
  }
  throw new Error('setup: home missing');
}

/** Step until `done()` or `max` ticks, collecting events; throws past `max` (a hung stage fails loudly). */
function runUntil(sim: Simulation, done: () => boolean, max: number, label: string): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < max; i++) {
    sim.step();
    events.push(...sim.events.current());
    if (done()) return events;
  }
  throw new Error(`stage never completed within ${max} ticks: ${label}`);
}

describe('e2e: marriage → household → child (full step schedule)', () => {
  it('runs the whole loop: marry (kiss), assign the house, stock food, hearts, a daughter is born', () => {
    const { sim, woman, man, home } = familySim(3);

    // ── Marry: the woman seeks; the pair walks together, kisses, and carries mirrored Marriages.
    sim.enqueue({ kind: 'marry', entity: woman() });
    const weddingEvents = runUntil(
      sim,
      () => sim.world.has(woman(), Marriage) && sim.world.has(man(), Marriage),
      400,
      'wedding',
    );
    expect(weddingEvents.some((ev) => ev.kind === 'settlersMarried')).toBe(true);
    const kisses = weddingEvents.filter(
      (ev) =>
        ev.kind === 'atomicCompleted' && (ev.atomicId === KISS_ATOMIC_ID || ev.atomicId === KISSED_ATOMIC_ID),
    );
    expect(kisses.length).toBe(2); // one kiss, one kissed — the paired ceremony
    expect(sim.world.get(woman(), Marriage).spouse).toBe(man());
    expect(sim.world.get(man(), Marriage).spouse).toBe(woman());
    expect(sim.world.has(woman(), Wedding)).toBe(false);

    // ── Assign the house: one command on the wife moves the whole family in.
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();
    expect(sim.world.get(woman(), Residence).home).toBe(home());
    expect(sim.world.get(man(), Residence).home).toBe(home());

    // ── Make a daughter: she stocks the home to 3 food (reserved), waits inside, he joins, hearts, birth.
    sim.enqueue({ kind: 'makeChild', entity: woman(), child: 'female' });
    sim.step();
    expect(sim.world.get(woman(), ChildOrder).child).toBe('female');

    let sawReserve = false;
    let sawHearts = false;
    const birthEvents = runUntil(
      sim,
      () => {
        if (sim.world.has(home(), FoodReserve)) sawReserve = true;
        if (sim.world.has(home(), MakingLove)) sawHearts = true;
        return sim.world.get(woman(), Marriage).child !== null;
      },
      4000,
      'child-making',
    );
    expect(sawReserve).toBe(true); // the child fund was reserved while it accumulated
    expect(sawHearts).toBe(true); // hearts showed over the home
    expect(birthEvents.some((ev) => ev.kind === 'settlerBorn')).toBe(true);

    const child = sim.world.get(woman(), Marriage).child;
    expect(child).not.toBeNull();
    const baby = child as Entity;
    expect(sim.world.get(man(), Marriage).child).toBe(baby);
    expect(sim.world.get(baby, Settler).jobType).toBe(BABY_FEMALE); // the ordered sex
    expect(sim.world.has(baby, Female)).toBe(true);
    expect(sim.world.get(baby, Age).ticks).toBe(1); // stamped 0 at birth, aged one tick since
    expect(sim.world.get(baby, Residence).home).toBe(home()); // part of the household
    // The order completed and cleaned up: no standing order, no hearts, no reserve, the fund consumed.
    expect(sim.world.has(woman(), ChildOrder)).toBe(false);
    expect(sim.world.has(home(), MakingLove)).toBe(false);
    expect(sim.world.has(home(), FoodReserve)).toBe(false);
    expect(sim.world.get(home(), Stockpile).amounts.get(FOOD) ?? 0).toBe(0);

    // ── One child at a time: a fresh order while the child is a minor is skipped.
    sim.enqueue({ kind: 'makeChild', entity: woman(), child: 'male' });
    sim.step();
    expect(sim.world.has(woman(), ChildOrder)).toBe(false);
  });

  it('marrying after one spouse is already housed moves the other in (co-housed as one household)', () => {
    // User report 2026-07-17: assigning a woman to a house while she is still single, then marrying
    // her, left the husband unhoused — the home stayed a one-person household (door dot read single)
    // and makeChild never saw the couple together. Marriage now co-houses the pair.
    const { sim, woman, man, home } = familySim(23);
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();
    expect(sim.world.get(woman(), Residence).home).toBe(home());
    expect(sim.world.has(man(), Residence)).toBe(false); // the single man lives nowhere yet

    sim.enqueue({ kind: 'marry', entity: woman() });
    runUntil(sim, () => sim.world.has(woman(), Marriage) && sim.world.has(man(), Marriage), 400, 'wedding');

    // On marriage the husband joins her home, and the two are one family (one homeSize slot).
    expect(sim.world.get(man(), Residence).home).toBe(home());
    const families = familiesOf(sim.world, home());
    expect(families).toHaveLength(1);
    expect(new Set(families[0])).toEqual(new Set([woman(), man()]));
  });

  it('marry auto-cancels when no eligible partner exists (a soldier is on a mission)', () => {
    const sim = new Simulation({ seed: 5, content: familyContent(), map: grassMap(28, 4) });
    sim.enqueue({ kind: 'spawnSettler', jobType: WOMAN, x: 2, y: 0, tribe: VIKING, owner: PLAYER });
    sim.enqueue({ kind: 'spawnSettler', jobType: SOLDIER, x: 6, y: 0, tribe: VIKING, owner: PLAYER });
    sim.step();
    const settlers = [...sim.world.query(Settler)].sort((a, b) => a - b);
    const woman = settlers.find((e) => sim.world.get(e, Settler).jobType === WOMAN) as Entity;
    sim.enqueue({ kind: 'marry', entity: woman });
    for (let i = 0; i < 20; i++) sim.step();
    // The only man is a soldier (on a mission) — nobody to marry, the order dissolved into nothing.
    expect(sim.world.has(woman, Wedding)).toBe(false);
    expect(sim.world.has(woman, Marriage)).toBe(false);
  });

  it('a widow may remarry: the spouse dying removes the survivor Marriage', () => {
    const { sim, woman, man } = familySim(7);
    sim.enqueue({ kind: 'marry', entity: woman() });
    runUntil(sim, () => sim.world.has(woman(), Marriage), 400, 'wedding');
    sim.enqueue({ kind: 'debugKill', target: man() });
    runUntil(sim, () => !sim.world.isAlive(man()), 5, 'death');
    expect(sim.world.has(woman(), Marriage)).toBe(false); // widowed — free to remarry
  });

  it('a widowed parent keeps the Marriage (the parent-child edge) until the child grows up', () => {
    const { sim, woman, man, home } = familySim(13);
    sim.enqueue({ kind: 'marry', entity: woman() });
    runUntil(sim, () => sim.world.has(woman(), Marriage), 400, 'wedding');
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();
    sim.enqueue({ kind: 'makeChild', entity: woman(), child: 'male' });
    runUntil(sim, () => sim.world.get(woman(), Marriage).child !== null, 4000, 'birth');
    const child = sim.world.get(woman(), Marriage).child as Entity;
    sim.enqueue({ kind: 'debugKill', target: man() });
    runUntil(sim, () => !sim.world.isAlive(man()), 5, 'death');
    // Widowed mid-raising: the Marriage survives as the carrier of the parent-child edge — the family
    // still moves as one household, and the widow may not remarry yet.
    expect(sim.world.has(woman(), Marriage)).toBe(true);
    expect(familyOf(sim.world, woman())).toEqual([woman(), child]);
    expect(mayMarry(sim.world, woman())).toBe(false);
    // The child growing up dissolves the stale dead-spouse union: the widow is free again.
    sim.world.remove(child, Age);
    expect(mayMarry(sim.world, woman())).toBe(true);
  });

  it("a widower's home slot frees when his wife dies (a lone man is evicted)", () => {
    const { sim, woman, man, home } = familySim(31);
    sim.enqueue({ kind: 'marry', entity: woman() });
    runUntil(sim, () => sim.world.has(man(), Marriage), 400, 'wedding');
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();
    expect(sim.world.get(man(), Residence).home).toBe(home()); // both housed as one family
    expect(familiesOf(sim.world, home())).toHaveLength(1);

    sim.enqueue({ kind: 'debugKill', target: woman() });
    runUntil(sim, () => !sim.world.isAlive(woman()), 5, 'death');
    // Wife dead, no growing child: the lone man is widowed AND evicted, so the home slot is free for
    // a new family (familiesOf empty — assignHouse now finds a slot).
    expect(sim.world.has(man(), Marriage)).toBe(false);
    expect(sim.world.has(man(), Residence)).toBe(false);
    expect(familiesOf(sim.world, home())).toHaveLength(0);
  });

  it('a widower still raising a child keeps his home slot (the carve-out)', () => {
    const { sim, woman, man, home } = familySim(37);
    sim.enqueue({ kind: 'marry', entity: woman() });
    runUntil(sim, () => sim.world.has(woman(), Marriage), 400, 'wedding');
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();
    sim.enqueue({ kind: 'makeChild', entity: woman(), child: 'male' });
    runUntil(sim, () => sim.world.get(woman(), Marriage).child !== null, 4000, 'birth');
    const child = sim.world.get(woman(), Marriage).child as Entity;

    sim.enqueue({ kind: 'debugKill', target: woman() });
    runUntil(sim, () => !sim.world.isAlive(woman()), 5, 'death');
    // Widowed mid-raising: the man keeps the Marriage (parent-child edge) and his home — the family
    // lives on as one household until the child grows up, so the slot stays occupied.
    expect(sim.world.has(man(), Marriage)).toBe(true);
    expect(sim.world.get(man(), Residence).home).toBe(home());
    expect(familyOf(sim.world, man())).toEqual([man(), child]);
    expect(familiesOf(sim.world, home())).toHaveLength(1);
  });

  it('a widow keeps her home when her husband dies (homes anchor on women)', () => {
    const { sim, woman, man, home } = familySim(41);
    sim.enqueue({ kind: 'marry', entity: woman() });
    runUntil(sim, () => sim.world.has(woman(), Marriage), 400, 'wedding');
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();

    sim.enqueue({ kind: 'debugKill', target: man() });
    runUntil(sim, () => !sim.world.isAlive(man()), 5, 'death');
    // The surviving woman is widowed (free to remarry) but NOT evicted: she keeps her slot, and a new
    // husband joins her home on remarriage.
    expect(sim.world.has(woman(), Marriage)).toBe(false);
    expect(sim.world.get(woman(), Residence).home).toBe(home());
    expect(familiesOf(sim.world, home())).toHaveLength(1);
  });

  it('home food feeds only residents (and never the reserved child fund)', () => {
    const sim = new Simulation({ seed: 11, content: familyContent(), map: grassMap(28, 4) });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOME, x: 10, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: CIVILIST, x: 8, y: 0, tribe: VIKING, owner: PLAYER });
    sim.step();
    const stranger = [...sim.world.query(Settler)][0] as Entity;
    const home = homeOf(sim);
    sim.world.get(home, Stockpile).amounts.set(FOOD, 2);
    // Starve the stranger: hungry beside a stocked home he does NOT live in — he never eats from it.
    sim.enqueue({ kind: 'debugSetNeeds', target: stranger, hunger: 100 });
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(2); // untouched — not his larder
    expect(sim.world.get(stranger, Settler).hunger).toBe(ONE); // still starving (no other food)
    // Move him in: now it IS his larder and he eats.
    sim.enqueue({ kind: 'assignHouse', entity: stranger, house: home });
    runUntil(sim, () => (sim.world.get(home, Stockpile).amounts.get(FOOD) ?? 0) < 2, 200, 'resident meal');
    expect(sim.world.get(stranger, Settler).hunger).toBeLessThan(ONE);
  });

  it('a hungry wife feeds herself before waiting, then bears the child (no home↔store starvation loop)', () => {
    // User report (AI player, 2026-07-18): a wife with the child fund stocked but no other reachable
    // food starved in a loop — the child order dragged her home every tick while the eat drive dragged
    // her to the distant store, so she reached neither and never conceived. She now eats first.
    const sim = new Simulation({ seed: 4, content: familyContent(), map: grassMap(60, 4) });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOME, x: 10, y: 0, tribe: VIKING });
    sim.enqueue({ kind: 'spawnSettler', jobType: WOMAN, x: 10, y: 1, tribe: VIKING, owner: PLAYER });
    sim.enqueue({ kind: 'spawnSettler', jobType: CIVILIST, x: 11, y: 1, tribe: VIKING, owner: PLAYER });
    // The only food outside the home is a warehouse across the map — a long walk from the couple.
    sim.enqueue({ kind: 'placeBuilding', buildingType: WAREHOUSE, x: 54, y: 2, tribe: VIKING });
    sim.step();
    const settlers = [...sim.world.query(Settler)].sort((a, b) => a - b);
    const woman = settlers.find((e) => sim.world.get(e, Settler).jobType === WOMAN) as Entity;
    const man = settlers.find((e) => sim.world.get(e, Settler).jobType === CIVILIST) as Entity;
    const home = homeOf(sim);
    const warehouse = [...sim.world.query(Building)].find(
      (e) => sim.world.get(e, Building).buildingType === WAREHOUSE,
    ) as Entity;

    sim.world.add(woman, Marriage, { spouse: man, child: null });
    sim.world.add(man, Marriage, { spouse: woman, child: null });
    sim.enqueue({ kind: 'assignHouse', entity: woman, house: home });
    sim.step();
    sim.world.get(warehouse, Stockpile).amounts.set(FOOD, 50);
    sim.world.get(home, Stockpile).amounts.set(FOOD, 3); // the child fund, already stocked and reserved
    // Send her into the wait already hungry: without feeding first she loops home↔store and starves.
    sim.enqueue({ kind: 'debugSetNeeds', target: woman, hunger: 80 });
    sim.enqueue({ kind: 'makeChild', entity: woman, child: 'female' });
    sim.step();

    // Hunger only ever falls by eating, so a dip below the seeded 80% proves she reached the store.
    let minHunger = sim.world.get(woman, Settler).hunger;
    runUntil(
      sim,
      () => {
        const hunger = sim.world.get(woman, Settler).hunger;
        if (hunger < minHunger) minHunger = hunger;
        return sim.world.get(woman, Marriage).child !== null;
      },
      4000,
      'hungry child-making',
    );
    expect(sim.world.isAlive(woman)).toBe(true); // fed herself instead of starving in the loop
    expect(minHunger).toBeLessThan(ONE / 4); // she ate (hunger reset toward 0), not merely seeded < ONE
    expect(sim.world.get(sim.world.get(woman, Marriage).child as Entity, Settler).jobType).toBe(BABY_FEMALE);
  });

  it('homeSize caps FAMILIES: singles fill the slots, the family past the last slot is refused', () => {
    const { sim, woman, man, home } = familySim(13);
    // Two unrelated singles = two families, in a homeSize-3 home: both fit.
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.enqueue({ kind: 'assignHouse', entity: man(), house: home() });
    sim.step();
    expect(sim.world.get(woman(), Residence).home).toBe(home());
    expect(sim.world.get(man(), Residence).home).toBe(home()); // not her family — its own slot
    // Two more singles: the third slot fills, the fourth family is refused.
    sim.enqueue({ kind: 'spawnSettler', jobType: CIVILIST, x: 20, y: 0, tribe: VIKING, owner: PLAYER });
    sim.enqueue({ kind: 'spawnSettler', jobType: CIVILIST, x: 22, y: 0, tribe: VIKING, owner: PLAYER });
    sim.step();
    const singles = [...sim.world.query(Settler)]
      .sort((a, b) => a - b)
      .filter((e) => e !== woman() && e !== man());
    const [third, fourth] = singles as [Entity, Entity];
    sim.enqueue({ kind: 'assignHouse', entity: third, house: home() });
    sim.enqueue({ kind: 'assignHouse', entity: fourth, house: home() });
    sim.step();
    expect(sim.world.get(third, Residence).home).toBe(home());
    expect(sim.world.has(fourth, Residence)).toBe(false); // all three family slots taken
    // A resident re-assigning into its own home is a no-op, never a refused "fourth family".
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();
    expect(sim.world.get(woman(), Residence).home).toBe(home());
  });

  it('unassignHouse moves the whole family out and frees the slot (the inverse of assignHouse)', () => {
    const { sim, woman, man, home } = familySim(29);
    // Marry the pair directly (skip the wedding walk) and house them: one family in one slot.
    sim.world.add(woman(), Marriage, { spouse: man(), child: null });
    sim.world.add(man(), Marriage, { spouse: woman(), child: null });
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();
    expect(sim.world.get(woman(), Residence).home).toBe(home());
    expect(sim.world.get(man(), Residence).home).toBe(home());
    expect(familiesOf(sim.world, home())).toHaveLength(1);

    // One command on either spouse moves the whole household out — both lose Residence, the slot frees.
    sim.enqueue({ kind: 'unassignHouse', entity: man() });
    sim.step();
    expect(sim.world.has(woman(), Residence)).toBe(false);
    expect(sim.world.has(man(), Residence)).toBe(false);
    expect(familiesOf(sim.world, home())).toHaveLength(0);

    // The freed home takes a family again — assignHouse refills exactly what unassignHouse emptied.
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.step();
    expect(sim.world.get(woman(), Residence).home).toBe(home());
  });

  it('unassignHouse skips an unhoused adult, a child issuer, and a dead id (recoverable no-ops)', () => {
    const { sim, woman, man, home } = familySim(31);
    // An unhoused adult: nothing to free, and no throw.
    sim.enqueue({ kind: 'unassignHouse', entity: man() });
    sim.step();
    expect(sim.world.has(man(), Residence)).toBe(false);

    // House the woman, then spawn a housed CHILD and aim the command at it: a minor leaves with its
    // parents, never on its own, so the order is skipped and its Residence stays.
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    sim.enqueue({ kind: 'spawnSettler', jobType: CIVILIST, x: 20, y: 0, tribe: VIKING, owner: PLAYER });
    sim.step();
    const minor = [...sim.world.query(Settler)]
      .sort((a, b) => a - b)
      .find((e) => e !== woman() && e !== man()) as Entity;
    sim.world.add(minor, Age, { ticks: 0 }); // still growing up
    sim.world.add(minor, Residence, { home: home() });
    sim.enqueue({ kind: 'unassignHouse', entity: minor });
    sim.step();
    expect(sim.world.get(minor, Residence).home).toBe(home()); // the adult gate held

    // A never-created id: unorderable issuer, skipped — the housed woman stays put.
    sim.enqueue({ kind: 'unassignHouse', entity: 9999 as Entity });
    sim.step();
    expect(sim.world.get(woman(), Residence).home).toBe(home());
  });

  it('two order-holding couples in one home take turns: both bear a child, neither cancels the other', () => {
    // Regression (user report 2026-07-16): MakingLove was keyed on the home with no owner, so the second
    // couple's order saw "hearts but MY spouses aren't inside" and cancelled the first couple's session
    // every tick — both couples entered, instantly stepped back out, and no child was ever born.
    const sim = new Simulation({ seed: 21, content: familyContent(), map: grassMap(28, 4) });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOME, x: 10, y: 0, tribe: VIKING });
    for (const [job, x] of [
      [WOMAN, 2],
      [CIVILIST, 4],
      [WOMAN, 16],
      [CIVILIST, 18],
    ] as const) {
      sim.enqueue({ kind: 'spawnSettler', jobType: job, x, y: 0, tribe: VIKING, owner: PLAYER });
    }
    sim.step();
    const settlers = [...sim.world.query(Settler)].sort((a, b) => a - b);
    const women = settlers.filter((e) => sim.world.get(e, Settler).jobType === WOMAN);
    const men = settlers.filter((e) => sim.world.get(e, Settler).jobType === CIVILIST);
    const [wifeA, wifeB] = women as [Entity, Entity];
    const [manA, manB] = men as [Entity, Entity];
    sim.world.add(wifeA, Marriage, { spouse: manA, child: null });
    sim.world.add(manA, Marriage, { spouse: wifeA, child: null });
    sim.world.add(wifeB, Marriage, { spouse: manB, child: null });
    sim.world.add(manB, Marriage, { spouse: wifeB, child: null });
    const home = homeOf(sim);
    sim.enqueue({ kind: 'assignHouse', entity: wifeA, house: home });
    sim.enqueue({ kind: 'assignHouse', entity: wifeB, house: home });
    sim.enqueue({ kind: 'makeChild', entity: wifeA, child: 'female' });
    sim.enqueue({ kind: 'makeChild', entity: wifeB, child: 'male' });
    sim.step();
    // The larder holds one full child fund: the couples must conceive one AFTER the other.
    sim.world.get(home, Stockpile).amounts.set(FOOD, 3);
    runUntil(sim, () => sim.world.get(wifeA, Marriage).child !== null, 4000, 'first birth');
    expect(sim.world.get(wifeB, Marriage).child).toBeNull(); // one fund, one session — B still waits
    // Restock: the second couple's turn.
    sim.world.get(home, Stockpile).amounts.set(FOOD, 3);
    runUntil(sim, () => sim.world.get(wifeB, Marriage).child !== null, 4000, 'second birth');
    expect(sim.world.get(wifeA, Marriage).child).not.toBeNull();
    expect(sim.world.get(wifeB, Marriage).child).not.toBeNull();
  });

  it('a woman takes no trade: setJob is a recoverable no-op on her', () => {
    const { sim, woman } = familySim(15);
    sim.enqueue({ kind: 'setJob', entity: woman(), jobType: SOLDIER });
    sim.step();
    expect(sim.world.get(woman(), Settler).jobType).toBe(WOMAN); // the woman role is for life
  });

  it('a housewife hoards: with a home and no child order she stocks the larder to capacity', () => {
    const { sim, woman, home } = familySim(17);
    sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
    // The ground pile holds 3 food and the larder caps at 5 — she hauls everything reachable home.
    runUntil(sim, () => (sim.world.get(home(), Stockpile).amounts.get(FOOD) ?? 0) >= 3, 2000, 'hoarding');
    expect(sim.world.has(woman(), ChildOrder)).toBe(false); // no order drove this — the hoard rung did
  });

  it('is deterministic — two same-seed full-loop runs reach the same final state hash', () => {
    const run = (): string => {
      const { sim, woman, home } = familySim(9);
      sim.enqueue({ kind: 'marry', entity: woman() });
      runUntil(sim, () => sim.world.has(woman(), Marriage), 400, 'wedding');
      sim.enqueue({ kind: 'assignHouse', entity: woman(), house: home() });
      sim.enqueue({ kind: 'makeChild', entity: woman(), child: 'male' });
      runUntil(sim, () => sim.world.get(woman(), Marriage).child !== null, 4000, 'child');
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
