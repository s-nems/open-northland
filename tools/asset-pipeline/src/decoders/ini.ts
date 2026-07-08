/**
 * `.ini` / decoded-`.cif` rule parser -> typed IR.
 *
 * Cultures rule files come in two skins of ONE grammar:
 *   - readable `.ini`: `[section]` headers + `key value...` lines (`Data/logic/*.ini`,
 *     `DataCnmd/types/*`). The first line is a `<CULTURES_CIF_BEGIN>` marker, otherwise plain text.
 *   - encrypted `.cif`: decoded by `cif.ts` into level-tagged lines (level 1 = section header,
 *     level 2 = property) carrying the SAME key/value vocabulary (see docs/SOURCES.md).
 *
 * This module reduces BOTH skins to a generic {@link RuleSection} model, then typed extractors map
 * specific sections onto the zod IR in `@vinland/data`. No bytes here: callers read files and pass
 * text (for `.ini`) or `CifLine[]` (for `.cif`, via `decodeCifStringArray`).
 *
 * Not ported from OpenVikings (its `.ini` handling is a trivial text parse). The grammar facts come
 * from inspecting `Data/logic/*.ini`. See docs/SOURCES.md and docs/DATA-FORMAT.md.
 */
import {
  AnimalType,
  ArmorType,
  AtomicAnimation,
  BobSequenceSet,
  BuildingBob,
  BuildingConstructionLayer,
  type BuildingFootprint,
  BuildingType,
  type FootprintCell,
  GatheringPipeline,
  GfxAnimAtomic,
  GfxPattern,
  type GoodAtomics,
  type GoodClassification,
  type GoodGathering,
  GoodType,
  HumanJobExperienceType,
  type JobEnables,
  type JobEnablesKind,
  type JobRequirement,
  type JobRequirementKind,
  type JobRequirementTarget,
  JobType,
  LandscapeGfx,
  LandscapeType,
  MapInfo,
  SoundAmbient,
  SoundBank,
  SoundJingle,
  SoundStaticGroup,
  TerrainPattern,
  TrianglePatternType,
  TribeType,
  VehicleType,
  WeaponType,
} from '@vinland/data';
import { type CifLine, decodeCifStringArray } from './cif.js';

/**
 * Decodes raw `.ini` bytes to text as **CP1250** (Windows-1250, Central-European) — NOT UTF-8.
 * The Cultures rule files were authored on Windows-1250 codepages, so display strings carry Polish
 * glyphs (`ą ć ę ł ń ó ś ź ż` and capitals) in the 0x80..0xFF range; reading them as UTF-8 mangles
 * those bytes. Structural keywords (`[section]`, keys, the `<CULTURES_CIF_BEGIN>` header) are ASCII
 * and survive any of these single-byte encodings unchanged — only the human-facing names differ.
 *
 * This is the byte->text seam for the readable `.ini` skin; the `.cif` skin's seam lives in
 * `cif.ts` (decoded latin1 to match the OpenVikings oracle byte-for-byte). Re-decoding a `.cif`
 * display string as CP1250 is the IR-layer concern cif.ts's note defers — out of scope here.
 */
export function decodeIni(bytes: Uint8Array): string {
  // `fatal:false` (the default) maps the few unassigned CP1250 byte values to U+FFFD rather than
  // throwing — a malformed glyph in one name must not abort an offline batch over many files.
  return new TextDecoder('windows-1250').decode(bytes);
}

/** One property line: a key and its whitespace-separated values (quoted runs count as one value). */
export interface RuleProp {
  readonly key: string;
  readonly values: readonly string[];
}

/** One record: a section header (e.g. `goodtype`) and its properties, in file order. */
export interface RuleSection {
  readonly name: string;
  readonly props: readonly RuleProp[];
}

/** Where a batch of sections came from, stamped onto every IR record's `source` for auditability. */
export interface SourceRef {
  readonly file: string;
  readonly layer?: 'base' | 'mod';
}

/**
 * Splits one line into tokens: a quoted run (`"a b"`) is a single token (quotes stripped);
 * otherwise tokens are whitespace-separated. Signed numbers (`-1`, `+1`) survive as raw strings —
 * extractors coerce. The first token of a property line is its key; the rest are values.
 */
function tokenize(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) {
    out.push(m[1] !== undefined ? m[1] : (m[2] as string));
  }
  return out;
}

/**
 * Cuts a trailing `// ...` comment (the marker the `.ini` files actually use, e.g. on `transition`
 * lines in `landscapetypes.ini`). Quote-aware so a `//` inside a quoted value is preserved.
 */
function stripInlineComment(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/**
 * Parses readable `.ini` text into sections. Skips blank lines and the `<CULTURES_CIF_BEGIN>`
 * header, and strips `//` comments (full-line and inline). Properties appearing before the first
 * `[section]` are ignored.
 */
export function parseIniSections(text: string): RuleSection[] {
  const sections: { name: string; props: RuleProp[] }[] = [];
  let current: { name: string; props: RuleProp[] } | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine).trim();
    if (line === '' || line.startsWith('<')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      current = { name: line.slice(1, -1).trim(), props: [] };
      sections.push(current);
      continue;
    }
    if (current === undefined) continue;
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    const [key, ...values] = tokens;
    current.props.push({ key: key as string, values });
  }
  return sections;
}

/**
 * Adapts decoded `.cif` lines (from {@link CifLine}) into the same {@link RuleSection} model: a
 * level-1 (or level-0) line opens a new section named by its first token; deeper lines are its
 * properties. This is what lets type tables with no readable `.ini` twin (`housetypes`,
 * `weapontypes`, ...) feed the same extractors.
 */
export function cifLinesToSections(lines: readonly CifLine[]): RuleSection[] {
  const sections: { name: string; props: RuleProp[] }[] = [];
  let current: { name: string; props: RuleProp[] } | undefined;
  for (const { level, text } of lines) {
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;
    // Verified type tables (`housetypes`, ...) nest exactly: level 1 = section header,
    // level 2 = property. Only level 1 opens a section; level 0 (unprefixed) and any deeper
    // level fold into the current section's properties rather than spawning a bogus section —
    // tighten this once a real deeper-nested `.cif` fixture forces a richer tree.
    if (level === 1) {
      current = { name: tokens[0] as string, props: [] };
      sections.push(current);
    } else if (current !== undefined) {
      const [key, ...values] = tokens;
      current.props.push({ key: key as string, values });
    }
  }
  return sections;
}

/**
 * Walks a decoded string table — a `[control]` section with `stringidmultiplier <N>`, then a `[text]`
 * section of `stringn <id> "<text>"` (sets the running id explicitly) and bare `string "<text>"`
 * (auto-increments it) — into `{ <stringId>: <text> }`. The grammar is shared by the `ingamegui*` UI
 * tables (verified against the shipped `backup (errors)/*.ini`) and each map folder's
 * `text/<lang>/strings.ini`/`.cif` (same `stringn` lines, usually without a `[control]` section).
 * The multiplier (1 in every shipped table) scales the id, matching the engine's per-table id
 * namespacing. Values are returned as they appear in `sections` — the byte→text codepage is the
 * CALLER's seam ({@link decodeIni} already yields CP1250 for readable `.ini`; `.cif` text is decoded
 * latin1 to match the OpenVikings oracle and needs {@link latin1ToCp1250} for display).
 */
export function extractStringTable(sections: readonly RuleSection[]): Record<number, string> {
  const control = sections.find((s) => s.name === 'control');
  const rawMult = control?.props.find((p) => p.key === 'stringidmultiplier')?.values[0];
  const multiplier = rawMult !== undefined ? Number.parseInt(rawMult, 10) || 1 : 1;
  const text = sections.find((s) => s.name === 'text');

  const byId: Record<number, string> = {};
  let next = 0; // the running id the next bare `string` takes
  for (const prop of text?.props ?? []) {
    let id: number;
    let display: string | undefined;
    if (prop.key === 'stringn') {
      id = Number.parseInt(prop.values[0] ?? '', 10);
      display = prop.values[1];
      if (!Number.isNaN(id)) next = id + 1; // only advance the running id on a VALID explicit id, so one
      // malformed `stringn` drops only its own line, not every following bare `string` (per-item resilience)
    } else if (prop.key === 'string') {
      id = next;
      display = prop.values[0];
      next += 1;
    } else {
      continue; // not a string entry
    }
    if (Number.isNaN(id) || display === undefined) continue;
    byId[id * multiplier] = display;
  }
  return byId;
}

/** Re-decodes an oracle-faithful latin1 string (the `.cif` seam) as CP1250, its real display codepage. */
export function latin1ToCp1250(latin1: string): string {
  return new TextDecoder('windows-1250').decode(Uint8Array.from(latin1, (c) => c.charCodeAt(0) & 0xff));
}

/**
 * Decodes one encrypted `.cif` string table (a `CStringArray` of `[control]`/`[text]` lines) straight
 * to display text: {@link decodeCifStringArray} → {@link cifLinesToSections} → {@link extractStringTable},
 * with every value re-decoded through {@link latin1ToCp1250}. The `.cif` seam is oracle-faithful latin1,
 * so a caller composing the steps by hand can silently ship mojibake by forgetting the re-decode — this
 * helper keeps the codepage invariant in one place for both `.cif` string-table consumers (the
 * `ingamegui*` UI tables and the map folders' `strings.cif`).
 */
export function decodeCifStringTable(bytes: Uint8Array): Record<number, string> {
  const raw = extractStringTable(cifLinesToSections(decodeCifStringArray(bytes).lines));
  const table: Record<number, string> = {};
  for (const [id, display] of Object.entries(raw)) table[Number(id)] = latin1ToCp1250(display);
  return table;
}

/** First property with this key, or undefined. Repeated keys (e.g. `transition`) keep file order. */
function findProp(sec: RuleSection, key: string): RuleProp | undefined {
  return sec.props.find((p) => p.key === key);
}

/** All properties with this key, in file order — for repeated keys like `allowatomic`. */
function findProps(sec: RuleSection, key: string): RuleProp[] {
  return sec.props.filter((p) => p.key === key);
}

/**
 * First value of every property with this key, parsed as base-10 ints (NaN entries dropped). Used
 * for repeated single-value lines (`allowatomic N`, `baseatomics N`), preserving file order.
 */
