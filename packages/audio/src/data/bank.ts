import type {
  AnimalCall,
  GfxPattern,
  HumanVoices,
  SoundBank,
  SoundSfx,
  TerrainPattern,
  VoiceClass,
} from '@open-northland/data';

/**
 * The lookup-shaped view of a decoded {@link SoundBank} the director reads each frame, built once at
 * load ({@link buildSoundIndex}) so the per-frame decision does only `Map` gets. Folds in the
 * terrain→ambient join (`typeId → bed names`) the raw bank can't express.
 */
export interface SoundIndex {
  /** Lower-cased static-group name → its interchangeable wav files (the arbiter picks one per play). */
  readonly groupsByName: ReadonlyMap<string, readonly string[]>;
  /** A static group's `logicSoundType` id → its wav files - the id space animation events reference
   *  (`event <frame> 34 <id>`; the sim's `atomicSound` carries it as `soundType`). First-listed group
   *  wins a duplicated id (one known collision: 44, tribe variants of the generic female voice). */
  readonly groupsByLogicSoundType: ReadonlyMap<number, readonly string[]>;
  /** `MusicType` → the jingle's wav file(s). */
  readonly jinglesByMusicType: ReadonlyMap<number, readonly string[]>;
  /** Ambient bed name → the wav it loops (the bed's first `SFX`). */
  readonly ambientLoopByName: ReadonlyMap<string, string>;
  /** Landscape `typeId` → the ambient bed names its on-screen tiles activate. */
  readonly ambientByTerrainType: ReadonlyMap<number, readonly string[]>;
  /** Landscape `typeId` → its representative pattern's `trianglepatterntypes` logic type, the column a
   *  weapon's `soundtype_NoHit` thud table is keyed by. Coarse like the ambient join: `terrainPatterns`
   *  classes each typeId as water, land or mountain, so the finer ground columns never come up. */
  readonly groundLogicTypeByTerrainType: ReadonlyMap<number, number>;
  /** Settler tribe → voice class → the groups that tribe's settlers of that class speak with; a
   *  voiceless tribe in {@link BORROWED_TRIBE_VOICES} shares its lender's rows. */
  readonly humanVoices: ReadonlyMap<number, ReadonlyMap<VoiceClass, HumanVoices>>;
  /** Job ids whose authored slug identifies a hero; heroes always use response pool zero. */
  readonly heroJobs: ReadonlySet<number>;
  /** Animal tribe → its unprompted call and the roll that gates it. */
  readonly animalCalls: ReadonlyMap<number, AnimalCall>;
  /** A `[GfxLandscape]` record index → the object ambience its placed objects sound (birds in a tree). */
  readonly landscapeAmbienceByRecord: ReadonlyMap<number, LandscapeAmbience>;
  /** A static group's, jingle's or landscape pool's file list (the very array the maps above hold) →
   *  the gain of its authored volume ({@link authoredVolumeGain}). */
  readonly poolGains: ReadonlyMap<readonly string[], number>;
}

/** The wavs of one object ambience that share an `SFX` triple, so a pick among them is uniform. */
export interface LandscapeSoundPool {
  readonly files: readonly string[];
  /** The summed pick weight of its wavs. */
  readonly weight: number;
  /** The per-object, per-tick chance in {@link import('./director/object-ambience.js').LANDSCAPE_CHANCE_RANGE}. */
  readonly chance: number;
}

/** One `SoundFXAmbient` group keyed by landscape groups: its one-shots in pools of equal triples. */
export interface LandscapeAmbience {
  readonly name: string;
  readonly pools: readonly LandscapeSoundPool[];
  /** The pools' summed weight, the range a pick rolls in. */
  readonly weight: number;
}

/** A `[GfxLandscape]` record as the object ambience join reads it. */
export interface LandscapeRecord {
  readonly index: number;
  readonly editGroups?: readonly string[];
}

/** Where a landscape ambience's `SFX` line keeps its pick weight, volume and per-object chance, in
 *  file order. Verified against the shipped data: every line authors weight 10, a volume of 30 to 100
 *  and a chance of 1 to 10, while a pattern bed's line is `0 0 0`. */
