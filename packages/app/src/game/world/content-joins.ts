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
  readonly landscapeGfx?: readonly { index: number; editName?: string }[];
  readonly vehicles?: readonly { typeId?: number; id?: string; name?: string }[];
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

/**
 * A catalog identifier as a join key: case-folded and nothing else, because a tribe or a good is
 * named by its `.ini` id and maps only vary its case (`Byzantine`, `Leather`, `TOOL_WOODEN`). A name
 * the catalog does not carry stays unresolved, including the typographic-quote shapes one map
 * authors (`„gold”`), which the original's own lookup misses too.
 */
function catalogKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The name-to-typeId tables a map's authored placements and its mission script both join through.
 * Role, species and building names go through {@link normalizeRoleKey} because they are freehand
 * editor fields; tribe and good names go through {@link catalogKey}. Each table keeps the first row
 * a key resolves to, because the shipped catalog repeats slugs (two `oxcart` vehicle records) and
 * repeats one edit name across a building's levels; the vehicle table is the exception, keyed in type-id
 * order the way the original resolves a name.
 */
export interface ContentJoins {
  /** A `sethouse` name and level, the only join that is level-specific. */
  buildingBob(name: string, level: number): { typeId: number; tribeId: number } | undefined;
  /** A building's `kind`, which routes an `attachtohouse` to a home or a workplace. */
  buildingKind(typeId: number): string | undefined;
  /** A house type named without a level, the way a mission script writes it. */
  buildingType(name: string): number | undefined;
  job(name: string): number | undefined;
  tribe(name: string): number | undefined;
  /** An animal tribe, keyed by slug and by display name: `setanimal` authors either. */
  species(name: string): number | undefined;
  /** An animal tribe whose record has no living adult (`hitpointsAdult` 0), such as the butterflies:
   *  the sim never admits one, so an authored placement is presentation only. */
  ambientSpecies(name: string): number | undefined;
  vehicleType(name: string): number | undefined;
  landscape(name: string): number | undefined;
  /** A good by name, or by the bare `goodtype` id maps rarely author (`addgoods 49 1000`). */
  good(name: string): number | undefined;
}

export function contentJoins(rows: AuthoredJoinRows): ContentJoins {
  const bobByNameLevel = new Map<string, { typeId: number; tribeId: number }>();
  const buildingByName = new Map<string, number>();
  for (const b of rows.buildingBobs ?? []) {
    if (b.editName === undefined || b.typeId === undefined) continue;
    // NUL-separated key: a plain space would let `"foo 1" L0` collide with `"foo" L10`.
    const key = `${b.editName}\u0000${b.level ?? 0}`;
    if (!bobByNameLevel.has(key)) bobByNameLevel.set(key, { typeId: b.typeId, tribeId: b.tribeId ?? 0 });
    const slug = normalizeRoleKey(b.editName);
    if (!buildingByName.has(slug)) buildingByName.set(slug, b.typeId);
  }
  const kindByType = new Map<number, string>();
  for (const b of rows.buildings ?? []) {
    if (b.typeId === undefined) continue;
    if (b.kind !== undefined) kindByType.set(b.typeId, b.kind);
    const slug = b.id === undefined ? undefined : normalizeRoleKey(b.id);
    if (slug !== undefined && !buildingByName.has(slug)) buildingByName.set(slug, b.typeId);
  }
  const jobByName = byNormalizedName(rows.jobs ?? []);
  // Two records share the `oxcart` name; the original's name lookup walks the type ids in order, so
  // the ox cart (2) wins over the ox-less cart (6), whatever order the table lists them in.
  const vehicleByName = byNormalizedName(
    [...(rows.vehicles ?? [])].sort((a, b) => (a.typeId ?? 0) - (b.typeId ?? 0)),
  );
  const tribeByName = new Map<string, number>();
  for (const t of rows.tribes ?? []) {
    if (t.id === undefined || t.typeId === undefined) continue;
    const key = catalogKey(t.id);
    if (!tribeByName.has(key)) tribeByName.set(key, t.typeId);
  }
  const animalTribes = new Set<number>();
  const ambientTribes = new Set<number>();
  for (const a of rows.animals ?? []) {
    if (a.tribeType === undefined) continue;
    ((a.hitpointsAdult ?? 0) > 0 ? animalTribes : ambientTribes).add(a.tribeType);
  }
  const tribesIn = (ids: ReadonlySet<number>) =>
    (rows.tribes ?? []).filter((t) => t.typeId !== undefined && ids.has(t.typeId));
  const speciesByKey = byNormalizedName(tribesIn(animalTribes));
  const ambientSpeciesByKey = byNormalizedName(tribesIn(ambientTribes));
  const landscapeByName = new Map<string, number>();
  for (const row of rows.landscapeGfx ?? []) {
    if (row.editName === undefined) continue;
    const key = catalogKey(row.editName);
    if (!landscapeByName.has(key)) landscapeByName.set(key, row.index);
  }
  const goodByName = new Map<string, number>();
  const goodTypeIds = new Set<number>();
  for (const g of rows.goods ?? []) {
    const name = g.name ?? g.id;
    if (name !== undefined && g.typeId !== undefined) {
      const key = catalogKey(name);
      if (!goodByName.has(key)) goodByName.set(key, g.typeId);
    }
    if (g.typeId !== undefined) goodTypeIds.add(g.typeId);
  }
  return {
    buildingBob: (name, level) => bobByNameLevel.get(`${name}\u0000${level}`),
    buildingKind: (typeId) => kindByType.get(typeId),
    buildingType: (name) => buildingByName.get(normalizeRoleKey(name)),
    job: (name) => jobByName.get(normalizeRoleKey(name)),
    tribe: (name) => tribeByName.get(catalogKey(name)),
    species: (name) => speciesByKey.get(normalizeRoleKey(name)),
    ambientSpecies: (name) => ambientSpeciesByKey.get(normalizeRoleKey(name)),
    vehicleType: (name) => vehicleByName.get(normalizeRoleKey(name)),
    landscape: (name) => landscapeByName.get(catalogKey(name)),
    good: (name) => {
      const byName = goodByName.get(catalogKey(name));
      if (byName !== undefined) return byName;
      const asId = /^\d+$/.test(name) ? Number.parseInt(name, 10) : Number.NaN;
      return goodTypeIds.has(asId) ? asId : undefined;
    },
  };
}

/** Both the slug and the display name key one record, since maps author either. */
function byNormalizedName(
  records: readonly { typeId?: number; id?: string; name?: string }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const record of records) {
    if (record.typeId === undefined) continue;
    for (const name of [record.id, record.name]) {
      if (name === undefined) continue;
      const key = normalizeRoleKey(name);
      if (!out.has(key)) out.set(key, record.typeId);
    }
  }
  return out;
}
