import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  JobAssignment,
  Marriage,
  Rider,
  Settler,
  UnderConstruction,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  colonySeats,
  menPastWork,
} from '../../../../../src/systems/computer-player/colony/settlement/posts.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { addFishSwarms } from '../../../../../src/systems/economy/fish.js';
import { liveWorkFlag } from '../../../../../src/systems/economy/work-flag.js';
import { isFisherJob } from '../../../../../src/systems/readviews/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import {
  colonyBuildingsOf,
  colonySettlersOf,
  colonyState,
  colonyWorld,
  editColony,
  fishingColonyContent,
  looseColonyEnv,
  mooredShip,
  SMALL_SHIP,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { idleBuilders, routedWorld } from '../../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { aiSim, BAKER, BUILDER, CARRIER, COLLECTOR, FARMER, MILLER } from '../../support.js';

const GOLD = 90;
const COIN = 91;
const MINT_TYPE = 90;
const COIN_MAKER = 90;
const WOOD = 1;
const IRON = 5;
const ROUND_DUE_TICKS = minutesToTicks(30);
const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const SECOND_SHIP_AT = { x: 90, y: 100 };
const FOUND_DUE_TICKS = minutesToTicks(16);
const SEED = 7;
/** A swarm in the strait off the east island's shore, and its fish. */
const EAST_FISH_AT = { hx: 134, hy: 60 };
const FISH_IN_SWARM = 40;
const GATHER_DUE_TICKS = minutesToTicks(4);
/** The sites a running colony places once its store stands, and their building, before it rests. */
const REST_DUE_TICKS = minutesToTicks(8);
const HOMES_DUE_TICKS = minutesToTicks(20);
const BUILDERS_AT_REST = 2;
/** Seats past one a workshop offers its gatherers. */
const GATHERER_SLOTS = 2;

const seatsOf = (id: string): readonly { readonly jobType: number; readonly count: number }[] => {
  const content = aiContent();
  const type = content.buildings.find((b) => b.id === id);
  if (type === undefined) throw new Error(`setup: no ${id}`);
  return colonySeats(ctxOf(aiSim(1, content)), type);
};

describe('a colony workshop crew', () => {
  it('takes two farmers, one miller, one baker and the bakery porter, as home runs them', () => {
    expect(seatsOf('work_farm_00')).toEqual([{ jobType: FARMER, count: 2 }]);
    expect(seatsOf('work_mill_00')).toEqual([{ jobType: MILLER, count: 1 }]);
    expect(seatsOf('work_bakery_00')).toEqual([
      { jobType: BAKER, count: 1 },
      { jobType: CARRIER, count: 1 },
    ]);
    expect(seatsOf('work_well_00')).toEqual([]);
  });
});

/** {@link aiContent} with a mint taking `input` and wood, gathered by its own collectors. */
function mintContent(input: number) {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: GOLD, id: 'gold', weight: 1, gathering: { bioLandscape: false } },
      { typeId: COIN, id: 'coin', weight: 1 },
    ],
    jobs: [...base.jobs, { typeId: COIN_MAKER, id: 'coin_maker' }],
    buildings: [
      ...base.buildings,
      {
        typeId: MINT_TYPE,
        id: 'work_coin_mint',
        kind: 'workplace',
        workers: [
          { jobType: COIN_MAKER, count: 1 },
          { jobType: COLLECTOR, count: GATHERER_SLOTS },
        ],
        recipes: [
          {
            inputs: [
              { goodType: WOOD, amount: 1 },
              { goodType: input, amount: 1 },
            ],
            outputs: [{ goodType: COIN, amount: 1 }],
            ticks: 180,
          },
        ],
      },
    ],
  });
}

describe('a colony workshop gatherer', () => {
  const gatherers = (input: number): number => {
    const content = mintContent(input);
    const type = content.buildings.find((b) => b.typeId === MINT_TYPE);
    if (type === undefined) throw new Error('setup: no mint');
    const seats = colonySeats({ ...ctxOf(aiSim(1, content)), content }, type);
    return seats.find((seat) => seat.jobType === COLLECTOR)?.count ?? 0;
  };

  it('works for a good no digger of the colony digs, as gold, and leaves the diggers theirs', () => {
    expect(gatherers(GOLD)).toBe(1);
    expect(gatherers(IRON)).toBe(0);
  });
});

describe("a colony's men past work", () => {
  it('are its unwed builders first, past the crew it keeps, so a wed man stays', () => {
    const { sim } = routedWorld();
    expect(stepUntil(sim, ROUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const { husband } = idleBuilders(sim);
    const wife = sim.world.get(husband, Marriage).spouse;
    sim.world.remove(husband, Marriage); // unwed, then wed the man who goes first
    const colony = editColony(sim);
    const unwed = menPastWork(looseColonyEnv(sim, colony), colony);
    const first = unwed[0];
    if (first === undefined) throw new Error('setup: no man past work');
    sim.world.add(first, Marriage, { spouse: wife, child: null });
    sim.world.add(wife, Marriage, { spouse: first, child: null });
    const past = menPastWork(looseColonyEnv(sim, colony), colony);
    expect(past).not.toContain(first);
    expect(past).toHaveLength(unwed.length);
  });
});

describe('a running colony', () => {
  it('sets its builders past a pair digging once nothing is left to raise', () => {
    const sim = colonyWorld();
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    const builders = (): number => {
      return colonySettlersOf(sim).filter(
        (e) => !sim.world.has(e, Rider) && sim.world.get(e, Settler).jobType === BUILDER,
      ).length;
    };
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    for (const e of [...colonyBuildingsOf(sim)])
      if (sim.world.has(e, UnderConstruction)) sim.world.destroy(e);
    for (const build of editColony(sim).builds) build.placed = true;
    // It still raises the home it keeps ahead of its families, and rests once that stands.
    const resting = () =>
      (colonyState(sim)?.builds.every((b) => b.placed) ?? false) && builders() <= BUILDERS_AT_REST;
    expect(stepUntil(sim, REST_DUE_TICKS + HOMES_DUE_TICKS, resting)).toBe(true);
  });

  it('sets its fishers by the shore with a flag of their own, not at the store, so each catch is set down there', () => {
    const sim = colonyWorld(SEED, fishingColonyContent());
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    addFishSwarms(sim.world, terrain, [{ ...EAST_FISH_AT, count: FISH_IN_SWARM, continent: 0 }]);
    stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
    mooredShip(sim);
    stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
    mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
    expect(stepUntil(sim, FOUND_DUE_TICKS, () => colonyState(sim)?.phase === 'running')).toBe(true);
    const fishers = (): Entity[] => {
      const ctx = ctxOf(sim);
      return colonySettlersOf(sim).filter((e) => isFisherJob(ctx.content, sim.world.get(e, Settler).jobType));
    };
    expect(stepUntil(sim, GATHER_DUE_TICKS, () => fishers().length > 0)).toBe(true);
    for (const e of fishers()) {
      expect(sim.world.has(e, JobAssignment)).toBe(false);
      expect(liveWorkFlag(sim.world, e)).toBeDefined();
    }
  });
});
