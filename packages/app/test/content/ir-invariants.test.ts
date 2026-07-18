import { hasFieldFarmAtomics } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { NAV_LANDSCAPE_TYPES } from '../../src/catalog/terrain.js';
import { WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG } from '../../src/content/settler-gfx/index.js';
import { WEAPON_GOOD_SLUG_BY_JOB } from '../../src/game/sandbox/ids/index.js';
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

  it('every weapon-good slug the spawn/render tables key on exists in the real goods', async () => {
    // `weaponEquipmentFor` makes an unresolvable slug a silent unarmed spawn and the render's
    // equipped-weapon body join skips unknown slugs, so a pipeline slug rename (say, fixing the
    // `sword_shord` typo) would quietly bring back the empty-Broń-socket bug — this fails it loudly.
    const { real } = await loadContentUnderTest();
    const ids = new Set(real.goods.map((g) => g.id));
    const slugs = new Set([
      ...Object.values(WEAPON_GOOD_SLUG_BY_JOB),
      ...Object.keys(WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG),
    ]);
    for (const slug of slugs) expect(ids, `weapon good slug '${slug}' missing`).toContain(slug);
  });

  it('no building stocks or produces a vehicle good (stripVehicleGoods holds on real data)', async () => {
    // Vehicles are yard-built, not stockpiled wares (docs/tickets/features/vehicle-yard-construction.md);
    // the strip keys on the goodtype↔vehicletype slug identity, so a slug drift would silently bring
    // handcarts back as loaves of bread — this pins the regenerated IR.
    const { real } = await loadContentUnderTest();
    const vehicleIds = new Set(real.vehicles.map((v) => v.id));
    expect(vehicleIds.size).toBeGreaterThan(0); // the real data ships carts/ships/catapult
    const vehicleGoods = new Set(real.goods.filter((g) => vehicleIds.has(g.id)).map((g) => g.typeId));
    for (const b of real.buildings) {
      for (const s of b.stock)
        expect(vehicleGoods, `${b.id} stocks a vehicle good`).not.toContain(s.goodType);
      for (const p of b.produces) expect(vehicleGoods, `${b.id} produces a vehicle good`).not.toContain(p);
    }
  });

  it('every merged gathered good is calibrated or reported as a gap — never silently dead', async () => {
    const { merge } = await loadContentUnderTest();
    const reported = new Set(merge.unbalancedGoods);
    for (const good of merge.content.goods) {
      if (good.gathering === undefined || reported.has(good.id)) continue;
      if (KNOWN_UNCALIBRATED_GOOD_IDS.includes(good.id)) {
        // The allow-list must not outlive its gap: once the good gains a live balance, this fails
        // so the entry is removed in the same change that calibrates it.
        expect(
          good.gathering.yieldPerNode === 0 && good.gathering.depositSize === 0,
          `'${good.id}' is calibrated now — drop it from KNOWN_UNCALIBRATED_GOOD_IDS`,
        ).toBe(true);
        continue;
      }
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
      // The raw-IR presence test checks `real`; this one must not silently pass if the MERGE dropped it.
      expect(good, `core good '${id}' missing from the merged content`).toBeDefined();
      if (good === undefined || (good.gathering === undefined && !hasFieldFarmAtomics(good))) continue;
      const harvest = good.atomics.harvest;
      expect(harvest, `core good '${id}' carries no harvest atomic`).toBeDefined();
      if (harvest === undefined) continue;
      // Flag-gathering classifies by trade grants minus hard exclusions (ContentIndex.harvestJobs);
      // a good only reachable via a tribe-wide baseAtomic would flag non-gatherer trades instead.
      const grantedTo = merge.content.jobs.filter(
        (j) => j.allowedAtomics.includes(harvest) && !j.forbiddenAtomics.includes(harvest),
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

  it('the upgradeTarget lane carries the known level chains and never chains a wonder', async () => {
    // The whole upgrade mechanic hangs on this optional lane (`upgradeTierOf`, the HUD Upgrade button);
    // a pipeline regression dropping it would fail no schema check and silently delete the feature.
    // One pinned link per leveled kind (stable string ids), plus the wonders staying unchained (each
    // record maps every size level to its own typeId — a self-link the extractor skips).
    const { real } = await loadContentUnderTest();
    const byId = new Map(real.buildings.map((b) => [b.id, b]));
    const links = [
      ['home_level_00', 'home_level_01'],
      ['stock_00', 'stock_01'],
      ['tower_00', 'tower_01'],
    ] as const;
    for (const [from, to] of links) {
      const target = byId.get(to);
      expect(target, `'${to}' missing from the real buildings`).toBeDefined();
      expect(byId.get(from)?.upgradeTarget, `'${from}' → '${to}' chain link missing`).toBe(target?.typeId);
    }
    for (const b of real.buildings) {
      if (b.id.startsWith('wonder')) expect(b.upgradeTarget, `'${b.id}' must not chain`).toBeUndefined();
    }
  });

  it('every upgradeTarget link shares its familyBody and reserved footprint', async () => {
    // The sim's placement-blocker memos key on Building MEMBERSHIP generations only, resting on the
    // invariant that `familyBody`/`reserved` are identical across a type's whole level chain (an upgrade
    // swaps `buildingType` in place — a value write the memo keys don't see). A chain link resolved from
    // records with different family footprints would serve stale placement answers after an upgrade.
    const { real } = await loadContentUnderTest();
    const byTypeId = new Map(real.buildings.map((b) => [b.typeId, b]));
    const cellKey = (cells: readonly { readonly dx: number; readonly dy: number }[] | undefined): string =>
      JSON.stringify(
        (cells ?? [])
          .map((c): readonly [number, number] => [c.dx, c.dy])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      );
    for (const b of real.buildings) {
      if (b.upgradeTarget === undefined) continue;
      const target = byTypeId.get(b.upgradeTarget);
      expect(target, `'${b.id}' upgradeTarget ${b.upgradeTarget} missing from content`).toBeDefined();
      if (target === undefined) continue;
      expect(cellKey(b.footprint?.familyBody), `'${b.id}' → '${target.id}' familyBody differs`).toBe(
        cellKey(target.footprint?.familyBody),
      );
      expect(cellKey(b.footprint?.reserved), `'${b.id}' → '${target.id}' reserved differs`).toBe(
        cellKey(target.footprint?.reserved),
      );
    }
  });
});
