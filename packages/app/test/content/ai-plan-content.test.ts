import { constructionBillForType, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

const {
  BASE_REPLACEMENT_ENTRY,
  COLLECTOR_TARGET_BY_GOOD_ID,
  COLLECTOR_WORKSHOP_BY_GOOD_ID,
  CRAFT_PLANS_BY_BUILDING_ID,
  DEFAULT_BUILD_ORDER,
  HEADQUARTERS_BUILDING_ID,
  OPENING_HUNT_UNTIL_BUILDING_ID,
  SOLDIER_OUTFIT_GOOD_IDS,
  STAFFING_BY_BUILDING_ID,
  SUPPLY_CARRIER_GOODS_BY_BUILDING_ID,
  TOWER_CONTENT_IDS,
  hunterJobType,
  supplyLines,
} = systems;

/**
 * Pin the AI opening plan's content bindings against the real extracted content. The sim silently
 * `skip`s a plan entry whose id is unknown, so a typo amputates the AI's plan with no test failure
 * and no symptom beyond "the AI never builds X" - this suite is the tripwire: every id in
 * `DEFAULT_BUILD_ORDER`, the base replacement, and the workforce tables must resolve, every
 * direct-place tier must carry a construction bill (a bill-less site would finish instantly), every
 * upgrade target must be reachable over the `upgradeTarget` chain, and the per-building staffing
 * targets must fit real worker slots (the staffing cap is `min(slot.count, target)`, so a stale
 * target silently degrades).
 */
describe.runIf(hasRealIr())('AI opening plan against real content', () => {
  it('every plan id resolves, direct places carry bills, upgrade targets are chained', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const buildingById = new Map(content.buildings.map((b) => [b.id, b]));
    const byTypeId = new Map(content.buildings.map((b) => [b.typeId, b]));

    for (const entry of [BASE_REPLACEMENT_ENTRY, ...DEFAULT_BUILD_ORDER]) {
      if (entry.kind === 'collector') {
        expect(
          content.goods.some((g) => g.id === entry.good),
          `good ${entry.good}`,
        ).toBe(true);
        continue;
      }
      const building = buildingById.get(entry.building);
      expect(building, `building ${entry.building}`).toBeDefined();
      if (building === undefined) continue;
      if (entry.kind !== 'upgrade') {
        // A place (or coverage-placed tower or warehouse) entry raises a real construction site - an
        // empty bill would finish instantly.
        expect(building.construction.length, `construction bill of ${entry.building}`).toBeGreaterThan(0);
      } else {
        // An upgrade entry names its TARGET tier - some lower tier must chain into it.
        const reachable = content.buildings.some((from) => {
          let step = from.upgradeTarget;
          const visited = new Set<number>();
          while (step !== undefined && !visited.has(step)) {
            if (step === building.typeId) return true;
            visited.add(step);
            step = byTypeId.get(step)?.upgradeTarget;
          }
          return false;
        });
        expect(reachable, `upgrade chain into ${entry.building}`).toBe(true);
      }
    }
  });

  it('raises every weapon shop in the opening, never in the late tail', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const buildingById = new Map(content.buildings.map((b) => [b.id, b]));
    // Every good some class could be armed with, deliberately wider than the three main types the
    // garrison orders: a shop is worth checking whoever ends up carrying its output.
    const armingGoods = new Set(
      content.weapons.flatMap((w) =>
        w.goodType !== undefined && w.jobType !== undefined ? [w.goodType] : [],
      ),
    );
    // The perpetual tower-coverage entry opens the late tail.
    const tail = DEFAULT_BUILD_ORDER.findIndex((entry) => entry.kind === 'towerCoverage');
    expect(tail, 'a tower-coverage entry').toBeGreaterThanOrEqual(0);

    const firstPlaced = new Map<string, number>();
    for (const [i, entry] of DEFAULT_BUILD_ORDER.entries()) {
      if (entry.kind === 'place' && !firstPlaced.has(entry.building)) firstPlaced.set(entry.building, i);
    }
    for (const [id, placed] of firstPlaced) {
      const makesArms = (buildingById.get(id)?.recipes ?? []).some((r) =>
        r.outputs.some((o) => armingGoods.has(o.goodType)),
      );
      // The ordering rule and its reason live on `DEFAULT_BUILD_ORDER`.
      if (makesArms) expect(placed, `${id} in the opening`).toBeLessThan(tail);
    }
  });

  it('never reaches an entry whose bill the entries before it cannot supply', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const buildingById = new Map(content.buildings.map((b) => [b.id, b]));
    // Why an unbuildable bill is fatal rather than merely slow lives on `DEFAULT_BUILD_ORDER`.
    // Seeded with every harvestable good rather than the plan's own collector list - an upper bound on
    // gathered income, since a farm declares no recipe and its wheat can only enter through `harvest`.
    const available = new Set(
      content.goods.flatMap((g) => (g.atomics?.harvest === undefined ? [] : [g.typeId])),
    );
    const goodName = new Map(content.goods.map((g) => [g.typeId, g.id]));

    for (const entry of DEFAULT_BUILD_ORDER) {
      if (entry.kind === 'collector') continue;
      const building = buildingById.get(entry.building);
      if (building === undefined) continue; // absent from this content set - the sim skips the entry
      // The two bill shapes are `stores/construction.ts`'s rule.
      const bill =
        entry.kind === 'upgrade'
          ? building.construction
          : constructionBillForType(content.buildings, building.typeId);
      const missing = bill
        .filter((line) => !available.has(line.goodType))
        .map((line) => goodName.get(line.goodType) ?? line.goodType);
      expect(missing, `${entry.kind} ${entry.building} needs`).toEqual([]);
      for (const recipe of building.recipes) {
        for (const output of recipe.outputs) available.add(output.goodType);
      }
    }
  });

  it('the workforce tables name real buildings, goods, and matching worker slots', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const buildingById = new Map(content.buildings.map((b) => [b.id, b]));
    const carrierJob = content.jobs.find((j) => j.id === 'carrier')?.typeId;
    expect(carrierJob).toBeDefined();
    const managed = supplyLines(content, DEFAULT_BUILD_ORDER);

    for (const [id, staffing] of Object.entries(STAFFING_BY_BUILDING_ID)) {
      const building = buildingById.get(id);
      expect(building, `staffing override ${id}`).toBeDefined();
      // The staffing cap is min(slot.count, tier) - a real slot must offer the highest tier's seats.
      const operatorWant = Math.max(
        staffing.operatorMin ?? 0,
        staffing.operatorTarget ?? 0,
        staffing.operatorSurplus ?? 0,
      );
      if (operatorWant > 0) {
        const fits = building?.workers.some((w) => w.jobType !== carrierJob && w.count >= operatorWant);
        expect(fits, `an operator slot of ${id} offering ${operatorWant} seats`).toBe(true);
      }
      // A product-gated second hand is hired only while a product with supply lines runs short.
      if (staffing.productGated === true) {
        expect(
          building?.recipes.some((r) => r.outputs.some((o) => managed.has(o.goodType))),
          `${id} makes a good with supply lines`,
        ).toBe(true);
      }
      const carrierTarget = staffing.carrierTarget ?? 0;
      if (carrierTarget > 0) {
        const fits = building?.workers.some((w) => w.jobType === carrierJob && w.count >= carrierTarget);
        expect(fits, `a carrier slot of ${id} offering ${carrierTarget} seats`).toBe(true);
      }
    }
    // The opening hunt: both halves must resolve, or the post is silently never made (no seat) or
    // never given up (no milestone tier).
    const hunterJob = hunterJobType(content);
    expect(hunterJob, 'a hunter trade').not.toBeNull();
    const hq = buildingById.get(HEADQUARTERS_BUILDING_ID);
    expect(
      hq?.workers.some((w) => w.jobType === hunterJob),
      'a hunter slot at the headquarters',
    ).toBe(true);
    // Why the replacement exists at all: the headquarters declares an EMPTY bill, and an empty-cost
    // type waives the labor gate, so rebuilding one would raise a free hub the moment it is placed.
    expect(hq?.construction.length, 'an empty headquarters bill').toBe(0);
    // The base replacement is found by KIND but named by id, so a drift between the two would leave a
    // baseless seat re-placing a warehouse it never adopts. Its hunter slot keeps the opening hunt
    // running out of the rebuilt hub.
    const replacement = buildingById.get(BASE_REPLACEMENT_ENTRY.building);
    expect(replacement?.kind, `${BASE_REPLACEMENT_ENTRY.building} is storage`).toBe('storage');
    expect(
      replacement?.workers.some((w) => w.jobType === hunterJob),
      `a hunter slot at ${BASE_REPLACEMENT_ENTRY.building}`,
    ).toBe(true);
    expect(
      buildingById.has(OPENING_HUNT_UNTIL_BUILDING_ID),
      `opening-hunt milestone ${OPENING_HUNT_UNTIL_BUILDING_ID}`,
    ).toBe(true);
    for (const goodId of Object.keys(COLLECTOR_TARGET_BY_GOOD_ID)) {
      expect(
        content.goods.some((g) => g.id === goodId),
        `collector good ${goodId}`,
      ).toBe(true);
    }
    // A stale workshop id sends the good's gatherers back to the base, silently.
    for (const [goodId, workshop] of Object.entries(COLLECTOR_WORKSHOP_BY_GOOD_ID)) {
      const good = content.goods.find((g) => g.id === goodId);
      expect(good, `anchored good ${goodId}`).toBeDefined();
      const building = buildingById.get(workshop.building);
      expect(
        building?.recipes.some((r) => r.inputs.some((i) => i.goodType === good?.typeId)),
        `${workshop.building} works up ${goodId}`,
      ).toBe(true);
    }
    // A stale supply good never calls the carrier in.
    for (const [id, goodIds] of Object.entries(SUPPLY_CARRIER_GOODS_BY_BUILDING_ID)) {
      const building = buildingById.get(id);
      expect(
        building?.workers.some((w) => w.jobType === carrierJob),
        `a carrier slot of supply workshop ${id}`,
      ).toBe(true);
      for (const goodId of goodIds) {
        const good = content.goods.find((g) => g.id === goodId);
        expect(
          building?.recipes.some((r) => r.outputs.some((o) => o.goodType === good?.typeId)),
          `${id} makes supply good ${goodId}`,
        ).toBe(true);
      }
    }
    // The tower allowlist: a stale id here would leave built towers uncounted as coverage centres,
    // so the coverage entry would re-arm and place towers forever.
    for (const towerId of TOWER_CONTENT_IDS) {
      const building = buildingById.get(towerId);
      expect(building, `tower id ${towerId}`).toBeDefined();
      expect(building?.kind, `tower kind of ${towerId}`).toBe('tower');
    }
    for (const [id, plan] of Object.entries(CRAFT_PLANS_BY_BUILDING_ID)) {
      const building = buildingById.get(id);
      expect(building, `craft restriction ${id}`).toBeDefined();
      const produced = new Set(building?.recipes.flatMap((r) => r.outputs.map((o) => o.goodType)));
      // One list per operator seat across the type - the buildings the plan raises must offer every seat
      // the table splits.
      const operatorSeats = building?.workers
        .filter((w) => w.jobType !== carrierJob)
        .reduce((most, w) => Math.max(most, w.count), 0);
      const planned = DEFAULT_BUILD_ORDER.reduce(
        (most, entry) =>
          (entry.kind === 'place' || entry.kind === 'upgrade') && entry.building === id
            ? Math.max(most, entry.count)
            : most,
        0,
      );
      const seatLists = [plan.seats, plan.crowded?.seats ?? []];
      for (const seats of seatLists) {
        expect(
          (operatorSeats ?? 0) * planned,
          `operator seats of every planned ${id}`,
        ).toBeGreaterThanOrEqual(seats.length);
      }
      const listed: string[] = [...(plan.alone ?? []), ...(plan.sink ?? [])];
      for (const seat of seatLists.flat()) {
        if (!('goods' in seat)) {
          listed.push(...seat);
          continue;
        }
        listed.push(...seat.goods, ...(seat.otherwise ?? []));
        for (const capped of Object.keys(seat.glut)) {
          // A glut on a good the seat never works would cap nothing, and a good with supply lines takes
          // its glut from them.
          expect(seat.goods, `${id} glut good ${capped}`).toContain(capped);
          const good = content.goods.find((g) => g.id === capped);
          expect(good !== undefined && managed.has(good.typeId), `${id} authors a glut for ${capped}`).toBe(
            false,
          );
        }
      }
      // A sink runs only while the type's goods with supply lines lie at glut, so the type needs one, and a
      // sink good with lines of its own would feed its own trigger.
      if (plan.sink !== undefined) {
        expect(
          [...produced].some((good) => managed.has(good)),
          `${id} makes a good with supply lines`,
        ).toBe(true);
        for (const goodId of plan.sink) {
          const good = content.goods.find((g) => g.id === goodId);
          expect(good !== undefined && managed.has(good.typeId), `${id} sink ${goodId} has no lines`).toBe(
            false,
          );
        }
      }
      for (const goodId of listed) {
        const good = content.goods.find((g) => g.id === goodId);
        expect(good, `craft good ${goodId}`).toBeDefined();
        // The restriction must name a product the workplace actually makes - an unmakeable-only
        // list issues no command and the workshop silently keeps crafting everything.
        expect(good !== undefined && produced.has(good.typeId), `${id} produces ${goodId}`).toBe(true);
      }
    }
    // The soldiers' outfit: a good with no misc equip class is silently never handed out.
    for (const goodId of SOLDIER_OUTFIT_GOOD_IDS) {
      const good = content.goods.find((g) => g.id === goodId);
      expect(good?.equip?.category, `outfit good ${goodId}`).toBe('misc');
    }
    // A resource-gated entry must name a map good, or no map could ever satisfy the gate.
    for (const entry of DEFAULT_BUILD_ORDER) {
      if (entry.kind !== 'place') continue;
      for (const goodId of entry.needsResources ?? []) {
        const good = content.goods.find((g) => g.id === goodId);
        expect(good?.atomics?.harvest, `${entry.building} needs harvestable ${goodId}`).toBeDefined();
      }
    }
  });
});
