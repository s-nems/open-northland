import type {
  AnimalCall,
  GfxPattern,
  HumanVoices,
  SoundBank,
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
  /** Settler tribe → voice class → the groups that tribe's settlers of that class speak with. */
  readonly humanVoices: ReadonlyMap<number, ReadonlyMap<VoiceClass, HumanVoices>>;
  /** Job ids whose authored slug identifies a hero; heroes always use response pool zero. */
  readonly heroJobs: ReadonlySet<number>;
  /** Animal tribe → its unprompted call and the roll that gates it. */
  readonly animalCalls: ReadonlyMap<number, AnimalCall>;
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
  jobs: readonly { readonly typeId?: number; readonly id?: string }[] = [],
): SoundIndex {
  const groupsByName = new Map<string, readonly string[]>();
  const groupsByLogicSoundType = new Map<number, readonly string[]>();
  for (const g of sounds.staticGroups) {
    if (g.name.trim() === '') continue;
    const files = g.sfx.map((s) => s.file);
    groupsByName.set(g.name.toLowerCase(), files);
    if (g.logicSoundType !== undefined && !groupsByLogicSoundType.has(g.logicSoundType)) {
      groupsByLogicSoundType.set(g.logicSoundType, files);
    }
  }

  const jinglesByMusicType = new Map<number, readonly string[]>();
  for (const j of sounds.jingles) {
    if (j.musicType === undefined) continue;
    jinglesByMusicType.set(
      j.musicType,
      j.sfx.map((s) => s.file),
    );
  }

  // Ambient bed name → its loop wav, plus pattern-group name → bed names (the join's middle table).
  const ambientLoopByName = new Map<string, string>();
  const bedsByPatternGroup = new Map<string, string[]>();
  for (const a of sounds.ambient) {
    const loop = a.sfx[0]?.file;
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
