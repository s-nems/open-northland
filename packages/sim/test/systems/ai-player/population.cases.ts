import { describe, expect, it } from 'vitest';
import { Marriage, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { populationModule } from '../../../src/systems/ai-player/index.js';
import {
  aiSim,
  ctxOf,
  entityOfBuilding,
  HOME_TYPE,
  placeHq,
  SEAT,
  spawnMen,
  VIKING,
  WOMAN,
} from './support.js';

describe('population module (homeExpansion)', () => {
  function populationSim(): Simulation {
    const sim = aiSim();
    placeHq(sim);
    for (let i = 0; i < 2; i++) {
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: WOMAN,
        x: 6 + 2 * i,
        y: 8,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    spawnMen(sim, 2);
    sim.step();
    return sim;
  }

  function womenOf(sim: Simulation): Entity[] {
    return [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === WOMAN)
      .sort((a, b) => a - b);
  }

  it('marries every single woman while single men exist', () => {
    const sim = populationSim();
    const commands = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    const weddings = commands.filter((c) => c.kind === 'marry');
    expect(weddings.map((c) => c.entity)).toEqual(womenOf(sim));
  });

  it('houses married women and drives the birth counters: daughters to the slots, sons infinite', () => {
    const sim = populationSim();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: 36,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    for (const woman of womenOf(sim)) sim.enqueueSetup({ kind: 'marry', entity: woman });
    // Let the couples walk together and kiss - both marriages must stand before the module houses them.
    for (let i = 0; i < 3000 && womenOf(sim).some((w) => !sim.world.has(w, Marriage)); i++) sim.step();
    expect(womenOf(sim).every((w) => sim.world.has(w, Marriage))).toBe(true);

    // 2 women against 2 family slots: no daughter deficit, so the module raises only the standing
    // infinite son counter - the assistant keeps every family expecting a boy from here on.
    const houseCommands = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    const home = entityOfBuilding(sim, HOME_TYPE);
    expect(houseCommands.filter((c) => c.kind === 'assignHouse').map((c) => c.house)).toEqual([home, home]);
    expect(houseCommands.filter((c) => c.kind === 'makeChild')).toEqual([]);
    expect(houseCommands.filter((c) => c.kind === 'setAssistantCounter')).toEqual([
      { kind: 'setAssistantCounter', player: SEAT, counter: 'extraMen', value: 0, infinite: true },
    ]);
    for (const c of houseCommands) sim.enqueueSetup(c);
    sim.step();

    // Both counters at their wanted state, everyone married and housed: the decision is a no-op.
    expect([...populationModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);

    // A second home (2 more slots) opens a two-daughter deficit; the son counter stands untouched.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: 24,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect([...populationModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([
      { kind: 'setAssistantCounter', player: SEAT, counter: 'extraWomen', value: 2, infinite: false },
    ]);
  });
});