const LANDSCAPE_WEIGHT_PARAM = 0;
const LANDSCAPE_VOLUME_PARAM = 1;
const LANDSCAPE_CHANCE_PARAM = 2;

/** The top of the data's per-wav volume scale, which plays at full gain. */
export const AUTHORED_VOLUME_MAX = 100;
/** The dB span the authored 0-100 volume covers, linear in dB: 100 plays at 0 dB, 50 at -10 dB. The
 *  original's scale, unconfirmed in play. */
export const AUTHORED_VOLUME_RANGE_DB = 20;
/** The volume of a group that authors none (a custom bank's): the data's majority, which most work
 *  sounds, answers and jingles carry. */
export const DEFAULT_AUTHORED_VOLUME = 80;
/** Where a static group's or jingle's `SFX` line keeps its volume among the trailing integers. */
const VOLUME_PARAM = 0;

/** An authored 0-100 volume as linear gain over {@link AUTHORED_VOLUME_RANGE_DB}; 0 or below is
 *  silent, as the original skips a play of volume 0. */
export function authoredVolumeGain(volume: number): number {
  if (!(volume > 0)) return 0;
  const v = Math.min(volume, AUTHORED_VOLUME_MAX);
  return 10 ** (((v / AUTHORED_VOLUME_MAX - 1) * AUTHORED_VOLUME_RANGE_DB) / 20);
}

/** The gain a pool's authored volume plays at; a list the index did not build gets the default's. */
export function poolGain(index: SoundIndex, files: readonly string[]): number {
  return index.poolGains.get(files) ?? authoredVolumeGain(DEFAULT_AUTHORED_VOLUME);
}

/**
 * A group's authored volume. Approximation: the original sets the volume per wav, and a group whose
 * wavs differ (a few unbound murmur pools mixing 40 laughs with 80 lines) plays all at its loudest.
 */
function groupVolume(sfx: readonly SoundSfx[]): number {
  let volume: number | undefined;
  for (const s of sfx) {
    const v = s.params[VOLUME_PARAM];
    if (s.file !== SILENT_PLACEHOLDER_FILE && v !== undefined) volume = Math.max(volume ?? v, v);
  }
  return volume ?? DEFAULT_AUTHORED_VOLUME;
}

/**
 * The data's placeholder for a silent slot. Its decoded wav is a copy of the GUI confirm click, so a
 * slot naming it is dropped from its group instead of ringing a click in the world.
 */
export const SILENT_PLACEHOLDER_FILE = 'static/dummy.wav';

/**
 * A group's playable wav files: every slot except the {@link SILENT_PLACEHOLDER_FILE}. A group of only
 * placeholders stays silent. Approximation: a group mixing both plays a real file every time, where the
 * data's placeholder slots would have kept it silent part of the time.
 */
function audibleFiles(sfx: readonly SoundSfx[]): readonly string[] {
  return sfx.map((s) => s.file).filter((file) => file !== SILENT_PLACEHOLDER_FILE);
}

/**
 * Tribe slug -> the tribe whose voice rows it speaks with when the data gives it none. Authored
 * approximation: the mod's Egypt ships without voices, so it borrows the Saracens' Arabic pools.
 */
export const BORROWED_TRIBE_VOICES: ReadonlyMap<string, string> = new Map([['egypt', 'saracen']]);

/** The authored ids a content row joins by: a job's or a tribe's `typeId` and slug. */
export interface AuthoredId {
  readonly typeId?: number;
  readonly id?: string;
}

/**
 * The wav files of a static group by its (case-insensitive) name, or `undefined` when the group is
 * absent or empty. The one home for the lower-cased-key `groupsByName` lookup its callers share.
 */
export function groupFiles(index: SoundIndex, group: string): readonly string[] | undefined {
  const files = index.groupsByName.get(group.toLowerCase());
  return files && files.length > 0 ? files : undefined;
}

