import { BUILDING_KIND, type TerrainMapFile } from '@open-northland/data';
import { components, type TerrainMap } from '@open-northland/sim';

/**
 * The narrow `ir.json` row views the authored-entity joins read: structural picks over the raw fetched
 * IR, so an entry can join by name without the full zod `parseContentSet` over the multi-MB file.
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
  readonly tribes?: readonly { typeId?: number; id?: string; name?: string }[];
  readonly goods?: readonly { typeId?: number; name?: string; id?: string }[];
  /** The `animaltypes` rows. A species places only when its tribe has a living record
   *  (`hitpointsAdult` > 0); without one the sim would drop the spawn and leave the count dishonest. */
  readonly animals?: readonly { tribeType?: number; hitpointsAdult?: number }[];
}

/**
 * Canonicalize an authored role or species name to its `.ini` slug: lowercase, punctuation and space
 * runs to `_`, edge underscores trimmed. Maps author freehand variants (`coin maker`, `herb & mush
 * guy`, `SOLDIER_UNARMED`) that an exact-string join drops (observed across `content/maps/*.json`).
 */
function normalizeRoleKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function anchorKey(hx: number, hy: number): string {
  return `${hx},${hy}`;
}

/** One resolved authored placement, ready to enqueue. */
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
      /** The authored produced good (`setproducedgood`), resolved to a good typeId. Only a
       *  flag-harvestable pick reaches a gatherer's flag; the sim drops the rest. */
      gatherGood?: number;
      /** The authored home (`attachtohouse` naming a `home`-kind building), as its anchor half-cell. */
      home?: { x: number; y: number };
      /** The authored workplace (`attachtohouse` naming any other building), as its anchor half-cell. */
      workplace?: { x: number; y: number };
    }
  | {
      /** One `setanimal` record spawns one unowned creature at its authored half-cell, never a whole
       *  `maximumgroupsize` herd, which would multiply the map's population. */
      kind: 'animal';
      tribe: number;
      x: number;
      y: number;
    };

/**
 * Resolve a map's authored `entities` (names and half-cells, verbatim from `map.cif` `StaticObjects`)
 * into sim placements, joining by name against the IR rows. `sethouse` and `sethuman` player columns are
 * already 0-based, so they land on sim owners verbatim, and half-cells pass through verbatim because the
 * sim grid is the same `2W×2H` lattice the records address. Unresolvable, decorative, or out-of-bounds
 * records are dropped and counted, animals on their own counter.
 *
 * An `attachtohouse` is routed by the kind of the building standing on its anchor, not by its `slot`
 * column. An approximation: reading `slot` itself as the role (1 home, 2 workplace) fits 172 of the 180
 * resolvable rows, and the two readings differ only on six slot-2 homes in one mod map and the two
 * outlier slots. Routing by kind is the safer of the two because no building type both houses and
 * employs. The first entry of each role wins; no corpus human authors two homes or two workplaces.
 */
