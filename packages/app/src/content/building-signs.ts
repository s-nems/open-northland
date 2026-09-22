import type {
  AtlasFrame,
  BuildingSignGfx,
  BuildingSignKind,
  BuildingSignSheet,
} from '@open-northland/render';
import { servedAtlasStem } from './ir/joins.js';
import { loadIr, loadLayer, MissingAtlasError } from './ir/load.js';
import type { ContentIr, LandscapeGfxRow } from './ir/rows.js';
import { type GatheringNodeRef, nodeRefFrom } from './resource-gfx/refs.js';

/**
 * The building-sign art join: resolve the original's player-coloured `ls_temp` sign records and the
 * garrison flag's star ladder into the per-player {@link BuildingSignGfx} the render badge and
 * construction-sign layers draw.
 *
 * Source basis: the record names are the ones the original references and `landscapes.cif` binds per
 * player (`playerNN ...`); the banner→family-state and carrier→pennant assignments are observed
 * original behavior pending an in-game recheck (signs 01-04 all bind the same disc bob, so the disc
 * for workers is the only readable choice). Named approximations: each residence banner authors an
 * 8-frame wave loop and is drawn as a still, and the records' `ls_temp_s` shadow twin is not loaded.
 */

/** The `[GfxLandscape]` record name suffix each sign kind resolves (prefixed `playerNN `). */
const KIND_RECORD: Readonly<Record<BuildingSignKind, string>> = {
  worker: 'sign 01',
  carrier: 'sign 05',
  couple: 'residence sign 01',
  single: 'residence sign 02',
  family: 'residence sign 03',
  construction: 'construction sign',
};

/** The garrison-flag records in star order: `soldier 01` flies one star, `soldier 05` five. */
const GARRISON_RECORDS: readonly string[] = [
  'soldier 01',
  'soldier 02',
  'soldier 03',
  'soldier 04',
  'soldier 05',
];

/** Player slots the original ships recoloured sign records for (`player01`...`player10`). */
const SIGN_PLAYER_COUNT = 10;

/** One player slot's resolved sign refs: the served `ls_temp.human_playerNN` stem, a bob per kind, and
 *  the garrison flag's per-star wave loops when that slot's `soldier` records resolved. */
export interface BuildingSignPlayerRef {
  readonly stem: string;
  readonly bobByKind: Readonly<Record<BuildingSignKind, number>>;
  readonly garrisonBobs?: readonly (readonly number[])[];
}

/**
 * Resolve each player slot's sign records from the IR. A slot resolves only when every kind's record is
 * present with a frame and all name one served atlas stem; anything else leaves the slot `undefined`.
 */
export function resolveBuildingSignRefs(
  ir: ContentIr | null,
): readonly (BuildingSignPlayerRef | undefined)[] {
  const gfx = ir?.landscapeGfx ?? [];
  const byName = new Map<string, LandscapeGfxRow>();
  for (const rec of gfx) {
    if (rec.editName !== undefined && !byName.has(rec.editName)) byName.set(rec.editName, rec);
  }
  return Array.from({ length: SIGN_PLAYER_COUNT }, (_, slot) =>
    resolveSlot(byName, `player${String(slot + 1).padStart(2, '0')} `),
  );
}

/** One slot's six-record resolution: every kind present, one shared stem, or `undefined`. */
function resolveSlot(
  byName: ReadonlyMap<string, LandscapeGfxRow>,
  prefix: string,
): BuildingSignPlayerRef | undefined {
  const kindRef = (kind: BuildingSignKind): GatheringNodeRef | undefined => {
    const rec = byName.get(prefix + KIND_RECORD[kind]);
    return rec === undefined ? undefined : nodeRefFrom(rec);
  };
  const worker = kindRef('worker');
  const carrier = kindRef('carrier');
  const single = kindRef('single');
  const couple = kindRef('couple');
  const family = kindRef('family');
  const construction = kindRef('construction');
  if (
    worker === undefined ||
    carrier === undefined ||
    single === undefined ||
    couple === undefined ||
    family === undefined ||
    construction === undefined
  ) {
    return undefined;
  }
  const refs = [worker, carrier, single, couple, family, construction];
  if (refs.some((r) => r.stem !== worker.stem)) return undefined; // one sheet per player - a split basis is malformed
  const garrisonBobs = resolveGarrisonBobs(byName, prefix, worker.stem);
  return {
    stem: worker.stem,
    bobByKind: {
      worker: worker.bob,
      carrier: carrier.bob,
      single: single.bob,
      couple: couple.bob,
      family: family.bob,
      construction: construction.bob,
    },
    ...(garrisonBobs !== undefined ? { garrisonBobs } : {}),
  };
}

