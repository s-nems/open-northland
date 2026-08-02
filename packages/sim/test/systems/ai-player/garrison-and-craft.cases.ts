import { describe, expect, it } from 'vitest';
import { AssistantRecruit, JobAssignment, Settler, TrainingOrder } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { isFighterJob } from '../../../src/systems/index.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  ANIMAL_FARM_TYPE,
  aiSim,
  BARRACKS_TYPE,
  BREEDER,
  BUILDER,
  collectModule,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  husbandryContent,
  JOINERY_TYPE,
  LEATHER,
  makeAiSeat,
  placeHq,
  SEAT,
  spawnMen,
  TOOL_IRON,
  VIKING,
  WOMAN,
  WOOL,
} from './support.js';

/** The garrison sizing out of the true bachelor surplus, and the per-seat craft restrictions. */

describe('workforce module - the barracks and craft selections', () => {
  it('never staffs the barracks: it is a military building, not a workplace the plan crews', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 18, BUILDER);
    sim.step();

    // The barracks declares carrier slots like any store, but the seat posts nobody to them (user
    // rule 2026-07-26) and stamps no fighter trade by command: a soldier is made by the drill, never
    // by `setJob` - and a seat that is not AI-flagged runs no garrison hire at all.
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const barracks = entityOfBuilding(sim, BARRACKS_TYPE);
    const posted = commands.filter((c) => c.kind === 'assignWorker');
    // The staffing pass ran - the HQ took its carriers - and skipped the barracks beside it.
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((c) => c.building === entityOfBuilding(sim, HQ_TYPE))).toBe(true);
    expect(posted.filter((c) => c.building === barracks)).toEqual([]);
    expect(commands.filter((c) => c.kind === 'setJob' && isFighterJob(sim.content, c.jobType))).toEqual([]);
    expect(commands.filter((c) => c.kind === 'trainSoldier')).toEqual([]);
  });

  it('sizes the trainSoldiers counter to the free civilians left after the ladder', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 40); // civilists, well past every post, reserve and collector tier
    makeAiSeat(sim, SEAT);
    sim.step();

    // The seat hand-picks no recruit (user rule 2026-08-02): the rung publishes the leftover
    // free-civilian count as the standing `trainSoldiers` order and the assistant drafts from it.
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands.filter((c) => c.kind === 'trainSoldier')).toEqual([]);
    const claimed = new Set<Entity>();
    for (const c of commands) {
      if (c.kind === 'setJob' || c.kind === 'assignWorker') claimed.add(c.entity);
    }
    const counters = commands.flatMap((c) => (c.kind === 'setAssistantCounter' ? [c] : []));
    expect(counters).toEqual([
      {
        kind: 'setAssistantCounter',
        player: SEAT,
        counter: 'trainSoldiers',
        value: 40 - claimed.size,
        infinite: false,
      },
    ]);
    // Well past the old six-man garrison - no fixed size caps the army.
    expect(40 - claimed.size).toBeGreaterThan(6);
  });

  it('the assistant executes the standing order: civilians march to drill unpicked', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 40);
    makeAiSeat(sim, SEAT);
    // The live loop: the seat publishes the counter, the assistant's beats pace the drafts - no
    // `trainSoldier` command from the AI anywhere in the log.
    sim.run(80);
    expect([...sim.world.query(TrainingOrder)].length).toBeGreaterThanOrEqual(2);
    expect(sim.commands.log.filter((c) => c.command.kind === 'trainSoldier')).toEqual([]);
    // Stable under in-flight drafts: each recruit left the free pool AND counts as booked, so the
    // wanted value is unchanged and the rung re-issues nothing.
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setAssistantCounter'),
    ).toEqual([]);

    const off = aiSim();
    placeHq(off);
    off.enqueue({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(off, 40);
    makeAiSeat(off, SEAT, { military: false });
    off.step();
    expect(
      [...collectModule.run(off.world, ctxOf(off), SEAT)].filter((c) => c.kind === 'setAssistantCounter'),
    ).toEqual([]);
  });

  it('caps the standing order at the bachelor surplus beyond the waiting brides', () => {
    const counterOf = (men: number, women: number): number => {
      const sim = aiSim();
      placeHq(sim);
      sim.enqueue({
        kind: 'placeBuilding',
        buildingType: BARRACKS_TYPE,
        x: 40,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
      spawnMen(sim, men);
      for (let i = 0; i < women; i++) {
        sim.enqueue({
          kind: 'spawnSettler',
          jobType: WOMAN,
          x: 4 + 2 * i,
          y: 28,
          tribe: VIKING,
          owner: SEAT,
        });
      }
      makeAiSeat(sim, SEAT);
      sim.step();
      const counters = [...collectModule.run(sim.world, ctxOf(sim), SEAT)].flatMap((c) =>
        c.kind === 'setAssistantCounter' ? [c] : [],
      );
      return counters[0]?.value ?? 0; // no command = the counter stays at its default zero
    };
    // A soldier neither marries nor fathers children, and the sons of housed couples are the army's
    // only future recruits - with a bride waiting for every bachelor, the order stays empty.
    expect(counterOf(20, 20)).toBe(0);
    // One bachelor beyond the brides: the settlement can spare exactly one man.
    expect(counterOf(21, 20)).toBe(1);
  });

  it('publishes no extra recruit for a booking whose drill was abandoned', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 40);
    makeAiSeat(sim, SEAT);
    sim.run(80); // the standing order is published and at least two drafts are in flight
    const drilling = [...sim.world.query(AssistantRecruit)].filter((e) => sim.world.has(e, TrainingOrder));
    const interrupted = drilling[0];
    expect(interrupted).toBeDefined();
    if (interrupted === undefined) return;
    // An abandoned drill (a wall, an override) drops the order while the booking survives until the
    // sweep: the man is back in the spare pool, so counting his booking too would publish one
    // recruit past the standing want. The rung must still see a settled state and re-issue nothing.
    sim.world.remove(interrupted, TrainingOrder);
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setAssistantCounter'),
    ).toEqual([]);
  });

  it('keeps a joinery operator on iron tools only, idempotently', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: JOINERY_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 2, BUILDER);
    sim.step();

    // The min pass assigns the joiner; its craft selection only exists once the binding stands.
    const first = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(first.filter((c) => c.kind === 'setCraftGoods')).toEqual([]);
    for (const c of first) sim.enqueue(c);
    sim.step();

    const second = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const tuned = second.filter((c) => c.kind === 'setCraftGoods');
    const joiner = [...sim.world.query(Settler, JobAssignment)].find(
      (e) => sim.world.get(e, JobAssignment).workplace === entityOfBuilding(sim, JOINERY_TYPE),
    );
    expect(tuned).toEqual([{ kind: 'setCraftGoods', entity: joiner, goods: [TOOL_IRON] }]);

    // Applied once, the selection matches - the next decision issues nothing.
    for (const c of second) sim.enqueue(c);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setCraftGoods'),
    ).toEqual([]);
  });

  it('splits the animal farm between its breeders - the ox line, then the sheep line', () => {
    const content = husbandryContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
    placeHq(sim);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: ANIMAL_FARM_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 3, BUILDER);
    sim.step();
    const ctx = { ...ctxOf(sim), content };

    // Both breeders are MINIMUM-tier posts: the pair is what runs the two species lines at once.
    const hires = [...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'assignWorker');
    const farm = entityOfBuilding(sim, ANIMAL_FARM_TYPE);
    expect(hires.filter((c) => c.building === farm && c.jobPriority.includes(BREEDER))).toHaveLength(2);
    for (const c of hires) sim.enqueue(c);
    sim.step();

    // Seats are handed out in canonical settler order: the first breeder takes the hide, the second
    // the fleece. Each is a whole species line - the feed stage rides behind it and the feed cycle
    // mints the meat byproduct either way.
    const breeders = [...sim.world.query(Settler, JobAssignment)]
      .filter((e) => sim.world.get(e, JobAssignment).workplace === farm)
      .filter((e) => sim.world.get(e, Settler).jobType === BREEDER)
      .sort((a, b) => a - b);
    expect(breeders).toHaveLength(2);
    expect([...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'setCraftGoods')).toEqual([
      { kind: 'setCraftGoods', entity: breeders[0], goods: [LEATHER] },
      { kind: 'setCraftGoods', entity: breeders[1], goods: [WOOL] },
    ]);
  });

  it('gives a lone breeder both lines rather than letting the sheep line die', () => {
    // The split must not outlive the crew it was written for: with the pool too short to seat two
    // breeders, restricting the one man to seat 0 would leave wool unmade for as long as he is alone.
    const content = husbandryContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
    placeHq(sim);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: ANIMAL_FARM_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 3, BUILDER);
    sim.step();
    const ctx = { ...ctxOf(sim), content };
    const farm = entityOfBuilding(sim, ANIMAL_FARM_TYPE);

    const hire = [...collectModule.run(sim.world, ctx, SEAT)].find(
      (c) => c.kind === 'assignWorker' && c.building === farm && c.jobPriority.includes(BREEDER),
    );
    if (hire === undefined) throw new Error('expected a breeder hire');
    sim.enqueue(hire);
    sim.step();

    const lone = [...sim.world.query(Settler, JobAssignment)].filter(
      (e) =>
        sim.world.get(e, JobAssignment).workplace === farm && sim.world.get(e, Settler).jobType === BREEDER,
    );
    expect(lone).toHaveLength(1);
    expect([...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'setCraftGoods')).toEqual([
      { kind: 'setCraftGoods', entity: lone[0], goods: [LEATHER, WOOL] },
    ]);
  });
});
