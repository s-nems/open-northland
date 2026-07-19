import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

const { CARRIER_STAFFED_BUILDING_IDS, DEFAULT_BUILD_ORDER, OPERATORS_PER_TRADE_BY_BUILDING_ID } = systems;

/**
 * Pin the AI opening plan's content bindings against the real extracted content. The sim silently
 * `skip`s a plan entry whose id is unknown, so a typo amputates the AI's plan with no test failure
 * and no symptom beyond "the AI never builds X" — this suite is the tripwire: every id in
 * `DEFAULT_BUILD_ORDER` and the staffing tables must resolve, every direct-place tier must carry a
 * construction bill (a bill-less site would finish instantly), every upgrade target must be reachable
 * over the `upgradeTarget` chain, and the per-building operator override must fit real worker slots
 * (the staffing cap is `min(slot.count, override)`, so a stale override silently degrades).
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
      if (entry.kind === 'place') {
        // A place entry raises a real construction site — an empty bill would finish instantly.
        expect(building.construction.length, `construction bill of ${entry.building}`).toBeGreaterThan(0);
      } else {
        // An upgrade entry names its TARGET tier — some lower tier must chain into it.
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

  it('the staffing tables name real buildings with matching worker slots', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const buildingById = new Map(content.buildings.map((b) => [b.id, b]));
    const carrierJob = content.jobs.find((j) => j.id === 'carrier')?.typeId;
    expect(carrierJob).toBeDefined();

    for (const id of CARRIER_STAFFED_BUILDING_IDS) {
      const building = buildingById.get(id);
      expect(building, `carrier-staffed ${id}`).toBeDefined();
      expect(
        building?.workers.some((w) => w.jobType === carrierJob),
        `carrier slot of ${id}`,
      ).toBe(true);
    }
    for (const [id, cap] of Object.entries(OPERATORS_PER_TRADE_BY_BUILDING_ID)) {
      const building = buildingById.get(id);
      expect(building, `operator override ${id}`).toBeDefined();
      // The staffing cap is min(slot.count, override) — a real slot must offer the override's seats.
      const fits = building?.workers.some((w) => w.jobType !== carrierJob && w.count >= cap);
      expect(fits, `an operator slot of ${id} offering ${cap} seats`).toBe(true);
    }
  });
});
