import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasFieldFarmAtomics } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { NAV_LANDSCAPE_TYPES } from '../../src/catalog/terrain.js';
import {
  flagPointByType,
  soldierFlagPointByType,
  VIKING_TRIBE,
} from '../../src/content/building-gfx/index.js';
import { resolveBuildingSignRefs } from '../../src/content/building-signs.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG } from '../../src/content/settler-gfx/index.js';
import { BUILDING_WATCHTOWER, WEAPON_GOOD_SLUG_BY_JOB } from '../../src/game/sandbox/ids/index.js';
import { HIDDEN_GOODS, SUMMARY_CATEGORIES } from '../../src/hud/summary/model.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * Property invariants over the REAL generated IR + its sim-ready merge - the class of break the
 * synthetic fixture cannot catch (schema-valid output that is economically dead: a zeroed balance
 * nobody overlays, a field good that neither farms nor produces, a good no trade may harvest).
 * Schema shape and raw cross-references are already `parseContentSet`'s job; everything here is a
 * semantic law over whatever content the pipeline emitted, never an exact count or id table, so the
 * suite survives mod/data drift. Skips without generated content (see `helpers.ts`).
 */

// Goods every playable Cultures economy starts on (stable string ids across mod versions); their
// absence means the extraction dropped a core table, not that the mod changed.
const CORE_GOOD_IDS = ['wood', 'stone', 'wheat'] as const;
/** The `EditName` stem of the original's bridge records (`bridge wood 01`, `bridge stone`). */
const BRIDGE_NAME_PREFIX = 'bridge ';

// Mushroom gathering remains uncalibrated; any additional zero-balance good must fail.
const KNOWN_UNCALIBRATED_GOOD_IDS: readonly string[] = ['mushroom'];

// The goods harvested as a finite deposit the collector chips one unit at a time (`GatherMode 'mine'`).
const MINED_GOOD_IDS: ReadonlySet<string> = new Set(['stone', 'mud', 'iron', 'gold']);