/** One slot's five garrison-flag wave loops, or `undefined` unless all five resolve off the slot's own
 *  sheet: a partial ladder would fly the wrong star count, so the flag degrades to the placeholder
 *  instead. */
function resolveGarrisonBobs(
  byName: ReadonlyMap<string, LandscapeGfxRow>,
  prefix: string,
  stem: string,
): readonly (readonly number[])[] | undefined {
  const loops: (readonly number[])[] = [];
  for (const name of GARRISON_RECORDS) {
    const rec = byName.get(prefix + name);
    if (rec === undefined || servedAtlasStem(rec) !== stem) return undefined;
    const bobs = waveBobs(rec);
    if (bobs.length === 0) return undefined;
    loops.push(bobs);
  }
  return loops;
}

/** A looping record's frame list: the highest state's bobs in authored order (the wave cycle). */
function waveBobs(record: LandscapeGfxRow): readonly number[] {
  let best: { state: number; bobIds: readonly number[] } | undefined;
  for (const f of record.frames ?? []) {
    if (f.bobIds.length > 0 && (best === undefined || f.state > best.state)) best = f;
  }
  return best?.bobIds ?? [];
}

/**
 * Load the per-player sign sheets for the resolved refs, degrading per slot on a missing atlas. `null`
 * when nothing resolves or no atlas loads.
 */
export async function loadBuildingSignGfx(): Promise<BuildingSignGfx | null> {
  const refs = resolveBuildingSignRefs(await loadIr());
  const byPlayer = await Promise.all(refs.map(loadSheet));
  return byPlayer.some((sheet) => sheet !== undefined) ? { byPlayer } : null;
}

/** One slot's sheet: its atlas page + the frame per kind, or `undefined` when the atlas is missing
 *  or stale (a frame the refs name is absent from it). */
async function loadSheet(ref: BuildingSignPlayerRef | undefined): Promise<BuildingSignSheet | undefined> {
  if (ref === undefined) return undefined;
  let layer: Awaited<ReturnType<typeof loadLayer>>;
  try {
    layer = await loadLayer(ref.stem);
  } catch (err) {
    if (err instanceof MissingAtlasError) return undefined;
    throw err;
  }
  const frame = (kind: BuildingSignKind): AtlasFrame | undefined =>
    layer.atlas.frames.get(ref.bobByKind[kind]);
  const worker = frame('worker');
  const carrier = frame('carrier');
  const single = frame('single');
  const couple = frame('couple');
  const family = frame('family');
  const construction = frame('construction');
  if (
    worker === undefined ||
    carrier === undefined ||
    single === undefined ||
    couple === undefined ||
    family === undefined ||
    construction === undefined
  ) {
    return undefined;
  }
  const garrison = garrisonFrames(ref.garrisonBobs, (bob) => layer.atlas.frames.get(bob));
  return {
    source: layer.source,
    frameByKind: { worker, carrier, single, couple, family, construction },
    ...(garrison !== undefined ? { garrison } : {}),
  };
}

/** The flag's wave loops as atlas frames, or `undefined` when the refs carry none or the loaded atlas
 *  is missing one of their bobs (a stale `content/`). */
function garrisonFrames(
  bobs: readonly (readonly number[])[] | undefined,
  frameOf: (bob: number) => AtlasFrame | undefined,
): readonly (readonly AtlasFrame[])[] | undefined {
  if (bobs === undefined) return undefined;
  const loops: AtlasFrame[][] = [];
  for (const loop of bobs) {
    const frames: AtlasFrame[] = [];
    for (const bob of loop) {
      const frame = frameOf(bob);
      if (frame === undefined) return undefined;
      frames.push(frame);
    }
    loops.push(frames);
  }
  return loops;
}
