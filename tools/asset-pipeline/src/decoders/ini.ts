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
  AtomicAnimation,
  BuildingType,
  type GoodAtomics,
  type GoodClassification,
  GoodType,
  HumanJobExperienceType,
  type JobEnables,
  type JobEnablesKind,
  type JobRequirement,
  type JobRequirementKind,
  type JobRequirementTarget,
  JobType,
  LandscapeType,
  MapInfo,
  TribeType,
  VehicleType,
  WeaponType,
} from '@vinland/data';
import type { CifLine } from './cif.js';

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
    goods.push(
      GoodType.parse({
        typeId,
        id: name ? slug(name) : `good_${typeId}`,
        name,
        atomics: extractGoodAtomics(sec),
        productionInputs: extractProductionInputs(sec),
        classification: extractGoodClassification(sec),
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
 * Extracts `[landscapetype]` sections into validated {@link LandscapeType} IR. Captures the inputs the
 * Phase-2 cell-adjacency graph needs: `maximumValency` (per-cell capacity → `maxValency`) and the
 * `allowedonland`/`allowedonwater`/`allowedoneverything` placement-layer flags (`1`/`0` ints). These
 * are the cell-graph's per-type valency + placement source, NOT a render-triangle property. There is
 * NO per-type movement-cost/weight field in this table — the engine gates movement by walkability +
 * valency, so the graph uses a uniform unit walk cost (see packages/sim/src/terrain.ts). `walkable`/
 * `buildable` keep their schema defaults — they're a later derivation (not cleanly from these flags,
 * which mark placement layer, not traversal). The `transition`/`debugcolor` lines (map-generation +
 * editor concerns) are skipped. See docs/ROADMAP.md Phase 2.
 */
export function extractLandscape(sections: readonly RuleSection[], src: SourceRef): LandscapeType[] {
  const landscape: LandscapeType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'landscapetype') continue;
    const typeId = requireTypeId(sec, 'landscapetype', src);
    const name = getStr(sec, 'name');
    landscape.push(
      LandscapeType.parse({
        typeId,
        id: name ? slug(name) : `landscape_${typeId}`,
        maxValency: getInt(sec, 'maximumValency') ?? 0,
        allowedOnLand: getInt(sec, 'allowedonland') === 1,
        allowedOnWater: getInt(sec, 'allowedonwater') === 1,
        allowedOnEverything: getInt(sec, 'allowedoneverything') === 1,
        source: { file: src.file, block: 'landscapetype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return landscape;
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
 * so this prefers that `.ini` per CLAUDE.md golden rule #4.
 *
 * Each `damagevalue <armorClass> <value>` line becomes one entry in the role-keyed `damage` record
 * (the armor class is the string key, matching the schema's `record<string,number>` shape and the
 * original `damageValue[targetArmorClass]` indexing). `minimumrange`/`maximumrange` map to
 * `minRange`/`maxRange`; `jobtype` is the wielding job (cross-checked against the job table by
 * `validateCrossReferences`). `tribetype` is captured because a weapon's `type` id is **not**
 * globally unique — the original keys a weapon by `(tribetype, type)`, so the same id recurs once
 * per tribe (e.g. `type 2` = "fist" for every tribe); see {@link WeaponType}. The combat extras
 * (`soundtype_*`, `munitiontype`,
 * `createsmoke`, `damagetype`) are not in the {@link WeaponType} schema yet and are intentionally
 * skipped here — they belong with the Phase-4 CombatSystem, not this type-table slice. Throws on a
 * section missing the required numeric `type` (matches {@link extractGoods}'s throw-on-malformed stance).
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
    weapons.push(
      WeaponType.parse({
        typeId,
        id: name ? slug(name) : `weapon_${typeId}`,
        name,
        tribeType: getInt(sec, 'tribetype'),
        minRange: getInt(sec, 'minimumrange'),
        maxRange: getInt(sec, 'maximumrange'),
        damage,
        jobType: getInt(sec, 'jobtype'),
        source: { file: src.file, block: 'weapontype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return weapons;
}

/**
 * Extracts `[vehicletype]` sections (base `Data/logic/vehicletypes.ini` — the mod ships no readable
 * twin, and the file is plain `.ini` like `goodtypes`/`landscapetypes`) into validated
 * {@link VehicleType} IR. The carry capacity is `stockslots` (the param the later multi-good carrier
 * slice consumes); `passengerslots` and `logicsize` round out the type record. The per-vehicle
 * `logicgood`/`logicpassenger` allow-lists, vector/slot graphics (`stockvector`/`vehicleslots`), the
 * draft-animal (`logicdragginganimaltribe`) and `debug*` extras are intentionally skipped — they
 * belong with the later vehicle/transport + graphics slices, not this type-table extract. Throws on a
 * section missing the required numeric `type` (matches {@link extractWeapons}'s throw-on-malformed
 * stance).
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
        source: { file: src.file, block: 'vehicletype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return vehicles;
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
 * the base game's encrypted `housetypes.cif` per CLAUDE.md golden rule #4) into validated
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
 * APPROXIMATED on two axes, both recorded in docs/FIDELITY.md: (a) production length **varies per
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
 *     APPROXIMATED (recorded in docs/FIDELITY.md): the source length varies per tribe and per output;
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
 * campaign layer, not this metadata slice (see {@link MapInfo} and docs/ROADMAP.md). `id` is supplied by
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
 * (docs/ROADMAP.md Phase 1): a graphics record names a bob set's palette by `editname`
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
 * (docs/ROADMAP.md Phase 1). The first leg ({@link extractPaletteIndex}) resolves `paletteName` to a
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
 * {@link BmdPaletteBinding} (docs/ROADMAP.md Phase 1). Unlike the flat `[jobgraphics]` schema (one body
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
