import { z } from 'zod';
import { TypeId } from '../../record.js';
import { TerrainEntities } from '../entities.js';
import { TRANSITION_NONE, TRANSITION_PAIRS } from './encoding.js';
import { TerrainGround, TerrainObjects, TerrainTransitions } from './layers.js';

/**
 * A decoded terrain grid file (`content/maps/<id>.json`) — the per-map nav-graph input the pipeline
 * emits from `map.dat` (the `lmlt` half-cell landscape-object lane reduced to one typeId per cell;
 * raw values are the 1-based IR {@link LandscapeType} typeIds, with raw 0 = "no object" mapped to
 * `void`). This is the on-disk twin of the sim's `TerrainMap`, which the sim defines structurally
 * without zod, so this schema is the validating loader boundary before a file reaches the pure sim.
 * The `typeIds.length === width * height` invariant is enforced here so a truncated/oversized grid
 * fails at load, not as an out-of-bounds read inside `buildTerrainGraph`.
 *
 * The optional {@link ground} / {@link objects} layers carry the map's 1:1 visual data (per-triangle
 * ground patterns; placed landscape objects) — render-only consumers; the sim reads only the grid.
 * The optional {@link elevation} (`lmhe` terrain height) and {@link brightness} (`embr` baked
 * shading) lanes are per-cell render inputs: the projection lift and the ground's per-fragment
 * shading respectively.
 */
const TerrainMapFields = z.strictObject({
  /** Map width in cells. */
  width: z.number().int().positive(),
  /** Map height in cells. */
  height: z.number().int().positive(),
  /** Row-major landscape typeId per cell (length must equal width*height). */
  typeIds: z.array(TypeId),
  /** The 1:1 per-triangle ground patterns (`empa`/`empb` + `eapd`), when the map carries them. */
  ground: TerrainGround.optional(),
  /** The per-triangle transition overlays (`emt1..emt4` + `eatd`), when the map carries them. */
  transitions: TerrainTransitions.optional(),
  /** The placed landscape objects (`emla` + `eald`), when the map carries them. */
  objects: TerrainObjects.optional(),
  /**
   * Per-cell terrain height (`lmhe` lane), row-major, one value per cell (length = width*height) —
   * not the `2W × 2H` half-cell resolution the {@link objects} lane uses. Raw byte values, 0..250
   * (a hard observed ceiling across the real maps).
   * Present when the map ships the lane (older/foreign saves omit it). Consumed by the render's
   * elevation lift (≈1.24 native px/unit, measured — see source basis "projection";
   * `packages/render/src/data/elevation.ts`).
   */
  elevation: z.array(z.number().int().nonnegative()).optional(),
  /**
   * Per-cell baked brightness (`embr` lane), row-major, one value per cell (length = width*height),
   * raw byte values 0..255 with 127 = neutral. The engine's baked shading plane: slope light/shadow
   * plus the fade-to-black map border (the outermost 2–3 rows/columns hold 0). Present when the map
   * ships the lane. Consumed by the ground's per-fragment shading (luminance × brightness/127,
   * the response curve calibrated against the reference corpus —
   * `packages/render/src/data/brightness.ts`).
   */
  brightness: z.array(z.number().int().nonnegative()).optional(),
  /** The authored entity placements (`map.cif` `StaticObjects`), when the map carries them. */
  entities: TerrainEntities.optional(),
});
type TerrainMapValue = z.infer<typeof TerrainMapFields>;

/** A placements lane is a flat run of `[hx, hy, typeIndex]` triples. */
const PLACEMENT_STRIDE = 3;
/** Half-cell lattice factor: the objects lane is at `2W × 2H` half-cell resolution (the sim's grid). */
const HALF_CELLS_PER_CELL = 2;

const cellCount = (m: TerrainMapValue): number => m.width * m.height;

