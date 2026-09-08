import { existsSync } from 'node:fs';
import { components, type Entity } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, rawIrUnderTest } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

const { MissionBehaviour, Person, Settler } = components;

/** A decoded map whose `sethuman` records are 400 weresnakes on one seat and two saracen heroes on
 *  another - the monster placement the synthetic fixtures can only approximate. */
const MAP_ID = 'saracen_4_sub_1';
const RUN_TICKS = 600;

/**
 * The monster tribes against the REAL decoded content: `logicdefines.inc` declares weresnake and werewolf
 * `TRIBE_TYPE_HUMAN_*`, `animaltypes.ini` gives them no record, and their `jobEnables` tech graph is empty.
 * That combination is what the sim reads as a person with no economy, and it exists only in real content -
 * every other tribe is either a civilization or wildlife.
 */
describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('the monster tribes', () => {
  it('places them as people whose needs never move, beside a civilization whose do', {
    timeout: 120_000,
  }, async () => {
    const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: [], berryBushes: true });
    const ir = rawIrUnderTest() as { tribes?: { typeId: number; id: string; jobEnables?: unknown[] }[] };
    const monsterTribes = (ir.tribes ?? []).filter((t) => t.id === 'weresnake' || t.id === 'werewolf');
    expect(monsterTribes).toHaveLength(2);
    for (const tribe of monsterTribes) expect(tribe.jobEnables ?? []).toHaveLength(0);
    const monsterTypes = new Set(monsterTribes.map((t) => t.typeId));

    // Every placement on this map carries the script's needs-frozen behaviour bit, monsters and
    // saracens alike. That is a second mechanic with the same visible effect, so it is stripped here
    // to leave the tribe rule under test on its own.
    for (const e of [...sim.world.query(MissionBehaviour)]) sim.world.remove(e, MissionBehaviour);

    const hungerByEntity = new Map<Entity, { tribe: number; hunger: number }>();
    for (const e of sim.world.query(Settler)) {
      const settler = sim.world.get(e, Settler);
      // A monster is a person, not wildlife: it is an owned combatant the AI must still see and answer.
      if (monsterTypes.has(settler.tribe)) expect(sim.world.has(e, Person)).toBe(true);
      hungerByEntity.set(e, { tribe: settler.tribe, hunger: settler.hunger });
    }
    const monsters = [...hungerByEntity.values()].filter((r) => monsterTypes.has(r.tribe));
    expect(monsters.length).toBeGreaterThan(0);

    sim.run(RUN_TICKS);

    let civiliansRisen = 0;
    for (const [e, before] of hungerByEntity) {
      if (!sim.world.has(e, Settler)) continue;
      const after = sim.world.get(e, Settler).hunger;
      if (monsterTypes.has(before.tribe)) expect(after).toBe(before.hunger);
      else if (after > before.hunger) civiliansRisen += 1;
    }
    // The control: the same sweep raises the bars of a tribe that has an economy behind them.
    expect(civiliansRisen).toBeGreaterThan(0);
  });
});
