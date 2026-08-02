import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

const {
  COLLECTOR_TARGET_BY_GOOD_ID,
  CRAFT_RESTRICTIONS_BY_BUILDING_ID,
  DEFAULT_BUILD_ORDER,
  STAFFING_BY_BUILDING_ID,
  TOWER_CONTENT_IDS,
} = systems;

/**
 * Pin the AI opening plan's content bindings against the real extracted content. The sim silently
 * `skip`s a plan entry whose id is unknown, so a typo amputates the AI's plan with no test failure
 * and no symptom beyond "the AI never builds X" - this suite is the tripwire: every id in
 * `DEFAULT_BUILD_ORDER` and the workforce tables must resolve, every direct-place tier must carry a
 * construction bill (a bill-less site would finish instantly), every upgrade target must be reachable
 * over the `upgradeTarget` chain, and the per-building staffing targets must fit real worker slots
 * (the staffing cap is `min(slot.count, target)`, so a stale target silently degrades).
 */
describe.runIf(hasRealIr())('AI opening plan against real content', () => {
  it('every plan id resolves, direct places carry bills, upgrade targets are chained', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const buildingById = new Map(content.buildings.map((b) => [b.id, b]));
    const byTypeId = new Map(content.buildings.map((b) => [b.typeId, b]));

    for (const entry of DEFAULT_BUILD_ORDER) {
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
      if (entry.kind === 'place' || entry.kind === 'towerCoverage') {
        // A place (or coverage-placed tower) entry raises a real construction site - an empty bill
        // would finish instantly.
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

  it('the workforce tables name real buildings, goods, and matching worker slots', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const buildingById = new Map(content.buildings.map((b) => [b.id, b]));
    const carrierJob = content.jobs.find((j) => j.id === 'carrier')?.typeId;
    expect(carrierJob).toBeDefined();

    for (const [id, staffing] of Object.entries(STAFFING_BY_BUILDING_ID)) {
      const building = buildingById.get(id);
      expect(building, `staffing override ${id}`).toBeDefined();
      // The staffing cap is min(slot.count, tier) - a real slot must offer the highest tier's seats.
      const operatorWant = Math.max(staffing.operatorTarget ?? 0, staffing.operatorSurplus ?? 0);
      if (operatorWant > 0) {
        const fits = building?.workers.some((w) => w.jobType !== carrierJob && w.count >= operatorWant);
        expect(fits, `an operator slot of ${id} offering ${operatorWant} seats`).toBe(true);
      }
      const carrierTarget = staffing.carrierTarget ?? 0;
      if (carrierTarget > 0) {
        const fits = building?.workers.some((w) => w.jobType === carrierJob && w.count >= carrierTarget);
        expect(fits, `a carrier slot of ${id} offering ${carrierTarget} seats`).toBe(true);
      }
    }
    for (const goodId of Object.keys(COLLECTOR_TARGET_BY_GOOD_ID)) {
      expect(
        content.goods.some((g) => g.id === goodId),
        `collector good ${goodId}`,
      ).toBe(true);
    }
    // The tower allowlist: a stale id here would leave built towers uncounted as coverage centres,
    // so the coverage entry would re-arm and place towers forever.
    for (const towerId of TOWER_CONTENT_IDS) {
      const building = buildingById.get(towerId);
      expect(building, `tower id ${towerId}`).toBeDefined();
      expect(building?.kind, `tower kind of ${towerId}`).toBe('tower');
    }
    for (const [id, goods] of Object.entries(CRAFT_RESTRICTIONS_BY_BUILDING_ID)) {
      const building = buildingById.get(id);
      expect(building, `craft restriction ${id}`).toBeDefined();
      const produced = new Set(building?.recipes.flatMap((r) => r.outputs.map((o) => o.goodType)));
      for (const goodId of goods) {
        const good = content.goods.find((g) => g.id === goodId);
        expect(good, `craft good ${goodId}`).toBeDefined();
        // The restriction must name a product the workplace actually makes - an unmakeable-only
        // list issues no command and the workshop silently keeps crafting everything.
        expect(good !== undefined && produced.has(good.typeId), `${id} produces ${goodId}`).toBe(true);
      }
    }
  });
});
