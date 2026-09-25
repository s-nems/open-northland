import { describe, expect, it } from 'vitest';
import { Building, JobAssignment, Settler, UnderConstruction } from '../../../src/components/index.js';
import { replay, type Simulation } from '../../../src/index.js';
import { BUILDER_CAP } from '../../../src/systems/ai-player/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BARRACKS_TYPE,
  BREWERY_TYPE,
  BUILDER,
  CARRIER,
  entityOfBuilding,
  FARM_TYPE,
  FARMER,
  HOME_TOP_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  IRON,
  JOINERY_TYPE,
  MILL_TYPE,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  STOCK_TOP_TYPE,
  spawnMen,
  TOOL_IRON,
  TOWER_TYPE,
  VIKING,
  WELL_TYPE,
  WOMAN,
} from './support.js';

describe('the full strategic registry - determinism and replay', () => {
  const TICKS = 120;

  function liveRun(): Simulation {
    const sim = aiSim(11);
    placeHq(sim);
    placeResources(sim);
    spawnMen(sim, 5);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOMAN, x: 20, y: 8, tribe: VIKING, owner: SEAT });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.run(TICKS);
    return sim;
  }

  it('acts through the command seam: the log carries the AI-issued orders', () => {
    const live = liveRun();
    const kinds = new Set(live.commands.log.map((c) => c.command.kind));
    expect(kinds.has('placeBuilding')).toBe(true); // the opening farm went through the queue
    expect(kinds.has('setJob')).toBe(true); // and so did the workforce decisions
    expect(kinds.has('setWorkFlag')).toBe(true); // the collectors flag their resources
  });

  // A long unattended run shares CPU with the whole suite - the explicit timeout keeps a loaded
  // machine from flaking it.
  it('carries the opening list to completion unattended (stocked HQ + a large crew)', {
    timeout: 60_000,
  }, () => {
    const sim = aiSim(21);
    // Needs are off because this fixture cannot restore them: a tired or lonely settler parks for good,
    // so with them on the list closes only if the crew happens to outrun that. The run budget is the
    // construction throughput guard instead.
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ_X,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      fillStock: true,
    });
    // Deep deposits: a whole ladder of gatherers works these spots for the length of the run, and a
    // 5-unit deposit would run dry long before the list closes.
    placeResources(sim, Object.values(RESOURCE_SPOTS), 40);
    // The crew covers the ladder's essentials - the collectors (with top-ups), the scout, the
    // minimum staffing of every workshop the list raises, and the builder reserve that
    // actually raises it - with enough left over to reach the first target-tier posts. The rest
    // waits for grown sons, which this run doesn't simulate. The list closes once the cadenced
    // gathering has fed every site; the budget keeps slack without dragging the suite (per-tick cost
    // here is dominated by the settler micro-planner, not the strategic AI).
    spawnMen(sim, 26);
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.run(9000);
    const built = [...sim.world.query(Building)].filter(
      (e) => !sim.world.has(e, UnderConstruction) && sim.world.get(e, Building).buildingType !== HQ_TYPE,
    );
    // The whole fixture-expressible list stands finished: the farm/mill/bakery/well chain, three
    // TOP-tier homes (the tail's further homes name a tier above this content set's chain, so they
    // skip here), the upgraded bakery plus the three direct-placed level-2 bakeries, three breweries,
    // the joinery, the barracks, and the three outskirts warehouses. Every building sits inside the HQ's
    // opening coverage circle, so only the late tail's denser ring raises towers.
    expect(built.map((e) => sim.world.get(e, Building).buildingType).sort((a, b) => a - b)).toEqual(
      [
        HOME_TOP_TYPE,
        HOME_TOP_TYPE,
        HOME_TOP_TYPE,
        FARM_TYPE,
        WELL_TYPE,
        MILL_TYPE,
        BAKERY_TOP_TYPE,
        BAKERY_TOP_TYPE,
        BAKERY_TOP_TYPE,
        BAKERY_TOP_TYPE,
        BREWERY_TYPE,
        BREWERY_TYPE,
        BREWERY_TYPE,
        JOINERY_TYPE,
        BARRACKS_TYPE,
        STOCK_TOP_TYPE,
        STOCK_TOP_TYPE,
        STOCK_TOP_TYPE,
        TOWER_TYPE,
        TOWER_TYPE,
      ].sort((a, b) => a - b),
    );
    // The crew clears the reserve, so the farm reaches its target-tier hands and the bakery keeps
    // its carrier; the joinery's joiner was locked onto iron tools; the gated iron collector was
    // hired once the list reached its entry (the tiny fixture patch is long harvested dry by now,
    // so the proof is the logged command); and the builder crew never exceeds its reserve.
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const posts = [...sim.world.query(Settler, JobAssignment)].map((e) => ({
      workplace: sim.world.get(e, JobAssignment).workplace,
      jobType: sim.world.get(e, Settler).jobType,
    }));
    expect(posts.filter((p) => p.workplace === farm && p.jobType === FARMER).length).toBeGreaterThanOrEqual(
      2,
    );
    const bakeries = [...sim.world.query(Building)].filter(
      (e) => sim.world.get(e, Building).buildingType === BAKERY_TOP_TYPE,
    );
    expect(bakeries.some((b) => posts.some((p) => p.workplace === b && p.jobType === CARRIER))).toBe(true);
    const log = sim.commands.log.map((c) => c.command);
    expect(log.some((c) => c.kind === 'setGatherGood' && c.goodType === IRON)).toBe(true);
    expect(
      log.some((c) => c.kind === 'setCraftGoods' && c.goods.length === 1 && c.goods[0] === TOOL_IRON),
    ).toBe(true);
    const builders = [...sim.world.query(Settler)].filter(
      (e) => sim.world.get(e, Settler).jobType === BUILDER && !sim.world.has(e, JobAssignment),
    );
    expect(builders.length).toBeLessThanOrEqual(BUILDER_CAP);
  });

  it('same seed twice → byte-identical state; replaying the log reproduces it', () => {
    const a = liveRun();
    const b = liveRun();
    expect(a.hashState()).toBe(b.hashState());
    const replayed = replay({
      content: aiContent(),
      seed: 11,
      map: grassNodeMap(64, 32),
      log: a.commands.log,
      untilTick: TICKS,
    });
    expect(replayed.hashState()).toBe(a.hashState());
    // The seat's live re-emissions are discarded during reconstruction and so take no sequence: the
    // replayed log is numbered exactly like the run it rebuilds, and a bug report's entry index means
    // the same thing in both.
    const order = (sim: Simulation): Array<readonly [number, number, string]> =>
      sim.commands.log.map((e) => [e.applyTick, e.sequence, e.origin] as const);
    expect(order(replayed)).toEqual(order(a));
    expect(order(a).some(([, , origin]) => origin === 'ai')).toBe(true);
  });
});
