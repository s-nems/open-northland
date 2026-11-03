import { ContentSet, parseContentSet, parseGeneratedContentSet } from '@open-northland/data';

const ROW_KEY_FIELDS = [
  'tribe',
  'tribeId',
  'id',
  'typeId',
  /** The `[GfxHouse]` growth level: the house lanes key on `(tribeId, typeId, level)`, so levels of one
   *  type stay apart and a mod's verbatim clone of a tribe's rows adds instead of collapsing them. */
  'level',
  'atomicId',
  'job',
  'jobType',
  'goodType',
  'vehicleType',
  'action',
  'editName',
  'imagelib',
  'patternId',
  'logicType',
  'paletteName',
  'stackIdx',
  'state',
  'slot',
] as const;
type JsonRecord = Record<string, unknown>;
const CONTENT_LANES: ReadonlySet<string> = new Set(Object.keys(ContentSet.shape));

export class ContentModLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentModLoadError';
  }
}

function record(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowKey(value: unknown): string | null {
  if (!record(value)) return null;
  const identity = ROW_KEY_FIELDS.filter((field) => Object.hasOwn(value, field)).map((field) => [
    field,
    value[field],
  ]);
  return identity.length === 0 ? null : JSON.stringify(identity);
}

function mergeRows(base: readonly unknown[], patch: readonly unknown[]): unknown[] {
  const merged = [...base];
  const positions = new Map<string, number>();
  merged.forEach((value, index) => {
    const key = rowKey(value);
    if (key !== null) positions.set(key, index);
  });
  for (const value of patch) {
    const key = rowKey(value);
    const index = key === null ? undefined : positions.get(key);
    if (index === undefined) {
      if (key !== null) positions.set(key, merged.length);
      merged.push(value);
    } else {
      merged[index] = mergeContentModData(merged[index], value);
    }
  }
  return merged;
}

export function mergeContentModData(base: unknown, patch: unknown): unknown {
  if (!record(base) || !record(patch)) return patch;
  const merged = new Map(Object.entries(base));
  for (const [key, value] of Object.entries(patch)) {
    const previous = merged.get(key);
    if (CONTENT_LANES.has(key) && Array.isArray(previous) && Array.isArray(value)) {
      merged.set(key, mergeRows(previous, value));
    } else if (record(previous) && record(value)) {
      merged.set(key, mergeContentModData(previous, value));
    } else {
      merged.set(key, value);
    }
  }
  return Object.fromEntries(merged);
}

export function validateContentModPatch(raw: unknown): void {
  ContentSet.partial().parse(raw);
}

function isFullContentSet(raw: unknown): boolean {
  return record(raw) && Object.keys(ContentSet.shape).every((lane) => Object.hasOwn(raw, lane));
}

/** The lanes whose rows carry author-facing ids derived from their people's slug (`chinese-male` name
 *  pools, `chinese_fist` weapons): such a row belongs to that people even when its tribe field names
 *  another id - an edited pack whose tribe row moved while its rows kept the authored tribe still
 *  re-keys as one people instead of leaving its rows bound to whoever holds the old id. */
const SLUG_ID_LANES: ReadonlySet<string> = new Set(['personalNames', 'weapons']);

/** The lanes whose rows bind to one tribe through a single top-level field: a people's rows are keyed
 *  by its tribe id, so re-keying a people re-keys exactly these (`docs/MODS.md`, "New civilizations"). */
const TRIBE_FIELD_BY_LANE: Readonly<Record<string, 'tribe' | 'tribeId' | 'tribeType'>> = {
  animals: 'tribeType',
  weapons: 'tribeType',
  personalNames: 'tribe',
  jobGraphics: 'tribe',
  gfxAtomics: 'tribe',
  gfxWalkAtomics: 'tribe',
  gfxInHousePrograms: 'tribe',
  vehicleGraphics: 'tribe',
  buildingBobs: 'tribeId',
  constructionLayers: 'tribeId',
  buildingOverlays: 'tribeId',
  buildingLandscapeOverlays: 'tribeId',
  buildingFlagPoints: 'tribeId',
  buildingSoldierFlagPoints: 'tribeId',
  buildingHolyFirePoints: 'tribeId',
};

/** The `sounds` voice tables whose rows also key on the tribe id. */
const SOUND_TRIBE_TABLES = ['humanVoices', 'attackAlerts', 'animalCalls'] as const;

/** The identity a re-keyed people takes: the renamed slug, the moved tribe id and what moved. */
interface PeopleRekey {
  readonly slug: string;
  readonly newSlug: string;
  readonly typeId: number;
  readonly newTypeId: number;
  readonly slugTaken: boolean;
  readonly typeTaken: boolean;
}

function rowsOf(value: unknown, lane: string): JsonRecord[] {
  if (typeof value !== 'object' || value === null) return [];
  const rows = (value as JsonRecord)[lane];
  return Array.isArray(rows) ? (rows as JsonRecord[]) : [];
}

/** A row of the `sounds` / `humanPalettes` / variant shape whose `tribe` field names the people. */
function isTribeRow(row: unknown, typeId: number): row is JsonRecord {
  return typeof row === 'object' && row !== null && (row as JsonRecord).tribe === typeId;
}

/** The first `${base}-2`, `${base}-3`, ... no tribe id takes, compared case-folded. */
function freePeopleSlug(base: string, taken: ReadonlySet<string>): string {
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`.toLowerCase())) suffix++;
  return `${base}-${suffix}`;
}

/** The first id above every taken one - the rule `tools/mods/build-people-mod.mjs` uses for a new people. */
function freeTribeId(taken: ReadonlySet<number>): number {
  return taken.size === 0 ? 1 : Math.max(...taken) + 1;
}

/** Whether a row id is one a pack derives from its people's slug (`chinese-male` pools,
 *  `chinese_fist` weapons); ids the author named freely are not. */
function isSlugDerivedRowId(id: string, slug: string): boolean {
  return id.startsWith(`${slug}-`) || id.startsWith(`${slug}_`);
}

/** Row ids a pack derives from its people's slug (`chinese-male` pools, `chinese_fist` weapons) follow
 *  the rename; ids the author named freely keep theirs. */
function renamedRowId(id: string, oldSlug: string, newSlug: string): string {
  return isSlugDerivedRowId(id, oldSlug) ? `${newSlug}${id.slice(oldSlug.length)}` : id;
}

/** The `(tribe, sex)` name-pool bindings the merged content holds, keyed `42:male` to the pool id that
 *  holds the binding: the validator admits one pool per binding, so a patch pool that binds a held
 *  pair under another id is a second people arriving on a taken tribe, not an override. */
function boundPoolIds(merged: unknown): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const pool of rowsOf(merged, 'personalNames')) {
    if (typeof pool !== 'object' || pool === null) continue;
    const row = pool as JsonRecord;
    if (typeof row.tribe !== 'number' || typeof row.sex !== 'string') continue;
    bindings.set(`${row.tribe}:${row.sex}`, typeof row.id === 'string' ? row.id : '');
  }
  return bindings;
}

/** Whether the people the tribe row anchors brings a name pool onto a `(tribe, sex)` binding the
 *  merged content already holds under a different pool id. A pool the people owns either binds its
 *  tribe id or carries a slug-derived row id; a pool with a free id binding a taken pair is the
 *  pack's own people regardless, since nothing else could have authored `han-male` on `chinese`'s
 *  tribe. */
function bringsConflictingPool(
  patch: JsonRecord,
  slug: string,
  typeId: number,
  bindings: ReadonlyMap<string, string>,
): boolean {
  const pools = patch.personalNames;
  if (!Array.isArray(pools)) return false;
  return pools.some((pool) => {
    if (typeof pool !== 'object' || pool === null) return false;
    const row = pool as JsonRecord;
    if (typeof row.tribe !== 'number' || typeof row.sex !== 'string') return false;
    const owned = row.tribe === typeId || (typeof row.id === 'string' && isSlugDerivedRowId(row.id, slug));
    if (!owned) return false;
    const holder = bindings.get(`${row.tribe}:${row.sex}`);
    return holder !== undefined && holder !== row.id;
  });
}

/** Re-keys a patch's new people when its identity is taken or its rows would collide with the people
 *  already holding that identity: the pack that merges later keeps both peoples playable by taking
 *  the first free slug and, when its `typeId` is taken too, the first tribe id above every `tribes`,
 *  `animals` and `weapons` row. Every tribe-bound row of the patch follows - by tribe field, or for
 *  the slug-id lanes by a row id derived from the slug, so an edited pack whose tribe row moved while
 *  its rows kept the authored tribe still re-keys as one people. The trigger is data-driven: a pack
 *  whose name pool binds a `(tribe, sex)` pair the merged content holds under another pool id brings
 *  a second people onto a taken tribe, and re-keys whether or not its tribe row carries the
 *  `civilization` flag - pools cannot override through a different id, so that clash is never an
 *  override. A row without the flag that brings no new binding keeps the override semantics and is
 *  never touched, and a row - flagged or not - that names an identity the base itself carries
 *  (`base`) is that same people coming back - a full-IR pack echoes the base - so it overrides in
 *  place rather than re-keys. */
export function rekeyCollidingPeople(merged: unknown, patch: unknown, base: unknown = merged): void {
  if (typeof patch !== 'object' || patch === null) return;
  const tribes = rowsOf(patch, 'tribes');
  if (tribes.length === 0) return;
  const baseIdentities = new Set<string>();
  for (const row of rowsOf(base, 'tribes'))
    if (typeof row.id === 'string' && typeof row.typeId === 'number')
      baseIdentities.add(`${row.id.toLowerCase()}|${row.typeId}`);
  const takenSlugs = new Set<string>();
  const takenTypes = new Set<number>();
  for (const row of rowsOf(merged, 'tribes')) {
    if (typeof row.id === 'string') takenSlugs.add(row.id.toLowerCase());
    if (typeof row.typeId === 'number') takenTypes.add(row.typeId);
  }
  for (const row of rowsOf(merged, 'animals'))
    if (typeof row.tribeType === 'number') takenTypes.add(row.tribeType);
  for (const row of rowsOf(merged, 'weapons'))
    if (typeof row.tribeType === 'number') takenTypes.add(row.tribeType);

  const bindings = boundPoolIds(merged);
  for (const [index, row] of tribes.entries()) {
    const slug = typeof row.id === 'string' ? row.id : undefined;
    const typeId = typeof row.typeId === 'number' ? row.typeId : undefined;
    if (slug === undefined || typeId === undefined) continue;
    // The row occupies its identity flagged or not, so a later row of this very patch cannot take it.
    const slugTaken = takenSlugs.has(slug.toLowerCase());
    const typeTaken = takenTypes.has(typeId);
    takenSlugs.add(slug.toLowerCase());
    takenTypes.add(typeId);
    // A row naming an identity the base itself carries is that people coming back: it overrides in
    // place, and its pools override by their own ids - never a second people to re-key.
    if (baseIdentities.has(`${slug.toLowerCase()}|${typeId}`)) continue;
    const conflict = bringsConflictingPool(patch as JsonRecord, slug, typeId, bindings);
    if (row.civilization !== true) {
      // Without the flag the row keeps the override semantics; only a clash that no override could
      // produce - a name pool binding a held (tribe, sex) pair under another id - re-keys it.
      if (!conflict) continue;
    } else if (!slugTaken && !typeTaken && !conflict) {
      continue;
    }
    const newSlug = slugTaken ? freePeopleSlug(slug, takenSlugs) : slug;
    const newTypeId = typeTaken ? freeTribeId(takenTypes) : typeId;
    if (slugTaken) takenSlugs.add(newSlug.toLowerCase());
    if (typeTaken) takenTypes.add(newTypeId);
    rekeyPeopleRows(patch as JsonRecord, tribes, index, {
      slug,
      newSlug,
      typeId,
      newTypeId,
      slugTaken,
      typeTaken,
    });
    // The re-keyed people's pools hold their new bindings now: a later pack of this very install
    // arriving on the same identity re-keys again instead of colliding with them.
    for (const pool of rowsOf(patch, 'personalNames')) {
      if (typeof pool !== 'object' || pool === null) continue;
      const rekeyed = pool as JsonRecord;
      if (rekeyed.tribe === newTypeId && typeof rekeyed.sex === 'string')
        bindings.set(`${newTypeId}:${rekeyed.sex}`, typeof rekeyed.id === 'string' ? rekeyed.id : '');
    }
  }
}

function rekeyPeopleRows(patch: JsonRecord, tribes: JsonRecord[], index: number, ids: PeopleRekey): void {
  const row = tribes[index];
  if (row === undefined) return;
  tribes[index] = {
    ...row,
    ...(ids.slugTaken ? { id: ids.newSlug } : {}),
    ...(ids.typeTaken ? { typeId: ids.newTypeId } : {}),
    // A variant arms its soldier by `(tribeType, typeId)`; the renumbering moves the half it owns.
    ...(ids.typeTaken && Array.isArray(row.unitVariants)
      ? {
          unitVariants: (row.unitVariants as readonly JsonRecord[]).map((variant) => {
            const weapon = variant.weapon;
            return typeof weapon === 'object' &&
              weapon !== null &&
              (weapon as JsonRecord).tribeType === ids.typeId
              ? { ...variant, weapon: { ...weapon, tribeType: ids.newTypeId } }
              : variant;
          }),
        }
      : {}),
  };
  // Rows bind by the numeric tribe id, and slug-id-lane rows also follow their people through a row
  // id derived from the slug - an edited pack whose rows kept the authored tribe re-keys as one
  // people instead of leaving those rows bound to whoever holds the old id. Mapping is a no-op for
  // rows the people does not own, so a people whose identity moved nowhere still fixes its pools.
  for (const [lane, field] of Object.entries(TRIBE_FIELD_BY_LANE)) {
    const rows = patch[lane];
    if (!Array.isArray(rows)) continue;
    patch[lane] = rows.map((bound) => tribeBoundRow(bound, field, SLUG_ID_LANES.has(lane), ids));
  }
  if (ids.typeTaken) {
    rekeySoundBank(patch, ids);
    rekeyPaletteJobChanges(patch, ids);
    rekeyBuildingVariants(patch, ids);
  }
}

function tribeBoundRow(row: unknown, field: string, slugIds: boolean, ids: PeopleRekey): unknown {
  if (typeof row !== 'object' || row === null) return row;
  const record = row as JsonRecord;
  const ownedByTribe = record[field] === ids.typeId;
  const ownedBySlug = slugIds && typeof record.id === 'string' && isSlugDerivedRowId(record.id, ids.slug);
  if (!ownedByTribe && !ownedBySlug) return row;
  const rekeyed: JsonRecord = { ...record };
  // The people's tribe id after the re-key: unchanged when only the slug moved, so a row already
  // bound to it keeps its value, and one bound to the authored tribe follows the people.
  rekeyed[field] = ids.newTypeId;
  if (ids.slugTaken && typeof record.id === 'string')
    rekeyed.id = renamedRowId(record.id, ids.slug, ids.newSlug);
  return rekeyed;
}

function rekeySoundBank(patch: JsonRecord, ids: PeopleRekey): void {
  const bank = patch.sounds;
  if (typeof bank !== 'object' || bank === null) return;
  let next = bank as JsonRecord;
  for (const table of SOUND_TRIBE_TABLES) {
    const rows = next[table];
    if (!Array.isArray(rows) || !rows.some((row) => isTribeRow(row, ids.typeId))) continue;
    next = {
      ...next,
      [table]: rows.map((row) => (isTribeRow(row, ids.typeId) ? { ...row, tribe: ids.newTypeId } : row)),
    };
  }
  if (next !== bank) patch.sounds = next;
}

function rekeyPaletteJobChanges(patch: JsonRecord, ids: PeopleRekey): void {
  const palettes = patch.humanPalettes;
  if (typeof palettes !== 'object' || palettes === null) return;
  const jobChanges = (palettes as JsonRecord).jobChanges;
  if (!Array.isArray(jobChanges) || !jobChanges.some((row) => isTribeRow(row, ids.typeId))) return;
  patch.humanPalettes = {
    ...palettes,
    jobChanges: jobChanges.map((row) =>
      isTribeRow(row, ids.typeId) ? { ...row, tribe: ids.newTypeId } : row,
    ),
  };
}

function rekeyBuildingVariants(patch: JsonRecord, ids: PeopleRekey): void {
  const buildings = patch.buildings;
  if (!Array.isArray(buildings)) return;
  patch.buildings = buildings.map((building) => {
    if (typeof building !== 'object' || building === null) return building;
    const row = building as JsonRecord;
    const variants = tribeVariantsOf(row, 'tribeVariants', ids);
    const records = tribeVariantsOf(row, 'recordFootprints', ids);
    if (variants === undefined && records === undefined) return building;
    return {
      ...row,
      ...(variants !== undefined ? { tribeVariants: variants } : {}),
      ...(records !== undefined ? { recordFootprints: records } : {}),
    };
  });
}

/** The named variant array with the people's entries moved to the new tribe id, or undefined untouched. */
function tribeVariantsOf(row: JsonRecord, field: string, ids: PeopleRekey): readonly unknown[] | undefined {
  const entries = row[field];
  if (!Array.isArray(entries) || !entries.some((entry) => isTribeRow(entry, ids.typeId))) return undefined;
  return entries.map((entry) => (isTribeRow(entry, ids.typeId) ? { ...entry, tribe: ids.newTypeId } : entry));
}

export function mergeContentModPatches(base: unknown | null, rawPatches: readonly unknown[]) {
  const patches = rawPatches.map((raw) => ContentSet.partial().parse(raw));
  let merged = base;
  // The pack that seeds the set when no base content exists already owns its identity.
  const seededIndex = base === null ? rawPatches.findIndex(isFullContentSet) : -1;
  if (merged === null) {
    const full = rawPatches.find(isFullContentSet);
    if (full === undefined) throw new Error('A partial content pack requires base content/ir.json');
    merged = parseGeneratedContentSet(full);
  }
  // Echo identities come from the base alone: the stand `merged` reaches later packs through already
  // carries the peoples earlier patches of this very install added, whose collisions must re-key.
  const baseRows = merged;
  for (const [index, patch] of patches.entries()) {
    if (index !== seededIndex) rekeyCollidingPeople(merged, patch, baseRows);
    merged = mergeContentModData(merged, patch);
  }
  return parseContentSet(merged);
}
