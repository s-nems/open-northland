import type { GfxPattern, SoundBank, TerrainPattern } from '@open-northland/data';

/**
 * The resolved, lookup-shaped view of a decoded {@link SoundBank} that the director reads each frame —
 * built once from the IR at load ({@link buildSoundIndex}) so the per-frame decision does only cheap
 * `Map` gets. It also folds in the terrain→ambient join (`typeId → bed names`) the raw bank can't
 * express.
 */
export interface SoundIndex {
  /** Lower-cased static-group name → its interchangeable wav files (the engine picks one per play). */
  readonly groupsByName: ReadonlyMap<string, readonly string[]>;
  /** `MusicType` → the jingle's wav file(s). */
  readonly jinglesByMusicType: ReadonlyMap<number, readonly string[]>;
  /** Ambient bed name → the wav it loops (the bed's first `SFX`). */
  readonly ambientLoopByName: ReadonlyMap<string, string>;
  /** Landscape `typeId` → the ambient bed names its on-screen tiles activate. */
  readonly ambientByTerrainType: ReadonlyMap<number, readonly string[]>;
}

function pushInto(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/**
 * Assemble the {@link SoundIndex} from the IR's sound bank and terrain-pattern tables. The
 * `gfxPatterns`/`terrainPatterns` inputs are only needed for the terrain→ambient join; passing empty
 * arrays yields a working index with no terrain ambient (still fine for the event-driven layers).
 *
 * The terrain→ambient join is coarse by construction: `terrainPatterns` already approximates each
 * `typeId` to one representative pattern, so a `typeId` inherits only that pattern's groups (the
 * original keys ambient off pattern groups, pinned to the data we have).
 */
export function buildSoundIndex(
  sounds: SoundBank,
  gfxPatterns: readonly GfxPattern[],
  terrainPatterns: readonly TerrainPattern[],
): SoundIndex {
  const groupsByName = new Map<string, readonly string[]>();
  for (const g of sounds.staticGroups) {
    if (g.name.trim() === '') continue;
    groupsByName.set(
      g.name.toLowerCase(),
      g.sfx.map((s) => s.file),
    );
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
  for (const tp of terrainPatterns) {
    const groups = groupsByPatternId.get(tp.patternId) ?? [];
    const beds = new Set<string>();
    for (const g of groups) for (const bed of bedsByPatternGroup.get(g) ?? []) beds.add(bed);
    if (beds.size > 0) ambientByTerrainType.set(tp.typeId, [...beds]);
  }

  return { groupsByName, jinglesByMusicType, ambientLoopByName, ambientByTerrainType };
}
