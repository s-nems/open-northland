import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_RECRUIT_INTENTS,
  type AssistantCounterKind,
  AssistantRecruit,
  type AssistantRecruitIntent,
  Building,
  CraftSelection,
  JobAssignment,
  Settler,
  setStockAmount,
  TrainingOrder,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { AI_PUBLISHED_COUNTERS } from '../../../src/systems/ai-player/assistant-counters.js';
import { tuneCraftSelections } from '../../../src/systems/ai-player/workforce/craft.js';
import { isFighterJob, type SystemContext } from '../../../src/systems/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { stampPost } from '../../signposts/support.js';
import {
  ANIMAL_FARM_TYPE,
  aiSim,
  armedContent,
  BARRACKS_TYPE,
  BOW,
  BREEDER,
  BUILDER,
  CATTLE,
  collectModule,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  husbandryContent,
  JOINERY_TYPE,
  makeAiSeat,
  placeHq,
  SEAT,
  SHEEP,
  SPEAR,
  SWORD,
  spawnMen,
  TOOL_IRON,
  VIKING,
  WOMAN,
} from './support.js';

// The garrison sizing out of the true bachelor surplus, the weapon mix it publishes, and the
// per-seat craft restrictions.

/** Spare civilians an armed-seat case spawns by default - well past every post, reserve and
 *  collector tier. */
const SPARE_MEN = 40;

interface ArmedSeat {
  readonly sim: Simulation;
  readonly ctx: SystemContext;
  /** Civilians spawned - the baseline {@link sparePool} subtracts the ladder's claims from. */
  readonly men: number;
}

interface SeatOptions {
  readonly men?: number;
  /** Where the barracks stands, in nodes - the drill floor an arming reach is measured from. */
  readonly barracks?: { x: number; y: number };
  /** Turn signpost navigation on, so that reach confines anything at all. */
  readonly confined?: boolean;
}

/** The barracks a few nodes off the HQ: one settlement, everything inside one walk range. */
const BARRACKS_AT = { x: 40, y: 16 };
/** A barracks 70 nodes from the HQ store, past a recruit's own walk range (50 nodes). */
const FAR_BARRACKS = { x: 100, y: 16 };
/** A post midway between the two, in TILE coords (`Position` is tile-space), inside the walk range
 *  of both doors - the network that makes the far store shoppable again. */
const BRIDGE_POST = { x: 32, y: 8 };

/** A seat with an HQ holding `arms`, a barracks, and `men` idle civilians, on content whose sword,
 *  spear and bow classes are equippable ({@link armedContent}). */
function armedSeat(arms: readonly { good: number; amount: number }[], options: SeatOptions = {}): ArmedSeat {
  const content = armedContent();
  const men = options.men ?? SPARE_MEN;
  const barracks = options.barracks ?? BARRACKS_AT;
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 32) });
  if (options.confined === true) sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ_X,
    y: HQ_Y,
    tribe: VIKING,
    owner: SEAT,
    initialGoods: arms,
  });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BARRACKS_TYPE,
    x: barracks.x,
    y: barracks.y,
    tribe: VIKING,
    owner: SEAT,
  });
  spawnMen(sim, men);
  makeAiSeat(sim, SEAT);
  sim.step();
  return { sim, ctx: { ...ctxOf(sim), content }, men };
}

/** The rung's standing order, by counter. A counter the decision leaves where it already sits issues
 *  no command, so an absent key means "still zero". */
function counterWants(sim: Simulation, ctx: SystemContext): Partial<Record<AssistantCounterKind, number>> {
  const wants: Partial<Record<AssistantCounterKind, number>> = {};
  for (const c of collectModule.run(sim.world, ctx, SEAT)) {
    if (c.kind === 'setAssistantCounter') wants[c.counter] = c.value;
  }
  return wants;
}

/** The men the ladder leaves over - the draft allowance, derived from the other side: the spawned
 *  civilians minus everyone a post, reserve or flag claimed this decision. */
function sparePool(seat: ArmedSeat): number {
  const claimed = new Set<Entity>();
  for (const c of collectModule.run(seat.sim.world, seat.ctx, SEAT)) {
    if (c.kind === 'setJob' || c.kind === 'assignWorker') claimed.add(c.entity);
  }
  return seat.men - claimed.size;
}

/** The free drill slots the standing order opens: what the dispatcher computes per counter - the
 *  published value less that counter's own unpaid bookings (`systems/assistant/`). A counter the
 *  decision leaves alone keeps its live value. */
