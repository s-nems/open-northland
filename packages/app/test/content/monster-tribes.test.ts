import { existsSync } from 'node:fs';
import { cellAnchorNode, components, type Entity } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../src/catalog/buildings.js';
import { spawnSandboxSettler } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { characterTablesUnderTest, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

const { SettlerNeeds, MissionBehaviour, Person, Settler } = components;

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
  it('draws each authored monster form from its body and binds its fight', () => {
    const tables = characterTablesUnderTest([1, 5, 6]);
    expect(tables).not.toBeNull();
    const snake = tables?.get(5);
    const wolf = tables?.get(6);
    expect(snake?.byJob[31]?.binding.byAtomic?.[81]).toBeDefined();
    expect(wolf?.byJob[31]?.binding.byAtomic?.[81]).toBeDefined();
    expect(snake?.byJob[31]?.binding.idleFidgets?.length).toBeGreaterThan(0);
    expect(wolf?.byJob[31]?.binding.idleFidgets?.length).toBeGreaterThan(0);
    for (const job of [16, 18, 32, 33, 35]) {
      const character = snake?.byJob[job];
      expect(character, `monster job ${job} has no body`).toBeDefined();
      expect(character?.indexed, `monster job ${job} uses a baked animal body`).toBe(false);
      expect(character?.binding.moving, `monster job ${job} has no walk`).toBeDefined();
      expect(snake?.fixedByJob?.[job], `monster job ${job} must keep its body while armed`).toBe(character);
    }
    for (const job of [18, 32, 33, 35]) {
      expect(snake?.byJob[job]?.binding.byAtomic?.[81], `monster job ${job} has no attack`).toBeDefined();
    }
  });

  it('starts authored attacks for jobless predators and monster forms with the loaded mod data', async () => {
    const { merge } = await loadContentUnderTest();
    const threats = [
      { tribe: 5, job: 31, hp: 5000, length: 32, hits: [6, 10, 22] },
      { tribe: 6, job: 31, hp: 5000, length: 33, hits: [6, 10, 22] },
      { tribe: 8, job: null, hp: 15000, length: 20, hits: [6] },
      { tribe: 18, job: null, hp: 20000, length: 20, hits: [6] },
      { tribe: 20, job: null, hp: 1000, length: 25, hits: [2] },
      { tribe: 25, job: null, hp: 10000, length: 25, hits: [9] },
      { tribe: 26, job: null, hp: 9000, length: 25, hits: [9] },
      { tribe: 5, job: 32, hp: 5000, length: 25, hits: [9] },
      { tribe: 5, job: 33, hp: 5000, length: 25, hits: [2] },
      { tribe: 5, job: 35, hp: 5000, length: 20, hits: [6] },
    ];
    for (const threat of threats) {
      const sim = createSceneSim(
        {
          seed: 71,
          terrain: grassTerrain(20, 20),
          build: (world) => {
            const at = cellAnchorNode(10, 10);
            world.enqueueSetup(
              threat.job === null
                ? { kind: 'spawnAnimalHerd', tribe: threat.tribe, x: at.hx, y: at.hy, count: 1 }
                : {
                    kind: 'spawnSettler',
                    tribe: threat.tribe,
                    jobType: threat.job,
                    owner: 1,
                    x: at.hx,
                    y: at.hy,
                  },
            );
            spawnSandboxSettler(world, 34, 12, 10);
          },
        },
        { content: merge.content },
      );
      sim.step();
      const entity = [...sim.world.query(Settler)].find(
        (e) => sim.world.get(e, Settler).tribe === threat.tribe,
      );
      if (entity === undefined) throw new Error(`missing threat ${threat.tribe}/${threat.job}`);
      expect(sim.world.get(entity, components.Health).max).toBe(threat.hp);
      // Brown bears retaliate only after provocation.
      if (threat.tribe === 8) {
        const soldier = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).tribe === 1);
        if (soldier === undefined) throw new Error('missing test soldier');
        sim.enqueueSetup({ kind: 'attackUnit', entity: soldier, target: entity });
      }
      let attack = sim.world.tryGet(entity, components.CurrentAtomic);
      for (let tick = 0; tick < 120 && attack?.effect.kind !== 'attack'; tick++) {
        sim.step();
        attack = sim.world.tryGet(entity, components.CurrentAtomic);
      }
      expect(attack, `threat ${threat.tribe}/${threat.job} never attacks`).toMatchObject({
        duration: threat.length,
        effect: { kind: 'attack', hitFrames: threat.hits },
      });
    }
  });

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
      hungerByEntity.set(e, { tribe: settler.tribe, hunger: sim.world.get(e, SettlerNeeds).hunger });
    }
    const monsters = [...hungerByEntity.values()].filter((r) => monsterTypes.has(r.tribe));
    expect(monsters.length).toBeGreaterThan(0);

    sim.run(RUN_TICKS);

    let civiliansRisen = 0;
    for (const [e, before] of hungerByEntity) {
      if (!sim.world.has(e, Settler)) continue;
      const after = sim.world.get(e, SettlerNeeds).hunger;
      if (monsterTypes.has(before.tribe)) expect(after).toBe(before.hunger);
      else if (after > before.hunger) civiliansRisen += 1;
    }
    // The control: the same sweep raises the bars of a tribe that has an economy behind them.
    expect(civiliansRisen).toBeGreaterThan(0);
  });
});
