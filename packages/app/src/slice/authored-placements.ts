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
}

/** One resolved authored placement, ready to enqueue (what {@link resolveAuthoredPlacements} returns). */
export type AuthoredPlacement =
  | { kind: 'building'; typeId: number; tribe: number; x: number; y: number; owner?: number }
  | { kind: 'human'; jobType: number; tribe: number; x: number; y: number; owner?: number };

/**
 * Resolve a map's authored `entities` (names + half-cells, verbatim from `map.cif` `StaticObjects`) into
 * sim placements. Joins are by name against the IR rows (a building's `EditName`+`level` → `buildingBobs`
 * typeId+tribe; a human's `role` → `jobs` typeId, its `tribe` string → `tribes` typeId), and the two player
 * columns land on 0-based sim owners verbatim (both `sethouse` and `sethuman` are 0-based — schema notes).
 * Half-cells pass through verbatim — the sim's grid is the `2W×2H` lattice the records address, so an
 * authored building keeps its exact anchor. Unresolvable or out-of-bounds records are dropped and counted;
 * `setanimal` records are not placed yet (herd-vs-individual semantics, source basis).
 */
export function resolveAuthoredPlacements(
  entities: NonNullable<TerrainMapFile['entities']>,
  rows: AuthoredJoinRows,
  map: TerrainMap,
): { placements: AuthoredPlacement[]; skipped: number } {
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
    if (name !== undefined && j.typeId !== undefined && !jobByName.has(name)) jobByName.set(name, j.typeId);
  }
  const tribeByName = new Map<string, number>();
  for (const t of rows.tribes ?? []) {
    if (t.id !== undefined && t.typeId !== undefined && !tribeByName.has(t.id))
      tribeByName.set(t.id, t.typeId);
  }
  // `map` is the sim's half-cell grid (2W×2H) — authored half-cells bound-check directly against it.
  const inBounds = (hx: number, hy: number): boolean =>
    hx >= 0 && hy >= 0 && hx < map.width && hy < map.height;

  const placements: AuthoredPlacement[] = [];
  let skipped = 0;
  for (const b of entities.buildings) {
    const hit = bobByNameLevel.get(`${b.name}\u0000${b.level}`);
    if (hit === undefined || !inBounds(b.hx, b.hy)) {
      skipped++;
      continue;
    }
    placements.push({
      kind: 'building',
      typeId: hit.typeId,
      tribe: hit.tribeId,
      x: b.hx,
      y: b.hy,
      ...(components.isValidPlayer(b.player) ? { owner: b.player } : {}),
    });
  }
  for (const h of entities.humans) {
    const jobType = jobByName.get(h.role);
    const tribe = tribeByName.get(h.tribe);
    if (jobType === undefined || tribe === undefined || !inBounds(h.hx, h.hy)) {
      skipped++;
      continue;
    }
    placements.push({
      kind: 'human',
      jobType,
      tribe,
      x: h.hx,
      y: h.hy,
      ...(components.isValidPlayer(h.player) ? { owner: h.player } : {}),
    });
  }
  return { placements, skipped };
}