function pushInto(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/**
 * Assemble the {@link SoundIndex} from the sound bank and terrain-pattern tables. `gfxPatterns`/
 * `terrainPatterns` feed only the terrain→ambient join; empty arrays yield a working index with no
 * terrain ambient.
 *
 * The join is coarse (named approximation): `terrainPatterns` already approximates each `typeId` to
 * one representative pattern, so a `typeId` inherits only that pattern's groups (the original keys
 * ambient off pattern groups; pinned to the data we have).
 */
export function buildSoundIndex(
  sounds: SoundBank,
  gfxPatterns: readonly GfxPattern[],
  terrainPatterns: readonly TerrainPattern[],
  jobs: readonly AuthoredId[] = [],
  tribes: readonly AuthoredId[] = [],
  landscapeRecords: readonly LandscapeRecord[] = [],
): SoundIndex {
  const groupsByName = new Map<string, readonly string[]>();
  const groupsByLogicSoundType = new Map<number, readonly string[]>();
  const poolGains = new Map<readonly string[], number>();
  for (const g of sounds.staticGroups) {
    if (g.name.trim() === '') continue;
    const files = audibleFiles(g.sfx);
    poolGains.set(files, authoredVolumeGain(groupVolume(g.sfx)));
    groupsByName.set(g.name.toLowerCase(), files);
    if (g.logicSoundType !== undefined && !groupsByLogicSoundType.has(g.logicSoundType)) {
      groupsByLogicSoundType.set(g.logicSoundType, files);
    }
  }

  const jinglesByMusicType = new Map<number, readonly string[]>();
  for (const j of sounds.jingles) {
    if (j.musicType === undefined) continue;
    const files = audibleFiles(j.sfx);
    poolGains.set(files, authoredVolumeGain(groupVolume(j.sfx)));
    jinglesByMusicType.set(j.musicType, files);
  }

  // Ambient bed name → its loop wav, plus pattern-group name → bed names (the join's middle table). A
  // pattern bed authors `0 0 0` (weight, volume, chance): its level is its screen coverage, not a
  // volume. The landscape groups' triples belong to the object ambience ({@link landscapeAmbience}).
  const ambientLoopByName = new Map<string, string>();
  const bedsByPatternGroup = new Map<string, string[]>();
  for (const a of sounds.ambient) {
    const loop = audibleFiles(a.sfx)[0];
    if (loop === undefined) continue;
    ambientLoopByName.set(a.name, loop);
    for (const g of a.patternGroups) pushInto(bedsByPatternGroup, g, a.name);
  }

  // GfxPattern id → its (lower-cased) editGroups, so a terrainPattern's representative pattern
  // resolves to the group names that key the ambient beds.
  const groupsByPatternId = new Map<number, readonly string[]>();
  for (const p of gfxPatterns) {
    groupsByPatternId.set(
      p.id,
      p.editGroups.map((g) => g.toLowerCase()),
    );
  }

  const ambientByTerrainType = new Map<number, readonly string[]>();
  const groundLogicTypeByTerrainType = new Map<number, number>();
  for (const tp of terrainPatterns) {
    if (!groundLogicTypeByTerrainType.has(tp.typeId))
      groundLogicTypeByTerrainType.set(tp.typeId, tp.logicType);
    const groups = groupsByPatternId.get(tp.patternId) ?? [];
    const beds = new Set<string>();
    for (const g of groups) for (const bed of bedsByPatternGroup.get(g) ?? []) beds.add(bed);
    if (beds.size > 0) ambientByTerrainType.set(tp.typeId, [...beds]);
  }

  const humanVoices = new Map<number, Map<VoiceClass, HumanVoices>>();
  for (const row of sounds.humanVoices) {
    let byClass = humanVoices.get(row.tribe);
    if (byClass === undefined) {
      byClass = new Map<VoiceClass, HumanVoices>();
      humanVoices.set(row.tribe, byClass);
    }
    byClass.set(row.voiceClass, row);
  }
  lendTribeVoices(humanVoices, tribes);
  const animalCalls = new Map<number, AnimalCall>();
  for (const call of sounds.animalCalls) animalCalls.set(call.tribe, call);
  const heroJobs = new Set<number>();
  for (const job of jobs) {
    if (job.typeId !== undefined && job.id?.startsWith('hero') === true) heroJobs.add(job.typeId);
  }

  return {
    groupsByName,
    groupsByLogicSoundType,
    jinglesByMusicType,
    ambientLoopByName,
    ambientByTerrainType,
    groundLogicTypeByTerrainType,
    humanVoices,
    heroJobs,
    animalCalls,
    landscapeAmbienceByRecord: landscapeAmbience(sounds, landscapeRecords, poolGains),
    poolGains,
  };
}

/**
 * Each `[GfxLandscape]` record → the object ambience its objects sound: the first ambience in file
 * order naming one of the record's `EditGroups` (both lower-cased) among its `LandscapeGroup`s. Each
 * ambience's wavs are pooled by their exact triple, every pool's gain going into `poolGains`.
 */
function landscapeAmbience(
  sounds: SoundBank,
  records: readonly LandscapeRecord[],
  poolGains: Map<readonly string[], number>,
): Map<number, LandscapeAmbience> {
  const byGroup = new Map<string, LandscapeAmbience>();
  for (const a of sounds.ambient) {
    if (a.landscapeGroups.length === 0) continue;
    const ambience = landscapeSoundPools(a.name, a.sfx, poolGains);
    if (ambience === null) continue;
    for (const g of a.landscapeGroups) if (!byGroup.has(g)) byGroup.set(g, ambience);
  }
  const byRecord = new Map<number, LandscapeAmbience>();
  if (byGroup.size === 0) return byRecord;
  for (const r of records) {
    for (const g of r.editGroups ?? []) {
      const ambience = byGroup.get(g.toLowerCase());
      if (ambience === undefined) continue;
      byRecord.set(r.index, ambience);
      break;
    }
  }
  return byRecord;
}

/** One landscape ambience's audible wavs pooled by triple; null when no pool can be picked. */
function landscapeSoundPools(
  name: string,
  sfx: readonly SoundSfx[],
  poolGains: Map<readonly string[], number>,
): LandscapeAmbience | null {
  const byTriple = new Map<string, { files: string[]; weight: number; chance: number; volume: number }>();
  for (const s of sfx) {
    if (s.file === SILENT_PLACEHOLDER_FILE) continue;
    const weight = s.params[LANDSCAPE_WEIGHT_PARAM] ?? 0;
    const volume = s.params[LANDSCAPE_VOLUME_PARAM] ?? DEFAULT_AUTHORED_VOLUME;
    const chance = s.params[LANDSCAPE_CHANCE_PARAM] ?? 0;
    if (!(weight > 0 && chance > 0)) continue;
    const triple = `${weight} ${volume} ${chance}`;
    const pool = byTriple.get(triple);
    if (pool === undefined) byTriple.set(triple, { files: [s.file], weight, chance, volume });
    else {
      pool.files.push(s.file);
      pool.weight += weight;
    }
  }
  if (byTriple.size === 0) return null;
  const pools: LandscapeSoundPool[] = [];
  let total = 0;
  for (const { files, weight, chance, volume } of byTriple.values()) {
    poolGains.set(files, authoredVolumeGain(volume));
    pools.push({ files, weight, chance });
    total += weight;
  }
  return { name, pools, weight: total };
}

/** Give each voiceless tribe in {@link BORROWED_TRIBE_VOICES} its lender's rows, every class at once. */
function lendTribeVoices(
  humanVoices: Map<number, Map<VoiceClass, HumanVoices>>,
  tribes: readonly AuthoredId[],
): void {
  const typeIdBySlug = new Map<string, number>();
  for (const t of tribes) if (t.typeId !== undefined && t.id !== undefined) typeIdBySlug.set(t.id, t.typeId);
  for (const [borrower, lender] of BORROWED_TRIBE_VOICES) {
    const borrowerId = typeIdBySlug.get(borrower);
    const lenderId = typeIdBySlug.get(lender);
    if (borrowerId === undefined || lenderId === undefined || humanVoices.has(borrowerId)) continue;
    const rows = humanVoices.get(lenderId);
    if (rows !== undefined) humanVoices.set(borrowerId, rows);
  }
}
