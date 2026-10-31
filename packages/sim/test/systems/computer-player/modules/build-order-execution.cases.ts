import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Building,
  BuildOrderFrontier,
  ComputerStrategy,
  discoverTechnology,
  grantScriptUnlock,
  Owner,
  Settler,
  StalledPlacements,
  setMapPermission,
  UnderConstruction,
} from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import { Simulation } from '../../../../src/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../../src/systems/ai-shared/cadence.js';
import { AI_PROFILES } from '../../../../src/systems/computer-player/difficulty.js';
import {
  LATE_GAME_FROM_TICKS,
  SITES_GROW_FROM_TICKS,
} from '../../../../src/systems/computer-player/game-phase.js';
import {
  type BuildOrder,
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  MEN_PER_OPEN_SITE,
  REBUILD_DELAY_TICKS,
  sitePace,
  WELL_REACH_NODES,
} from '../../../../src/systems/computer-player/index.js';
import { standsAtPost } from '../../../../src/systems/conflict/tower-post.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import {
  ANIMAL_FARM_TYPE,
  aiSim,
  BAKER,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  BARRACKS_TYPE,
  BOWMAN,
  BREWERY_TYPE,
  COLLECTOR,
  completeSites,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  HOME_TOP_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  husbandryContent,
  IRON,
  JOINERY_TYPE,
  MILL_TYPE,
  MILLER,
  makeAiSeat,
  oneLine,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SCHOOL_TYPE,
  SEAT,
  STOCK_TOP_TYPE,
  spawnMen,
  TOWER_TYPE,
  technologyContent,
  VEHICLE_YARD_TYPE,
  VIKING,
  WELL_TYPE,
  WOOD,
} from '../support.js';

/** The build-order executor: entry order, the counts it repairs, the open-site cap and the rebuild delay. */

