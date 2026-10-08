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
  /** Lower-cased static-group name → its interchangeable wav files (the engine picks one per play). */
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
): SoundIndex {
  const groupsByName = new Map<string, readonly string[]>();
  const groupsByLogicSoundType = new Map<number, readonly string[]>();
  for (const g of sounds.staticGroups) {
    if (g.name.trim() === '') continue;
    const files = audibleFiles(g.sfx);
    groupsByName.set(g.name.toLowerCase(), files);
    if (g.logicSoundType !== undefined && !groupsByLogicSoundType.has(g.logicSoundType)) {
      groupsByLogicSoundType.set(g.logicSoundType, files);
    }
  }

  const jinglesByMusicType = new Map<number, readonly string[]>();
  for (const j of sounds.jingles) {
    if (j.musicType === undefined) continue;
    jinglesByMusicType.set(j.musicType, audibleFiles(j.sfx));
  }

  // Ambient bed name → its loop wav, plus pattern-group name → bed names (the join's middle table).
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
  };
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