describe.runIf(hasRealIr())('real IR invariants', () => {
  it('carries the core goods by stable string id', async () => {
    const { real } = await loadContentUnderTest();
    const ids = new Set(real.goods.map((g) => g.id));
    for (const id of CORE_GOOD_IDS) expect(ids, `core good '${id}' missing`).toContain(id);
  });

  it('every weapon-good slug the spawn/render tables key on exists in the real goods', async () => {
    // `weaponEquipmentFor` makes an unresolvable slug a silent unarmed spawn and the render's
    // equipped-weapon body join skips unknown slugs, so a pipeline slug rename (say, fixing the
    // `sword_shord` typo) would quietly bring back the empty-Broń-socket bug - this fails it loudly.
    const { real } = await loadContentUnderTest();
    const ids = new Set(real.goods.map((g) => g.id));
    const slugs = new Set([
      ...Object.values(WEAPON_GOOD_SLUG_BY_JOB),
      ...Object.keys(WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG),
    ]);
    for (const slug of slugs) expect(ids, `weapon good slug '${slug}' missing`).toContain(slug);
  });

  it('every good the summary bar lists, hides or shows as an icon exists in the real goods', async () => {
    // A misspelled id would sit on the bar as a permanent muted zero while the real good drifts into
    // Inne through the unlisted rule, with every synthetic test still green.
    const { real } = await loadContentUnderTest();
    const ids = new Set(real.goods.map((g) => g.id));
    const listed = new Set([
      ...SUMMARY_CATEGORIES.flatMap((category) => [category.icon, ...category.columns.flat()]),
      ...HIDDEN_GOODS,
    ]);
    for (const id of listed) expect(ids, `summary good '${id}' missing`).toContain(id);
  });

  it('every vehicle yard pairs with one vehicle good, which some workshop lists as a product', async () => {
    // Vehicles are yard-built: each `vehicle`-kind house spawns a type the vehicle table carries and is
    // opened by exactly one good, and a joinery lists that good among its products (`logicproduction`)
    // so the yard drive has a turn to take. The production gate keys on the pairing, so a pairing gap
    // would craft handcarts as loaves of bread - this pins the regenerated IR.
    const { real } = await loadContentUnderTest();
    const vehicleTypes = new Set(real.vehicles.map((v) => v.typeId));
    const yards = real.buildings.filter((b) => b.kind === 'vehicle');
    expect(yards.length).toBeGreaterThan(0); // the real data ships cart, ship and catapult yards
    const goodsByYard = new Map(
      yards.map((b) => [b.typeId, real.goods.filter((g) => g.vehicleHouse === b.typeId)]),
    );
    const produced = new Set(real.buildings.flatMap((b) => b.produces));
    for (const yard of yards) {
      expect(
        yard.vehicleType !== undefined && vehicleTypes.has(yard.vehicleType),
        `${yard.id} spawns no vehicle`,
      ).toBe(true);
      const goods = goodsByYard.get(yard.typeId) ?? [];
      expect(
        goods.map((g) => g.id),
        `${yard.id} pairs with one good`,
      ).toHaveLength(1);
      for (const g of goods) expect(produced.has(g.typeId), `${g.id} is nobody's product`).toBe(true);
      expect(yard.construction.length, `${yard.id} has no bill`).toBeGreaterThan(0);
    }
  });

  it('the vehicle table has unique slugs and every type its animation job', async () => {
    const { real } = await loadContentUnderTest();
    const ids = real.vehicles.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    const jobs = new Set(real.jobs.map((j) => j.typeId));
    for (const v of real.vehicles) expect(jobs.has(v.jobId), `${v.id} has no job ${v.jobId}`).toBe(true);
  });

  it('every vehicle graphics frame lands inside its body atlas, and the ships take the player palettes', () => {
    // The join resolves `[bobseq]`-relative cart records and raw ship records onto one bob-id space;
    // an off-by-one against the sequence starts would draw a frame of the wrong facing or nothing.
    const ir = rawIrUnderTest() as ContentIr;
    const rows = ir.vehicleGraphics ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const overruns = new Set<string>();
    for (const row of rows) {
      const stem = row.body.slice(row.body.lastIndexOf('/') + 1).replace(/\.bmd$/i, '');
      const atlasPath = resolve(contentDir(), 'bobs', `${stem}.${row.bodyPalette}.atlas.json`);
      const atlas = JSON.parse(readFileSync(atlasPath, 'utf8')) as { frames: readonly { bobId: number }[] };
      const bobIds = new Set(atlas.frames.map((f) => f.bobId));
      const frames = [
        ...row.clips.flatMap((c) => c.dirFrames.flat()),
        ...row.gaits.flatMap((g) => [...g.dirFrames.flat(), ...(g.turnFrames ?? []).flat()]),
      ];
      if (frames.some((bobId) => !bobIds.has(bobId))) overruns.add(stem);
      const isShip = row.playerPalettes !== undefined;
      expect(isShip, `tribe ${row.tribe} vehicle ${row.vehicleType} palette family`).toBe(
        row.bodyPalette.startsWith('human_ship'),
      );
    }
    // The viking big ship binds the 32-frame `ve_test_ship.bmd` while its job rows index the 98-frame
    // `ls_vehicles.bmd` layout, so its loaded hull (bob 66..94) has no frame there. That is the mod's
    // data; any other overrun is a join fault.
    expect([...overruns]).toEqual(['ve_test_ship']);
  });

  it('every merged felled or mined good is calibrated or reported as a gap - never silently dead', async () => {
    const { merge } = await loadContentUnderTest();
    const reported = new Set(merge.unbalancedGoods);
    // A field crop, a carcass yield and a hive's honey (no harvest stage) are supplied by their own
    // loops, so the felling/mining balance never applies to them.
    const huntYields = new Set(merge.content.huntPrey.flatMap((p) => p.yields.map((y) => y.goodType)));
    for (const good of merge.content.goods) {
      if (good.gathering === undefined || reported.has(good.id)) continue;
      if (good.gathering.harvest === undefined || good.farming !== undefined || huntYields.has(good.typeId)) {
        continue;
      }
      if (KNOWN_UNCALIBRATED_GOOD_IDS.includes(good.id)) {
        // The allow-list must not outlive its gap: once the good gains a live balance, this fails
        // so the entry is removed in the same change that calibrates it.
        expect(
          good.gathering.yieldPerNode === 0 && good.gathering.depositSize === 0,
          `'${good.id}' is calibrated now - drop it from KNOWN_UNCALIBRATED_GOOD_IDS`,
        ).toBe(true);
        continue;
      }
      // The pipeline emits zeroed gathering balance (no readable constants); the merge overlays the
      // clean-room pins. Calibration means a per-node yield (felled/plucked goods) or a deposit size
      // (mined goods, e.g. mud) - a good with neither could never bank a single unit.
      expect(
        good.gathering.yieldPerNode > 0 || good.gathering.depositSize > 0,
        `good '${good.id}' merged to a dead gathering balance (no yield, no deposit)`,
      ).toBe(true);
    }
  });

  it('every field-farmed good has a farming block or is reported as a gap - never silently barren', async () => {
    const { merge } = await loadContentUnderTest();
    const reported = new Set(merge.unfarmedFieldGoods);
    for (const good of merge.content.goods) {
      if (!hasFieldFarmAtomics(good)) continue;
      // A field good ships no recipe (grown, not made); without a farming block it neither
      // field-farms nor produces - the class of the field-farmed-recipe regression.
      expect(
        good.farming !== undefined || reported.has(good.id),
        `field good '${good.id}' has no farming block and is not surfaced as a gap`,
      ).toBe(true);
    }
  });

  it('each core good is harvestable by some trade GRANT (allowedAtomics), not only by inheritance', async () => {
    const { merge } = await loadContentUnderTest();
    for (const id of CORE_GOOD_IDS) {
      const good = merge.content.goods.find((g) => g.id === id);
      // The raw-IR presence test checks `real`; this one must not silently pass if the MERGE dropped it.
      expect(good, `core good '${id}' missing from the merged content`).toBeDefined();
      if (good === undefined || (good.gathering === undefined && !hasFieldFarmAtomics(good))) continue;
      const harvest = good.atomics.harvest;
      expect(harvest, `core good '${id}' carries no harvest atomic`).toBeDefined();
      if (harvest === undefined) continue;
      // Some trade must grant the harvest atomic outright: an inherited-only harvest would hand it to
      // every job down that base chain, making the gathering trade unidentifiable (ContentIndex.harvestJobs).
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

  it('still ships the bridge decks as still records', () => {
    // The still-landscape pass draws `GfxStatic` records under every entity, which is what keeps a
    // deck from burying the settlers crossing it; a pipeline regression in that lane would pass every
    // synthetic fixture.
    const ir = rawIrUnderTest() as {
      landscapeGfx?: readonly {
        editName?: string;
        isStatic?: boolean;
        walkBlockAreas?: readonly (readonly number[])[];
      }[];
    };
    const rows = ir.landscapeGfx ?? [];
    const bridges = rows.filter((g) => g.editName?.startsWith(BRIDGE_NAME_PREFIX) === true);
    expect(bridges.length, `no landscapeGfx row named '${BRIDGE_NAME_PREFIX}*'`).toBeGreaterThan(0);
    for (const bridge of bridges) {
      expect(bridge.isStatic, `${bridge.editName} left the still-landscape pass`).toBe(true);
      expect(bridge.walkBlockAreas?.length ?? 0, `${bridge.editName} lost its deck`).toBeGreaterThan(0);
    }
  });

  it('the upgradeTarget lane carries the known level chains and never chains a wonder', async () => {
    // The whole upgrade mechanic hangs on this optional lane (`upgradeTierOf`, the HUD Upgrade button);
    // a pipeline regression dropping it would fail no schema check and silently delete the feature.
    // One pinned link per leveled kind (stable string ids), plus the wonders staying unchained (each
    // record maps every size level to its own typeId - a self-link the extractor skips).
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
    // swaps `buildingType` in place - a value write the memo keys don't see). A chain link resolved from
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

  it('every mined harvest record authors one fill state per unit of its max valency', async () => {
    // The deposit ladder rests on this: a map placement's deposit is sized by `LogicMaximumValency`
    // (`map-spawn.ts` `withRecordDeposit`) while the static object layer indexes the record's own frame
    // lists, so a record where the two disagree puts the sprite pool and the static layer on different
    // frames for the same placement - a deposit that jumps state the moment a settler first works it.
    const ir = rawIrUnderTest() as {
      landscapeGfx?: readonly {
        index: number;
        editName?: string;
        maxValency?: number;
        frames?: readonly unknown[];
      }[];
      gatheringPipeline?: readonly { goodId: string; harvest?: { gfxIndices?: readonly number[] } }[];
    };
    const byIndex = new Map((ir.landscapeGfx ?? []).map((g) => [g.index, g]));
    let checked = 0;
    for (const p of ir.gatheringPipeline ?? []) {
      if (!MINED_GOOD_IDS.has(p.goodId)) continue;
      for (const idx of p.harvest?.gfxIndices ?? []) {
        const record = byIndex.get(idx);
        if (record === undefined) continue;
        checked++;
        expect(
          record.maxValency,
          `'${record.editName}' (${p.goodId}) authors ${record.frames?.length} states for valency ${record.maxValency}`,
        ).toBe(record.frames?.length);
      }
    }
    expect(checked, 'no mined harvest records found - the pipeline lane went missing').toBeGreaterThan(0);
  });

  it('every player slot resolves its ls_temp building-sign records', () => {
    // The sign join keys on exact `playerNN sign ...` edit names; a pipeline rename would silently
    // degrade every boot to the placeholder squares (the synthetic fixture shares the join's own name
    // assumption, so only real data can catch the drift).
    const refs = resolveBuildingSignRefs(rawIrUnderTest() as ContentIr);
    refs.forEach((slot, i) => {
      expect(slot, `player slot ${i} unresolved`).toBeDefined();
    });
  });

  it('resolves a viking GfxFlagPoint sign-post anchor for most viking-skinned building types', () => {
    // The sign chain anchors on the extracted `GfxFlagPoint`; if the lane goes missing the badge
    // projection silently falls back to the derived door-side node for EVERY building (visibly wrong
    // on the tower). The viking tower's own values are byte-verified against the mod source.
    const ir = rawIrUnderTest() as ContentIr;
    const points = flagPointByType(ir, VIKING_TRIBE);
    expect(points.get(BUILDING_WATCHTOWER)).toEqual({ x: -6, y: 29 });
    const vikingBobTypes = new Set(
      (ir.buildingBobs ?? []).filter((b) => b.tribeId === VIKING_TRIBE).map((b) => b.typeId),
    );
    const anchored = [...vikingBobTypes].filter((t) => points.has(t));
    // Not every record carries the key (the source misses a handful), but a near-empty join means the
    // lane or the tribe filter broke.
    expect(anchored.length).toBeGreaterThan(vikingBobTypes.size / 2);
  });

  it('resolves the viking garrison mast, and only for the towers that declare one', () => {
    // `gfxsoldierflagpoint` is the source's own answer to where a manned post flies its flag; without
    // the lane the projection falls back to the sign post and the flag lands on the tower's doorstep.
    const masts = soldierFlagPointByType(rawIrUnderTest() as ContentIr, VIKING_TRIBE);
    expect(masts.get(BUILDING_WATCHTOWER)).toEqual({ x: -6, y: -239 }); // high above the anchor
    // The key is the tower's alone - the frank tower shares the typeIds with a different height, so a
    // broken tribe filter shows up as a wrong value, and a broken lane as an empty map.
    expect(masts.size).toBeGreaterThan(0);
    expect(masts.size).toBeLessThan(flagPointByType(rawIrUnderTest() as ContentIr, VIKING_TRIBE).size);
  });

  it('specializes only pairings a tribe enables, at most once each', async () => {
    // The pipeline's `correctJobExperience` repairs the records CulturesNation left on a profession
    // that no longer makes their good and then asserts this law; re-checking it on the shipped rows
    // is what proves the stage is still wired into `buildIr`. A specialization the tribe table
    // contradicts trains nobody and silently hands its product to the profession-general track, and
    // a repeated pairing makes `trackFor` pick by table position.
    const { real } = await loadContentUnderTest();
    const goods = new Map(real.goods.map((g) => [g.typeId, g.id]));
    const jobs = new Map(real.jobs.map((j) => [j.typeId, j.id]));
    const producers = new Map<number, Set<number>>();
    for (const tribe of real.tribes) {
      for (const edge of tribe.jobEnables) {
        if (edge.kind !== 'good') continue;
        producers.set(edge.targetId, (producers.get(edge.targetId) ?? new Set()).add(edge.jobType));
      }
    }
    expect(producers.size).toBeGreaterThan(0); // the law is vacuous without the tribe edges
    const seen = new Set<string>();
    for (const track of real.jobExperience) {
      for (const good of track.goodTypes) {
        const pairing = `${jobs.get(track.jobType) ?? track.jobType} / ${goods.get(good) ?? good}`;
        expect(producers.get(good), `${track.id} specializes ${pairing}`).toContain(track.jobType);
        expect(seen, `${track.id} repeats ${pairing}`).not.toContain(pairing);
        seen.add(pairing);
      }
    }
  });
});