export function resolveAuthoredPlacements(
  entities: NonNullable<TerrainMapFile['entities']>,
  rows: AuthoredJoinRows,
  map: TerrainMap,
): {
  placements: AuthoredPlacement[];
  skipped: number;
  droppedGoods: number;
  droppedPicks: number;
  droppedAttachments: number;
  skippedAnimals: number;
} {
  const bobByNameLevel = new Map<string, { typeId: number; tribeId: number }>();
  for (const b of rows.buildingBobs ?? []) {
    if (b.editName === undefined || b.typeId === undefined) continue;
    // NUL-separated key: a plain space would let `"foo 1" L0` collide with `"foo" L10`.
    const key = `${b.editName}\u0000${b.level ?? 0}`;
    if (!bobByNameLevel.has(key)) bobByNameLevel.set(key, { typeId: b.typeId, tribeId: b.tribeId ?? 0 });
  }
  const kindByType = new Map<number, string>();
  for (const b of rows.buildings ?? []) {
    if (b.typeId !== undefined && b.kind !== undefined) kindByType.set(b.typeId, b.kind);
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
  // `setanimal` authors either slug or display name, so both key the species join.
  const animalTribes = new Set<number>();
  for (const a of rows.animals ?? []) {
    if (a.tribeType !== undefined && (a.hitpointsAdult ?? 0) > 0) animalTribes.add(a.tribeType);
  }
  const speciesByKey = new Map<string, number>();
  for (const t of rows.tribes ?? []) {
    if (t.typeId === undefined || !animalTribes.has(t.typeId)) continue;
    for (const name of [t.id, t.name]) {
      if (name === undefined) continue;
      const key = normalizeRoleKey(name);
      if (!speciesByKey.has(key)) speciesByKey.set(key, t.typeId);
    }
  }
  const goodByName = new Map<string, number>();
  const goodTypeIds = new Set<number>();
  for (const g of rows.goods ?? []) {
    const name = g.name ?? g.id;
    if (name !== undefined && g.typeId !== undefined && !goodByName.has(name)) goodByName.set(name, g.typeId);
    if (g.typeId !== undefined) goodTypeIds.add(g.typeId);
  }
  // A good is authored as a quoted name, or rarely as a bare goodtype typeId (`addgoods 49 1000`).
  const resolveGood = (name: string): number | undefined => {
    const byName = goodByName.get(name);
    if (byName !== undefined) return byName;
    const asId = /^\d+$/.test(name) ? Number.parseInt(name, 10) : Number.NaN;
    return goodTypeIds.has(asId) ? asId : undefined;
  };
  // `map` is the sim's half-cell grid, so authored half-cells bound-check against it directly.
  const inBounds = (hx: number, hy: number): boolean =>
    hx >= 0 && hy >= 0 && hx < map.width && hy < map.height;

  const placements: AuthoredPlacement[] = [];
  let skipped = 0;
  let droppedGoods = 0;
  let droppedPicks = 0;
  let droppedAttachments = 0;
  // The kind of the building placed on each anchor, the key an `attachtohouse` resolves through. Only
  // placed buildings enter it, so an attachment naming a skipped house is dropped with it.
  const kindByAnchor = new Map<string, string>();
  for (const b of entities.buildings) {
    const hit = bobByNameLevel.get(`${b.name}\u0000${b.level}`);
    if (hit === undefined || !inBounds(b.hx, b.hy)) {
      skipped++;
      continue;
    }
    // A missing good must not cost the map its house, so an unresolvable name is only counted.
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
    // First placement wins, to agree with the sim's lowest-id anchor lookup as long as the sim accepts
    // that placement; no decoded map shares an anchor between two kinds.
    const kind = kindByType.get(hit.typeId);
    const key = anchorKey(b.hx, b.hy);
    if (kind !== undefined && !kindByAnchor.has(key)) kindByAnchor.set(key, kind);
  }
  for (const h of entities.humans) {
    const jobType = jobByName.get(normalizeRoleKey(h.role));
    const tribe = tribeByName.get(h.tribe);
    if (jobType === undefined || tribe === undefined || !inBounds(h.hx, h.hy)) {
      skipped++;
      continue;
    }
    // An unresolvable pick only counts: the settler still spawns on the gather-everything default.
    const gatherGood = h.producedGood !== undefined ? resolveGood(h.producedGood) : undefined;
    if (h.producedGood !== undefined && gatherGood === undefined) droppedPicks++;
    let home: { x: number; y: number } | undefined;
    let workplace: { x: number; y: number } | undefined;
    for (const a of h.attach ?? []) {
      const kind = kindByAnchor.get(anchorKey(a.hx, a.hy));
      if (kind === undefined) {
        droppedAttachments++;
        continue;
      }
      if (kind === BUILDING_KIND.home) home ??= { x: a.hx, y: a.hy };
      else workplace ??= { x: a.hx, y: a.hy };
    }
    placements.push({
      kind: 'human',
      jobType,
      tribe,
      x: h.hx,
      y: h.hy,
      ...(components.isValidPlayer(h.player) ? { owner: h.player } : {}),
      ...(gatherGood !== undefined ? { gatherGood } : {}),
      ...(home !== undefined ? { home } : {}),
      ...(workplace !== undefined ? { workplace } : {}),
    });
  }
  let skippedAnimals = 0;
  // Approximation: `setanimal` also authors an adult/baby age column that the maps decoder drops, so
  // every authored animal spawns adult with `hitpoints_adult`.
  for (const a of entities.animals) {
    const tribe = speciesByKey.get(normalizeRoleKey(a.species));
    if (tribe === undefined || !inBounds(a.hx, a.hy)) {
      skippedAnimals++;
      continue;
    }
    placements.push({ kind: 'animal', tribe, x: a.hx, y: a.hy });
  }
  return { placements, skipped, droppedGoods, droppedPicks, droppedAttachments, skippedAnimals };
}
