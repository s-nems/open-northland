import type { TerrainObjects } from '@vinland/data';
import type { ContentIr } from './ir.js';

/**
 * The decoded-map → sim RESOURCE join: which placed landscape objects are harvestable, and the good each
 * yields. A decoded map ships its trees/ore/stone as pure render decor (`map.objects`, drawn by the static
 * map-object layer); this module is the reverse lookup that lets the `?map=` entry ALSO spawn them as real
 * `Resource` sim nodes so a gatherer can actually work them (plan `gathering-economy.md` step 6). Without it
 * a map's trees are drawn but carry no `Resource`, so hovering shows nothing and gatherers idle — only an
 * admin-spawned node (a real sim entity) was ever harvestable.
 *
 * The join is data-driven off the REAL `ir.json`, not hardcoded: each good's gathering pipeline lists the
 * `landscapeGfx` indices of its standing HARVEST-stage forms (every tree variant for wood, every ore
 * outcrop for iron, …); inverting that index list → EditName → goodId names exactly the objects the
 * original treats as harvestable. Decor (grass, ferns, waves) appears in no harvest stage, so it is absent
 * from the map and never spawned. The pipeline's `goodId` STRING is the bridge across the two good-number
 * spaces — the IR's original numbering (`wood` = 5) and the app's clean-room numbering (`GOOD_WOOD` = 1) —
 * so the caller resolves the returned id against `GATHERERS` by `id`.
 */

/** What one harvestable object `EditName` resolves to: the good it yields and its OWN harvest-stage
 *  `[GfxLandscape]` record index (the species variant — "pine 02", not the good's representative). */
export interface HarvestObjectRef {
  readonly goodId: string;
  readonly gfxIndex: number;
}

/**
 * Map each placed landscape-object `EditName` (e.g. `"yew 01"`, `"iron mine 03"`) to the `goodId` string it
 * yields when harvested AND its own `[GfxLandscape]` record index, from the IR gathering pipeline's HARVEST
 * stage. Pure — one pass over the pipeline and the `landscapeGfx` index↔name table. An object in no harvest
 * stage is absent (a decor object stays decor). Degrades to an empty map when either lane is missing (an
 * older `ir.json`). The `gfxIndex` rides the spawn onto `Resource.gfxIndex` — an OPAQUE render-variant tag
 * (app numbering) the snapshot carries into `DrawItem.gfxIndex`, so a pool-drawn node keeps its exact
 * original graphic instead of collapsing to one species per good. It never reaches the sim's footprint
 * resolution: collision stays the good's own record in the SIM's content set (an unrelated number space).
 */
export function harvestGoodByObjectName(ir: ContentIr): ReadonlyMap<string, HarvestObjectRef> {
  const nameByIndex = new Map<number, string>();
  for (const g of ir.landscapeGfx ?? []) {
    if (g.editName !== undefined) nameByIndex.set(g.index, g.editName);
  }
  const out = new Map<string, HarvestObjectRef>();
  for (const p of ir.gatheringPipeline ?? []) {
    for (const idx of p.harvest?.gfxIndices ?? []) {
      const name = nameByIndex.get(idx);
      if (name !== undefined) out.set(name, { goodId: p.goodId, gfxIndex: idx });
    }
  }
  return out;
}

/** One harvestable node a decoded map defines: the `goodId` it yields, its variant `gfxIndex`, at a
 *  HALF-CELL anchor `(hx, hy)` (the `map.objects` lattice is the sim's 2W×2H node grid verbatim — the
 *  same lane `collision.ts` reads). `placement` is the placement ORDINAL (triplet index) in
 *  `objects.placements` — the join key back to the static layer's drawn sprite for the same placement
 *  (the `?map=` entry's static→dynamic handover). */
export interface MapResourceSpawn {
  readonly goodId: string;
  readonly gfxIndex: number;
  readonly hx: number;
  readonly hy: number;
  readonly placement: number;
}

/**
 * The harvestable resource nodes a decoded map's placed objects define — each placement whose EditName maps
 * to a good with a real gatherer trade (`spawnableGoodIds`, the `GATHERERS` ids). Pure and deterministic:
 * one pass over `map.objects.placements` in its native row-major order, so the caller creates entities (and
 * mints ids) in a fixed order. A good that maps but has no gatherer trade yet (e.g. `wheat`, `leather`) is
 * left out so it stays decor rather than spawning an unworkable node.
 */
export function mapResourceSpawns(
  objects: TerrainObjects,
  ir: ContentIr,
  spawnableGoodIds: ReadonlySet<string>,
): MapResourceSpawn[] {
  const goodByName = harvestGoodByObjectName(ir);
  const { types, placements } = objects;
  const out: MapResourceSpawn[] = [];
  for (let i = 0; i + 2 < placements.length; i += 3) {
    const hx = placements[i];
    const hy = placements[i + 1];
    const typeIndex = placements[i + 2];
    if (hx === undefined || hy === undefined || typeIndex === undefined) break;
    const name = types[typeIndex];
    const ref = name !== undefined ? goodByName.get(name) : undefined;
    if (ref !== undefined && spawnableGoodIds.has(ref.goodId)) {
      out.push({ goodId: ref.goodId, gfxIndex: ref.gfxIndex, hx, hy, placement: i / 3 });
    }
  }
  return out;
}

/**
 * The object `EditName`s whose placements BECOME sim `Resource` entities (their good has a gatherer
 * trade) — exactly the set {@link mapResourceSpawns} spawns. The STATIC collision join must skip these
 * (`buildCollisionTerrain skipObjectNames`): their blocking lives in the sim's dynamic
 * resource-footprint overlay, stamped at spawn and UNSTAMPED when the node is felled/depleted. Baked
 * statically instead, a felled tree's cell stayed walled off forever and the collector could never
 * path to the trunk it had just dropped there. Pure.
 */
export function simResourceObjectNames(ir: ContentIr, spawnableGoodIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const [name, ref] of harvestGoodByObjectName(ir)) {
    if (spawnableGoodIds.has(ref.goodId)) out.add(name);
  }
  return out;
}
