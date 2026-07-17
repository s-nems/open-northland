import type { TerrainMapFile } from '@open-northland/data';
import { components, type TerrainMap } from '@open-northland/sim';

/**
 * The pure middle of the authored-entity placement import: resolve a decoded map's `entities` layer
 * (names + half-cells, verbatim from `map.cif` `StaticObjects`) into sim placements over narrow
 * structural views of the served IR. No fetch, no sim construction — headlessly unit-testable
 * (`test/vertical-slice.test.ts`); `runAuthoredSlice` consumes the result.
 */

/**
 * The narrow `ir.json` row views the authored-entity joins read — structural picks over the raw
 * fetched IR (the full zod `parseContentSet` over the multi-MB file is a load-time cost the entry
 * doesn't need; these are the same by-name join keys the engine itself uses).
 */
export interface AuthoredJoinRows {
  readonly buildingBobs?: readonly {
    editName?: string;
    level?: number;
    typeId?: number;
    tribeId?: number;
  }[];
  readonly buildings?: readonly { typeId?: number; id?: string; kind?: string }[];
  readonly jobs?: readonly { typeId?: number; id?: string; name?: string }[];
  readonly tribes?: readonly { typeId?: number; id?: string }[];
  readonly goods?: readonly { typeId?: number; name?: string; id?: string }[];
}

/**
 * Canonicalize a `sethuman` role name for the job join: lowercase, punctuation/space runs to `_`,
 * edge underscores trimmed. Decoded maps author the same jobtype in freehand variants —
 * `Child_Male`, `SOLDIER_UNARMED`, `hero_sword_BJARNI`, `coin maker`, `herb & mush guy`,
 * `hero_axe_???` — that all mean the `jobtypes.ini` slug (`child_male`, `coin_maker`, `hero_axe`, …);
 * an exact-string join drops them (observed across the decoded `content/maps/*.json`).
 */
function normalizeRoleKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** One resolved authored placement, ready to enqueue (what {@link resolveAuthoredPlacements} returns). */
export type AuthoredPlacement =
  | {
      kind: 'building';
      typeId: number;
      tribe: number;
      x: number;
      y: number;
      owner?: number;
      /** Authored starting stock (`addgoods`), good names resolved to good typeIds. */
      goods?: { good: number; amount: number }[];
    }
  | {
      kind: 'human';
      jobType: number;
      tribe: number;
      x: number;
      y: number;
      owner?: number;
      /** The gatherer's authored resource pick (`setproducedgood`), resolved to a good typeId. */
      gatherGood?: number;
    };

/**
 * Resolve a map's authored `entities` (names + half-cells, verbatim from `map.cif` `StaticObjects`) into
 * sim placements. Joins are by name against the IR rows (a building's `EditName`+`level` → `buildingBobs`
 * typeId+tribe and its `addgoods` names → `goods` typeIds; a human's `role` → `jobs` typeId, its `tribe`
 * string → `tribes` typeId, its gatherer `producedGood` name → a `goods` typeId), and the two player
 * columns land on 0-based sim owners verbatim (both `sethouse` and `sethuman` are 0-based — schema notes).
 * Half-cells pass through verbatim — the sim's grid is the `2W×2H` lattice the records address, so an
 * authored building keeps its exact anchor. Unresolvable or out-of-bounds records are dropped and counted;
 * `setanimal` records are not placed yet (herd-vs-individual semantics, source basis).
 */