describe('build-order module (houseBuild)', () => {
  const module = buildOrderModule(DEFAULT_BUILD_ORDER);
  /** The default opening alone: this content stops short of the homes line's tiers, so the default
   *  order's lanes open at once and take sites of their own. Its homes stay at the lowest tier. */
  const opening = buildOrderModule(
    oneLine([
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'place', building: 'home_level_00', count: 3, belowTier: 'home_level_01' },
    ]),
  );

  function nextPlacement(sim: Simulation): Command | undefined {
    return [...module.run(sim.world, ctxOf(sim), SEAT)][0];
  }

  function applyAndFinish(sim: Simulation, command: Command): void {
    sim.enqueueSetup(command);
    sim.step();
    completeSites(sim);
  }

  it('uses the roster tribe for expansion and base replacement in an authored mixed-tribe town', () => {
    const sim = aiSim();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ_X,
      y: HQ_Y,
      tribe: 13,
      owner: SEAT,
      force: true,
    });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: 20,
      y: 8,
      tribe: 13,
      owner: SEAT,
      force: true,
    });
    sim.step();
    expect(nextPlacement(sim)).toMatchObject({ kind: 'placeBuilding', tribe: VIKING });
    sim.enqueueSetup({ kind: 'demolish', building: entityOfBuilding(sim, HQ_TYPE) });
    sim.step();
    expect(nextPlacement(sim)).toMatchObject({
      kind: 'placeBuilding',
      buildingType: STOCK_TOP_TYPE,
      tribe: VIKING,
    });
  });

  it("runs the lines side by side near the HQ, each line's first new building before more of one", () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]); // a live iron node keeps the collector step waiting
    sim.step();

    // Farm first - on a free node close to the HQ, as a construction site owned by the seat.
    const first = nextPlacement(sim);
    if (first?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    expect(first.buildingType).toBe(FARM_TYPE);
    expect(first.underConstruction).toBe(true);
    expect(first.owner).toBe(SEAT);
    const dist = Math.abs(first.x - HQ_X) + Math.abs(first.y - HQ_Y);
    expect(dist).toBeGreaterThan(0); // never on the HQ's own node
    expect(dist).toBeLessThanOrEqual(4); // the closest free ring, not a far scatter
    applyAndFinish(sim, first);

    const walk: string[] = [];
    for (let decision = 0; decision < 40; decision++) {
      const next = nextPlacement(sim);
      if (next === undefined) break;
      if (next.kind === 'placeBuilding') walk.push(`place ${next.buildingType}`);
      else if (next.kind === 'upgradeBuilding') walk.push(`upgrade ${next.target}`);
      else throw new Error(`unexpected ${next.kind}`);
      applyAndFinish(sim, next);
    }
    // This content stops short of the pottery and the mason hut, so those steps skip. Every line raises its
    // first new kind of building in priority order (opening, bread with its first bakery's well, brewery,
    // tools; the military line waits for its deadline) before any line adds another of a kind the seat
    // has: the opening's homes, five with no archetype dropping the rich seat's fifth. No progression gate
    // is on and every bill is wood, so each place step but a home's raises its chain's top tier outright;
    // the homes keep their step's tier, the housing lane pacing their tiers by the food. The seat has
    // no man to staff its bakery and brewery, so their lines hold their second copies, and the seat holds
    // no woman, so the housing lane raises nothing. The weapons line holds at its iron gatherer, whose
    // clock has not come, and holds no other line.
    const place = (type: number): string => `place ${type}`;
    expect(walk).toEqual([
      place(HOME_TYPE),
      place(MILL_TYPE),
      place(BAKERY_TOP_TYPE),
      place(WELL_TYPE),
      place(BREWERY_TYPE),
      place(JOINERY_TYPE),
      place(HOME_TYPE),
      place(HOME_TYPE),
      place(HOME_TYPE),
      place(HOME_TYPE),
    ]);
  });

  it('raises another workshop of a kind only once the ones standing hold their full crews', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const bakeries = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'work_bakery_00', count: 1, belowTier: 'work_bakery_01' },
        { kind: 'place', building: 'work_bakery_00', count: 2, belowTier: 'work_bakery_01' },
      ]),
    );
    const next = (): Command | undefined => [...bakeries.run(sim.world, ctxOf(sim), SEAT)][0];
    const first = next();
    if (first?.kind !== 'placeBuilding') throw new Error('expected the first bakery');
    sim.enqueueSetup(first);
    sim.step();
    // Its site still rises, then it stands without a baker: the second waits either way.
    expect(next()).toBeUndefined();
    completeSites(sim);
    expect(next()).toBeUndefined();
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: BAKER,
      x: HQ_X + 2,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const baker = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === BAKER);
    if (baker === undefined) throw new Error('setup: a baker');
    sim.enqueueSetup({
      kind: 'assignWorker',
      entity: baker,
      building: entityOfBuilding(sim, BAKERY_TYPE),
      jobPriority: [BAKER],
    });
    sim.step();
    expect(next()).toMatchObject({ kind: 'placeBuilding', buildingType: BAKERY_TYPE });
  });

  it('keeps placing beside the vehicle yard a workshop crew opened, which holds no site slot', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    const first = [...opening.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the opening placement');
    sim.enqueueSetup(first);
    // A joiner's cart cycle opened a yard site of its own; the list did not place it.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: VEHICLE_YARD_TYPE,
      x: HQ_X + 6,
      y: HQ_Y + 6,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    expect([...sim.world.query(UnderConstruction)]).toHaveLength(2);

    // Two sites stand, yet only the farm counts: the second slot of the opening pace is still free.
    const second = [...opening.run(sim.world, ctxOf(sim), SEAT)][0];
    expect(second).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    if (second?.kind !== 'placeBuilding') return;
    sim.enqueueSetup(second);
    sim.step();
    expect([...opening.run(sim.world, ctxOf(sim), SEAT)][0]).toBeUndefined();
  });

  it('re-places a destroyed building (the count repairs itself)', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const first = nextPlacement(sim);
    if (first?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    sim.enqueueSetup(first);
    sim.step();
    const farm = entityOfBuilding(sim, FARM_TYPE);
    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: farm });
    sim.step();
    sim.enqueueSetup({ kind: 'demolish', building: farm });
    sim.step();
    const again = nextPlacement(sim);
    if (again?.kind !== 'placeBuilding') throw new Error('expected a repair placement');
    expect(again.buildingType).toBe(FARM_TYPE);
  });

  it('keeps within three entries of a site still going up', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const place = (building: string): Extract<BuildOrderEntry, { kind: 'place' }> => ({
      kind: 'place',
      building,
      count: 1,
    });
    // The bakery waits on iron the map lacks, so it skips and takes no place in the lookahead.
    const skipped: BuildOrderEntry = { ...place('work_bakery_00'), needsResources: ['iron'] };
    const chain = buildOrderModule(
      oneLine([
        place('work_farm_00'),
        place('work_mill_00'),
        skipped,
        place('work_well_00'),
        place('work_brewery'),
        place('work_joinery_01'),
      ]),
    );
    const next = (): Command | undefined => [...chain.run(sim.world, ctxOf(sim), SEAT)][0];
    const raise = (expected: number, finish: boolean): void => {
      const placed = next();
      if (placed?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(placed.buildingType).toBe(expected);
      sim.enqueueSetup(placed);
      sim.step();
      if (!finish) return;
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, expected) });
      sim.step();
    };

    // The farm stays a site throughout; the mill, the well and the brewery go up and finish beside it.
    raise(FARM_TYPE, false);
    raise(MILL_TYPE, true);
    raise(WELL_TYPE, true);
    raise(BREWERY_TYPE, true);
    // One site is open, but the joinery would run four entries past the unfinished farm.
    expect(next()).toBeUndefined();
    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, FARM_TYPE) });
    sim.step();
    raise(JOINERY_TYPE, false);
  });

  it('raises a razed building again only after the rebuild delay, after every loss', () => {
    const sim = aiSim();
    placeHq(sim);
    // The seat's own decisions during the steps below would move the frontier with the default list.
    makeAiSeat(sim, SEAT, { houseBuild: false });
    sim.step();
    // The opening coverage entry sits between the two buildings: re-arming it must not lower the frontier.
    const chain = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'work_farm_00', count: 1 },
        { kind: 'towerCoverage', building: 'tower_01' },
        { kind: 'place', building: 'work_mill_00', count: 1 },
      ]),
    );
    const decide = (tick: number): Command[] => [...chain.run(sim.world, ctxOf(sim, tick), SEAT)];
    for (const expected of [FARM_TYPE, MILL_TYPE]) {
      const placed = decide(0)[0];
      if (placed?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(placed.buildingType).toBe(expected);
      applyAndFinish(sim, placed);
    }
    expect(decide(0)).toEqual([]); // the list is done: the frontier stands past its end

    /** Raze `type` at `tick`, and check it waits out the delay before its site is placed again. */
    const razeAndRebuild = (type: number, tick: number): void => {
      sim.enqueueSetup({ kind: 'demolish', building: entityOfBuilding(sim, type) });
      sim.step();
      expect(decide(tick)).toEqual([]);
      expect(decide(tick + REBUILD_DELAY_TICKS - 1)).toEqual([]);
      const again = decide(tick + REBUILD_DELAY_TICKS)[0];
      if (again?.kind !== 'placeBuilding') throw new Error(`expected type ${type} placed again`);
      expect(again.buildingType).toBe(type);
      applyAndFinish(sim, again);
      expect(decide(tick + REBUILD_DELAY_TICKS)).toEqual([]);
    };
    razeAndRebuild(MILL_TYPE, 100); // the last entry, at the frontier's edge
    razeAndRebuild(FARM_TYPE, 1000); // a second loss waits again

    // An outlying home re-arms the coverage entry below the mill; the tower goes up at once.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X + 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const tower = decide(2000)[0];
    if (tower?.kind !== 'placeBuilding') throw new Error('expected a covering tower');
    expect(tower.buildingType).toBe(TOWER_TYPE);
    applyAndFinish(sim, tower);
    razeAndRebuild(MILL_TYPE, 3000);
  });

  it('counts an upgrade in flight as met, and goes on with the list beside it', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const chain = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'work_bakery_00', count: 1 },
        { kind: 'upgrade', building: 'work_bakery_01', count: 1 },
        { kind: 'place', building: 'work_farm_00', count: 1 },
      ]),
    );
    const next = (): Command | undefined => [...chain.run(sim.world, ctxOf(sim), SEAT)][0];
    // The lower bakery stands by hand: the order itself would raise the enabled upper tier outright.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const upgrade = next();
    if (upgrade?.kind !== 'upgradeBuilding') throw new Error('expected the bakery upgrade');
    sim.enqueueSetup(upgrade);
    sim.step();
    expect(next()).toMatchObject({ kind: 'placeBuilding', buildingType: FARM_TYPE });
  });

  it('opens a third site from the growth clock and a fourth from the late game', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    const paces = [0, SITES_GROW_FROM_TICKS, LATE_GAME_FROM_TICKS].map(
      (t) => sitePace(AI_PROFILES.hard, t).sites,
    );
    expect(paces).toEqual([...paces].sort((a, b) => a - b));
    expect(new Set(paces).size).toBe(paces.length);

    const openAt = (tick: number): Command | undefined =>
      [...opening.run(sim.world, ctxOf(sim, tick), SEAT)][0];
    const sites = (): number => [...sim.world.query(UnderConstruction)].length;
    for (let open = 0; open < sitePace(AI_PROFILES.hard, LATE_GAME_FROM_TICKS).sites; open++) {
      expect(sites()).toBe(open);
      // Each step holds at its own cap while the next one opens another site.
      if (open >= sitePace(AI_PROFILES.hard, 0).sites) expect(openAt(0)).toBeUndefined();
      if (open >= sitePace(AI_PROFILES.hard, SITES_GROW_FROM_TICKS).sites)
        expect(openAt(SITES_GROW_FROM_TICKS)).toBeUndefined();
      const tick =
        open < sitePace(AI_PROFILES.hard, 0).sites
          ? 0
          : open < sitePace(AI_PROFILES.hard, SITES_GROW_FROM_TICKS).sites
            ? SITES_GROW_FROM_TICKS
            : LATE_GAME_FROM_TICKS;
      const next = openAt(tick);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected site ${open + 1} at tick ${tick}`);
      sim.enqueueSetup(next);
      sim.step();
    }
    expect(openAt(LATE_GAME_FROM_TICKS)).toBeUndefined();
  });

  it('opens no tower site past the sites its men can staff', () => {
    const laned = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'work_farm_00', count: 1 },
        { kind: 'towerCoverage', building: 'tower_01', lane: true },
      ]),
    );
    const sim = aiSim();
    placeHq(sim);
    // A home out at the edge arms the ring; three men staff one site, the farm's.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X + 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, MEN_PER_OPEN_SITE);
    sim.step();
    const act = (): Command | undefined => {
      const commands = [...laned.run(sim.world, ctxOf(sim, LATE_GAME_FROM_TICKS), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands[0];
    };
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: FARM_TYPE });
    expect(act()).toBeUndefined();
    // Three more men staff a second site: the tower goes up.
    spawnMen(sim, MEN_PER_OPEN_SITE);
    sim.step();
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: TOWER_TYPE });
  });

  it('leaves a freed site empty for the profile’s pause below the hard difficulty', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    makeAiSeat(sim, SEAT, { houseBuild: false }, 'easy');
    sim.step();
    const pause = AI_PROFILES.easy.freeSitePauseTicks;
    const at = (tick: number): Command | undefined => [...module.run(sim.world, ctxOf(sim, tick), SEAT)][0];

    // The first decision to find the site free starts the wait, and the list acts once it has run out.
    expect(at(0)).toBeUndefined();
    expect(at(pause - 1)).toBeUndefined();
    const first = at(pause);
    if (first?.kind !== 'placeBuilding') throw new Error('expected the opening placement');
    applyAndFinish(sim, first);
    // The finished site frees the slot again, and the next wait runs from the decision that sees it.
    expect(at(pause + 1)).toBeUndefined();
    expect(at(2 * pause)).toBeUndefined();
    expect(at(2 * pause + 1)?.kind).toBe('placeBuilding');
  });

  it('runs a reached lane beside the list: on the hard profile its tower stands beyond the clock', () => {
    const laned = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'work_farm_00', count: 1 },
        { kind: 'towerCoverage', building: 'tower_01', lane: true },
        { kind: 'place', building: 'home_level_00', count: 4, belowTier: 'home_level_01' },
      ]),
    );
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const act = (): Command | undefined => {
      const commands = [...laned.run(sim.world, ctxOf(sim, LATE_GAME_FROM_TICKS), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands[0];
    };
    const placed = (): number[] =>
      [...sim.world.query(UnderConstruction)].map((e) => sim.world.get(e, Building).buildingType);
    // The farm holds the list until its site stands; then the lane is reached, satisfied while every
    // building sits in the HQ circle, and the list goes on to the homes.
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: FARM_TYPE });
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    // A home out at the edge re-arms the lane: the tower goes up first, out of the lane's own site.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X + 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: TOWER_TYPE });
    // The late clock keeps four sites, all the list's: the tower stands beyond them, so the list opens two
    // more homes beside the farm and the home, then stops at the clock's four.
    expect(placed().sort((a, b) => a - b)).toEqual([FARM_TYPE, HOME_TYPE, TOWER_TYPE].sort((a, b) => a - b));
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    expect(act()).toBeUndefined();
    expect(placed()).toHaveLength(sitePace(AI_PROFILES.hard, LATE_GAME_FROM_TICKS).sites + 1);
  });

  it("raises a line's tower ring one site at a time", () => {
    const ringed = buildOrderModule(oneLine([{ kind: 'towerCoverage', building: 'tower_01' }]));
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(160, 32) });
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
    placeHq(sim);
    // Two homes out east, far apart: no one tower covers both.
    for (const dx of [31, 90]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x: HQ_X + dx,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    sim.step();
    const act = (): Command | undefined => {
      const commands = [...ringed.run(sim.world, ctxOf(sim, LATE_GAME_FROM_TICKS), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands[0];
    };
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: TOWER_TYPE });
    // The clock has free sites, but the ring waits for its tower to stand.
    expect(act()).toBeUndefined();
    completeSites(sim);
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: TOWER_TYPE });
  });

  it('never holds the list on a lane with no room for its building', () => {
    // A store lane whose one target, a gatherer's flag, lies far past any spot the seat may build on: the
    // lane finds nothing, and the list goes on regardless.
    const STORE_RADIUS = 19;
    const laned = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'work_farm_00', count: 1 },
        { kind: 'storeCoverage', building: 'stock_02', radius: STORE_RADIUS, lane: true },
        { kind: 'place', building: 'home_level_00', count: 2, belowTier: 'home_level_01' },
      ]),
    );
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(240, 32) });
    placeHq(sim);
    const FAR_FLAG = { x: HQ_X + 190, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: COLLECTOR,
      x: FAR_FLAG.x + 2,
      y: FAR_FLAG.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const gatherer = [...sim.world.query(Settler)].find(
      (e) => sim.world.get(e, Settler).jobType === COLLECTOR,
    );
    if (gatherer === undefined) throw new Error('setup: a gatherer');
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, x: FAR_FLAG.x, y: FAR_FLAG.y });
    sim.step();
    const next = (): Command | undefined => [...laned.run(sim.world, ctxOf(sim), SEAT)][0];
    const farm = next();
    if (farm?.kind !== 'placeBuilding') throw new Error('expected the farm');
    applyAndFinish(sim, farm);
    expect(next()).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
  });

  it('looks one entry further past the oldest open site from each pace step', () => {
    const paced = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'work_farm_00', count: 1 },
        { kind: 'place', building: 'home_level_00', count: 1, belowTier: 'home_level_01' },
        { kind: 'place', building: 'work_well_00', count: 1 },
        { kind: 'place', building: 'work_mill_00', count: 1 },
        { kind: 'place', building: 'work_bakery_00', count: 1, belowTier: 'work_bakery_01' },
        { kind: 'place', building: 'work_brewery', count: 1 },
      ]),
    );
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const act = (tick: number): Command | undefined => {
      const commands = [...paced.run(sim.world, ctxOf(sim, tick), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands[0];
    };
    const finish = (buildingType: number): void => {
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, buildingType) });
      sim.step();
    };
    // The farm's site stays open; each entry behind it finishes at once, so the site cap never binds.
    expect(act(0)?.kind).toBe('placeBuilding');
    for (const built of [HOME_TYPE, WELL_TYPE, MILL_TYPE]) {
      expect(act(0)?.kind).toBe('placeBuilding');
      finish(built);
    }
    // The bakery lies four entries past the farm: beyond the opening's lookahead, inside the next step's.
    expect(act(0)).toBeUndefined();
    expect(act(SITES_GROW_FROM_TICKS)?.kind).toBe('placeBuilding');
    finish(BAKERY_TYPE);
    expect(act(SITES_GROW_FROM_TICKS)).toBeUndefined();
    expect(act(LATE_GAME_FROM_TICKS)?.kind).toBe('placeBuilding');
  });

  it('passes over an upgrade with nothing left below its tier, so the steps behind it still act', () => {
    // The army line's catapult joinery stands behind six tower upgrades, more than a small seat has towers.
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TOP_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const order = buildOrderModule(
      oneLine([
        { kind: 'upgrade', building: 'work_bakery_01', count: 2 },
        { kind: 'place', building: 'work_brewery', count: 1 },
      ]),
    );
    const next = [...order.run(sim.world, ctxOf(sim), SEAT)][0];
    expect(next).toMatchObject({ kind: 'placeBuilding', buildingType: BREWERY_TYPE });
  });

  it('upgrades two buildings side by side, each in-flight upgrade meeting its share of the entry', () => {
    const FIRST_BAKERY = { x: HQ_X + 8, y: HQ_Y };
    const SECOND_BAKERY = { x: HQ_X + 24, y: HQ_Y + 8 };
    const ownedOfType = (sim: Simulation, type: number): number =>
      [...sim.world.query(Building)].filter((e) => sim.world.get(e, Building).buildingType === type).length;
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const bakeries = buildOrderModule(
      oneLine([
        { kind: 'place', building: 'work_bakery_00', count: 1 },
        { kind: 'place', building: 'work_farm_00', count: 1 },
        { kind: 'place', building: 'work_mill_00', count: 1 },
        { kind: 'place', building: 'work_well_00', count: 1 },
        { kind: 'upgrade', building: 'work_bakery_01', count: 2 },
      ]),
    );
    const next = (): Command | undefined => [...bakeries.run(sim.world, ctxOf(sim), SEAT)][0];
    // Both lower bakeries stand by hand: the order would raise the enabled upper tier outright, and a
    // second one only once the first had its baker.
    for (const at of [FIRST_BAKERY, SECOND_BAKERY]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: BAKERY_TYPE,
        ...at,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    sim.step();
    for (let i = 0; i < 3; i++) {
      const placed = next();
      if (placed?.kind !== 'placeBuilding') throw new Error('expected a placement');
      applyAndFinish(sim, placed);
    }
    expect(ownedOfType(sim, BAKERY_TYPE)).toBe(2);
    const first = next();
    if (first?.kind !== 'upgradeBuilding') throw new Error('expected the first upgrade');
    sim.enqueueSetup(first);
    sim.step();
    const second = next();
    if (second?.kind !== 'upgradeBuilding') throw new Error('expected the second upgrade beside the first');
    expect(second.building).not.toBe(first.building);
    sim.enqueueSetup(second);
    sim.step();
    expect(next()).toBeUndefined();
  });

  it('skips a place entry while the map holds none of the good it works up', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const gated = buildOrderModule(
      oneLine([
        {
          kind: 'place',
          building: 'work_bakery_00',
          count: 1,
          needsResources: ['iron'],
          belowTier: 'work_bakery_01',
        },
        { kind: 'place', building: 'work_farm_00', count: 1 },
      ]),
    );
    const passedOver = [...gated.run(sim.world, ctxOf(sim), SEAT)][0];
    if (passedOver?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    expect(passedOver.buildingType).toBe(FARM_TYPE);

    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    const placed = [...gated.run(sim.world, ctxOf(sim), SEAT)][0];
    if (placed?.kind !== 'placeBuilding') throw new Error('expected the bakery placement');
    expect(placed.buildingType).toBe(BAKERY_TYPE);
  });

  it('holds a collector entry until its whole count of gatherers stands', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    const order = buildOrderModule(
      oneLine([
        { kind: 'collector', good: 'iron', count: 2 },
        { kind: 'place', building: 'work_farm_00', count: 1 },
      ]),
    );
    const flagIronGatherer = (): void => {
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: COLLECTOR,
        x: 12,
        y: 24,
        tribe: VIKING,
        owner: SEAT,
      });
      sim.step();
      const settler = [...sim.world.query(Settler)].at(-1);
      if (settler === undefined) throw new Error('setup: collector missing');
      sim.enqueueSetup({ kind: 'setWorkFlag', entity: settler, x: 14, y: 26 });
      sim.enqueueSetup({ kind: 'setGatherGood', entity: settler, goodType: IRON });
      sim.step();
    };
    flagIronGatherer();
    expect([...order.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]); // one of two: still waiting
    flagIronGatherer();
    const placed = [...order.run(sim.world, ctxOf(sim), SEAT)][0];
    if (placed?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    expect(placed.buildingType).toBe(FARM_TYPE);
  });

  it('stalls when nothing can upgrade toward the entry tier yet', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const upgradeOnly = buildOrderModule(oneLine([{ kind: 'upgrade', building: 'home_level_02', count: 1 }]));
    expect([...upgradeOnly.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('places a further home straight at the top tier instead of growing it', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    // The tail's housing rule: the opening homes walk the upgrade chain, but every home after them
    // is placed at the top tier outright - its own construction bill.
    const topHomes = buildOrderModule(oneLine([{ kind: 'place', building: 'home_level_02', count: 1 }]));
    const first = [...topHomes.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the top-tier home placement');
    expect(first.buildingType).toBe(HOME_TOP_TYPE);
  });

  it('counts an upgraded building for its place entry instead of building a duplicate', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const placeOnly = buildOrderModule(oneLine([{ kind: 'place', building: 'work_bakery_00', count: 1 }]));
    // The lower bakery stands by hand: the entry itself would place the enabled upper tier outright.
    applyAndFinish(sim, {
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    applyAndFinish(sim, { kind: 'upgradeBuilding', building: bakery });
    // The building now stands at the upper tier - the level-0 place entry stays satisfied.
    expect(sim.world.get(bakery, Building).buildingType).toBe(BAKERY_TOP_TYPE);
    expect([...placeOnly.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });
});

it('does not issue an upgrade blocked by map permissions and resumes once a script allows it', () => {
  const sim = aiSim();
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HOME_TYPE,
    tribe: VIKING,
    owner: SEAT,
    x: HQ_X + 8,
    y: HQ_Y,
    force: true,
  });
  sim.step();
  const target = sim.content.buildings.find((b) => b.typeId === HOME_TOP_TYPE);
  const next = sim.content.buildings.find((b) => b.typeId === HOME_TYPE)?.upgradeTarget;
  if (target === undefined || next === undefined) throw new Error('Missing fixture upgrade chain');
  const module = buildOrderModule(oneLine([{ kind: 'upgrade', building: target.id, count: 1 }]));
  setMapPermission(sim.world, { player: SEAT, tribe: VIKING, kind: 'house', typeId: next, allowed: false });
  expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  // An Enable grant leaves the ban in place; only an Allow lifts it.
  grantScriptUnlock(sim.world, 'enabled', SEAT, VIKING, 'house', next);
  expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  grantScriptUnlock(sim.world, 'allowed', SEAT, VIKING, 'house', next);
  expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toMatchObject([
    { kind: 'upgradeBuilding', target: HOME_TOP_TYPE },
  ]);
  // With the entry's own tier banned, the home still rises as far as it may.
  setMapPermission(sim.world, {
    player: SEAT,
    tribe: VIKING,
    kind: 'house',
    typeId: HOME_TOP_TYPE,
    allowed: false,
  });
  expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toMatchObject([
    { kind: 'upgradeBuilding', target: next },
  ]);
});

/** The enemy seat in the bakery well cases. */
const FOE = 3;

describe('build order - the bakery wells', () => {
  const NEAR_BAKERY = { x: 34, y: 16 };
  const FAR_BAKERY = { x: 6, y: 16 };
  const order: readonly BuildOrderEntry[] = [
    {
      kind: 'place',
      building: 'work_well_00',
      count: 5,
      near: [{ kind: 'building', id: 'work_bakery_00' }],
      unlessWithin: { building: 'work_bakery_00', radius: WELL_REACH_NODES },
    },
    { kind: 'place', building: 'work_mill_00', count: 1 },
  ];

  /** Two bakeries, the far one at the upgraded tier, and a well beside the near one plus one per `wells`. */
  function bakerySeat(wells: readonly { x: number; y: number }[]): Command | undefined {
    const sim = aiSim();
    placeHq(sim);
    const sites = [
      { buildingType: BAKERY_TYPE, ...NEAR_BAKERY },
      { buildingType: BAKERY_TOP_TYPE, ...FAR_BAKERY },
      { buildingType: WELL_TYPE, x: NEAR_BAKERY.x + 4, y: NEAR_BAKERY.y },
      ...wells.map((at) => ({ buildingType: WELL_TYPE, ...at })),
    ];
    for (const site of sites)
      sim.enqueueSetup({ kind: 'placeBuilding', ...site, tribe: VIKING, owner: SEAT });
    sim.step();
    return [...buildOrderModule(oneLine(order)).run(sim.world, ctxOf(sim), SEAT)][0];
  }

  it('raises a well beside the bakery that has none in reach, an upgraded one included', () => {
    const well = bakerySeat([]);
    if (well?.kind !== 'placeBuilding') throw new Error('expected a well placement');
    expect(well.buildingType).toBe(WELL_TYPE);
    expect(Math.abs(well.x - FAR_BAKERY.x) + Math.abs(well.y - FAR_BAKERY.y)).toBeLessThan(WELL_REACH_NODES);
  });

  /** The far bakery under fire: manned foe towers north and south of it put every node in a well's reach of
   *  it under fire (the reach disc is wider in rows than in columns, so one post's Manhattan reach cannot
   *  cover it), and the seat's well entry can only be passed over. */
  function wellUnderFireSeat(): Simulation {
    const sim = aiSim();
    placeHq(sim);
    for (const site of [
      { buildingType: BAKERY_TYPE, ...NEAR_BAKERY },
      { buildingType: BAKERY_TOP_TYPE, ...FAR_BAKERY },
      { buildingType: WELL_TYPE, x: NEAR_BAKERY.x + 4, y: NEAR_BAKERY.y },
    ]) {
      sim.enqueueSetup({ kind: 'placeBuilding', ...site, tribe: VIKING, owner: SEAT });
    }
    const posts = [
      { x: FAR_BAKERY.x, y: FAR_BAKERY.y - 4 },
      { x: FAR_BAKERY.x, y: FAR_BAKERY.y + 4 },
    ];
    for (const at of posts) {
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType: TOWER_TYPE, ...at, tribe: VIKING, owner: FOE });
    }
    sim.step();
    const towers = [...sim.world.query(Building)].filter((e) => sim.world.get(e, Owner).player === FOE);
    expect(towers).toHaveLength(posts.length);
    for (const at of posts) {
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: BOWMAN,
        x: at.x + 4,
        y: at.y,
        tribe: VIKING,
        owner: FOE,
      });
    }
    sim.step();
    const archers = [...sim.world.query(Settler, Owner)].filter(
      (e) => sim.world.get(e, Owner).player === FOE,
    );
    expect(archers).toHaveLength(posts.length);
    for (const [i, archer] of archers.entries()) {
      const tower = towers[i];
      if (tower === undefined) throw new Error('setup: fewer towers than archers');
      sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [BOWMAN] });
    }
    for (let i = 0; i < 200; i++) sim.step();
    for (const archer of archers) expect(standsAtPost(sim.world, archer)).not.toBeNull();
    return sim;
  }

  it('passes the well over, rather than stalling the list, when no spot in reach of the bakery is legal', () => {
    const sim = wellUnderFireSeat();
    expect([...buildOrderModule(oneLine(order)).run(sim.world, ctxOf(sim), SEAT)][0]).toMatchObject({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
    });
  });

  it('keeps placing past a passed-over well decision after decision, its frontier untouched and nothing holding the list', () => {
    // A seat with an AI carrier keeps a frontier: the passed-over well must not move it, or the well, unmet
    // below it next decision, would read as a razed building and hold the list for the rebuild delay.
    const sim = wellUnderFireSeat();
    makeAiSeat(sim, SEAT);
    const homesToo = buildOrderModule(
      oneLine([...order, { kind: 'place', building: 'home_level_00', count: 3, belowTier: 'home_level_01' }]),
    );
    const placed: number[] = [];
    for (let decision = 0; decision < 5; decision++) {
      const tick = SEAT + decision * COMPUTER_DECISION_INTERVAL_TICKS;
      const command = [...homesToo.run(sim.world, ctxOf(sim, tick), SEAT)][0];
      if (command === undefined) break;
      if (command.kind !== 'placeBuilding') throw new Error('expected a placement');
      placed.push(command.buildingType);
      sim.enqueueSetup(command);
      sim.step();
      completeSites(sim);
    }
    expect(placed).toEqual([MILL_TYPE, HOME_TYPE, HOME_TYPE, HOME_TYPE]);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI carrier');
    expect(sim.world.tryGet(carrier, BuildOrderFrontier)?.lines).toEqual(
      new Map([['opening', { step: 3, rebuildTick: null }]]),
    );
    // The well's failed search waits out its retry like any other; it holds nothing.
    const stalled = sim.world.tryGet(carrier, StalledPlacements);
    expect(stalled?.holding.size).toBe(0);
    expect([...(stalled?.retryTicks.keys() ?? [])]).toEqual(['opening:0']);
  });

  it('opens the lanes behind a passed-over well', () => {
    const sim = wellUnderFireSeat();
    // A home out at the east edge, far from the fire in the west, re-arms the tower lane after the well.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X + 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const laned = buildOrderModule(
      oneLine([
        order[0] ?? { kind: 'collector', good: 'wood' },
        { kind: 'towerCoverage', building: 'tower_01', lane: true },
        { kind: 'place', building: 'work_mill_00', count: 1 },
      ]),
    );
    expect([...laned.run(sim.world, ctxOf(sim, LATE_GAME_FROM_TICKS), SEAT)][0]).toMatchObject({
      kind: 'placeBuilding',
      buildingType: TOWER_TYPE,
    });
  });

  it('skips the well once every bakery has one in reach', () => {
    expect(bakerySeat([{ x: FAR_BAKERY.x + 4, y: FAR_BAKERY.y }])).toMatchObject({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
    });
  });
});

describe('build order - the animal farm well', () => {
  const FARM = { x: 44, y: 16 };
  const order: readonly BuildOrderEntry[] = [
    {
      kind: 'place',
      building: 'work_well_00',
      count: 3,
      near: [{ kind: 'building', id: 'work_animal_farm' }],
      unlessWithin: { building: 'work_animal_farm', radius: WELL_REACH_NODES },
    },
    // Acts only once the well entry counts as done, so a skip is told apart from a stall.
    { kind: 'place', building: 'work_mill_00', count: 1 },
  ];

  function animalFarmSeat(wellX: number): Command | undefined {
    const content = husbandryContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    for (const [buildingType, x] of [
      [WELL_TYPE, wellX],
      [ANIMAL_FARM_TYPE, FARM.x],
    ] as const) {
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y: FARM.y, tribe: VIKING, owner: SEAT });
    }
    sim.step();
    return [...buildOrderModule(oneLine(order)).run(sim.world, { ...ctxOf(sim), content }, SEAT)][0];
  }

  it('skips the well while one already stands beside the animal farm', () => {
    expect(animalFarmSeat(FARM.x + 4)).toMatchObject({ kind: 'placeBuilding', buildingType: MILL_TYPE });
  });

  it('raises a well beside the animal farm when the first stands farther off', () => {
    const well = animalFarmSeat(FARM.x - 3 * WELL_REACH_NODES);
    if (well?.kind !== 'placeBuilding') throw new Error('expected a well placement');
    expect(well.buildingType).toBe(WELL_TYPE);
    expect(Math.abs(well.x - FARM.x) + Math.abs(well.y - FARM.y)).toBeLessThan(WELL_REACH_NODES);
  });
});

describe('build order - a coverage entry with no spot', () => {
  const WATER = 1;
  const POCKET_RADIUS = 10;
  const ISLAND = { x: HQ_X + 31, y: HQ_Y };

  /** Grass in a pocket round the HQ and on one far node, water everywhere else: nothing within a tower's
   *  reach of the far node is buildable, so no tower can ever cover a home standing on it. */
  function islandSim(): Simulation {
    const width = 64;
    const height = 32;
    const typeIds = new Array<number>(width * height).fill(WATER);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= POCKET_RADIUS) typeIds[y * width + x] = 0;
      }
    }
    typeIds[ISLAND.y * width + ISLAND.x] = 0;
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { resolution: 'half-cell', width, height, typeIds },
    });
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      ...ISLAND,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
    sim.step();
    return sim;
  }

  it('passes a tower entry over, like a store entry, when no target it has can be covered', () => {
    const sim = islandSim();
    expect(sim.world.get(entityOfBuilding(sim, HOME_TYPE), Building).buildingType).toBe(HOME_TYPE);
    const towersFirst = buildOrderModule(
      oneLine([
        { kind: 'towerCoverage', building: 'tower_01' },
        { kind: 'place', building: 'work_mill_00', count: 1 },
      ]),
    );
    expect([...towersFirst.run(sim.world, ctxOf(sim), SEAT)][0]).toMatchObject({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
    });
  });
});

describe('build order - independent lines', () => {
  /** The fixture's wooden tools, made only by the joinery; the sand ground type. */
  const TOOL_WOODEN = 6;
  const SAND = 2;
  /** Capped at the lowest home tier, which every step below expects. */
  const HOME_STEP: BuildOrderEntry = {
    kind: 'place',
    building: 'home_level_00',
    count: 1,
    belowTier: 'home_level_01',
  };
  const MILL_STEP: BuildOrderEntry = { kind: 'place', building: 'work_mill_00', count: 1 };

  function twoLines(
    bread: readonly BuildOrderEntry[],
    homes: readonly BuildOrderEntry[],
    priority: BuildOrder['priority'] = ['bread', 'homes'],
  ): BuildOrder {
    return {
      lines: [
        { id: 'bread', steps: bread },
        { id: 'homes', steps: homes },
      ],
      priority,
    };
  }

  function decide(sim: Simulation, order: BuildOrder, tick = 0, content = aiContent()): Command | undefined {
    return [...buildOrderModule(order).run(sim.world, { ...ctxOf(sim, tick), content }, SEAT)][0];
  }

  it('gives one free site to the ready step of the higher-priority line', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    expect(decide(sim, twoLines([MILL_STEP], [HOME_STEP]))).toMatchObject({ buildingType: MILL_TYPE });
    expect(decide(sim, twoLines([MILL_STEP], [HOME_STEP], ['homes', 'bread']))).toMatchObject({
      buildingType: HOME_TYPE,
    });
  });

  it('gives the free site to a line raising its first building of a kind before one adding more', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const twoHomes: BuildOrderEntry = { ...HOME_STEP, count: 2 };
    const order = twoLines([twoHomes], [MILL_STEP]);
    // The higher line's first home is new to the seat, so it goes first.
    const home = decide(sim, order);
    if (home?.kind !== 'placeBuilding') throw new Error('expected the first home');
    expect(home.buildingType).toBe(HOME_TYPE);
    sim.enqueueSetup(home);
    sim.step();
    completeSites(sim);
    // Its second home adds one more of a kind the seat owns: the mill, new to it, goes first.
    expect(decide(sim, order)).toMatchObject({ buildingType: MILL_TYPE });
  });

  it('gives the free site to a workshop whose discovery the seat earned, ahead of a higher line', () => {
    const order = twoLines([MILL_STEP], [HOME_STEP], ['homes', 'bread']);
    const open = aiSim();
    placeHq(open);
    open.step();
    // With no technology table the mill was never earned: the higher line's home goes first.
    expect(decide(open, order)).toMatchObject({ buildingType: HOME_TYPE });

    const content = technologyContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.step();
    expect(decide(sim, order, 0, content)).toMatchObject({ buildingType: HOME_TYPE });
    discoverTechnology(sim.world, SEAT, VIKING, 'job', MILLER);
    expect(decide(sim, order, 0, content)).toMatchObject({ buildingType: MILL_TYPE });
  });

  it('gives the free site to a defence line before an earned workshop while the defence comes first', () => {
    const content = technologyContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    makeAiSeat(sim, SEAT, { houseBuild: false });
    sim.step();
    discoverTechnology(sim.world, SEAT, VIKING, 'job', MILLER);
    const order: BuildOrder = {
      lines: [
        { id: 'bread', steps: [MILL_STEP] },
        { id: 'military', steps: [HOME_STEP] },
      ],
      priority: ['bread', 'military'],
    };
    expect(decide(sim, order, 0, content)).toMatchObject({ buildingType: MILL_TYPE });
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    const strategy = sim.world.tryGet(carrier, ComputerStrategy);
    if (strategy === undefined) throw new Error('setup: no strategy');
    sim.world.mut(carrier, ComputerStrategy).military = {
      ...strategy.military,
      posture: 'defend',
      evidence: ['underAttack'],
    };
    expect(decide(sim, order, 0, content)).toMatchObject({ buildingType: HOME_TYPE });
  });

  it('opens one site over the pace for a workshop whose discovery the seat earned', () => {
    const content = technologyContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    for (const x of [HQ_X - 10, HQ_X + 10]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
        underConstruction: true,
      });
    }
    sim.step();
    const order = twoLines([MILL_STEP], [{ ...HOME_STEP, count: 5 }]);
    // The opening's two sites are taken: nothing else goes up, the mill not yet earned.
    expect(decide(sim, order, 0, content)).toBeUndefined();
    discoverTechnology(sim.world, SEAT, VIKING, 'job', MILLER);
    const mill = decide(sim, order, 0, content);
    expect(mill).toMatchObject({ buildingType: MILL_TYPE });
    if (mill === undefined) return;
    sim.enqueueSetup(mill);
    sim.step();
    // One site over the pace only, and only for the earned workshop.
    expect(decide(sim, order, 0, content)).toBeUndefined();
  });

  /** The fixture's edible good, `food_simple`. */
  const FOOD = 3;

  /** `content` whose mill turns wood into the fixture's food, so the mill heads a food chain. */
  function millFeeds(content: ContentSet): ContentSet {
    return parseContentSet({
      ...content,
      buildings: content.buildings.map((b) =>
        b.id === 'work_mill_00'
          ? {
              ...b,
              recipes: [
                {
                  inputs: [{ goodType: WOOD, amount: 1 }],
                  outputs: [{ goodType: FOOD, amount: 1 }],
                  ticks: 180,
                },
              ],
            }
          : b,
      ),
    });
  }

  it('gives the free site to a food chain step ahead of a higher line while the seat makes no food', () => {
    const order = twoLines([MILL_STEP], [HOME_STEP], ['homes', 'bread']);
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    // A mill making nothing edible is an ordinary workshop: the higher line's home goes first.
    expect(decide(sim, order)).toMatchObject({ buildingType: HOME_TYPE });
    expect(decide(sim, order, 0, millFeeds(aiContent()))).toMatchObject({ buildingType: MILL_TYPE });
  });

  it('gives a core step the earned turn and its extra site once no food chain step is ready', () => {
    const content = millFeeds(technologyContent());
    const sim = aiSim(1, content);
    placeHq(sim);
    for (const x of [HQ_X - 10, HQ_X + 10]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
        underConstruction: true,
      });
    }
    sim.step();
    const newSchool: BuildOrderEntry = { kind: 'place', building: 'school', count: 1 };
    const school: BuildOrderEntry = { ...newSchool, core: true };
    const order: BuildOrder = {
      lines: [
        { id: 'opening', steps: [school] },
        { id: 'bread', steps: [MILL_STEP] },
      ],
      priority: ['opening', 'bread'],
    };
    // Without the core mark the school, a new kind, waits for a site of the pace.
    const plain: BuildOrder = { ...order, lines: [{ id: 'opening', steps: [newSchool] }] };
    expect(decide(sim, plain, 0, content)).toBeUndefined();
    // The mill waits on its discovery, so the school takes the site over the pace.
    expect(decide(sim, order, 0, content)).toMatchObject({ buildingType: SCHOOL_TYPE });
    // Once the miller is discovered the mill is ready and goes first.
    discoverTechnology(sim.world, SEAT, VIKING, 'job', MILLER);
    expect(decide(sim, order, 0, content)).toMatchObject({ buildingType: MILL_TYPE });
  });

  it('opens the site over the pace for the barracks on its deadline while the defence comes first', () => {
    const sim = aiSim();
    placeHq(sim);
    makeAiSeat(sim, SEAT, { houseBuild: false });
    for (const x of [HQ_X - 10, HQ_X + 10]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
        underConstruction: true,
      });
    }
    sim.step();
    const barracks: BuildOrderEntry = {
      kind: 'place',
      building: 'barracks',
      count: 1,
      holdUntil: { kind: 'deadline', leadTicks: 0 },
    };
    const order: BuildOrder = {
      lines: [
        { id: 'bread', steps: [MILL_STEP] },
        { id: 'military', steps: [barracks] },
      ],
      priority: ['bread', 'military'],
    };
    // The opening's two sites are taken and the barracks still holds for its deadline.
    expect(decide(sim, order)).toBeUndefined();
    const carrier = aiControlEntity(sim.world, SEAT);
    const strategy = carrier === null ? undefined : sim.world.tryGet(carrier, ComputerStrategy);
    if (carrier === null || strategy === undefined) throw new Error('setup: no strategy');
    sim.world.mut(carrier, ComputerStrategy).military = {
      ...strategy.military,
      posture: 'defend',
      evidence: ['underAttack'],
    };
    // A raid lifts the hold, and the barracks takes the site over the pace; the mill does not.
    expect(decide(sim, order)).toMatchObject({ buildingType: BARRACKS_TYPE });
  });

  it('goes on with the other lines while one is held', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    // The bread line waits on an iron gatherer nobody hired; a single list would stall behind it.
    const order = twoLines([{ kind: 'collector', good: 'iron' }, MILL_STEP], [HOME_STEP]);
    expect(decide(sim, order)).toMatchObject({ buildingType: HOME_TYPE });
  });

  it('passes over a step whose building the seat may not build yet', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    setMapPermission(sim.world, {
      player: SEAT,
      tribe: VIKING,
      kind: 'house',
      typeId: MILL_TYPE,
      allowed: false,
    });
    expect(decide(sim, twoLines([MILL_STEP, HOME_STEP], []))).toMatchObject({ buildingType: HOME_TYPE });
    grantScriptUnlock(sim.world, 'allowed', SEAT, VIKING, 'house', MILL_TYPE);
    expect(decide(sim, twoLines([MILL_STEP, HOME_STEP], []))).toMatchObject({ buildingType: MILL_TYPE });
  });

  it('holds a step whose bill nothing the seat gathers, owns or stores can fill', () => {
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      buildings: base.buildings.map((b) =>
        b.id === 'work_mill_00' ? { ...b, construction: [{ goodType: TOOL_WOODEN, amount: 1 }] } : b,
      ),
    });
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.step();
    const order = twoLines([MILL_STEP], [HOME_STEP]);
    // The wooden tools come only from the joinery, which the seat lacks: the bread line waits.
    expect(decide(sim, order, 0, content)).toMatchObject({ buildingType: HOME_TYPE });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: JOINERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    expect(decide(sim, order, 0, content)).toMatchObject({ buildingType: MILL_TYPE });
  });

  it('keys the stalled search and the rebuild wait by line and step', () => {
    const sim = aiSim();
    placeHq(sim);
    makeAiSeat(sim, SEAT, { houseBuild: false });
    sim.step();
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI carrier');
    const order = twoLines([MILL_STEP], [HOME_STEP, { ...HOME_STEP, count: 2 }]);
    for (const expected of [MILL_TYPE, HOME_TYPE]) {
      const placed = decide(sim, order);
      if (placed?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(placed.buildingType).toBe(expected);
      sim.enqueueSetup(placed);
      sim.step();
    }
    completeSites(sim);

    // The razed mill waits out the rebuild delay on its own line; the homes line places beside it.
    sim.enqueueSetup({ kind: 'demolish', building: entityOfBuilding(sim, MILL_TYPE) });
    sim.step();
    const razedAt = 100;
    expect(decide(sim, order, razedAt)).toMatchObject({ buildingType: HOME_TYPE });
    expect(sim.world.tryGet(carrier, BuildOrderFrontier)?.lines.get('bread')).toEqual({
      step: 1,
      rebuildTick: razedAt + REBUILD_DELAY_TICKS,
    });
    expect(decide(sim, order, razedAt + REBUILD_DELAY_TICKS)).toMatchObject({ buildingType: MILL_TYPE });

    // A farm with no grass anywhere arms its own step's retry and holds only its own line.
    const sand = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { resolution: 'half-cell', width: 64, height: 32, typeIds: new Array<number>(64 * 32).fill(SAND) },
    });
    sand.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
    placeHq(sand);
    makeAiSeat(sand, SEAT, { houseBuild: false });
    sand.step();
    const farm: BuildOrderEntry = {
      kind: 'place',
      building: 'work_farm_00',
      count: 1,
      ground: 'plantable',
      essential: true,
    };
    expect(decide(sand, twoLines([farm], [HOME_STEP]))).toMatchObject({ buildingType: HOME_TYPE });
    const sandCarrier = aiControlEntity(sand.world, SEAT);
    if (sandCarrier === null) throw new Error('setup: no AI carrier');
    const stalled = sand.world.tryGet(sandCarrier, StalledPlacements);
    expect([...(stalled?.retryTicks.keys() ?? [])]).toEqual(['bread:0']);
    expect(stalled?.holding).toEqual(new Map([['bread', 'bread:0']]));
  });
});