function draftHeadroom(seat: ArmedSeat): number {
  const live = seat.sim.assistantCounters(SEAT);
  const wants = counterWants(seat.sim, seat.ctx);
  const booked = new Map<AssistantRecruitIntent, number>();
  for (const e of seat.sim.world.query(AssistantRecruit)) {
    const booking = seat.sim.world.get(e, AssistantRecruit);
    if (!booking.armed) booked.set(booking.intent, (booked.get(booking.intent) ?? 0) + 1);
  }
  return ASSISTANT_RECRUIT_INTENTS.reduce(
    (slots, intent) => slots + Math.max(0, (wants[intent] ?? live[intent].value) - (booked.get(intent) ?? 0)),
    0,
  );
}

describe('workforce module - the barracks and craft selections', () => {
  it('never staffs the barracks: it is a military building, not a workplace the plan crews', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
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
    // rule) and stamps no fighter trade by command: a soldier is made by the drill, never
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
    sim.enqueueSetup({
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

    // The seat hand-picks no recruit (user rule): the rung publishes the leftover
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
    sim.enqueueSetup({
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
    off.enqueueSetup({
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
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: BARRACKS_TYPE,
        x: 40,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
      spawnMen(sim, men);
      for (let i = 0; i < women; i++) {
        sim.enqueueSetup({
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
    sim.enqueueSetup({
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

  it('splits the standing order between swordsmen and archers once both arms are in store', () => {
    // One unit of each is enough: the counter is a standing want, and the smithy keeps making more.
    const both = [
      { good: SWORD, amount: 1 },
      { good: BOW, amount: 1 },
    ];
    const even = armedSeat(both);
    const evenTotal = sparePool(even);
    expect(evenTotal % 2).toBe(0);
    expect(counterWants(even.sim, even.ctx)).toEqual({
      trainSword: evenTotal / 2,
      trainBow: evenTotal / 2,
    });

    // One man fewer makes the split odd: the extra recruit fights in reach, never at range.
    const odd = armedSeat(both, { men: SPARE_MEN - 1 });
    const oddTotal = sparePool(odd);
    expect(oddTotal % 2).toBe(1);
    expect(counterWants(odd.sim, odd.ctx)).toEqual({
      trainSword: (oddTotal + 1) / 2,
      trainBow: (oddTotal - 1) / 2,
    });
  });

  it('splits the standing order three ways once every arm is in store', () => {
    const arms = [
      { good: SWORD, amount: 1 },
      { good: SPEAR, amount: 1 },
      { good: BOW, amount: 1 },
    ];
    // Equal thirds, the publication order taking the men a third does not divide - so both remainder
    // sizes must land in reach: one over goes to swords, two to swords and spears, never to bows.
    const overs = new Set<number>();
    for (const men of [SPARE_MEN, SPARE_MEN + 1]) {
      const seat = armedSeat(arms, { men });
      const total = sparePool(seat);
      const share = Math.floor(total / 3);
      const over = total % 3;
      overs.add(over);
      expect(counterWants(seat.sim, seat.ctx)).toEqual({
        trainSword: share + (over > 0 ? 1 : 0),
        trainSpear: share + (over > 1 ? 1 : 0),
        trainBow: share,
      });
    }
    expect([...overs].sort()).toEqual([1, 2]); // both arms of the tie-break were exercised
  });

  it('puts the whole order on the one class it can arm, never on fists', () => {
    const seat = armedSeat([{ good: BOW, amount: 1 }]);
    // Swords unmade: a swordsman would stand around weaponless, so every recruit becomes an archer
    // (user rule - the fist is the last resort, not half the plan).
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainBow: sparePool(seat) });
  });

  it('falls back to fist-fighters only while the seat holds no arms at all', () => {
    const seat = armedSeat([]);
    const total = sparePool(seat);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSoldiers: total });

    // The fallback follows the STORE, not the content: one delivered sword flips the whole order.
    setStockAmount(seat.sim.world, entityOfBuilding(seat.sim, HQ_TYPE), SWORD, 1);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: total });
  });

  it('will not order a class whose weapons its recruits could never walk to', () => {
    // The store a long march from the drill floor, with no signpost network bridging the two: the
    // arming pass would never fetch these swords, and a `trainSword` order would fill the barracks
    // with men who stand around bare-handed forever - and, being booked, never march either.
    const seat = armedSeat([{ good: SWORD, amount: 1 }], { confined: true, barracks: FAR_BARRACKS });
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSoldiers: sparePool(seat) });

    // One post between the two puts the store back inside the drill floor's own network.
    stampPost(seat.sim, BRIDGE_POST.x, BRIDGE_POST.y, SEAT);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: sparePool(seat) });
  });

  it('keeps each counter carrying its own recruits, so a new weapon drafts nobody extra', () => {
    // The regression a pooled total caused: the assistant reads headroom PER counter
    // (`counter - its own unpaid bookings`), so a shared total re-opened every booked slot the
    // moment the armable set changed, and the dispatcher filled it from married men.
    const seat = armedSeat([{ good: SWORD, amount: SPARE_MEN }]);
    seat.sim.run(200); // the sword order is published and a queue of recruits is in flight
    expect([...seat.sim.world.query(AssistantRecruit)].length).toBeGreaterThan(1);

    const before = draftHeadroom(seat);
    setStockAmount(seat.sim.world, entityOfBuilding(seat.sim, HQ_TYPE), BOW, SPARE_MEN);
    // Bows arriving changes which classes the seat drills, never how many men it may still take.
    expect(draftHeadroom(seat)).toBe(before);
  });

  it('books the class intents through the assistant, and re-publishes nothing while they work', () => {
    const seat = armedSeat([
      { good: SWORD, amount: 4 },
      { good: BOW, amount: 4 },
    ]);
    seat.sim.run(80); // the seat publishes its order, the assistant's beats pace the drafts

    // Every booking is a class intent - the seat drills nobody into the weaponless base class.
    const armed: readonly AssistantRecruitIntent[] = ['trainSword', 'trainBow'];
    const intents = [...seat.sim.world.query(AssistantRecruit)].map(
      (e) => seat.sim.world.get(e, AssistantRecruit).intent,
    );
    expect(intents.length).toBeGreaterThanOrEqual(2);
    expect(intents.filter((intent) => !armed.includes(intent))).toEqual([]);
    // Each draft moves one man from the allowance into its counter's bookings, so the published
    // values are unchanged and the rung re-issues nothing.
    expect(
      [...collectModule.run(seat.sim.world, seat.ctx, SEAT)].filter((c) => c.kind === 'setAssistantCounter'),
    ).toEqual([]);
  });

  it('publishes only counters the AI teardown knows how to withdraw', () => {
    // Drift guard: `setPlayerAi(false)` resets exactly the AI_PUBLISHED_COUNTERS kinds, so a counter
    // this rung reaches for outside that list would keep drafting after the seat's AI is detached.
    const withdrawable = new Set<string>(
      AI_PUBLISHED_COUNTERS.filter((entry) => entry.modules.includes('military')).flatMap(
        (entry) => entry.kinds,
      ),
    );
    const published = new Set<string>();
    for (const arms of [
      [],
      [{ good: SWORD, amount: 1 }],
      [
        { good: SWORD, amount: 1 },
        { good: SPEAR, amount: 1 },
        { good: BOW, amount: 1 },
      ],
    ]) {
      const seat = armedSeat(arms);
      for (const kind of Object.keys(counterWants(seat.sim, seat.ctx))) published.add(kind);
    }
    expect([...published].filter((kind) => !withdrawable.has(kind))).toEqual([]);
    expect(published.size).toBe(4); // all four reached: the fallback and every armed class
  });

  it('keeps a joinery operator on iron tools only, idempotently', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
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
    for (const c of first) sim.enqueueSetup(c);
    sim.step();

    const second = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const tuned = second.filter((c) => c.kind === 'setCraftGoods');
    const joiner = [...sim.world.query(Settler, JobAssignment)].find(
      (e) => sim.world.get(e, JobAssignment).workplace === entityOfBuilding(sim, JOINERY_TYPE),
    );
    expect(tuned).toEqual([{ kind: 'setCraftGoods', entity: joiner, goods: [TOOL_IRON] }]);

    // Applied once, the selection matches - the next decision issues nothing.
    for (const c of second) sim.enqueueSetup(c);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setCraftGoods'),
    ).toEqual([]);
  });

  it('selects stone blocks and ornaments for a mason after upgrading the workshop', () => {
    const base = aiContent();
    const MASON = 9;
    const PILLAR = 8;
    const ORNAMENT = 9;
    const HUT = 18;
    const UPGRADED_HUT = 19;
    const content = parseContentSet({
      ...base,
      goods: [...base.goods, { typeId: PILLAR, id: 'pillar' }, { typeId: ORNAMENT, id: 'ornament' }],
      jobs: [...base.jobs, { typeId: MASON, id: 'mason' }],
      buildings: [
        ...base.buildings,
        {
          typeId: HUT,
          id: 'work_mason_hut_00',
          kind: 'workplace',
          workers: [{ jobType: MASON, count: 1 }],
          produces: [PILLAR],
          recipes: [{ inputs: [], outputs: [{ goodType: PILLAR, amount: 1 }] }],
          stock: [{ goodType: PILLAR, capacity: 10 }],
          construction: [{ goodType: 1, amount: 1 }],
          upgradeTarget: UPGRADED_HUT,
        },
        {
          typeId: UPGRADED_HUT,
          id: 'work_mason_hut_01',
          kind: 'workplace',
          workers: [{ jobType: MASON, count: 1 }],
          produces: [PILLAR, ORNAMENT],
          recipes: [
            { inputs: [], outputs: [{ goodType: PILLAR, amount: 1 }] },
            { inputs: [], outputs: [{ goodType: ORNAMENT, amount: 1 }] },
          ],
          stock: [
            { goodType: PILLAR, capacity: 10 },
            { goodType: ORNAMENT, capacity: 10 },
          ],
          construction: [{ goodType: 1, amount: 1 }],
        },
      ],
    });
    const sim = aiSim(1, content);
    const ctx = { ...ctxOf(sim), content };
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 40, y: 16, tribe: VIKING, owner: SEAT });
    spawnMen(sim, 1, MASON);
    sim.step();
    completeSites(sim);
    const hut = entityOfBuilding(sim, HUT);
    const mason = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === MASON);
    if (mason === undefined) throw new Error('expected a mason');
    sim.world.add(mason, JobAssignment, { workplace: hut });
    expect(tuneCraftSelections(sim.world, ctx, SEAT)).toEqual([]);

    sim.enqueueSetup({ kind: 'upgradeBuilding', building: hut });
    sim.step();
    completeSites(sim);
    expect(sim.world.get(hut, Building).buildingType).toBe(UPGRADED_HUT);
    expect(sim.world.get(mason, CraftSelection).goods).toEqual([PILLAR]);

    const choice = { kind: 'setCraftGoods', entity: mason, goods: [PILLAR, ORNAMENT] } as const;
    expect(tuneCraftSelections(sim.world, ctx, SEAT)).toEqual([choice]);
    sim.enqueueSetup(choice);
    sim.step();
    expect(sim.world.get(mason, CraftSelection).goods).toEqual([PILLAR, ORNAMENT]);
    expect(tuneCraftSelections(sim.world, ctx, SEAT)).toEqual([]);
  });

  it('splits the animal farm between its breeders - the ox line, then the sheep line', () => {
    const content = husbandryContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 32) });
    placeHq(sim);
    sim.enqueueSetup({
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
    for (const c of hires) sim.enqueueSetup(c);
    sim.step();

    // Seats are handed out in canonical settler order: the first breeder takes the cattle, the second
    // the sheep, so both herds are tended at once.
    const breeders = [...sim.world.query(Settler, JobAssignment)]
      .filter((e) => sim.world.get(e, JobAssignment).workplace === farm)
      .filter((e) => sim.world.get(e, Settler).jobType === BREEDER)
      .sort((a, b) => a - b);
    expect(breeders).toHaveLength(2);
    expect([...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'setCraftGoods')).toEqual([
      { kind: 'setCraftGoods', entity: breeders[0], goods: [CATTLE] },
      { kind: 'setCraftGoods', entity: breeders[1], goods: [SHEEP] },
    ]);
  });

  it('gives a lone breeder both lines rather than letting the sheep line die', () => {
    // The split must not outlive the crew it was written for: with the pool too short to seat two
    // breeders, restricting the one man to seat 0 would leave the sheep untended while he is alone.
    const content = husbandryContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 32) });
    placeHq(sim);
    sim.enqueueSetup({
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
    sim.enqueueSetup(hire);
    sim.step();

    const lone = [...sim.world.query(Settler, JobAssignment)].filter(
      (e) =>
        sim.world.get(e, JobAssignment).workplace === farm && sim.world.get(e, Settler).jobType === BREEDER,
    );
    expect(lone).toHaveLength(1);
    expect([...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'setCraftGoods')).toEqual([
      { kind: 'setCraftGoods', entity: lone[0], goods: [SHEEP, CATTLE] },
    ]);
  });
});
