import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AssistantRecruit,
  JobAssignment,
  Marriage,
  Residence,
  Settler,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { populationModule } from '../../../src/systems/ai-player/index.js';
import { IDLE_MEN_HOLD_BIRTHS } from '../../../src/systems/ai-player/population.js';
import { builderCap } from '../../../src/systems/ai-player/workforce/staffing.js';
import { aiContent } from '../../fixtures/ai-content.js';
import {
  aiSim,
  BUILDER,
  ctxOf,
  entityOfBuilding,
  HOME_TYPE,
  HQ_TYPE,
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

  it('re-houses the families of a razed home in the next free one', () => {
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
    for (let i = 0; i < 3000 && womenOf(sim).some((w) => !sim.world.has(w, Marriage)); i++) sim.step();
    for (const c of populationModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();
    const razed = entityOfBuilding(sim, HOME_TYPE);
    expect(womenOf(sim).every((w) => sim.world.get(w, Residence).home === razed)).toBe(true);

    sim.enqueueSetup({ kind: 'demolish', building: razed });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: 24,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();

    const rebuilt = entityOfBuilding(sim, HOME_TYPE);
    const houseCommands = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(houseCommands.filter((c) => c.kind === 'assignHouse').map((c) => c.house)).toEqual([
      rebuilt,
      rebuilt,
    ]);
  });

  it('does not count a heroine as daughter stock for a family slot', () => {
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      jobs: [...base.jobs, { typeId: 47, id: 'heroine_bow_xena' }],
      buildings: base.buildings.map((building) =>
        building.typeId === HOME_TYPE ? { ...building, homeSize: 1 } : building,
      ),
    });
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: 36,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 47, x: 8, y: 8, tribe: VIKING, owner: SEAT });
    sim.step();

    const counters = [...populationModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)].filter(
      (command) => command.kind === 'setAssistantCounter',
    );
    expect(counters).toContainEqual({
      kind: 'setAssistantCounter',
      player: SEAT,
      counter: 'extraWomen',
      value: 1,
      infinite: false,
    });
  });

  describe('the sons counter under idle men', () => {
    /** The sons counter after two decisions: one on a seat with nobody idle, which unbounds it, then one
     *  after `builders` builders arrive, the lowest ids first handed to `book`. */
    function sonsAfter(
      builders: number,
      book: (sim: Simulation, men: readonly Entity[]) => void = () => {},
    ): { value: number; infinite: boolean } {
      const sim = aiSim();
      placeHq(sim);
      sim.step();
      const decide = (): void => {
        for (const c of populationModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
        sim.step();
      };
      decide();
      spawnMen(sim, builders, BUILDER);
      sim.step();
      const men = [...sim.world.query(Settler)]
        .filter((e) => sim.world.get(e, Settler).jobType === BUILDER)
        .sort((a, b) => a - b);
      book(sim, men);
      decide();
      return sim.assistantCounters(SEAT).extraMen;
    }

    // The seat's civilians are its builders alone, well under the grown-settlement reserve.
    const reserve = builderCap(0, 0);

    it('holds the sons at zero while idle builders stand beyond the reserve', () => {
      const idleBeyondReserve = 5;
      expect(sonsAfter(reserve + idleBeyondReserve)).toEqual({ value: 0, infinite: false });
    });

    it('keeps the sons unbounded while the idle men fit the reserve', () => {
      expect(sonsAfter(reserve + IDLE_MEN_HOLD_BIRTHS - 1)).toEqual({ value: 0, infinite: true });
    });

    it('never counts a posted man as idle', () => {
      const posted = (sim: Simulation, [man]: readonly Entity[]): void => {
        if (man === undefined) throw new Error('setup: no builder');
        sim.world.add(man, JobAssignment, { workplace: entityOfBuilding(sim, HQ_TYPE) });
      };
      expect(sonsAfter(reserve + IDLE_MEN_HOLD_BIRTHS, posted)).toEqual({ value: 0, infinite: true });
    });

    it('never counts a man booked for a drill as idle', () => {
      const booked = (sim: Simulation, [man]: readonly Entity[]): void => {
        if (man === undefined) throw new Error('setup: no builder');
        sim.world.add(man, AssistantRecruit, { intent: 'trainSword', armed: false });
      };
      expect(sonsAfter(reserve + IDLE_MEN_HOLD_BIRTHS, booked)).toEqual({ value: 0, infinite: true });
    });
  });
});