export function resolveAuthoredPlacements(
  entities: NonNullable<TerrainMapFile['entities']>,
  rows: AuthoredJoinRows,
  map: TerrainMap,
): { placements: AuthoredPlacement[]; skipped: number; droppedGoods: number } {
  const bobByNameLevel = new Map<string, { typeId: number; tribeId: number }>();
  for (const b of rows.buildingBobs ?? []) {
    if (b.editName === undefined || b.typeId === undefined) continue;
    // NUL-separated key: a plain space would let `"foo 1" L0` collide with `"foo" L10`.
    const key = `${b.editName}\u0000${b.level ?? 0}`;
    if (!bobByNameLevel.has(key)) bobByNameLevel.set(key, { typeId: b.typeId, tribeId: b.tribeId ?? 0 });
  }
  const jobByName = new Map<string, number>();
  for (const j of rows.jobs ?? []) {
    const name = j.name ?? j.id;
    if (name !== undefined && j.typeId !== undefined) {
      const key = normalizeRoleKey(name);
      if (!jobByName.has(key)) jobByName.set(key, j.typeId);
    }
  }
  const tribeByName = new Map<string, number>();
  for (const t of rows.tribes ?? []) {
    if (t.id !== undefined && t.typeId !== undefined && !tribeByName.has(t.id))
      tribeByName.set(t.id, t.typeId);
  }
  const goodByName = new Map<string, number>();
  const goodTypeIds = new Set<number>();
  for (const g of rows.goods ?? []) {
    const name = g.name ?? g.id;
    if (name !== undefined && g.typeId !== undefined && !goodByName.has(name)) goodByName.set(name, g.typeId);
    if (g.typeId !== undefined) goodTypeIds.add(g.typeId);
  }
  // A good is authored as a quoted name, or rarely as a bare goodtype typeId (`addgoods 49 1000`,
  // Walhalla) — an all-digits "name" resolves by id when the IR carries that good.
  const resolveGood = (name: string): number | undefined => {
    const byName = goodByName.get(name);
    if (byName !== undefined) return byName;
    const asId = /^\d+$/.test(name) ? Number.parseInt(name, 10) : Number.NaN;
    return goodTypeIds.has(asId) ? asId : undefined;
  };
  // `map` is the sim's half-cell grid (2W×2H) — authored half-cells bound-check directly against it.
  const inBounds = (hx: number, hy: number): boolean =>
    hx >= 0 && hy >= 0 && hx < map.width && hy < map.height;

  const placements: AuthoredPlacement[] = [];
  let skipped = 0;
  let droppedGoods = 0;
  for (const b of entities.buildings) {
    const hit = bobByNameLevel.get(`${b.name}\u0000${b.level}`);
    if (hit === undefined || !inBounds(b.hx, b.hy)) {
      skipped++;
      continue;
    }
    // Authored `addgoods` stock, good names → good typeIds; an unresolvable name is dropped and
    // counted (the building still places — a missing good must not cost the map its house).
    const goods = (b.goods ?? []).flatMap((g) => {
      const good = resolveGood(g.name);
      if (good === undefined) {
        droppedGoods++;
        return [];
      }
      return [{ good, amount: g.count }];
    });
    placements.push({
      kind: 'building',
      typeId: hit.typeId,
      tribe: hit.tribeId,
      x: b.hx,
      y: b.hy,
      ...(components.isValidPlayer(b.player) ? { owner: b.player } : {}),
      ...(goods.length > 0 ? { goods } : {}),
    });
  }
  for (const h of entities.humans) {
    const jobType = jobByName.get(normalizeRoleKey(h.role));
    const tribe = tribeByName.get(h.tribe);
    if (jobType === undefined || tribe === undefined || !inBounds(h.hx, h.hy)) {
      skipped++;
      continue;
    }
    // The gatherer's authored resource pick. An unresolvable name is dropped and counted — the settler
    // still spawns, on the gather-everything default, exactly as a map with no pick at all.
    const gatherGood = h.producedGood !== undefined ? resolveGood(h.producedGood) : undefined;
    if (h.producedGood !== undefined && gatherGood === undefined) droppedGoods++;
    placements.push({
      kind: 'human',
      jobType,
      tribe,
      x: h.hx,
      y: h.hy,
      ...(components.isValidPlayer(h.player) ? { owner: h.player } : {}),
      ...(gatherGood !== undefined ? { gatherGood } : {}),
    });
  }
  return { placements, skipped, droppedGoods };
}
