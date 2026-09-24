import type { TerrainMapFile } from '@open-northland/data';
import { type ElevationField, halfCellToScreen, type MapObjectSprite } from '@open-northland/render';
import { AMBIENT_LOOK_BY_TRIBE } from '../../catalog/animal-roster.js';
import { diag } from '../../diag/index.js';
import { contentJoins } from '../../game/world/content-joins.js';
import { GFX_ANIM_MODE_LOOP } from '../ir/joins.js';
import { loadLayer, MissingAtlasError } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';
import { pairedStateFrames } from '../objects.js';
import { ADULT_ANIMAL_JOB } from './bindings.js';

type AuthoredAnimals = NonNullable<TerrainMapFile['entities']>['animals'];

/** One ambient species' drawable loop, shared by every placement of it. */
type AmbientLoop = Pick<MapObjectSprite, 'source' | 'frames' | 'shadow'>;

/**
 * The adult swarm loop: the tribe's sequence-less `[gfxanimatomic]` record, the `gfxanimmode 1` looping
 * base wait first. Its list holds bob ids of the whole body set. The original rolls its fidgets between
 * loops; playing the base loop alone is a named approximation.
 */
function swarmLoopBobIds(ir: ContentIr, tribe: number): readonly number[] | undefined {
  let first: readonly number[] | undefined;
  for (const row of ir.gfxAtomics ?? []) {
    if (row.tribe !== tribe || row.job !== ADULT_ANIMAL_JOB || row.bodySeq !== undefined) continue;
    const list = row.dirFrames[0];
    if (list === undefined || list.length === 0) continue;
    if (row.mode === GFX_ANIM_MODE_LOOP) return list;
    first ??= list;
  }
  return first;
}

async function loadAmbientLoop(ir: ContentIr, tribe: number): Promise<AmbientLoop | null> {
  const look = AMBIENT_LOOK_BY_TRIBE.get(tribe);
  const bobIds = swarmLoopBobIds(ir, tribe);
  if (look === undefined || bobIds === undefined) return null;
  let layer: Awaited<ReturnType<typeof loadLayer>>;
  try {
    layer = await loadLayer(`${look.bodyStem}.${look.palette}`, `${look.bodyStem}_s.shadow`);
  } catch (err) {
    if (err instanceof MissingAtlasError) return null;
    throw err;
  }
  const paired = pairedStateFrames(layer, bobIds);
  if (paired === null) return null;
  const shadowSource = layer.shadow?.source;
  return {
    source: layer.source,
    frames: paired.frames,
    ...(shadowSource !== undefined && paired.shadowFrames.some((f) => f !== undefined)
      ? { shadow: { source: shadowSource, frames: paired.shadowFrames } }
      : {}),
  };
}

/**
 * The map's authored ambient creatures (`setanimal` of a species the sim never admits, the butterflies)
 * as presentation-only tall sprites: each swarm loops in place at its authored half-cell, one frame per
 * sim tick, and stays out of sim state. Whether the original also drifts a swarm around its birth point
 * is unconfirmed; the loop's own frames carry the flutter.
 */
export async function loadAmbientCreatures(
  animals: AuthoredAnimals,
  ir: ContentIr,
  elevation?: ElevationField,
): Promise<MapObjectSprite[]> {
  const joins = contentJoins(ir);
  const byTribe = new Map<number, { hx: number; hy: number }[]>();
  for (const a of animals) {
    const tribe = joins.ambientSpecies(a.species);
    if (tribe === undefined) continue;
    const list = byTribe.get(tribe) ?? [];
    list.push({ hx: a.hx, hy: a.hy });
    byTribe.set(tribe, list);
  }
  const out: MapObjectSprite[] = [];
  const undrawn: number[] = [];
  await Promise.all(
    [...byTribe].map(async ([tribe, placements]) => {
      const loop = await loadAmbientLoop(ir, tribe);
      if (loop === null) {
        undrawn.push(tribe);
        return;
      }
      for (const { hx, hy } of placements) {
        const screen = halfCellToScreen(hx, hy);
        const lift = elevation?.liftAtNode(hx, hy) ?? 0;
        out.push({
          x: screen.x,
          y: screen.y,
          ...loop,
          scale: 1,
          decor: false,
          creature: true,
          // Invented, as for landscape objects: neighbouring swarms stay out of step.
          phase: hx + hy,
          ...(lift !== 0 ? { lift } : {}),
        });
      }
    }),
  );
  if (undrawn.length > 0) {
    const slugById = new Map((ir.tribes ?? []).map((t) => [t.typeId, t.id]));
    diag.warn(
      'content',
      `ambient creatures without a drawable loop: ${undrawn.map((t) => slugById.get(t) ?? `tribe ${t}`).join(', ')}`,
    );
  }
  return out;
}