/** All placement `(hx, hy)` half-cell coords and `typeIndex` values are in range. */
function placementsInRange(objects: NonNullable<TerrainMapValue['objects']>, m: TerrainMapValue): boolean {
  const p = objects.placements;
  for (let i = 0; i + (PLACEMENT_STRIDE - 1) < p.length; i += PLACEMENT_STRIDE) {
    const hx = p[i];
    const hy = p[i + 1];
    const typeIndex = p[i + 2];
    // The loop bound guarantees all three are present; the guard only discharges the checked-index
    // `| undefined` so a future stride/bound edit fails to typecheck rather than reading past the run.
    if (hx === undefined || hy === undefined || typeIndex === undefined) continue;
    if (hx >= m.width * HALF_CELLS_PER_CELL || hy >= m.height * HALF_CELLS_PER_CELL) return false;
    if (typeIndex >= objects.types.length) return false;
  }
  return true;
}

/**
 * The cross-lane invariants a valid decoded map must hold — each an `ok` predicate plus the message
 * and path pushed when it fails. Kept as a named table (not inline `.check` closures) so each rule
 * reads independently.
 */
const INVARIANTS: ReadonlyArray<{
  readonly ok: (m: TerrainMapValue) => boolean;
  readonly message: (m: TerrainMapValue) => string;
  readonly path: readonly (string | number)[];
}> = [
  {
    ok: (m) => m.typeIds.length === cellCount(m),
    message: (m) =>
      `terrain map typeIds length ${m.typeIds.length} != width*height (${m.width}*${m.height} = ${cellCount(m)})`,
    path: ['typeIds'],
  },
  {
    ok: (m) =>
      m.ground === undefined || (m.ground.a.length === cellCount(m) && m.ground.b.length === cellCount(m)),
    message: (m) => `terrain map ground lanes must be width*height (${cellCount(m)}) cells`,
    path: ['ground'],
  },
  {
    ok: (m) => {
      const g = m.ground;
      return g === undefined || [...g.a, ...g.b].every((idx) => idx < g.patterns.length);
    },
    message: () => 'terrain map ground lane indexes outside its patterns list',
    path: ['ground'],
  },
  {
    ok: (m) => {
      const t = m.transitions;
      return t === undefined || [t.a1, t.b1, t.a2, t.b2].every((lane) => lane.length === cellCount(m));
    },
    message: (m) => `terrain map transition lanes must be width*height (${cellCount(m)}) cells`,
    path: ['transitions'],
  },
  {
    ok: (m) => {
      const t = m.transitions;
      return (
        t === undefined ||
        [t.a1, t.b1, t.a2, t.b2].every((lane) =>
          lane.every((v) => v === TRANSITION_NONE || Math.floor(v / TRANSITION_PAIRS) < t.types.length),
        )
      );
    },
    message: () => 'terrain map transition lane values outside its types dictionary',
    path: ['transitions'],
  },
  {
    ok: (m) => m.objects === undefined || m.objects.placements.length % PLACEMENT_STRIDE === 0,
    message: () => 'terrain map objects.placements must be flat [hx, hy, typeIndex] triples',
    path: ['objects', 'placements'],
  },
  {
    ok: (m) => m.objects === undefined || placementsInRange(m.objects, m),
    message: () => 'terrain map objects.placements triple out of range (half-cell coords / types index)',
    path: ['objects', 'placements'],
  },
  {
    ok: (m) =>
      m.objects?.levels === undefined ||
      m.objects.levels.length === m.objects.placements.length / PLACEMENT_STRIDE,
    message: () => 'terrain map objects.levels must carry one entry per placement triple',
    path: ['objects', 'levels'],
  },
  {
    ok: (m) => m.elevation === undefined || m.elevation.length === cellCount(m),
    message: (m) => `terrain map elevation length ${m.elevation?.length} != width*height (${cellCount(m)})`,
    path: ['elevation'],
  },
  {
    ok: (m) => m.brightness === undefined || m.brightness.length === cellCount(m),
    message: (m) => `terrain map brightness length ${m.brightness?.length} != width*height (${cellCount(m)})`,
    path: ['brightness'],
  },
];

export const TerrainMapFile = TerrainMapFields.check((ctx) => {
  const m = ctx.value;
  for (const inv of INVARIANTS) {
    if (!inv.ok(m)) {
      ctx.issues.push({ code: 'custom', message: inv.message(m), path: [...inv.path], input: m });
    }
  }
});
export type TerrainMapFile = z.infer<typeof TerrainMapFile>;