function getIntList(sec: RuleSection, key: string): number[] {
  const out: number[] = [];
  for (const p of findProps(sec, key)) {
    const n = Number.parseInt(p.values[0] ?? '', 10);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

/**
 * ALL values of the first matching property parsed as base-10 ints (NaN entries dropped), in file
 * order. For a single multi-value line like `productionInputGoods 1 1 14 14` (vs {@link getIntList},
 * which reads `values[0]` of each repeated single-value line).
 */
function getIntValues(sec: RuleSection, key: string): number[] {
  const out: number[] = [];
  for (const raw of findProp(sec, key)?.values ?? []) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

/**
 * ALL values of the first matching property parsed as ints, returned only if there are **exactly**
 * `length` of them (else `undefined`) — for fixed-arity tuples like a 6-int UV set (`GfxCoordsA`) or a
 * 3-int `debugcolor`. A wrong-arity line yields `undefined` rather than a partial tuple, so a degenerate
 * record degrades gracefully instead of producing a malformed shape.
 */
function getIntTuple(sec: RuleSection, key: string, length: number): number[] | undefined {
  const vals = getIntValues(sec, key);
  return vals.length === length ? vals : undefined;
}

/** First value of the first matching property as a string. */
function getStr(sec: RuleSection, key: string): string | undefined {
  return findProp(sec, key)?.values[0];
}

/** First value of the first matching property parsed as a base-10 int (undefined if absent/NaN). */
function getInt(sec: RuleSection, key: string): number | undefined {
  const v = findProp(sec, key)?.values[0];
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** Stable, filesystem-safe slug from a display name: `"tree falling"` -> `"tree_falling"`. */
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Reads the required numeric `type` id, throwing if absent — malformed source data, surfaced to the
 * human running the offline pipeline rather than silently dropped (matches cif.ts's throw-on-corrupt
 * stance and the project's "throw for bugs" rule).
 */
function requireTypeId(sec: RuleSection, block: string, src: SourceRef): number {
  const typeId = getInt(sec, 'type');
  if (typeId === undefined) {
    throw new Error(`ini: [${block}] without a numeric \`type\` in ${src.file}`);
  }
  return typeId;
}

/**
 * Extracts `[goodtype]` sections into validated {@link GoodType} IR. Throws on a section missing the
 * required numeric `type` id — that is malformed source data, surfaced to the human running the
 * offline pipeline rather than silently dropped.
 */
export function extractGoods(sections: readonly RuleSection[], src: SourceRef): GoodType[] {
  const goods: GoodType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'goodtype') continue;
    const typeId = requireTypeId(sec, 'goodtype', src);
    const name = getStr(sec, 'name');
    const gathering = extractGoodGathering(sec);
    goods.push(
      GoodType.parse({
        typeId,
        id: name ? slug(name) : `good_${typeId}`,
        name,
        atomics: extractGoodAtomics(sec),
        productionInputs: extractProductionInputs(sec),
        classification: extractGoodClassification(sec),
        landscapeType: getInt(sec, 'landscapetype'),
        ...(gathering ? { gathering } : {}),
        source: { file: src.file, block: 'goodtype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return goods;
}

/**
 * Collapse a `[goodtype]`'s `productionInputGoods` multiset into `{ goodType, amount }` pairs. The
 * line is a flat list of input good ids where a **repeat encodes the quantity** (`… 1 1 14 14 …` =
 * 2× good 1 + 2× good 14), so equal ids are tallied; first-seen order is preserved (deterministic IR).
 * Absent → `[]` (a raw/harvested good with no production recipe). The amounts are faithful counts from
 * the source, not derived.
 */
function extractProductionInputs(sec: RuleSection): { goodType: number; amount: number }[] {
  const counts = new Map<number, number>();
  for (const id of getIntValues(sec, 'productionInputGoods')) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts].map(([goodType, amount]) => ({ goodType, amount }));
}

/**
 * Reads a `[goodtype]`'s boolean classification flags (`1`/`0` ints) onto the node-layer
 * {@link GoodClassification}: `isProducedOnMapFlag` (raw/map-gathered), `isProducedInHouseFlag`
 * (workplace-produced), `isInputGoodFlag` (consumable as a recipe input). An absent flag is `false`.
 * These layers + the `productionInputGoods` edges are the explicit goods-graph IR (raw → produced →
 * food tiers) the Phase-3 economy reads.
 */
function extractGoodClassification(sec: RuleSection): GoodClassification {
  return {
    producedOnMap: getInt(sec, 'isProducedOnMapFlag') === 1,
    producedInHouse: getInt(sec, 'isProducedInHouseFlag') === 1,
    inputGood: getInt(sec, 'isInputGoodFlag') === 1,
  };
}

/**
 * Maps a `[goodtype]`'s `atomicFor*` lines onto the role-keyed {@link GoodAtomics} map. Absent
 * roles are simply omitted (the schema leaves them undefined). The role names match the four keys
 * present in `Data/logic/goodtypes.ini`: Harvesting / Cultivating / Planting / Production.
 */
function extractGoodAtomics(sec: RuleSection): GoodAtomics {
  const atomics: { harvest?: number; cultivate?: number; plant?: number; produce?: number } = {};
  const harvest = getInt(sec, 'atomicForHarvesting');
  const cultivate = getInt(sec, 'atomicForCultivating');
  const plant = getInt(sec, 'atomicForPlanting');
  const produce = getInt(sec, 'atomicForProduction');
  if (harvest !== undefined) atomics.harvest = harvest;
  if (cultivate !== undefined) atomics.cultivate = cultivate;
  if (plant !== undefined) atomics.plant = plant;
  if (produce !== undefined) atomics.produce = produce;
  return atomics;
}

/**
 * Reads a `[goodtype]`'s three-stage gathering pipeline (`landscapeToHarvest`/`landscapeToPickup`/
 * `landscapeToStore` → {@link LandscapeType} ids) + the `isBioLandscapeFlag` classification. Returns
 * `undefined` for a good with NO gathering lane (a produced/in-house good like flour or bread) so the
 * caller omits the field. A partial chain is kept as-is (honey ships only pickup/store, no harvest) —
 * an absent lane is a faithful `undefined`, not a guessed default.
 */
function extractGoodGathering(sec: RuleSection): GoodGathering | undefined {
  const harvest = getInt(sec, 'landscapeToHarvest');
  const pickup = getInt(sec, 'landscapeToPickup');
  const store = getInt(sec, 'landscapeToStore');
  if (harvest === undefined && pickup === undefined && store === undefined) return undefined;
  // `chopsToFell`/`yieldPerNode` are OBSERVED felling calibration constants, NOT in the source `.ini`
  // (verified absent — no `baserepeatcounter` for the collector job), so the extractor emits them at 0
  // (= "not calibrated / single-hit"); a scene/fixture sets the real values, tracked in source basis.
  const gathering: {
    harvest?: number;
    pickup?: number;
    store?: number;
    bioLandscape: boolean;
    chopsToFell: number;
    yieldPerNode: number;
    depositSize: number;
    depositLevels: number;
  } = {
    bioLandscape: getInt(sec, 'isBioLandscapeFlag') === 1,
    // OBSERVED calibration with no readable source (chop count / yield / deposit size — `maximumValency`
    // is a per-cell valency, not the unit count): emitted 0, pinned by a scene until measured. `depositLevels`
    // is DIFFERENT — it IS the harvest `[GfxLandscape]` record's fill-state count (gfx DATA), still emitted 0
    // here (a future join would copy that frame count); until then the spawn site sets it. See source basis.
    chopsToFell: 0,
    yieldPerNode: 0,
    depositSize: 0,
    depositLevels: 0,
  };
  if (harvest !== undefined) gathering.harvest = harvest;
  if (pickup !== undefined) gathering.pickup = pickup;
  if (store !== undefined) gathering.store = store;
  return gathering;
}

/**
 * Extracts `[landscapetype]` sections into validated {@link LandscapeType} IR. Captures the inputs the
 * Phase-2 cell-adjacency graph needs: `maximumValency` (per-cell capacity → `maxValency`) and the
 * `allowedonland`/`allowedonwater`/`allowedoneverything` placement-layer flags (`1`/`0` ints). These
 * are the cell-graph's per-type valency + placement source, NOT a render-triangle property. There is
 * NO per-type movement-cost/weight field in this table — the engine gates movement by walkability +
 * valency, so the graph uses a uniform unit walk cost (see packages/sim/src/terrain.ts). `walkable`/
 * `buildable` keep their schema defaults — they're a later derivation (not cleanly from these flags,
 * which mark placement layer, not traversal). The raw `name` + the `transition` tuples are captured
 * verbatim (the tuple field-semantics are NOT decoded — see docs/SOURCES.md); `debugcolor`/
 * `playeridallowed` (editor concerns) are still skipped. See docs/plans/Phase 2.
 */
export function extractLandscape(sections: readonly RuleSection[], src: SourceRef): LandscapeType[] {
  const landscape: LandscapeType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'landscapetype') continue;
    const typeId = requireTypeId(sec, 'landscapetype', src);
    const name = getStr(sec, 'name');
    // Raw `transition` tuples in file order, variable arity (mostly 5 ints, a few `mine` types 2),
    // captured VERBATIM — the encoding is not reversed, so no semantics are read into the positions.
    const transitions = findProps(sec, 'transition')
      .map((p) => p.values.map((v) => Number.parseInt(v, 10)))
      .filter((vals) => vals.length > 0 && vals.every((n) => !Number.isNaN(n)));
    landscape.push(
      LandscapeType.parse({
        typeId,
        id: name ? slug(name) : `landscape_${typeId}`,
        name,
        maxValency: getInt(sec, 'maximumValency') ?? 0,
        allowedOnLand: getInt(sec, 'allowedonland') === 1,
        allowedOnWater: getInt(sec, 'allowedonwater') === 1,
        allowedOnEverything: getInt(sec, 'allowedoneverything') === 1,
        transitions,
        source: { file: src.file, block: 'landscapetype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return landscape;
}

/**
 * Extracts `[trianglepatterntype]` sections from `Data/logic/trianglepatterntypes.cif` (`.cif`-only,
 * decoded via {@link decodeCifStringArray} → {@link cifLinesToSections}) into validated
 * {@link TrianglePatternType} IR — the **logic classification** of the terrain triangles
 * (water/land/mountain/sand/...), the cross-reference target of a {@link GfxPattern}'s `logicType`. The
 * real file is 10 records (type ids 1..10), despite the 82-string count its `.cif` header reports (10
 * section headers + 72 property lines). Throws on a section missing the required numeric `type` (matches
 * {@link extractGoods}'s throw-on-malformed stance — a triangle type with no id is corrupt source). The
 * `0`/`1` flags become booleans (`getInt(...) === 1`, as {@link extractLandscape}/{@link extractAnimals}
 * do); an absent flag is `false` (the source omits a `0`). `debugcolor` is the flat per-type RGB
 * fallback colour, kept for the cheap legible terrain render when textures are deferred.
 */
export function extractTrianglePatternTypes(
  sections: readonly RuleSection[],
  src: SourceRef,
): TrianglePatternType[] {
  const types: TrianglePatternType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'trianglepatterntype') continue;
    const type = requireTypeId(sec, 'trianglepatterntype', src);
    types.push(
      TrianglePatternType.parse({
        type,
        debugName: getStr(sec, 'debugname'),
        isWater: getInt(sec, 'iswater') === 1,
        humanCanWalkOn: getInt(sec, 'humancanwalkon') === 1,
        houseCanBeBuildOn: getInt(sec, 'housecanbebuildon') === 1,
        bioCanGrowOn: getInt(sec, 'biocangrowon') === 1,
        bioCanPlantOn: getInt(sec, 'biocanplanton') === 1,
        island: getInt(sec, 'island') === 1,
        moveResistance: getInt(sec, 'moveresistance') ?? 0,
        debugColor: getIntTuple(sec, 'debugcolor', 3),
        source: { file: src.file, block: 'trianglepatterntype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return types;
}

/**
 * Extracts `[GfxPattern]` sections from `Data/engine2d/inis/patterns/pattern.cif` (`.cif`-only, with
 * CamelCase keys + a CamelCase section header like {@link extractLandscapeGraphics}) into validated
 * {@link GfxPattern} IR — the **texture→cell binding** for the triangle-mesh terrain (927 records). Each
 * pattern names a `text_NNN.pcx` ground texture, the two triangles' 6-int UV tuples (`GfxCoordsA`/
 * `GfxCoordsB`) and a `LogicType` ({@link TrianglePatternType.type} cross-ref; `0` = the misc/border
 * tiles that classify to no logic type).
 *
 * Unlike the throw/skip extractors, this **keeps every record and never drops or reorders one**: the
 * record has no explicit id, so {@link GfxPattern.id} is its 0-based position and a map references a
 * pattern by that index — skipping a malformed record would renumber the rest. The visual fields are
 * therefore read defensively (a wrong-arity coord set → `undefined` via {@link getIntTuple}) rather than
 * aborting the offline batch, so even a degenerate record still occupies its positional slot. The `id`
 * counter advances only on a matched section, so it stays the pattern index even if other section kinds
 * were interleaved. `EditGroups` keeps its raw quoted group strings verbatim (editor metadata, unslugged).
 */
export function extractPatterns(sections: readonly RuleSection[], src: SourceRef): GfxPattern[] {
  const patterns: GfxPattern[] = [];
  let id = 0;
  for (const sec of sections) {
    if (sec.name !== 'GfxPattern') continue;
    const texture = getStr(sec, 'GfxTexture');
    patterns.push(
      GfxPattern.parse({
        id: id++,
        editName: getStr(sec, 'EditName'),
        editGroups: [...(findProp(sec, 'EditGroups')?.values ?? [])],
        logicType: getInt(sec, 'LogicType') ?? 0,
        texture: texture !== undefined ? normalizeAssetPath(texture) : undefined,
        coordsA: getIntTuple(sec, 'GfxCoordsA', 6),
        coordsB: getIntTuple(sec, 'GfxCoordsB', 6),
        source: { file: src.file, block: 'GfxPattern', layer: src.layer ?? 'base' },
      }),
    );
  }
  return patterns;
}

/** The three coarse ground families a landscape typeId is approximated into, each pinned to a logic type + a representative pattern's preferred editName prefix. */
const TERRAIN_FAMILIES = [
  { family: 'water', logicType: 1, prefix: 'water' },
  { family: 'mountain', logicType: 3, prefix: 'mountain' },
  { family: 'land', logicType: 2, prefix: 'meadow' },
] as const;

type TerrainFamily = (typeof TERRAIN_FAMILIES)[number]['family'];

/**
 * Classifies a {@link LandscapeType} (by its `id` slug) into a coarse ground family. The map's per-cell
 * `lmlt` value is a landscape typeId, but those types are mostly OBJECTS (void/tree/rock/iron/wheat/…),
 * not ground classes — so the GROUND under a cell is approximated from the type's NAME: a `water` name →
 * water, a `rock`/`stone` name → mountain, everything else (incl. tree/bush/wood, whose ground is land)
 * → land. This is the deviation the 1:1-oracle-blocked terrain render ships (source basis).
 */
function classifyTerrainFamily(landscapeId: string): TerrainFamily {
  const n = landscapeId.toLowerCase();
  if (n.includes('water')) return 'water';
  if (n.includes('rock') || n.includes('stone')) return 'mountain';
  return 'land';
}

/**
 * Picks the representative {@link GfxPattern} for a family: the pattern of the family's `logicType` whose
 * `editName` starts with the family seed (`water`/`meadow`/`mountain`) — the clean full-tile base — else,
 * if none match the seed, any pattern of that `logicType`. Among candidates, the **shortest editName,
 * lowest id** wins (the unsuffixed base tile like `"water 01"` over a `"block water 00 00 00"` transition
 * variant), a deterministic pick. Returns `undefined` if the family's `logicType` has no usable pattern
 * (no texture / coords) — then that family's typeIds bind nothing.
 */
function pickRepresentativePattern(
  patterns: readonly GfxPattern[],
  logicType: number,
  prefix: string,
): GfxPattern | undefined {
  const usable = patterns.filter(
    (p) =>
      p.logicType === logicType &&
      p.texture !== undefined &&
      p.coordsA !== undefined &&
      p.coordsB !== undefined,
  );
  const seeded = usable.filter((p) => (p.editName ?? '').toLowerCase().startsWith(prefix));
  const pool = seeded.length > 0 ? seeded : usable;
  return [...pool].sort((a, b) => (a.editName ?? '').length - (b.editName ?? '').length || a.id - b.id)[0];
}

/**
 * Builds the **approximated** typeId→ground-pattern table the terrain renderer consumes
 * ({@link TerrainPattern} IR, historical plan phase 2 step 2): for each {@link LandscapeType}, classify its
 * ground family ({@link classifyTerrainFamily}) and bind it to that family's one representative
 * {@link GfxPattern} ({@link pickRepresentativePattern}) — its `text_NNN` texture + the two triangles'
 * UVs — plus the family logic type's `debugColor` (the flat-tint fallback). A cross-table builder (like
 * {@link fillBuildingRecipes}), so it runs after the three source tables are extracted. **This is a
 * recorded deviation, not a 1:1 match** (source basis): the original computes the per-cell pattern
 * from corner types + variant lanes, an oracle-blocked algorithm; here every typeId of a family gets the
 * SAME representative ground. A landscape typeId whose family has no usable pattern is skipped (binds no
 * ground → the renderer keeps its flat-colour fallback for those cells).
 */
export function buildTerrainPatterns(
  landscape: readonly LandscapeType[],
  patterns: readonly GfxPattern[],
  triangleTypes: readonly TrianglePatternType[],
  src: SourceRef,
): TerrainPattern[] {
  const debugByType = new Map(triangleTypes.map((t) => [t.type, t.debugColor]));
  const repByFamily = new Map<TerrainFamily, GfxPattern | undefined>(
    TERRAIN_FAMILIES.map((f) => [f.family, pickRepresentativePattern(patterns, f.logicType, f.prefix)]),
  );
  const out: TerrainPattern[] = [];
  for (const lt of landscape) {
    const family = classifyTerrainFamily(lt.id);
    const rep = repByFamily.get(family);
    if (rep?.texture === undefined || rep.coordsA === undefined || rep.coordsB === undefined) continue;
    out.push(
      TerrainPattern.parse({
        typeId: lt.typeId,
        family,
        patternId: rep.id,
        logicType: rep.logicType,
        texture: rep.texture,
        coordsA: rep.coordsA,
        coordsB: rep.coordsB,
        debugColor: debugByType.get(rep.logicType),
        source: { file: src.file, block: 'terrainpattern', layer: src.layer ?? 'base' },
      }),
    );
  }
  return out;
}

/**
 * Extracts `[jobtype]` sections into validated {@link JobType} IR, capturing the atomic vocabulary a
 * job may perform: `allowatomic` (granted), `baseatomics` (always-available base set) and
 * `forbidatomic` (hard-denied) — all repeated single-value lines kept in file order. The Phase-2
 * atomic planner picks among these.
 */
export function extractJobs(sections: readonly RuleSection[], src: SourceRef): JobType[] {
  const jobs: JobType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'jobtype') continue;
    const typeId = requireTypeId(sec, 'jobtype', src);
    const name = getStr(sec, 'name');
    jobs.push(
      JobType.parse({
        typeId,
        id: name ? slug(name) : `job_${typeId}`,
        name,
        allowedAtomics: getIntList(sec, 'allowatomic'),
        baseAtomics: getIntList(sec, 'baseatomics'),
        forbiddenAtomics: getIntList(sec, 'forbidatomic'),
        source: { file: src.file, block: 'jobtype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return jobs;
}

/**
 * Extracts `[humanjobexperiencetype]` sections (`Data/logic/humanjobexperiencetypes.ini`) into
 * validated {@link HumanJobExperienceType} IR — the per-specialization experience tracks the Phase-3
 * ProgressionSystem accrues XP into. A track names its owning `job` (always) and, when good-specific,
 * the `good` it trains on; `experiencefactor` scales accrual and `baserepeatcounter` (on a few records)
 * is the original's repeat-count tuning. The numeric semantics are captured raw — interpreting the XP
 * curve is the ProgressionSystem's concern, not this extraction slice. The `job`/`good` ids are
 * cross-checked against the job/good tables by `validateCrossReferences`. Throws on a record missing
 * the required numeric `type` id (matches {@link extractGoods}'s throw-on-malformed stance). The base
 * `.ini` is the source — there is no mod twin and no readable-vs-encrypted choice to make here.
 */
export function extractJobExperience(
  sections: readonly RuleSection[],
  src: SourceRef,
): HumanJobExperienceType[] {
  const tracks: HumanJobExperienceType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'humanjobexperiencetype') continue;
    const typeId = requireTypeId(sec, 'humanjobexperiencetype', src);
    const name = getStr(sec, 'name');
    const jobType = getInt(sec, 'job');
    if (jobType === undefined) {
      throw new Error(`ini: [humanjobexperiencetype] without a numeric \`job\` in ${src.file}`);
    }
    tracks.push(
      HumanJobExperienceType.parse({
        typeId,
        id: name ? slug(name) : `jobxp_${typeId}`,
        name,
        jobType,
        goodType: getInt(sec, 'good'),
        experienceFactor: getInt(sec, 'experiencefactor') ?? 0,
        baseRepeatCounter: getInt(sec, 'baserepeatcounter'),
        source: { file: src.file, block: 'humanjobexperiencetype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return tracks;
}

/** The four `jobEnables<Kind>` source keys → the unified {@link JobEnables} `kind` discriminator. */
const JOB_ENABLES_KIND: Readonly<Record<string, JobEnablesKind>> = {
  jobEnablesGood: 'good',
  jobEnablesHouse: 'house',
  jobEnablesJob: 'job',
  jobEnablesVehicle: 'vehicle',
};

/**
 * Collects one `[tribetype]` section's `jobEnables<Kind> <jobType> <targetId>` lines into unified
 * {@link JobEnables} tech-graph edges in **exact source order**. The real data interleaves the four
 * kinds within a job's block (e.g. job 8's goods, then its jobs, then its houses), so a single
 * file-order pass — recognizing any of the four keys — keeps that order verbatim rather than
 * regrouping by kind. A line missing either int is skipped, matching the `setatomic` malformed-line
 * stance. (A non-`jobEnables*` prop yields no key match and is ignored.)
 */
function extractJobEnables(sec: RuleSection): JobEnables[] {
  const edges: JobEnables[] = [];
  for (const p of sec.props) {
    const kind = JOB_ENABLES_KIND[p.key];
    if (kind === undefined) continue;
    const jobType = Number.parseInt(p.values[0] ?? '', 10);
    const targetId = Number.parseInt(p.values[1] ?? '', 10);
    if (Number.isNaN(jobType) || Number.isNaN(targetId)) continue;
    edges.push({ jobType, kind, targetId });
  }
  return edges;
}

/** The four `{need,train}for{job,good}` source keys → their (requirement, target) decomposition. */
const JOB_REQUIREMENT_KEY: Readonly<
  Record<string, { requirement: JobRequirementKind; target: JobRequirementTarget }>
> = {
  needforjob: { requirement: 'need', target: 'job' },
  needforgood: { requirement: 'need', target: 'good' },
  trainforjob: { requirement: 'train', target: 'job' },
  trainforgood: { requirement: 'train', target: 'good' },
};

/**
 * Collects one `[tribetype]` section's `{need,train}for{job,good} <targetId> <amount> <expType>
 * [expType2]` lines into unified {@link JobRequirement} records in **exact source order** (the data
 * interleaves `need`/`train` blocks, kept verbatim like {@link JobEnables}). The `need`/`train`
 * prefix and `job`/`good` suffix of the key give the two dimensions; the remaining ints are the
 * target id, the amount, and one-or-two experience-type ids. A line missing the target id or the
 * amount is skipped, matching the `setatomic`/`jobEnables` malformed-line stance; a line with no
 * expType still yields a record (`experienceTypes: []`) rather than being dropped.
 */
function extractJobRequirements(sec: RuleSection): JobRequirement[] {
  const reqs: JobRequirement[] = [];
  for (const p of sec.props) {
    const decomposed = JOB_REQUIREMENT_KEY[p.key];
    if (decomposed === undefined) continue;
    const targetId = Number.parseInt(p.values[0] ?? '', 10);
    const amount = Number.parseInt(p.values[1] ?? '', 10);
    if (Number.isNaN(targetId) || Number.isNaN(amount)) continue;
    const experienceTypes: number[] = [];
    for (const raw of p.values.slice(2)) {
      const expType = Number.parseInt(raw, 10);
      if (!Number.isNaN(expType)) experienceTypes.push(expType);
    }
    reqs.push({ ...decomposed, targetId, amount, experienceTypes });
  }
  return reqs;
}

/**
 * Extracts `[tribetype]` sections into validated {@link TribeType} IR. The payload is each tribe's
 * `setatomic <jobType> <atomicId> "animation"` bindings — the per-tribe atomic→animation table that
 * carries tribal identity — plus its `jobEnables*` tech-graph edges ({@link extractJobEnables}) and
 * its `{need,train}for*` experience requirements ({@link extractJobRequirements}). The readable mod
 * `tribetypes.ini` covers playable tribes AND animals. Malformed `setatomic` lines (missing the
 * job/atomic ints or the animation token) are skipped.
 */
export function extractTribes(sections: readonly RuleSection[], src: SourceRef): TribeType[] {
  const tribes: TribeType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'tribetype') continue;
    const typeId = requireTypeId(sec, 'tribetype', src);
    const name = getStr(sec, 'name');
    const atomicBindings: { jobType: number; atomicId: number; animation: string }[] = [];
    for (const p of findProps(sec, 'setatomic')) {
      const jobType = Number.parseInt(p.values[0] ?? '', 10);
      const atomicId = Number.parseInt(p.values[1] ?? '', 10);
      const animation = p.values[2];
      if (Number.isNaN(jobType) || Number.isNaN(atomicId) || animation === undefined) continue;
      atomicBindings.push({ jobType, atomicId, animation });
    }
    tribes.push(
      TribeType.parse({
        typeId,
        id: name ? slug(name) : `tribe_${typeId}`,
        name,
        atomicBindings,
        jobEnables: extractJobEnables(sec),
        jobRequirements: extractJobRequirements(sec),
        source: { file: src.file, block: 'tribetype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return tribes;
}

/**
 * Extracts `[atomicanimation]` sections into validated {@link AtomicAnimation} IR — the timing/effect
 * layer the atomic vocabulary points at. Each section is keyed by `name` (the join target of a tribe's
 * `setatomic` binding); `length`/`interruptable`/`startdirection` are scalars, and `event`/`eventx`
 * lines become ordered {@link AtomicEvent}s carrying their raw `(at, type, value?)` numbers — the event
 * vocabulary is undocumented and captured faithfully, not interpreted. Throws on a section without a
 * `name` (it would be unreferenceable), matching {@link extractGoods}'s throw-on-malformed stance.
 */
export function extractAtomicAnimations(sections: readonly RuleSection[], src: SourceRef): AtomicAnimation[] {
  const animations: AtomicAnimation[] = [];
  for (const sec of sections) {
    if (sec.name !== 'atomicanimation') continue;
    const name = getStr(sec, 'name');
    if (name === undefined || name.trim() === '') {
      throw new Error(`ini: [atomicanimation] without a \`name\` in ${src.file}`);
    }
    const events: { at: number; type: number; value?: number; extended: boolean }[] = [];
    for (const p of sec.props) {
      if (p.key !== 'event' && p.key !== 'eventx') continue;
      const at = Number.parseInt(p.values[0] ?? '', 10);
      const type = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(at) || Number.isNaN(type)) continue;
      const event: { at: number; type: number; value?: number; extended: boolean } = {
        at,
        type,
        extended: p.key === 'eventx',
      };
      const rawValue = p.values[2];
      if (rawValue !== undefined) {
        const value = Number.parseInt(rawValue, 10);
        if (!Number.isNaN(value)) event.value = value;
      }
      events.push(event);
    }
    animations.push(
      AtomicAnimation.parse({
        id: slug(name),
        name,
        length: getInt(sec, 'length'),
        interruptible: getInt(sec, 'interruptable') === 1,
        startDirection: getInt(sec, 'startdirection'),
        events,
        source: { file: src.file, block: 'atomicanimation', layer: src.layer ?? 'base' },
      }),
    );
  }
  return animations;
}

/**
 * Extracts `[weapontype]` sections into validated {@link WeaponType} IR. The mod ships a readable
 * `DataCnmd/types/weapons.ini` (the base game's `Data/logic/weapontypes.cif` is the encrypted twin),
 * so this prefers that `.ini` per AGENTS.md golden rule #4.
 *
 * Each `damagevalue <armorClass> <value>` line becomes one entry in the role-keyed `damage` record
 * (the armor class is the string key, matching the schema's `record<string,number>` shape and the
 * original `damageValue[targetArmorClass]` indexing). `minimumrange`/`maximumrange` map to
 * `minRange`/`maxRange`; `jobtype` is the wielding job (cross-checked against the job table by
 * `validateCrossReferences`). `goodtype` is the good that IS the weapon (the weapon-side twin of an
 * armor's `goodtype`), cross-checked against the good table — captured as `undefined` when the source
 * value is **0** (the natural-weapon sentinel: a fist/claw is backed by no craftable good, just as
 * armor class 0 / a weapon's `damage["0"]` mean "unarmored"; good ids start at 1, so a literal 0 would
 * dangle). `tribetype` is captured because a weapon's `type` id is **not**
 * globally unique — the original keys a weapon by `(tribetype, type)`, so the same id recurs once
 * per tribe (e.g. `type 2` = "fist" for every tribe); see {@link WeaponType}. `mainType` (the coarse
 * weapon class) and `weight` (encumbrance) are captured as the weapon-side twins of an armor's
 * `mainType`/`weight` — note `mainType` is the file's exact camelCase key (a lowercased `maintype`
 * would silently vanish; see AGENTS.md). `munitiontype` (all-lowercase in the source, unlike
 * `mainType`) is the ammunition class a *ranged* weapon fires (1 = bow ammo, 2 = catapult projectile;
 * only bows/catapults carry it — melee weapons omit it → `undefined`), captured as a plain id (it is
 * a class enum, not a cross-ref — `munitiontype` exists in no other table and 1/2 are not good ids).
 * `damagetype` (all-lowercase like `munitiontype`) is the damage **class** a weapon deals — a
 * siege/area marker carried only by the catapults (value `2`); absent on every other weapon, so it's
 * `undefined` there and, like `munitiontype`, captured as a plain id (a class enum in no other table,
 * `2` is not a good id). `speed` (all-lowercase like `munitiontype`) is the ranged projectile's travel
 * speed — carried only by the bow/catapult rows (absent → `undefined` on melee weapons, its
 * `munitiontype` twin), captured as a plain magnitude (the unit is unreadable — the ranged drive maps
 * it via a calibration constant, see the schema). The remaining combat extras (`soundtype_*`,
 * `createsmoke`) are not in the {@link WeaponType} schema yet and are intentionally skipped here — they
 * belong with the Phase-4 CombatSystem, not this type-table slice.
 * Throws on a section missing the required numeric `type` (matches {@link extractGoods}'s
 * throw-on-malformed stance).
 */
export function extractWeapons(sections: readonly RuleSection[], src: SourceRef): WeaponType[] {
  const weapons: WeaponType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'weapontype') continue;
    const typeId = requireTypeId(sec, 'weapontype', src);
    const name = getStr(sec, 'name');
    const damage: Record<string, number> = {};
    for (const p of findProps(sec, 'damagevalue')) {
      const armorClass = Number.parseInt(p.values[0] ?? '', 10);
      const value = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(armorClass) || Number.isNaN(value)) continue;
      damage[String(armorClass)] = value;
    }
    // `goodtype 0` is the natural-weapon sentinel (fist/claw — no craftable good); good ids start at
    // 1, so drop a 0 to `undefined` rather than let it dangle in the cross-ref (the armor class-0 /
    // damage["0"] = "unarmored" pattern, one axis over).
    const goodTypeRaw = getInt(sec, 'goodtype');
    weapons.push(
      WeaponType.parse({
        typeId,
        id: name ? slug(name) : `weapon_${typeId}`,
        name,
        tribeType: getInt(sec, 'tribetype'),
        mainType: getInt(sec, 'mainType'),
        weight: getInt(sec, 'weight'),
        // `munitiontype` is all-lowercase in the source (unlike `mainType`) — the ammo class a ranged
        // weapon fires (bow/catapult); absent on melee weapons, so it doubles as the "is ranged" marker.
        munitionType: getInt(sec, 'munitiontype'),
        // `speed` (all-lowercase) is the ranged projectile's travel speed (bow 8, catapult 3); like
        // `munitiontype` it is carried only by ranged rows and absent on melee weapons → undefined.
        speed: getInt(sec, 'speed'),
        // `damagetype` is all-lowercase too — the damage class (siege marker, catapult-only, value 2);
        // absent on every other weapon → undefined. A class enum, not a cross-ref (no other table).
        damageType: getInt(sec, 'damagetype'),
        minRange: getInt(sec, 'minimumrange'),
        maxRange: getInt(sec, 'maximumrange'),
        damage,
        jobType: getInt(sec, 'jobtype'),
        goodType: goodTypeRaw === 0 ? undefined : goodTypeRaw,
        source: { file: src.file, block: 'weapontype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return weapons;
}

/**
 * Extracts `[armortype]` sections (base `Data/logic/armortypes.ini` — plain `.ini` despite the
 * `<CULTURES_CIF_BEGIN>` header line, which the parser ignores like `goodtypes`/`vehicletypes`; the
 * mod ships no readable twin) into validated {@link ArmorType} IR. An armor's `type` is the **armor
 * class** a {@link WeaponType.damage} record keys against (`damagevalue <armorClass> <value>`), so
 * this table makes those keys resolvable — the prerequisite the later CombatSystem read side joins on
 * (a weapon's damage vs. a target's armor `blockingValue`). Captured per record: `mainType`,
 * `goodType` (the good that IS the armor — cross-checked against the good table), `materialType`,
 * `weight`, `blockingValue`. Throws on a section missing the required numeric `type` (matches
 * {@link extractWeapons}'s throw-on-malformed stance).
 */
export function extractArmor(sections: readonly RuleSection[], src: SourceRef): ArmorType[] {
  const armor: ArmorType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'armortype') continue;
    const typeId = requireTypeId(sec, 'armortype', src);
    const name = getStr(sec, 'name');
    armor.push(
      ArmorType.parse({
        typeId,
        id: name ? slug(name) : `armor_${typeId}`,
        name,
        mainType: getInt(sec, 'mainType'),
        goodType: getInt(sec, 'goodtype'),
        materialType: getInt(sec, 'materialType'),
        weight: getInt(sec, 'weight'),
        blockingValue: getInt(sec, 'blockingValue'),
        source: { file: src.file, block: 'armortype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return armor;
}

/**
 * Extracts `[vehicletype]` sections (base `Data/logic/vehicletypes.ini` — the mod ships no readable
 * twin, and the file is plain `.ini` like `goodtypes`/`landscapetypes`) into validated
 * {@link VehicleType} IR. The carry capacity is `stockslots` (the param the later multi-good carrier
 * slice consumes); `passengerslots` and `logicsize` round out the type record. The per-vehicle
 * `logicgood` cargo allow-list is carried (the goodtypes a hold may hold — the `cargoGoods` filter
 * the Sea/Northland boat-as-mobile-store consumes), read with {@link getIntList} since each
 * `logicgood N` is a repeated single-value line. The `logicpassenger` board-list, vector/slot
 * graphics (`stockvector`/`vehicleslots`), the draft-animal (`logicdragginganimaltribe`) and `debug*`
 * extras are still skipped — they belong with the later embark/transport + graphics slices, not this
 * type-table extract. Throws on a section missing the required numeric `type` (matches
 * {@link extractWeapons}'s throw-on-malformed stance).
 */
export function extractVehicles(sections: readonly RuleSection[], src: SourceRef): VehicleType[] {
  const vehicles: VehicleType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'vehicletype') continue;
    const typeId = requireTypeId(sec, 'vehicletype', src);
    const name = getStr(sec, 'name');
    vehicles.push(
      VehicleType.parse({
        typeId,
        id: name ? slug(name) : `vehicle_${typeId}`,
        name,
        stockSlots: getInt(sec, 'stockslots'),
        passengerSlots: getInt(sec, 'passengerslots'),
        logicSize: getInt(sec, 'logicsize'),
        cargoGoods: getIntList(sec, 'logicgood'),
        source: { file: src.file, block: 'vehicletype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return vehicles;
}

/**
 * Extracts `[animaltype]` sections (base `Data/logic/animaltypes.ini` — plain `.ini` despite the
 * `<CULTURES_CIF_BEGIN>` header line, like `armortypes`/`vehicletypes`; the mod ships no readable twin)
 * into validated {@link AnimalType} IR — the per-tribe behaviour of the non-controllable creature
 * tribes the civ-vs-animal combat slice consumes. Unlike every other type table, an animal record keys
 * on **`tribetype`** (the cross-ref into the tribe table), NOT `type`: the source has no `type` id and
 * an animal's identity is its owning tribe. A record **missing `tribetype`** is **dropped** (a couple of
 * leftover/disabled stubs in the real file carry none) — it cannot resolve to a tribe, so keeping it
 * would dangle. This is the one extractor that drops-on-missing-key rather than throwing
 * ({@link extractWeapons}'s stance): here the key is genuinely absent in real data (a disabled record),
 * not malformed. The 0/1 flags become booleans (`getInt(...) === 1`, as {@link extractLandscape} does);
 * the magnitude fields stay ints. The graphics/sound/spawn extras are skipped — behaviour slice only.
 */
export function extractAnimals(sections: readonly RuleSection[], src: SourceRef): AnimalType[] {
  const animals: AnimalType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'animaltype') continue;
    const tribeType = getInt(sec, 'tribetype');
    if (tribeType === undefined) continue; // a disabled/leftover stub with no tribe key — can't resolve, drop it
    const name = getStr(sec, 'name');
    animals.push(
      AnimalType.parse({
        id: name ? slug(name) : `animal_${tribeType}`,
        name,
        tribeType,
        aggressive: getInt(sec, 'aggressive') === 1,
        getAngry: getInt(sec, 'getangry') === 1,
        angryGameTime: getInt(sec, 'angryGameTime'),
        hitpointsAdult: getInt(sec, 'hitpoints_adult'),
        hitpointsBaby: getInt(sec, 'hitpoints_baby'),
        maximumGroupSize: getInt(sec, 'maximumgroupsize'),
        maximumCadaverSize: getInt(sec, 'maximumcadaversize'),
        maximumLeaderDistance: getInt(sec, 'maximumleaderdistance'),
        searchForLeader: getInt(sec, 'searchforleader') === 1,
        maximumDistanceToStayPoint: getInt(sec, 'maximumdistancetostaypoint'),
        maximumDistanceToBirthPoint: getInt(sec, 'maximumdistancetobirthpoint'),
        moveSpeed: getInt(sec, 'movespeed'),
        runSpeed: getInt(sec, 'runspeed'),
        catchable: getInt(sec, 'catchable') === 1,
        warrantable: getInt(sec, 'warrantable') === 1,
        cannotBeAttacked: getInt(sec, 'cannotbeattacked') === 1,
        ignoreHouses: getInt(sec, 'ignorehouses') === 1,
        source: { file: src.file, block: 'animaltype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return animals;
}

/**
 * Coarse building class from the original `logichousetype` `logicmaintype`. The mapping is taken from
 * the readable `houses.ini` records themselves (OpenVikings decodes formats, not house semantics):
 *   1 = storage (headquarters + the stock houses), 2 = home (residences with a `logichomesize`),
 *   3 = workplace (production, carries `logicproduction`), 4 = training (barracks/school),
 *   5 = tower (defence), 6 = vehicle (buildable carts/ships, carries `logicvehicletype`),
 *   7 = wonder. Unknown ids fall back to a stable `maintype_<n>` so a new value never crashes a batch.
 */
function houseKind(mainType: number | undefined): string {
  switch (mainType) {
    case 1:
      return 'storage';
    case 2:
      return 'home';
    case 3:
      return 'workplace';
    case 4:
      return 'training';
    case 5:
      return 'tower';
    case 6:
      return 'vehicle';
    case 7:
      return 'wonder';
    default:
      return `maintype_${mainType ?? 'unknown'}`;
  }
}

/**
 * Extracts `[logichousetype]` sections (the mod's readable `DataCnmd/types/houses.ini`, preferred over
 * the base game's encrypted `housetypes.cif` per AGENTS.md golden rule #4) into validated
 * {@link BuildingType} IR. Unlike the other type tables a house record keys its id on `logictype` (not
 * `type`) and its name on `debugname`. Captured per record:
 *   - `logicworker <jobType> <count>`  -> {@link WorkerSlot}[] (the worker the building employs;
 *     `jobType` is cross-checked against the job table by `validateCrossReferences`).
 *   - `logicstock <goodType> <capacity> <initial>` -> {@link StockSlot}[] (per-good storage slots;
 *     `goodType` cross-checked against the good table).
 *   - `logicproduction <goodType>` -> `produces` (output good ids only — the input side is the
 *     output-side join {@link fillBuildingRecipes} does after this, see {@link BuildingType.produces}).
 *   - `logichomesize` -> `homeSize` (population-capacity tier, on `home` buildings).
 * `kind` is mapped from `logicmaintype` ({@link houseKind}). Throws on a section missing the required
 * numeric `logictype` (matches {@link extractGoods}'s throw-on-malformed stance). The combat/graphics
 * extras (`debugcolor`, `logicCanEnableDefenceMode`, `logicSchoolSize`, `logicvehicletype`, the
 * `logicbuildon*`/`logicignore*` placement flags) are intentionally skipped — they belong with the
 * later construction/combat/placement systems, not this type-table slice.
 */
export function extractBuildings(sections: readonly RuleSection[], src: SourceRef): BuildingType[] {
  const buildings: BuildingType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'logichousetype') continue;
    const typeId = getInt(sec, 'logictype');
    if (typeId === undefined) {
      throw new Error(`ini: [logichousetype] without a numeric \`logictype\` in ${src.file}`);
    }
    const name = getStr(sec, 'debugname');
    const workers: { jobType: number; count: number }[] = [];
    for (const p of findProps(sec, 'logicworker')) {
      const jobType = Number.parseInt(p.values[0] ?? '', 10);
      const count = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(jobType) || Number.isNaN(count)) continue;
      workers.push({ jobType, count });
    }
    const stock: { goodType: number; capacity: number; initial: number }[] = [];
    for (const p of findProps(sec, 'logicstock')) {
      const goodType = Number.parseInt(p.values[0] ?? '', 10);
      const capacity = Number.parseInt(p.values[1] ?? '', 10);
      const initial = Number.parseInt(p.values[2] ?? '', 10);
      if (Number.isNaN(goodType) || Number.isNaN(capacity)) continue;
      stock.push({ goodType, capacity, initial: Number.isNaN(initial) ? 0 : initial });
    }
    buildings.push(
      BuildingType.parse({
        typeId,
        id: name ? slug(name) : `house_${typeId}`,
        kind: houseKind(getInt(sec, 'logicmaintype')),
        homeSize: getInt(sec, 'logichomesize') ?? 0,
        workers,
        stock,
        produces: getIntList(sec, 'logicproduction'),
        source: { file: src.file, block: 'logichousetype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return buildings;
}

/**
 * Extracts each building's **build-material cost** from the graphics table's `[GfxHouse]` records (the
 * readable `DataCnmd/budynki12/houses/houses.ini`), keyed by the building `typeId` for an overlay onto
 * the `[logichousetype]`-extracted {@link BuildingType}s ({@link extractBuildings} reads the *logic*
 * table; the construction cost lives only in the *graphics* twin — a separate file the pipeline did not
 * read until now). A `[GfxHouse]` record is a render record carrying a few `Logic*` keys, three of which
 * matter here:
 *   - `LogicTribeType <id>` — the owning tribe. The cost is genuinely keyed by **(tribe, typeId)**: the
 *     same logic `typeId` (homes 2..6 are shared across civilizations) carries a DIFFERENT cost per
 *     tribe — viking/frank/byzantine model a home as an *upgrade chain* (level 4 = `27 27`, ornaments
 *     only), while egypt/saracen model the same typeId as a *standalone full build* (the cumulative
 *     list). To keep a single flat {@link BuildingType.construction} field we collapse to the
 *     **lowest-tribeType** record (the deterministic "reference tribe" convention `fillBuildingRecipes`
 *     already uses); the per-tribe divergence is recorded in source basis.
 *   - `LogicType <sizeIdx> <typeId>` — the building `typeId` at that size level (a home spans several:
 *     `home level 00..04` are five distinct typeIds, one per `sizeIdx`), joined to the cost by `sizeIdx`.
 *   - `LogicConstructionGoods <sizeIdx> <good> <good> …` — the goods to build that level, a flat id
 *     list where a **repeat encodes quantity** (`3 3 26` = 2× stone + pillar), exactly like
 *     `goodtypes.productionInputGoods` ({@link extractProductionInputs}).
 * A level with a `LogicType` but no matching `LogicConstructionGoods` (the headquarters/wonder records)
 * is omitted — that building has no construction cost. Returns an empty map if the file carries no
 * `[GfxHouse]` records (e.g. the logic-only sources every other extractor reads).
 *
 * Two collisions are resolved DETERMINISTICALLY (the cost is genuinely multi-valued in the source):
 *   1. cross-tribe — the same `typeId` (homes 2..6, potteries, …) recurs per civilization with a
 *      different cost; the **lowest `LogicTribeType`** record wins (the "reference tribe" convention).
 *   2. within a record — a `typeId` can map to MORE THAN ONE `sizeIdx` (e.g. pottery `LogicType {1:21,
 *      2:21}`, and a multi-stage wonder repeats one typeId across rising sizes); the **lowest `sizeIdx`**
 *      cost wins (the base/first build stage). Both collapses are recorded as approximations in
 *      source basis — a fully-faithful model would key the cost by `(tribe, typeId, sizeIdx)`.
 */
/**
 * The `LogicType <sizeIdx> <typeId>` table of one `[GfxHouse]` section/sub-record — the size-level →
 * building-typeId join every graphics-table extractor pairs its per-level lines against
 * (construction costs, footprints, construction layers, building bobs). Malformed lines are skipped.
 */
function logicTypeByLevel(sec: RuleSection): Map<number, number> {
  const typeByLevel = new Map<number, number>();
  for (const p of findProps(sec, 'LogicType')) {
    const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
    const typeId = Number.parseInt(p.values[1] ?? '', 10);
    if (Number.isNaN(sizeIdx) || Number.isNaN(typeId)) continue;
    typeByLevel.set(sizeIdx, typeId);
  }
  return typeByLevel;
}

export function extractConstructionCosts(
  sections: readonly RuleSection[],
): Map<number, { goodType: number; amount: number }[]> {
  // typeId -> the winning record, ranked by (tribeType asc, sizeIdx asc) so the lowest-tribe / lowest-
  // size cost deterministically wins regardless of file/parse order (see JSDoc collisions 1 & 2).
  const winner = new Map<
    number,
    { tribeType: number; sizeIdx: number; cost: { goodType: number; amount: number }[] }
  >();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    const tribeType = getInt(sec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
    // sizeIdx -> typeId. A typeId may appear at several sizeIdx; each (sizeIdx -> typeId) is kept so
    // the construction-goods loop below can pair each cost line to its level's typeId.
    const typeByLevel = logicTypeByLevel(sec);
    for (const p of findProps(sec, 'LogicConstructionGoods')) {
      const sizeIdx = Number.parseInt(p.values[0] ?? '', 10);
      if (Number.isNaN(sizeIdx)) continue;
      const typeId = typeByLevel.get(sizeIdx);
      if (typeId === undefined) continue;
      const existing = winner.get(typeId);
      // Lower tribeType wins; for the same tribe, lower sizeIdx wins (the base build stage).
      if (
        existing !== undefined &&
        (existing.tribeType < tribeType || (existing.tribeType === tribeType && existing.sizeIdx <= sizeIdx))
      ) {
        continue;
      }
      const counts = new Map<number, number>();
      for (const raw of p.values.slice(1)) {
        const id = Number.parseInt(raw, 10);
        if (Number.isNaN(id)) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      winner.set(typeId, {
        tribeType,
        sizeIdx,
        cost: [...counts].map(([goodType, amount]) => ({ goodType, amount })),
      });
    }
  }
  return new Map([...winner].map(([typeId, { cost }]) => [typeId, cost]));
}

/**
 * Expands one footprint-area source line (`<x> <y> <run>` after any leading level index) into its
 * cells: `run` cells starting at `(x, y)`, extending along +x — the row encoding every
 * `Logic*BlockArea` key uses. Non-numeric / non-positive runs yield no cells (malformed line).
 */
function expandAreaRun(x: number, y: number, run: number): FootprintCell[] {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(run) || run <= 0) return [];
  const cells: FootprintCell[] = [];
  for (let i = 0; i < run; i++) cells.push({ dx: x + i, dy: y });
  return cells;
}

/** Canonical footprint-cell order (ascending y, then x) + exact-duplicate removal, so the emitted IR
 *  is byte-stable regardless of source line order. */
function canonicalCells(cells: Iterable<FootprintCell>): FootprintCell[] {
  const byKey = new Map<string, FootprintCell>();
  for (const c of cells) byKey.set(`${c.dx},${c.dy}`, c);
  return [...byKey.values()].sort((a, b) => a.dy - b.dy || a.dx - b.dx);
}

/**
 * Extracts each building type's **ground footprint** from the graphics table's `[GfxHouse]` records —
 * the collision/placement model the logic table never carried (the same graphics-table overlay as
 * {@link extractConstructionCosts}, keyed by the `LogicType <sizeIdx> <typeId>` join):
 *
 *   - `LogicWalkBlockArea <sizeIdx> <x> <y> <run>` — the cells the standing building at that size
 *     level makes unwalkable (its body) → `blocked` for that level's `typeId`.
 *   - `LogicBuildBlockArea <x> <y> <run>` — defined ONCE per record with **no level index**: the
 *     level-independent build-exclusion zone. Every level's typeId gets the same zone — which is
 *     exactly the original's "a level-0 hut reserves the space of its top level" behavior.
 *   - `LogicDoorPoint <sizeIdx> <x> <y>` — that level's entry cell → `door`.
 *
 * Emitted per typeId: `blocked` (this level), `familyBody` (the union of every level's `blocked` —
 * the largest body the upgrade chain reaches), and `reserved` (`familyBody` ∪ the build-exclusion
 * zone; the union matters because a few real records — walls' gate cells, two frank/byzantine houses
 * — have walk-block cells the build area does not cover). Cells are canonically ordered (ascending
 * y, then x) and de-duplicated so the IR is byte-stable.
 *
 * Collisions resolve exactly like {@link extractConstructionCosts}: cross-tribe, the **lowest
 * `LogicTribeType`** record wins (the reference-tribe convention — footprints genuinely differ per
 * tribe skin; source basis); within a record, the **lowest `sizeIdx`** wins for a typeId mapped
 * at several sizes. Returns an empty map for sources with no `[GfxHouse]` records.
 */
export function extractBuildingFootprints(sections: readonly RuleSection[]): Map<number, BuildingFootprint> {
  const winner = new Map<number, { tribeType: number; sizeIdx: number; footprint: BuildingFootprint }>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeType = getInt(rec, 'LogicTribeType') ?? Number.POSITIVE_INFINITY;
      const typeByLevel = logicTypeByLevel(rec);
      if (typeByLevel.size === 0) continue;

      // The record-wide (level-independent) build-exclusion zone.
      const buildZone: FootprintCell[] = [];
      for (const p of findProps(rec, 'LogicBuildBlockArea')) {
        const [x, y, run] = p.values.map((v) => Number.parseInt(v, 10));
        buildZone.push(...expandAreaRun(x ?? Number.NaN, y ?? Number.NaN, run ?? Number.NaN));
      }
      // Per-level walk-block bodies + door points.
      const blockedByLevel = new Map<number, FootprintCell[]>();
      for (const p of findProps(rec, 'LogicWalkBlockArea')) {
        const [sizeIdx, x, y, run] = p.values.map((v) => Number.parseInt(v, 10));
        if (sizeIdx === undefined || Number.isNaN(sizeIdx)) continue;
        const cells = blockedByLevel.get(sizeIdx) ?? [];
        cells.push(...expandAreaRun(x ?? Number.NaN, y ?? Number.NaN, run ?? Number.NaN));
        blockedByLevel.set(sizeIdx, cells);
      }
      const doorByLevel = new Map<number, FootprintCell>();
      for (const p of findProps(rec, 'LogicDoorPoint')) {
        const [sizeIdx, x, y] = p.values.map((v) => Number.parseInt(v, 10));
        if (sizeIdx === undefined || Number.isNaN(sizeIdx)) continue;
        if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) continue;
        if (!doorByLevel.has(sizeIdx)) doorByLevel.set(sizeIdx, { dx: x, dy: y });
      }

      const familyBody = canonicalCells([...blockedByLevel.values()].flat());
      const reserved = canonicalCells([...familyBody, ...buildZone]);
      // A record with no collision CELLS at all (the vehicle/cart records; a record whose only area
      // lines are malformed) contributes nothing — an all-empty footprint would look footprinted yet
      // validate every placement. Gate on the expanded cells, not on the raw line/level count.
      if (reserved.length === 0) continue;

      for (const [sizeIdx, typeId] of typeByLevel) {
        const existing = winner.get(typeId);
        // Lower tribeType wins; for the same tribe, lower sizeIdx wins (the base build stage).
        if (
          existing !== undefined &&
          (existing.tribeType < tribeType ||
            (existing.tribeType === tribeType && existing.sizeIdx <= sizeIdx))
        ) {
          continue;
        }
        winner.set(typeId, {
          tribeType,
          sizeIdx,
          footprint: {
            blocked: canonicalCells(blockedByLevel.get(sizeIdx) ?? []),
            familyBody,
            reserved,
            door: doorByLevel.get(sizeIdx),
          },
        });
      }
    }
  }
  return new Map([...winner].map(([typeId, { footprint }]) => [typeId, footprint]));
}

/**
 * Extracts the `[GfxHouse]` **construction-stage layers** (`GfxBobConstructionLayer <sizeIdx>
 * <upgrade> <bobId> <shadowBobId|-1> <fromPct> <toPct>`) — which atlas bobs an under-construction
 * building draws at a given build progress ({@link BuildingConstructionLayer} documents the range/
 * stacking semantics). The `(sizeIdx → typeId)` join, the `(bmd, palette)` atlas keying, and the
 * per-palette row fan-out all mirror {@link extractBuildingBobs} (the finished-body binding these
 * layers extend); `stackIdx` preserves the record's file order per `(typeId, palette)` — the draw
 * stacking order. A malformed line (non-numeric fields) is skipped, never thrown.
 */
export function extractConstructionLayers(
  sections: readonly RuleSection[],
  src: SourceRef,
): BuildingConstructionLayer[] {
  const layers: BuildingConstructionLayer[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeId = getInt(rec, 'LogicTribeType');
      if (tribeId === undefined) continue;
      const bmd = findProp(rec, 'GfxBobLibs')?.values[0];
      if (bmd === undefined || bmd.trim() === '') continue;
      const palettes = (findProp(rec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
      if (palettes.length === 0) continue;
      const editName = getStr(rec, 'EditName');
      const typeByLevel = logicTypeByLevel(rec);
      const normalizedBmd = normalizeAssetPath(bmd);
      // File order per level — the stacking order at draw time (the finished body is listed so the
      // active-layer stack keeps it on top at high progress).
      const stackByLevel = new Map<number, number>();
      for (const p of findProps(rec, 'GfxBobConstructionLayer')) {
        const [level, upgrade, bobId, shadowBobId, fromPct, toPct] = p.values.map((v) =>
          Number.parseInt(v, 10),
        );
        if (
          level === undefined ||
          upgrade === undefined ||
          bobId === undefined ||
          shadowBobId === undefined ||
          fromPct === undefined ||
          toPct === undefined ||
          [level, upgrade, bobId, shadowBobId, fromPct, toPct].some((n) => Number.isNaN(n))
        ) {
          continue;
        }
        const typeId = typeByLevel.get(level);
        if (typeId === undefined) continue;
        const stackIdx = stackByLevel.get(level) ?? 0;
        stackByLevel.set(level, stackIdx + 1);
        for (const paletteName of palettes) {
          layers.push(
            BuildingConstructionLayer.parse({
              tribeId,
              typeId,
              level,
              upgrade: upgrade !== 0,
              stackIdx,
              bmd: normalizedBmd,
              paletteName: normalizePaletteName(paletteName),
              bobId,
              shadowBobId: shadowBobId >= 0 ? shadowBobId : undefined,
              fromPct: Math.max(0, Math.min(100, fromPct)),
              toPct: Math.max(0, Math.min(100, toPct)),
              editName,
              source: { file: src.file, block: 'GfxHouse', layer: src.layer ?? 'base' },
            }),
          );
        }
      }
    }
  }
  return layers;
}

/** Ticks for one production cycle when no produce-atomic animation length resolves (unpinned). */
const DEFAULT_RECIPE_TICKS = 20;

/**
 * Builds a last-wins `(jobType, atomicId) -> animation-name` lookup over ONE tribe's `setatomic`
 * bindings. `setatomic` is kept in file order with repeats; the original resolves a `(job, atomic)`
 * pair as **last-wins** (a later config line overrides an earlier one), so a plain `Map.set` in
 * binding order yields the engine's effective table.
 */
function tribeBindingLookup(tribe: TribeType): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of tribe.atomicBindings) m.set(`${b.jobType}:${b.atomicId}`, b.animation);
  return m;
}

/**
 * Resolves the faithful per-cycle tick count for one producing building, or `undefined` when the
 * chain can't be followed (so the caller falls back to {@link DEFAULT_RECIPE_TICKS}).
 *
 * The chain is: the building's worker `jobType` + the **primary** produced good's
 * `atomicForProduction` (`GoodAtomics.produce`) form the `(jobType, atomicId)` key into the
 * reference tribe's `setatomic` table -> an animation name -> that {@link AtomicAnimation}'s `length`.
 * "Primary" = the first `produces` good (file order) whose produce-atomic resolves all the way to a
 * positive animation length; later goods are tried only as a fallback so a building always pins to a
 * real length when any of its outputs can.
 *
 * APPROXIMATED on two axes, both recorded in source basis: (a) production length **varies per
 * tribe** in the source (e.g. viking coiner=200 vs frank coiner=60), so pinning to one reference
 * tribe loses the per-tribe spread — a per-tribe recipe table is the fully-faithful model, deferred;
 * (b) a multi-output workplace has one `length` per output atomic, collapsed here to the primary
 * output's (the merged-recipe model carries a single `ticks`). Both are strictly more faithful than
 * the old flat constant — the tick is now an actual extracted animation length, not a magic 20.
 */
function resolveRecipeTicks(
  building: BuildingType,
  goodById: ReadonlyMap<number, GoodType>,
  refTribeLookup: ReadonlyMap<string, string>,
  lengthByAnimation: ReadonlyMap<string, number>,
): number | undefined {
  const jobType = building.workers[0]?.jobType;
  if (jobType === undefined) return undefined;
  for (const outputGood of building.produces) {
    const atomicId = goodById.get(outputGood)?.atomics.produce;
    if (atomicId === undefined) continue;
    const animation = refTribeLookup.get(`${jobType}:${atomicId}`);
    if (animation === undefined) continue;
    const length = lengthByAnimation.get(animation);
    if (length !== undefined && length > 0) return length;
  }
  return undefined;
}

/**
 * Fills each producing building's `recipe` by the **output-side join**: a workplace's `produces`
 * names the *output* good(s) it makes, and a `[goodtype]`'s `productionInputGoods` (extracted onto
 * {@link GoodType.productionInputs}) names what producing THAT good consumes — so joining a
 * building's outputs through the goods table materializes the inputs the original house table never
 * carried directly. Cross-table, so it runs after `extractGoods`/`extractBuildings`/`extractTribes`/
 * `extractAtomicAnimations`, before `parseContentSet`.
 *
 * Returns NEW building records (the input array is left untouched). For each building with a
 * non-empty `produces`:
 *   - `recipe.outputs` = each produced good at amount 1 (one unit per cycle — the original house
 *     table carries no per-good output quantity, only which good; uniform 1 is the faithful default,
 *     matching the `logicproduction <good>` semantics). A repeated `logicproduction` id is summed
 *     into one output (symmetry with the input side + the production system's per-good stockpile model).
 *   - `recipe.inputs` = the merged `productionInputs` of every produced good, summed per input
 *     goodType (a workplace making several goods consumes the union of their inputs per cycle).
 *     Both sides are emitted in ascending goodType order — deterministic, source-order-independent.
 *   - `recipe.ticks` = the produce-atomic animation length resolved through the **reference tribe**
 *     (the lowest-`typeId` tribe — deterministic) by {@link resolveRecipeTicks}, falling back to
 *     {@link DEFAULT_RECIPE_TICKS} only when no produced good's produce-atomic resolves a length.
 *     APPROXIMATED (recorded in source basis): the source length varies per tribe and per output;
 *     the reference-tribe primary-output length is the faithful-leaning single value the merged
 *     recipe can carry until a per-tribe recipe table lands.
 *
 * A building that already carries a `recipe` (e.g. a future explicit override) is left as-is. A
 * building with empty `produces` gets no recipe (it is not a producer) and is returned unchanged.
 * `tribes`/`atomicAnimations` may be empty — then every recipe falls back to {@link DEFAULT_RECIPE_TICKS}.
 */
export function fillBuildingRecipes(
  buildings: readonly BuildingType[],
  goods: readonly GoodType[],
  tribes: readonly TribeType[] = [],
  atomicAnimations: readonly AtomicAnimation[] = [],
): BuildingType[] {
  const inputsByGood = new Map<number, readonly { goodType: number; amount: number }[]>();
  const goodById = new Map<number, GoodType>();
  for (const g of goods) {
    inputsByGood.set(g.typeId, g.productionInputs);
    goodById.set(g.typeId, g);
  }
  // Reference tribe = the lowest-typeId tribe (deterministic, source-order-independent). Production
  // length varies per tribe (see resolveRecipeTicks); one reference tribe is pinned for the single
  // building-type-level `ticks`. The animation length lookup is keyed by name (the `setatomic` join).
  const refTribe = tribes.reduce<TribeType | undefined>(
    (lo, t) => (lo === undefined || t.typeId < lo.typeId ? t : lo),
    undefined,
  );
  const refTribeLookup = refTribe ? tribeBindingLookup(refTribe) : new Map<string, string>();
  const lengthByAnimation = new Map<string, number>();
  for (const a of atomicAnimations) lengthByAnimation.set(a.name, a.length);

  return buildings.map((b) => {
    if (b.recipe !== undefined || b.produces.length === 0) return b;

    const mergedInputs = new Map<number, number>();
    const mergedOutputs = new Map<number, number>();
    for (const outputGood of b.produces) {
      mergedOutputs.set(outputGood, (mergedOutputs.get(outputGood) ?? 0) + 1);
      for (const inp of inputsByGood.get(outputGood) ?? []) {
        mergedInputs.set(inp.goodType, (mergedInputs.get(inp.goodType) ?? 0) + inp.amount);
      }
    }
    const sortedPairs = (m: Map<number, number>): { goodType: number; amount: number }[] =>
      [...m].sort(([a], [c]) => a - c).map(([goodType, amount]) => ({ goodType, amount }));

    const recipe = {
      inputs: sortedPairs(mergedInputs),
      outputs: sortedPairs(mergedOutputs),
      ticks: resolveRecipeTicks(b, goodById, refTribeLookup, lengthByAnimation) ?? DEFAULT_RECIPE_TICKS,
    };
    return BuildingType.parse({ ...b, recipe });
  });
}

/**
 * Reduces one decoded `map.cif`'s logic header sections into a validated {@link MapInfo}. The map's
 * `CStringArray` opens with a `logiccontrol` section (`mapsize <w> <h>`, `mapguid <16 bytes>`) plus
 * `misc_maptype`/`misc_mapname` metadata sections; this pulls those declarative scalars and leaves the
 * map's scripting payload (`MissionData`/`StaticObjects`/`playerdata`) untouched — that is the Phase-5
 * campaign layer, not this metadata slice (see {@link MapInfo} and docs/plans/). `id` is supplied by
 * the caller (the map folder name), since the header carries no human-readable map id.
 *
 * Throws when the required `logiccontrol` `mapsize`/`mapguid` are absent or malformed — a `map.cif`
 * without them is not a decodable map, surfaced to the human running the offline pipeline rather than
 * emitting a degenerate record (matches the throw-on-malformed stance of the other required-field
 * extractors). The optional `misc_*` scalars are simply omitted when a given map lacks them (skirmish
 * maps have no `mapcampaignid`, for instance).
 */
export function extractMapInfo(sections: readonly RuleSection[], id: string, src: SourceRef): MapInfo {
  const logic = sections.find((s) => s.name === 'logiccontrol');
  if (logic === undefined) {
    throw new Error(`ini: map ${src.file} has no [logiccontrol] section`);
  }
  const size = findProp(logic, 'mapsize')?.values;
  const width = Number.parseInt(size?.[0] ?? '', 10);
  const height = Number.parseInt(size?.[1] ?? '', 10);
  if (Number.isNaN(width) || Number.isNaN(height)) {
    throw new Error(`ini: map ${src.file} has no valid \`mapsize <w> <h>\``);
  }
  const guidRaw = findProp(logic, 'mapguid')?.values ?? [];
  const guid = guidRaw.map((v) => Number.parseInt(v, 10));
  if (guid.length !== 16 || guid.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
    throw new Error(`ini: map ${src.file} has no valid 16-byte \`mapguid\``);
  }

  const mapType = sections.find((s) => s.name === 'misc_maptype');
  const mapName = sections.find((s) => s.name === 'misc_mapname');
  const info: {
    id: string;
    width: number;
    height: number;
    guid: number[];
    mapType?: number;
    campaign?: { campaignId: number; missionId: number };
    nameStringId?: number;
    descriptionStringId?: number;
    source: { file: string; block: string; layer: 'base' | 'mod' };
  } = {
    id,
    width,
    height,
    guid,
    source: { file: src.file, block: 'logiccontrol', layer: src.layer ?? 'base' },
  };
  const type = mapType !== undefined ? getInt(mapType, 'maptype') : undefined;
  if (type !== undefined) info.mapType = type;
  const campaign = mapType !== undefined ? findProp(mapType, 'mapcampaignid')?.values : undefined;
  if (campaign !== undefined) {
    const campaignId = Number.parseInt(campaign[0] ?? '', 10);
    const missionId = Number.parseInt(campaign[1] ?? '', 10);
    if (!Number.isNaN(campaignId) && !Number.isNaN(missionId)) info.campaign = { campaignId, missionId };
  }
  const nameStringId = mapName !== undefined ? getInt(mapName, 'mapnamestringid') : undefined;
  if (nameStringId !== undefined) info.nameStringId = nameStringId;
  const descriptionStringId = mapName !== undefined ? getInt(mapName, 'mapdescriptionstringid') : undefined;
  if (descriptionStringId !== undefined) info.descriptionStringId = descriptionStringId;

  return MapInfo.parse(info);
}

/** The decoded `StaticObjects` placements of one map — the on-disk `entities` layer's shape. */
export interface MapStaticObjects {
  buildings: {
    name: string;
    level: number;
    player: number;
    hx: number;
    hy: number;
    rot?: number;
  }[];
  humans: { tribe: string; role: string; player: number; hx: number; hy: number }[];
  animals: { species: string; hx: number; hy: number }[];
}

/**
 * Extracts a map's `[StaticObjects]` authored placements — the pre-placed houses, humans and animals a
 * scenario starts with. Verb grammar (all coordinates **half-cells**, the `emla` 2W×2H lattice):
 *
 * ```
 * sethouse  <class> "<GfxHouse EditName>" <level> <player(1-based)> <hx> <hy> <rot>
 * sethuman  <player(0-based)> "<tribe>" "<jobtype role>" <hx> <hy> <a> <b>
 * setanimal <class> "<species>" "<age>" <hx> <hy> <a> <b>
 * ```
 *
 * Names are kept VERBATIM (the version-robust join key the loader resolves against the IR by name);
 * the two player columns keep their original bases, documented on the schema. The stock/production/
 * guide verbs (`addgoods`/`setproducedgood`/`setguide`) are not captured yet (source basis). A
 * malformed row is skipped, not thrown — one bad line must not drop a whole map's placements.
 * Returns `undefined` when the map has no `StaticObjects` section or it places nothing.
 */
export function extractStaticObjects(sections: readonly RuleSection[]): MapStaticObjects | undefined {
  const sec = sections.find((s) => s.name === 'StaticObjects');
  if (sec === undefined) return undefined;
  const int = (v: string | undefined): number | undefined => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isNaN(n) || n < 0 ? undefined : n;
  };
  const out: MapStaticObjects = { buildings: [], humans: [], animals: [] };
  for (const p of sec.props) {
    if (p.key === 'sethouse') {
      const [, name, levelRaw, playerRaw, hxRaw, hyRaw, rotRaw] = p.values;
      const level = int(levelRaw);
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      const rot = int(rotRaw);
      if (
        name === undefined ||
        level === undefined ||
        player === undefined ||
        hx === undefined ||
        hy === undefined
      )
        continue;
      out.buildings.push({ name, level, player, hx, hy, ...(rot !== undefined ? { rot } : {}) });
    } else if (p.key === 'sethuman') {
      const [playerRaw, tribe, role, hxRaw, hyRaw] = p.values;
      const player = int(playerRaw);
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      if (
        tribe === undefined ||
        role === undefined ||
        player === undefined ||
        hx === undefined ||
        hy === undefined
      )
        continue;
      out.humans.push({ tribe, role, player, hx, hy });
    } else if (p.key === 'setanimal') {
      const [, species, , hxRaw, hyRaw] = p.values;
      const hx = int(hxRaw);
      const hy = int(hyRaw);
      if (species === undefined || hx === undefined || hy === undefined) continue;
      out.animals.push({ species, hx, hy });
    }
  }
  if (out.buildings.length + out.humans.length + out.animals.length === 0) return undefined;
  return out;
}

/**
 * One resolved palette alias: a name a graphics record references (via `gfxpalettebody "<name>"`)
 * mapped to the `.pcx` whose trailer palette holds the actual 256 colours. The path is normalized to
 * a forward-slash, lower-cased, relative path so a lookup is host-OS- and case-independent (archive
 * names use Windows backslashes and mixed case, e.g. `data\Engine2D\Bin\palettes\landscapes\tree01.pcx`).
 */
export interface PaletteAlias {
  /**
   * The `editname` a graphics record references, **lower-cased** ({@link normalizePaletteName}): the
   * original engine looks `editname`s up case-insensitively, and the real data mixes case across the
   * two legs (e.g. `palettes.ini` declares `Lion01`/`Chicken01` while `jobgraphics.ini` references
   * `LION01`/`chicken01`). Lower-casing the join key on both sides makes the pairing resolve. One
   * record may expose several aliases for one file.
   */
  readonly name: string;
  /** The palette source `.pcx`, as a normalized `data/.../foo.pcx` relative path (forward slashes, lower-case). */
  readonly gfxFile: string;
}

/** Normalizes a Cultures asset path (`data\Engine2D\...\X.pcx`) to a lookup key: forward slashes, lower-case. */
function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * Normalizes a palette `editname` to its case-insensitive join key (lower-case). The two pairing legs
 * disagree on case in the real data — `palettes.ini` declares `Lion01`/`Chicken01`, `jobgraphics.ini`
 * references `LION01`/`chicken01` — and the original engine matches them case-insensitively, so both
 * {@link extractPaletteIndex} and {@link extractGraphicsBindings} key on the lower-cased name.
 */
function normalizePaletteName(name: string): string {
  return name.toLowerCase();
}

/**
 * Extracts the `palettes.ini` (`Data/engine2d/inis/palettes/palettes.ini`) `[GfxPalette256]` records
 * into name→`.pcx` palette aliases. This is the first leg of the `.bmd` palette-pairing graph
 * (docs/plans/Phase 1): a graphics record names a bob set's palette by `editname`
 * (`gfxpalettebody "tree01"`), `palettes.ini` resolves that name to a `gfxfile` `.pcx`, and the
 * `.pcx` trailer palette is the colour table {@link import('./pcx.js').decodePcx} already returns.
 *
 * Each record carries exactly one `gfxfile` but the grammar allows **several** `editname` aliases —
 * every alias is emitted as its own entry pointing at the shared file, so a consumer builds one flat
 * `name -> .pcx` map (the real file has 143 `[GfxPalette256]` records; it also holds 108
 * `[GfxPalette16]` 16-colour sub-palettes built via `gfxcolorrange` with no `.pcx`, which the
 * section-name guard skips). A record missing its `gfxfile` (nothing to resolve to) or with no
 * `editname` (unreferenceable) is skipped rather than throwing: this is an index over many records
 * and one malformed entry must not abort the offline batch. Paths are normalized via
 * {@link normalizeAssetPath} for host-OS/case-independent lookup against the unpacked `--out` tree.
 * The other binding leg (which `.bmd` uses which `editname`) lives mostly in graphics `.cif` records
 * (only `animals/jobgraphics.ini` is readable) and is wired in a later step.
 */
export function extractPaletteIndex(sections: readonly RuleSection[]): PaletteAlias[] {
  const aliases: PaletteAlias[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxPalette256') continue;
    const gfxFile = getStr(sec, 'gfxfile');
    if (gfxFile === undefined || gfxFile.trim() === '') continue;
    const normalized = normalizeAssetPath(gfxFile);
    for (const p of findProps(sec, 'editname')) {
      const name = p.values[0];
      if (name === undefined || name.trim() === '') continue;
      aliases.push({ name: normalizePaletteName(name), gfxFile: normalized });
    }
  }
  return aliases;
}

/**
 * One bob set's palette pairing: a `.bmd` body (and its optional shadow `.bmd`) bound to the palette
 * `editname` its `[jobgraphics]` record names — the **second leg** of the `.bmd`→palette graph
 * (docs/plans/Phase 1). The first leg ({@link extractPaletteIndex}) resolves `paletteName` to a
 * `.pcx` trailer palette; together they answer "which 256 colours colour this `.bmd`". The `.bmd`
 * paths are normalized (forward-slash, lower-case) so a lookup against the unpacked `--out` tree is
 * host-OS/case-independent, matching {@link PaletteAlias.gfxFile}.
 */
export interface BmdPaletteBinding {
  /** The body bob set, as a normalized `data/.../foo.bmd` relative path (forward slashes, lower-case). */
  readonly bmd: string;
  /** The matching shadow bob set, same normalization, or `undefined` when the record has no shadow `.bmd`. */
  readonly shadowBmd: string | undefined;
  /**
   * The palette `editname` the record references, **lower-cased** ({@link normalizePaletteName}) so it
   * joins case-insensitively onto {@link PaletteAlias.name} (the two legs disagree on case in the real
   * data).
   */
  readonly paletteName: string;
  /** The `logictribe` id the record applies to, when present (a cross-reference, not required). */
  readonly tribeId: number | undefined;
  /** The `logicjob` id the record applies to, when present (a cross-reference, not required). */
  readonly jobId: number | undefined;
}

/**
 * Extracts the readable `[jobgraphics]` records (`Data/engine2d/inis/animals/jobgraphics.ini` — the
 * one graphics binding file that ships as plain `.ini`, the rest being `.cif`) into `.bmd`→palette
 * bindings. Each record carries a `gfxbobmanagerbody "<body>.bmd" "<shadow>.bmd"` (the shadow value is
 * optional) and a `gfxpalettebody "<editname>"`; the `editname` resolves to a `.pcx` trailer palette
 * via {@link extractPaletteIndex}, completing the pairing the `.bmd` container itself doesn't carry.
 *
 * A record missing the body `.bmd` (nothing to colour) or the palette name (unbindable) is skipped
 * rather than throwing — this is an index over many records and one malformed entry must not abort the
 * offline batch, matching {@link extractPaletteIndex}. Paths are normalized via
 * {@link normalizeAssetPath}. The richer mod `[jobbasegraphics]` variant (indexed body/head bobs +
 * `gfxpalettebasebody`/`gfxpalettebasehead`/`gfxpaletterandom`) is a separate, later extractor; this
 * one covers only the flat `[jobgraphics]` schema.
 */
export function extractGraphicsBindings(sections: readonly RuleSection[]): BmdPaletteBinding[] {
  const bindings: BmdPaletteBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'jobgraphics') continue;
    const body = findProp(sec, 'gfxbobmanagerbody');
    const bmd = body?.values[0];
    if (bmd === undefined || bmd.trim() === '') continue;
    const paletteName = getStr(sec, 'gfxpalettebody');
    if (paletteName === undefined || paletteName.trim() === '') continue;
    const shadow = body?.values[1];
    bindings.push({
      bmd: normalizeAssetPath(bmd),
      shadowBmd: shadow !== undefined && shadow.trim() !== '' ? normalizeAssetPath(shadow) : undefined,
      paletteName: normalizePaletteName(paletteName),
      tribeId: getInt(sec, 'logictribe'),
      jobId: getInt(sec, 'logicjob'),
    });
  }
  return bindings;
}

/**
 * One landscape-object graphics binding: a {@link BmdPaletteBinding} (`.bmd` body + shadow + palette
 * editname) plus the record's `EditName`. The name is provenance and a **species handle** — a render
 * binding picks "yew 01" vs "fir 01" by it without re-reading the `.cif`, and many records share one
 * body bob recoloured per palette, so the name is the only thing distinguishing them at the IR layer.
 */
export interface LandscapeGraphicsBinding extends BmdPaletteBinding {
  /** The record's `EditName` (e.g. `"yew 01"`), or undefined when the record omits it. */
  readonly editName: string | undefined;
}

/**
 * Extracts the `[GfxLandscape]` records from `Data/engine2d/inis/landscapes/landscapes.cif` — the
 * **landscape-object** graphics binding (trees, bushes, signs, wonders, harbours, …): the map's
 * pre-placed decor, the exact analog of the `[jobgraphics]` creature binding but for static objects.
 * Each record names a body + shadow bob set (`GfxBobLibs "<body>.bmd" "<shadow>.bmd"`) and the palette
 * `editname` (`GfxPalette "tree_yew01"`) that recolours it — the same `(bmd, palette)` pairing
 * {@link convertBmdTree} consumes, completing what the `.bmd` container itself lacks. This is the
 * missing leg that lets `ls_trees.bmd` (and the other `ls_*.bmd` decor sets) become atlases: it ships
 * **`.cif`-only** (no readable `.ini` twin), so it is decoded via {@link decodeCifStringArray} →
 * {@link cifLinesToSections} like the base humans graphics. Unlike the lower-cased `.ini` graphics
 * keys, the editor serializes these records with **CamelCase** keys (`GfxBobLibs`/`GfxPalette`/
 * `EditName`) and a CamelCase section header (`GfxLandscape`), so the lookups match that casing.
 *
 * A record without a body bob (some decor is texture-only / a logic marker) or without a palette name
 * (unbindable) is skipped, never thrown — this indexes hundreds of records and one malformed entry must
 * not abort the offline batch (matching {@link extractGraphicsBindings}). `tribeId`/`jobId` are always
 * undefined (a landscape object has neither cross-ref). Repeated `(bmd, palette)` pairs (the ~99 tree
 * species share a dozen palettes) are **not** deduped here — the atlas filename keys on `(bmd, palette)`
 * so a duplicate only re-emits identical bytes; deduping is the caller's concern.
 */
export function extractLandscapeGraphics(sections: readonly RuleSection[]): LandscapeGraphicsBinding[] {
  const bindings: LandscapeGraphicsBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const libs = findProp(sec, 'GfxBobLibs');
    const bmd = libs?.values[0];
    if (bmd === undefined || bmd.trim() === '') continue;
    const paletteName = getStr(sec, 'GfxPalette');
    if (paletteName === undefined || paletteName.trim() === '') continue;
    const shadow = libs?.values[1];
    bindings.push({
      bmd: normalizeAssetPath(bmd),
      shadowBmd: shadow !== undefined && shadow.trim() !== '' ? normalizeAssetPath(shadow) : undefined,
      paletteName: normalizePaletteName(paletteName),
      tribeId: undefined,
      jobId: undefined,
      editName: getStr(sec, 'EditName'),
    });
  }
  return bindings;
}

/**
 * Extracts the FULL `[GfxLandscape]` table from `landscapes.cif` into validated {@link LandscapeGfx}
 * IR — every placeable landscape object (866 records: trees, stones, bushes, mine decals, waves, signs,
 * wonders), each joining its visual half (`GfxBobLibs` body+shadow, `GfxPalette`, per-state `GfxFrames`,
 * `GfxStatic`/`GfxLoopAnimation`) to its logic half (`LogicType` → the landscape type table,
 * `LogicMaximumValency`, `LogicIsWorkable`, the `LogicWalkBlockArea`/`LogicBuildBlockArea`/
 * `LogicWorkArea` footprints). This is the table a decoded map's object placements join onto **by
 * `EditName`** (the map's `eald` dictionary stores names) — distinct from
 * {@link extractLandscapeGraphics}, which only derives the `(bmd, palette)` atlas work list.
 *
 * Like {@link extractPatterns} this keeps **every** record in file order ({@link LandscapeGfx.index}
 * is the positional id, so skipping a malformed record would renumber the rest); visual fields are
 * read defensively (`undefined` on absence) rather than aborting the batch. Keys are the editor's
 * CamelCase except the lower-case `logicispileableonmap` (matched verbatim per the case-sensitive
 * parser — see AGENTS.md [0cbe894]); `GfxFrames`/block-area lines repeat per state/offset and
 * are kept in file order.
 */
export function extractLandscapeGfx(sections: readonly RuleSection[], src: SourceRef): LandscapeGfx[] {
  const records: LandscapeGfx[] = [];
  let index = 0;
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const libs = findProp(sec, 'GfxBobLibs');
    const bmd = libs?.values[0];
    const shadow = libs?.values[1];
    const paletteName = getStr(sec, 'GfxPalette');
    const blockAreas = (key: string): number[][] =>
      findProps(sec, key)
        .map((p) => p.values.map((v) => Number.parseInt(v, 10)))
        .filter((vals) => vals.length === 4 && vals.every((n) => !Number.isNaN(n)));
    const frames = findProps(sec, 'GfxFrames')
      .map((p) => p.values.map((v) => Number.parseInt(v, 10)))
      .filter((vals) => vals.length >= 2 && vals.every((n) => !Number.isNaN(n)))
      .map((vals) => ({ state: vals[0] as number, bobIds: vals.slice(1) }));
    records.push(
      LandscapeGfx.parse({
        index: index++,
        editName: getStr(sec, 'EditName'),
        editGroups: [...(findProp(sec, 'EditGroups')?.values ?? [])],
        logicType: getInt(sec, 'LogicType') ?? 0,
        maxValency: getInt(sec, 'LogicMaximumValency'),
        isWorkable: getInt(sec, 'LogicIsWorkable') === 1,
        walkBlockAreas: blockAreas('LogicWalkBlockArea'),
        buildBlockAreas: blockAreas('LogicBuildBlockArea'),
        workAreas: blockAreas('LogicWorkArea'),
        bmd: bmd !== undefined && bmd.trim() !== '' ? normalizeAssetPath(bmd) : undefined,
        shadowBmd: shadow !== undefined && shadow.trim() !== '' ? normalizeAssetPath(shadow) : undefined,
        paletteName:
          paletteName !== undefined && paletteName.trim() !== ''
            ? normalizePaletteName(paletteName)
            : undefined,
        frames,
        isStatic: getInt(sec, 'GfxStatic') !== 0,
        loopAnimation: getInt(sec, 'GfxLoopAnimation') === 1,
        dynamicBackground: getInt(sec, 'GfxDynamicBackground') === 1,
        source: { file: src.file, block: 'GfxLandscape', layer: src.layer ?? 'base' },
      }),
    );
  }
  return records;
}

/**
 * Resolves the {@link GatheringPipeline} join for every map-gathered good: `goodType` → its three
 * `landscapeTo{Harvest,Pickup,Store}` stage ids → the {@link LandscapeGfx} records that place each
 * stage. The stage→gfx leg joins by `LandscapeGfx.logicType == the stage's landscape type` (the
 * `[GfxLandscape]` cross-ref to the `[landscapetype]` table — the houses analog is `[GfxHouse]
 * LogicType`). Materialized once here so a later gathering system reads the stages + their placeable
 * gfx directly instead of re-scanning the 866-record gfx table each time.
 *
 * One record per good carrying a `gathering` chain (the ~11 raw goods); produced/in-house goods are
 * skipped. A lane the good omits (honey has no `harvest`) is left absent. A stage whose landscape
 * type has no placeable gfx record yields an EMPTY `gfxIndices` — faithful data (some store lanes are
 * pure-logic "dropped good" markers), surfaced at build time rather than silently dropped.
 */
export function buildGatheringPipeline(
  goods: readonly GoodType[],
  landscapeGfx: readonly LandscapeGfx[],
): GatheringPipeline[] {
  // logicType -> the gfx records (by positional index, ascending) that place it, built once.
  const gfxByLogicType = new Map<number, number[]>();
  for (const g of landscapeGfx) {
    const list = gfxByLogicType.get(g.logicType);
    if (list) list.push(g.index);
    else gfxByLogicType.set(g.logicType, [g.index]);
  }
  const stage = (
    landscapeType: number | undefined,
  ): { landscapeType: number; gfxIndices: number[] } | undefined =>
    landscapeType === undefined
      ? undefined
      : { landscapeType, gfxIndices: gfxByLogicType.get(landscapeType) ?? [] };
  const pipeline: GatheringPipeline[] = [];
  for (const good of goods) {
    if (good.gathering === undefined) continue;
    const harvest = stage(good.gathering.harvest);
    const pickup = stage(good.gathering.pickup);
    const store = stage(good.gathering.store);
    pipeline.push(
      GatheringPipeline.parse({
        goodType: good.typeId,
        goodId: good.id,
        harvestAtomic: good.atomics.harvest,
        bioLandscape: good.gathering.bioLandscape,
        ...(harvest ? { harvest } : {}),
        ...(pickup ? { pickup } : {}),
        ...(store ? { store } : {}),
      }),
    );
  }
  return pipeline;
}

/**
 * One building graphics binding: a {@link BmdPaletteBinding} (`.bmd` body + shadow + palette editname)
 * plus the record's `EditName`. The same shape as {@link LandscapeGraphicsBinding} — a building is just
 * the `[GfxHouse]` analog of the `[GfxLandscape]` static-decor binding — so it flows through the exact
 * same {@link import('../stages/bmd.js').convertBmdTree} `(bmd, palette)` atlas path with no second copy
 * of the conversion logic. The name is provenance + a building handle (`"viking stock"` vs `"viking
 * home"`) so a render binding can pick a house by it without re-reading the `.ini`.
 */
export interface BuildingGraphicsBinding extends BmdPaletteBinding {
  /** The record's `EditName` (e.g. `"viking stock"`), or undefined when the record omits it. */
  readonly editName: string | undefined;
}

/**
 * Extracts the `[GfxHouse]` records from the mod's readable `DataCnmd/budynki12/houses/houses.ini` (the
 * graphics twin of the logic `houses.ini`; golden rule #4) — the **building** graphics binding: every
 * settlement house (homes, wells, stocks/warehouses, workshops, walls, …) bound to its bob set + palette,
 * the exact `[GfxHouse]` analog of {@link extractLandscapeGraphics}'s `[GfxLandscape]` static decor. This
 * is the leg that makes the `ls_houses_*.bmd` sets (viking/frank/egypt/saracen/byzantine/beduine) become
 * atlases — without it a house `.bmd` is unpacked but never coloured, so a building drew a placeholder box
 * (the gap that left the warehouse with no sprite). Each record names a body + shadow bob set
 * (`GfxBobLibs "<body>.bmd" "<shadow>.bmd"`) and one-or-more palette editnames.
 *
 * Unlike a landscape record (one `GfxPalette`), a house record commonly carries **several** palette
 * values on one `GfxPalette` line — `GfxPalette "house01" "house02"` recolours the same `ls_houses_viking`
 * body into the home (`house01`) and the stock/warehouse (`house02`) skins. Each value is emitted as its
 * own `(bmd, palette)` binding so *every* recolour becomes an atlas (the warehouse needs `house02`); the
 * caller dedups identical `(bmd, palette)` pairs (the ~25 viking-home records repeat one bob+palette pair).
 *
 * The keys are CamelCase like `[GfxLandscape]` (`GfxBobLibs`/`GfxPalette`/`EditName`). A record without a
 * body bob or without any palette is skipped, never thrown — this indexes hundreds of records and one
 * malformed entry must not abort the offline batch. `tribeId`/`jobId` are left undefined: an atlas keys on
 * `(bmd, palette)` only, so the per-tribe `LogicTribeType` cross-ref does not affect the emitted bytes
 * (the render-side per-building-type bob selection is a later, separate leg — see docs/plans/).
 */
export function extractBuildingGraphics(sections: readonly RuleSection[]): BuildingGraphicsBinding[] {
  const bindings: BuildingGraphicsBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    const libs = findProp(sec, 'GfxBobLibs');
    const bmd = libs?.values[0];
    if (bmd === undefined || bmd.trim() === '') continue;
    const paletteValues = (findProp(sec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
    if (paletteValues.length === 0) continue;
    const shadow = libs?.values[1];
    const editName = getStr(sec, 'EditName');
    for (const paletteName of paletteValues) {
      bindings.push({
        bmd: normalizeAssetPath(bmd),
        shadowBmd: shadow !== undefined && shadow.trim() !== '' ? normalizeAssetPath(shadow) : undefined,
        paletteName: normalizePaletteName(paletteName),
        tribeId: undefined,
        jobId: undefined,
        editName,
      });
    }
  }
  return bindings;
}

/**
 * Splits one `[GfxHouse]` section into its constituent house records. The mod packs SEVERAL houses
 * under a SINGLE `[GfxHouse]` bracket — five blocks lump 4..24 houses (the saracen + egypt families) —
 * each sub-house delimited only by a fresh `EditName` line, NOT a new bracket. `parseIniSections` opens
 * a section only on a `[...]` header, so it lumps the block into one {@link RuleSection}; without this
 * split the first sub-house's `GfxBobLibs`/`GfxPalette` would be stapled to last-wins `LogicType`/
 * `GfxBobId` across the whole block (dropping/mis-joining 63 of the 234 building types). Walking the
 * props in file order and starting a new record at each `EditName` recovers each house with its OWN
 * `GfxBobLibs`/`GfxPalette`/`LogicTribeType`/`LogicType`/`GfxBobId` block. Props before the first
 * `EditName` (none in the real file) are ignored; a single-house section yields one record.
 *
 * NOTE: {@link extractConstructionCosts} and {@link extractBuildingGraphics} read the same sections
 * with the SAME pre-existing lumping bug (so saracen/egypt costs + atlases are likewise incomplete) —
 * a flagged follow-up (source basis); this helper exists to be reused when that lands.
 */
function splitGfxHouseRecords(sec: RuleSection): RuleSection[] {
  const records: RuleSection[] = [];
  let props: RuleProp[] | undefined;
  for (const p of sec.props) {
    if (p.key === 'EditName') {
      props = [p];
      records.push({ name: sec.name, props });
    } else if (props !== undefined) {
      props.push(p);
    }
  }
  return records;
}

/**
 * Extracts the `[GfxHouse]` **building-type → house-bob** join from the mod's readable
 * `DataCnmd/budynki12/houses/houses.ini` — the data-pinned twin of the renderer's hand-transcribed
 * per-type table (`real-sprites.ts` `VIKING_HOUSE01_BOBS`). {@link extractBuildingGraphics} reads the
 * SAME records but keeps only `(bmd, palette)` to emit each recolour atlas; this leg keeps the
 * `(typeId → bobId)` mapping those atlases are indexed by, so the render can draw each building its own
 * house bob from data instead of a transcribed constant (AGENTS.md "content is data, not code").
 *
 * Each house record (recovered by {@link splitGfxHouseRecords} — a `[GfxHouse]` bracket can hold many)
 * pairs two per-level tables by their leading **level index** — exactly the `sizeIdx` pairing
 * {@link extractConstructionCosts} uses for `LogicConstructionGoods`:
 *   - `LogicType <level> <typeId>` — the building `typeId` at that growth level (a home spans levels
 *     0..4 → five distinct typeIds), and
 *   - `GfxBobId <level> <bobId>` — the atlas bob id for that level.
 * For each level present in BOTH tables we emit one {@link BuildingBob} per palette skin
 * (`GfxPalette "house01" "house02"` → two rows, the same bob in each recolour). The body `.bmd` is
 * `GfxBobLibs[0]`; `LogicTribeType` keys the row (the same logic `typeId` recurs per civilization).
 *
 * The join is intentionally **multi-valued** on `(tribeId, typeId, paletteName)`: a logic `typeId`
 * legitimately maps to several bobs — across **build levels** (a multi-stage wonder, a home's tiers)
 * AND across **graphics variants** sharing one typeId (wall orientations "Mur h"/"Mur V", the HQ vs
 * its "headquarters house", "semiramis" vs "semiramis front"). So this is the faithful `(tribeId,
 * typeId, level, bmd, paletteName) → bobId` table, NOT a unique per-type lookup — a consumer
 * disambiguates by `level` (build progress) and/or `editName` (the variant). Only **byte-identical**
 * rows are de-duplicated (a record the mod literally duplicated, e.g. "frank ship small") — distinct
 * levels/variants are all kept.
 *
 * A record missing a body `.bmd`, any palette, or a `LogicTribeType` is skipped (so one malformed
 * entry never aborts the offline batch over hundreds of records); a level with a `LogicType` but no
 * matching `GfxBobId` (a free/placeholder stage) is omitted. The `BuildingBob.parse` schema validates
 * the ids (`nonnegative`) — the real file carries no negative id, so this does not throw in practice.
 * Returns an empty array for sources with no `[GfxHouse]` records (the logic-only tables).
 */
export function extractBuildingBobs(sections: readonly RuleSection[], src: SourceRef): BuildingBob[] {
  const bobs: BuildingBob[] = [];
  // Drop only byte-identical rows (a literally-duplicated source record); genuine level/variant rows
  // (differing level, bobId, or editName) are all kept — the join is multi-valued by design.
  const seen = new Set<string>();
  for (const sec of sections) {
    if (sec.name !== 'GfxHouse') continue;
    for (const rec of splitGfxHouseRecords(sec)) {
      const tribeId = getInt(rec, 'LogicTribeType');
      if (tribeId === undefined) continue;
      const bmd = findProp(rec, 'GfxBobLibs')?.values[0];
      if (bmd === undefined || bmd.trim() === '') continue;
      const palettes = (findProp(rec, 'GfxPalette')?.values ?? []).filter((v) => v.trim() !== '');
      if (palettes.length === 0) continue;
      const editName = getStr(rec, 'EditName');
      // Pair the two per-level tables by their leading level index (the same join
      // `extractConstructionCosts` does for cost lines). A typeId may recur at several levels; each
      // level keeps its own bob.
      const typeByLevel = logicTypeByLevel(rec);
      const bobByLevel = new Map<number, number>();
      for (const p of findProps(rec, 'GfxBobId')) {
        const level = Number.parseInt(p.values[0] ?? '', 10);
        const bobId = Number.parseInt(p.values[1] ?? '', 10);
        if (Number.isNaN(level) || Number.isNaN(bobId)) continue;
        bobByLevel.set(level, bobId);
      }
      const normalizedBmd = normalizeAssetPath(bmd);
      for (const [level, typeId] of typeByLevel) {
        const bobId = bobByLevel.get(level);
        if (bobId === undefined) continue;
        for (const paletteName of palettes) {
          const pal = normalizePaletteName(paletteName);
          const key = `${tribeId}|${typeId}|${level}|${normalizedBmd}|${pal}|${bobId}|${editName ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bobs.push(
            BuildingBob.parse({
              tribeId,
              typeId,
              level,
              bmd: normalizedBmd,
              paletteName: pal,
              bobId,
              editName,
              source: { file: src.file, block: 'GfxHouse', layer: src.layer ?? 'base' },
            }),
          );
        }
      }
    }
  }
  return bobs;
}

/**
 * Extracts the `[bobseq]` records from `animations.ini` (the mod's
 * `animation/mapmoveableanimations/animations.ini`) into one {@link BobSequenceSet} per bob set — the
 * named animation ranges (`seq "<name>" <start> <length>`) the renderer previously hard-coded as magic
 * frame constants (`WALK` start 1988, `CHOP` 5106, …). Each record names its `imagelib` `.bmd` (the bob
 * set the ids index into) plus an optional `shadowlib`, and lists every sequence as a `seq` line whose
 * three values are the quoted name, the first bob id, and the total frame count across all directions.
 *
 * The render builds a directional cycle from each: `start` + `length` (with `dirs` = 8 for these
 * sprites, so the per-direction stride is `length / dirs`). The same sequence name recurs across several
 * bob sets that share a layout (`human_man_generic_walk` is 1988/96 in `CR_Hum_Body_00`, `_05`, `_10`,
 * …); each set is emitted independently so a consumer resolves by `(imagelib, name)`. `imagelib`/
 * `shadowlib` are normalized (lower-cased; they are bare `.bmd` filenames) to join case-insensitively
 * onto the decoded atlas stems. A record with no `imagelib` (nothing to index) or a `seq` line missing
 * its start/length (non-numeric) is skipped, never thrown — one malformed line must not abort the batch.
 */
export function extractBobSequences(sections: readonly RuleSection[], src: SourceRef): BobSequenceSet[] {
  const sets: BobSequenceSet[] = [];
  for (const sec of sections) {
    if (sec.name !== 'bobseq') continue;
    const imagelib = getStr(sec, 'imagelib');
    if (imagelib === undefined || imagelib.trim() === '') continue;
    const shadowlib = getStr(sec, 'shadowlib');
    const sequences: { name: string; start: number; length: number }[] = [];
    for (const p of findProps(sec, 'seq')) {
      const name = p.values[0];
      const start = Number.parseInt(p.values[1] ?? '', 10);
      const length = Number.parseInt(p.values[2] ?? '', 10);
      if (name === undefined || name.trim() === '' || Number.isNaN(start) || Number.isNaN(length)) continue;
      sequences.push({ name, start, length });
    }
    sets.push(
      BobSequenceSet.parse({
        imagelib: normalizeAssetPath(imagelib),
        shadowlib:
          shadowlib !== undefined && shadowlib.trim() !== '' ? normalizeAssetPath(shadowlib) : undefined,
        sequences,
        source: { file: src.file, block: 'bobseq', layer: src.layer ?? 'base' },
      }),
    );
  }
  return sets;
}

/**
 * Extracts the `[gfxanimatomic]` records from `mapmoveableanimations/animations.ini` into
 * {@link GfxAnimAtomic} rows — the atomic-action → directional body-animation binding the renderer needs
 * to play an ACTION (an attack swing, a work stroke) FACING its target. Unlike {@link extractBobSequences}
 * (which reads only the `[bobseq]` frame ranges), this reads the `gfxanimframelistdir <dir> <idx…>` lines
 * that lay an animation out per facing — the layout a bare `start`/`length` cannot encode (a melee swing
 * pool is not `length / 8` and authors per-facing holds/reuse; see {@link GfxAnimAtomic}).
 *
 * Each `gfxanimframelistdir` is placed at its leading `<dir>` slot so `dirFrames[d]` is facing `d`
 * regardless of file order; a record with a single non-directional `gfxanimframelist` yields one
 * facing-locked list. A record missing its tribe/job/action/body-seq, or carrying no frame list at all, is
 * skipped (never thrown) — one malformed record must not abort the batch. The same `(job, action)` recurs
 * per tribe, and one job/action may have SEVERAL records (the unarmed soldier's four punch variants); all
 * are emitted, and a consumer resolves by `(tribe, job, action)` or by `bodySeq` name.
 */
export function extractGfxAnimAtomics(sections: readonly RuleSection[], src: SourceRef): GfxAnimAtomic[] {
  const out: GfxAnimAtomic[] = [];
  for (const sec of sections) {
    if (sec.name !== 'gfxanimatomic') continue;
    const tribe = getInt(sec, 'logictribe');
    const job = getInt(sec, 'logicjob');
    const action = getInt(sec, 'logicatomicaction');
    const bodySeq = getStr(sec, 'gfxbobseqbody');
    if (
      tribe === undefined ||
      job === undefined ||
      action === undefined ||
      bodySeq === undefined ||
      bodySeq.trim() === ''
    ) {
      continue;
    }
    const headSeq = getStr(sec, 'gfxbobseqhead');
    // Per-direction frame lists: place each `gfxanimframelistdir <dir> <idx…>` at its `<dir>` slot so the
    // outer index is the facing. A missing intermediate dir stays an empty list (playback holds frame 0).
    const dirProps = findProps(sec, 'gfxanimframelistdir');
    let dirFrames: number[][];
    if (dirProps.length > 0) {
      const byDir = new Map<number, number[]>();
      for (const p of dirProps) {
        const dir = Number.parseInt(p.values[0] ?? '', 10);
        if (Number.isNaN(dir) || dir < 0) continue;
        const ids = p.values
          .slice(1)
          .map((v) => Number.parseInt(v, 10))
          .filter((n) => !Number.isNaN(n) && n >= 0);
        byDir.set(dir, ids);
      }
      if (byDir.size === 0) continue;
      const maxDir = Math.max(...byDir.keys());
      dirFrames = [];
      for (let d = 0; d <= maxDir; d++) dirFrames.push(byDir.get(d) ?? []);
    } else {
      // A non-directional record: one facing-locked list (`gfxanimframelist <idx…>` — no leading dir).
      const single = findProps(sec, 'gfxanimframelist')[0];
      if (single === undefined) continue;
      const ids = single.values.map((v) => Number.parseInt(v, 10)).filter((n) => !Number.isNaN(n) && n >= 0);
      dirFrames = [ids];
    }
    if (dirFrames.every((list) => list.length === 0)) continue; // nothing to draw
    out.push(
      GfxAnimAtomic.parse({
        tribe,
        job,
        action,
        bodySeq,
        ...(headSeq !== undefined && headSeq.trim() !== '' ? { headSeq } : {}),
        dirFrames,
        source: { file: src.file, block: 'gfxanimatomic', layer: src.layer ?? 'base' },
      }),
    );
  }
  return out;
}

/** One indexed bob-manager slot: a slot index + its body `.bmd` and (for body bobs) an optional shadow `.bmd`. */
export interface IndexedBobManager {
  /** The leading int slot index (`gfxbobmanagerbody 0 ...`, `gfxbobmanagerhead 3 ...`) — head bobs come in numbered variant slots (0..3). */
  readonly index: number;
  /** The bob set, as a normalized `data/.../foo.bmd` relative path (forward slashes, lower-case). */
  readonly bmd: string;
  /** The matching shadow bob set (body bobs only), same normalization, or `undefined` when absent (head bobs never carry one). */
  readonly shadowBmd: string | undefined;
}

/**
 * One human's full graphics binding from a mod `[jobbasegraphics]` record — the **richer variant** of
 * {@link BmdPaletteBinding} (docs/plans/Phase 1). Unlike the flat `[jobgraphics]` schema (one body
 * `.bmd` + one palette), a human draws as a **body** bob plus zero-or-more numbered **head** bobs, each
 * a `gfxbobmanagerbody/head <index> "<bmd>" ["<shadow>"]` line whose leading int index shifts the `.bmd`
 * path off `values[0]` (so it cannot reuse {@link extractGraphicsBindings}). Palettes split three ways:
 * `gfxpalettebasebody`/`gfxpalettebasehead` colour the two bob sets, and `gfxpaletterandom` is the
 * per-settler random tint range. Each palette name lower-cases ({@link normalizePaletteName}) to join
 * case-insensitively onto {@link PaletteAlias.name}.
 */
export interface JobBaseGraphicsBinding {
  /** The `logictribe` id the record applies to, when present (a cross-reference, not required). */
  readonly tribeId: number | undefined;
  /** The `logicjob` id the record applies to, when present (a cross-reference, not required). */
  readonly jobId: number | undefined;
  /** The body bob slots (`gfxbobmanagerbody`), in file order — at least one (a record with none is skipped). */
  readonly body: readonly IndexedBobManager[];
  /** The head bob slots (`gfxbobmanagerhead`), in file order — may be empty (some creatures are body-only). */
  readonly head: readonly IndexedBobManager[];
  /** The body palette `editname`, lower-cased, or `undefined` when the record omits `gfxpalettebasebody`. */
  readonly bodyPalette: string | undefined;
  /** The head palette `editname`, lower-cased, or `undefined` when the record omits `gfxpalettebasehead`. */
  readonly headPalette: string | undefined;
  /** The random-tint palette `editname`, lower-cased, or `undefined` when the record omits `gfxpaletterandom`. */
  readonly randomPalette: string | undefined;
}

/**
 * Parses an indexed bob-manager line (`gfxbobmanagerbody 0 "<bmd>" ["<shadow>"]`) into an
 * {@link IndexedBobManager}, or `undefined` if it has no `.bmd` path. The leading token is the slot
 * index; the second is the body `.bmd`; the optional third (body lines only) is the shadow `.bmd`.
 * A non-numeric/absent index falls back to 0 so a slightly malformed slot still binds its `.bmd`.
 */
function parseIndexedBobManager(prop: RuleProp): IndexedBobManager | undefined {
  const index = Number.parseInt(prop.values[0] ?? '', 10);
  const bmd = prop.values[1];
  if (bmd === undefined || bmd.trim() === '') return undefined;
  const shadow = prop.values[2];
  return {
    index: Number.isNaN(index) ? 0 : index,
    bmd: normalizeAssetPath(bmd),
    shadowBmd: shadow !== undefined && shadow.trim() !== '' ? normalizeAssetPath(shadow) : undefined,
  };
}

/** First value of the first matching property as a lower-cased palette `editname`, or `undefined` if absent/empty. */
function getPaletteName(sec: RuleSection, key: string): string | undefined {
  const name = getStr(sec, key);
  return name !== undefined && name.trim() !== '' ? normalizePaletteName(name) : undefined;
}

/**
 * Reduces every section named `sectionName` to a {@link JobBaseGraphicsBinding}. The
 * `[jobbasegraphics]` (base appearance) and `[jobchangegraphics]` (equipment/job skin) records share
 * the **same grammar** — indexed `gfxbobmanagerbody/head` bob slots (the `.bmd` path on `values[1]`,
 * the leading int slot index on `values[0]`) + the three optional palette keys (`gfxpalettebasebody`/
 * `gfxpalettebasehead`/`gfxpaletterandom`, lower-cased to join onto {@link extractPaletteIndex}
 * case-insensitively) — differing only in their section name and intent, so both public extractors
 * delegate here. A record with no usable body bob is skipped (nothing to colour) rather than throwing —
 * an index over many records must not abort the offline batch on one malformed entry, matching
 * {@link extractGraphicsBindings}. Head bobs and every palette are optional and simply omitted when
 * absent; the consumer resolves whichever palettes are present against the unpacked `--out` tree.
 */
function extractIndexedGraphics(
  sections: readonly RuleSection[],
  sectionName: string,
): JobBaseGraphicsBinding[] {
  const bindings: JobBaseGraphicsBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== sectionName) continue;
    const body: IndexedBobManager[] = [];
    for (const p of findProps(sec, 'gfxbobmanagerbody')) {
      const slot = parseIndexedBobManager(p);
      if (slot !== undefined) body.push(slot);
    }
    if (body.length === 0) continue;
    const head: IndexedBobManager[] = [];
    for (const p of findProps(sec, 'gfxbobmanagerhead')) {
      const slot = parseIndexedBobManager(p);
      if (slot !== undefined) head.push(slot);
    }
    bindings.push({
      tribeId: getInt(sec, 'logictribe'),
      jobId: getInt(sec, 'logicjob'),
      body,
      head,
      bodyPalette: getPaletteName(sec, 'gfxpalettebasebody'),
      headPalette: getPaletteName(sec, 'gfxpalettebasehead'),
      randomPalette: getPaletteName(sec, 'gfxpaletterandom'),
    });
  }
  return bindings;
}

/**
 * Extracts the `[jobbasegraphics]` records (the **base appearance** layer) from the mod's richer human
 * skin (`DataCnmd/types/humanstype/jobgraphics.ini`) or the base game's `humans/jobgraphics.cif` — the
 * second binding skin alongside the flat {@link extractGraphicsBindings} `[jobgraphics]` one. See
 * {@link extractIndexedGraphics} for the shared grammar; {@link extractJobChangeGraphics} is its
 * equipment-skin sibling.
 */
export function extractJobBaseGraphics(sections: readonly RuleSection[]): JobBaseGraphicsBinding[] {
  return extractIndexedGraphics(sections, 'jobbasegraphics');
}

/**
 * Extracts the `[jobchangegraphics]` records (the **equipment/job skin** layer) — the sibling of
 * {@link extractJobBaseGraphics}'s `[jobbasegraphics]` base-appearance layer. Both legs ship in the same
 * files: the base game's `Data/engine2d/inis/humans/jobgraphics.cif` and, preferred per golden rule #4,
 * the mod's `DataCnmd/types/humanstype/jobgraphics.ini`. A `[jobchangegraphics]` record reskins a human
 * for a specific `(logictribe, logicjob)` — e.g. swapping in a job's head/equipment bob set over the
 * shared body geometry — using the **identical grammar** as `[jobbasegraphics]` (indexed
 * `gfxbobmanagerbody/head` slots + `gfxpalettebasebody`/`gfxpalettebasehead`/`gfxpaletterandom`), so it
 * yields the same {@link JobBaseGraphicsBinding} shape and flattens via the same
 * `jobBaseGraphicsToBindings` path. A record with no usable body bob is skipped, matching the base leg.
 */
export function extractJobChangeGraphics(sections: readonly RuleSection[]): JobBaseGraphicsBinding[] {
  return extractIndexedGraphics(sections, 'jobchangegraphics');
}

/** The Cultures sounds root every `SFX` path resolves under, forward-slashed + lower-cased. */
const SOUNDS_ROOT = 'data/engine2d/bin/sounds/';

/**
 * Normalizes a `SFX` wav path (`Data\Engine2D\Bin\Sounds\Gui\Click_Confirm.wav`) to the key the audio
 * layer fetches — forward-slashed, lower-cased, and made **relative to** {@link SOUNDS_ROOT} so it
 * joins straight onto the served `/sounds/<file>` route (`gui/click_confirm.wav`). A path that does
 * not sit under the sounds root is kept as-is (lower-cased) rather than dropped.
 */
function normalizeSoundPath(path: string): string {
  const p = path.replace(/\\/g, '/').toLowerCase();
  const at = p.indexOf(SOUNDS_ROOT);
  return at >= 0 ? p.slice(at + SOUNDS_ROOT.length) : p;
}

/**
 * `soundfx.cif` disagrees with itself on key/section case (`SFX`/`sfx`, `Name`/`name`,
 * `PatternGroup`/`patternGroup`, `SoundFXAmbient`/`SoundFxAmbient`), and the original engine reads it
 * case-insensitively — so the sound extractor matches on lower-cased keys throughout, unlike the
 * CamelCase-stable graphics tables above.
 */
function soundProps(sec: RuleSection, key: string): RuleProp[] {
  const k = key.toLowerCase();
  return sec.props.filter((p) => p.key.toLowerCase() === k);
}

/** First value of the first case-insensitively-matching property, or undefined. */
function soundStr(sec: RuleSection, key: string): string | undefined {
  return soundProps(sec, key)[0]?.values[0];
}

/** First value parsed as a base-10 int (undefined if absent/NaN), case-insensitive key. */
function soundInt(sec: RuleSection, key: string): number | undefined {
  const v = soundStr(sec, key);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** Every `SFX "<path>" <n…>` line of a group → `{ file, params }`, in file order (empty paths dropped). */
function soundSfx(sec: RuleSection): { file: string; params: number[] }[] {
  return soundProps(sec, 'SFX')
    .map((p) => {
      const [file, ...rest] = p.values;
      return {
        file: normalizeSoundPath(file ?? ''),
        params: rest.map((v) => Number.parseInt(v, 10)).filter((n) => !Number.isNaN(n)),
      };
    })
    .filter((s) => s.file !== '');
}

/** Lower-cased first value of every case-insensitively-matching property (group name lists). */
function soundGroupNames(sec: RuleSection, key: string): string[] {
  return soundProps(sec, key)
    .map((p) => p.values[0])
    .filter((v): v is string => v !== undefined && v.trim() !== '')
    .map((v) => v.toLowerCase());
}

/**
 * Extracts the decoded `soundfx.cif` sections into the {@link SoundBank} IR: `SoundFXStatic` groups
 * (named wav bags, some bound to a `LogicSoundType` engine trigger), `SoundFXAmbient` terrain beds
 * (keyed on `PatternGroup`/`LandscapeGroup`), and `SoundFXJingle` life-event stingers (`MusicType`).
 * Sections it does not recognise contribute nothing. This is render-binding data the pure sim ignores;
 * the browser audio layer joins it onto sim events + on-screen terrain. Case-insensitive throughout
 * (see {@link soundProps}). Sound wav paths are made relative to the served sounds root
 * ({@link normalizeSoundPath}).
 */
export function extractSounds(sections: readonly RuleSection[]): SoundBank {
  const staticGroups: SoundStaticGroup[] = [];
  const ambient: SoundAmbient[] = [];
  const jingles: SoundJingle[] = [];
  for (const sec of sections) {
    switch (sec.name.toLowerCase()) {
      case 'soundfxstatic':
        staticGroups.push(
          SoundStaticGroup.parse({
            name: soundStr(sec, 'Name') ?? '',
            logicSoundType: soundInt(sec, 'LogicSoundType'),
            sfx: soundSfx(sec),
          }),
        );
        break;
      case 'soundfxambient':
        ambient.push(
          SoundAmbient.parse({
            name: soundStr(sec, 'Name') ?? '',
            patternGroups: soundGroupNames(sec, 'PatternGroup'),
            landscapeGroups: soundGroupNames(sec, 'LandscapeGroup'),
            sfx: soundSfx(sec),
          }),
        );
        break;
      case 'soundfxjingle':
        jingles.push(
          SoundJingle.parse({
            name: soundStr(sec, 'Name') ?? '',
            musicType: soundInt(sec, 'MusicType'),
            sfx: soundSfx(sec),
          }),
        );
        break;
    }
  }
  return SoundBank.parse({ staticGroups, ambient, jingles });
}
