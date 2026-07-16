import { hasFieldFarmAtomics } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { NAV_LANDSCAPE_TYPES } from '../../src/catalog/terrain.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * Property invariants over the REAL generated IR + its sim-ready merge — the class of break the
 * synthetic fixture cannot catch (schema-valid output that is economically dead: a zeroed balance
 * nobody overlays, a field good that neither farms nor produces, a good no trade may harvest).
 * Schema shape and raw cross-references are already `parseContentSet`'s job; everything here is a
 * semantic law over whatever content the pipeline emitted, never an exact count or id table, so the
 * suite survives mod/data drift. Skips without generated content (see `helpers.ts`).
 */

// Goods every playable Cultures economy starts on (stable string ids across mod versions); their
// absence means the extraction dropped a core table, not that the mod changed.
const CORE_GOOD_IDS = ['wood', 'stone', 'wheat'] as const;

// Goods with a deliberately numbers-free balance entry — known open calibration work, pinned here so
// the dead-balance invariant names exactly the accepted gaps and any NEW dead good still fails
// (mushroom: docs/tickets/app/herb-mushroom-field-farming.md).
const KNOWN_UNCALIBRATED_GOOD_IDS: readonly string[] = ['mushroom'];

describe.runIf(hasRealIr())('real IR invariants', () => {
  it('carries the core goods by stable string id', async () => {
    const { real } = await loadContentUnderTest();
    const ids = new Set(real.goods.map((g) => g.id));
    for (const id of CORE_GOOD_IDS) expect(ids, `core good '${id}' missing`).toContain(id);
  });

  it('every merged gathered good is calibrated or reported as a gap — never silently dead', async () => {
    const { merge } = await loadContentUnderTest();
    const reported = new Set(merge.unbalancedGoods);
    for (const good of merge.content.goods) {
      if (good.gathering === undefined || reported.has(good.id)) continue;
      if (KNOWN_UNCALIBRATED_GOOD_IDS.includes(good.id)) continue;
      // The pipeline emits zeroed gathering balance (no readable constants); the merge overlays the
      // clean-room pins. Calibration means a per-node yield (felled/plucked goods) or a deposit size
      // (mined goods, e.g. mud) — a good with neither could never bank a single unit.
      expect(
        good.gathering.yieldPerNode > 0 || good.gathering.depositSize > 0,
        `good '${good.id}' merged to a dead gathering balance (no yield, no deposit)`,
      ).toBe(true);
    }
  });

  it('every field-farmed good has a farming block or is reported as a gap — never silently barren', async () => {
    const { merge } = await loadContentUnderTest();
    const reported = new Set(merge.unfarmedFieldGoods);
    for (const good of merge.content.goods) {
      if (!hasFieldFarmAtomics(good)) continue;
      // A field good ships no recipe (grown, not made); without a farming block it neither
      // field-farms nor produces — the class of the field-farmed-recipe regression.
      expect(
        good.farming !== undefined || reported.has(good.id),
        `field good '${good.id}' has no farming block and is not surfaced as a gap`,
      ).toBe(true);
    }
  });

  it('each core good is harvestable by some trade GRANT (allowedAtomics), not only a base atomic', async () => {
    const { merge } = await loadContentUnderTest();
    for (const id of CORE_GOOD_IDS) {
      const good = merge.content.goods.find((g) => g.id === id);
      if (good?.gathering === undefined && !hasFieldFarmAtomics(good ?? { atomics: {} })) continue;
      const harvest = good?.atomics.harvest;
      expect(harvest, `core good '${id}' carries no harvest atomic`).toBeDefined();
      // Flag-gathering classifies by trade grants minus hard exclusions (ContentIndex.harvestJobs);
      // a good only reachable via a tribe-wide baseAtomic would flag non-gatherer trades instead.
      const grantedTo = merge.content.jobs.filter(
        (j) => j.allowedAtomics.includes(harvest ?? -1) && !j.forbiddenAtomics.includes(harvest ?? -1),
      );
      expect(grantedTo.length, `no trade is granted '${id}' harvest atomic ${harvest}`).toBeGreaterThan(0);
    }
  });

  it('every playable tribe spawns settlers with hitpoints after the merge', async () => {
    const { merge } = await loadContentUnderTest();
    // Playable = carries a jobEnables tech-graph; a 0-HP playable tribe makes every settler stillborn.
    for (const tribe of merge.content.tribes) {
      if (tribe.jobEnables.length === 0) continue;
      expect(tribe.hitpoints, `playable tribe '${tribe.id}' merged with no hitpoints`).toBeGreaterThan(0);
    }
  });

  it('the merge injects every sim nav-terrain class into the landscape table', async () => {
    const { merge } = await loadContentUnderTest();
    const landscapeIds = new Set(merge.content.landscape.map((t) => t.typeId));
    for (const nav of NAV_LANDSCAPE_TYPES) {
      expect(landscapeIds, `nav class ${nav.typeId} missing after merge`).toContain(nav.typeId);
    }
  });
});
