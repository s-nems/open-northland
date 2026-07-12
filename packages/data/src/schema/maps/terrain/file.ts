import { z } from 'zod';
import { TypeId } from '../../record.js';
import { TerrainEntities } from '../entities.js';
import { TRANSITION_NONE, TRANSITION_PAIRS } from './encoding.js';
import { TerrainGround, TerrainObjects, TerrainTransitions } from './layers.js';

/**
 * A decoded terrain grid file (`content/maps/<id>.json`) — the per-map nav-graph input the pipeline
 * emits from `map.dat` (the `lmlt` half-cell landscape-object lane reduced to one typeId per cell;
 * raw values ARE the 1-based IR {@link LandscapeType} typeIds, with raw 0 = "no object" mapped to
 * `void`). This is the on-disk twin of the sim's `TerrainMap` (the sim defines that structural type
 * without zod; this schema is the validating loader boundary so the build tool / app can
 * `parseTerrainMap` a file before it ever reaches the pure sim). The
 * `typeIds.length === width * height` invariant is enforced here so a truncated/oversized grid fails
 * at load, not as a confusing out-of-bounds read inside `buildTerrainGraph`.
 *
 * The optional {@link ground} / {@link objects} layers carry the map's 1:1 visual data (per-triangle
 * ground patterns; placed landscape objects) — render-only consumers; the sim reads only the grid.
 * The optional {@link elevation} (`lmhe` terrain height) and {@link brightness} (`embr` baked
 * shading) lanes are per-cell render inputs: the projection lift and the ground's per-fragment
 * shading respectively.
 */
export const TerrainMapFile = z
  .strictObject({
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
     * NOT the `2W × 2H` half-cell resolution the {@link objects} lane uses. Raw byte values, 0..250
     * (a hard observed ceiling across the real maps).
     * Present when the map ships the lane (older/foreign saves omit it). Consumed by the render's
     * elevation lift (≈1.24 native px/unit, MEASURED — see source basis "projection";
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
  })
  .check((ctx) => {
    const m = ctx.value;
    if (m.typeIds.length === m.width * m.height) return;
    ctx.issues.push({
      code: 'custom',
      message: `terrain map typeIds length ${m.typeIds.length} != width*height (${m.width}*${m.height} = ${
        m.width * m.height
      })`,
      path: ['typeIds'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    if (
      m.ground === undefined ||
      (m.ground.a.length === m.width * m.height && m.ground.b.length === m.width * m.height)
    )
      return;
    ctx.issues.push({
      code: 'custom',
      message: `terrain map ground lanes must be width*height (${m.width * m.height}) cells`,
      path: ['ground'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    if (
      m.ground === undefined ||
      [...m.ground.a, ...m.ground.b].every((idx) => idx < (m.ground as TerrainGround).patterns.length)
    )
      return;
    ctx.issues.push({
      code: 'custom',
      message: 'terrain map ground lane indexes outside its patterns list',
      path: ['ground'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    if (m.transitions === undefined) return;
    const cells = m.width * m.height;
    const t = m.transitions;
    if ([t.a1, t.b1, t.a2, t.b2].every((lane) => lane.length === cells)) return;
    ctx.issues.push({
      code: 'custom',
      message: `terrain map transition lanes must be width*height (${cells}) cells`,
      path: ['transitions'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    if (m.transitions === undefined) return;
    const t = m.transitions;
    if (
      [t.a1, t.b1, t.a2, t.b2].every((lane) =>
        lane.every((v) => v === TRANSITION_NONE || Math.floor(v / TRANSITION_PAIRS) < t.types.length),
      )
    )
      return;
    ctx.issues.push({
      code: 'custom',
      message: 'terrain map transition lane values outside its types dictionary',
      path: ['transitions'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    if (m.objects === undefined || m.objects.placements.length % 3 === 0) return;
    ctx.issues.push({
      code: 'custom',
      message: 'terrain map objects.placements must be flat [hx, hy, typeIndex] triples',
      path: ['objects', 'placements'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    const inRange = (): boolean => {
      if (m.objects === undefined) return true;
      const p = m.objects.placements;
      for (let i = 0; i + 2 < p.length; i += 3) {
        const hx = p[i] as number;
        const hy = p[i + 1] as number;
        if (hx >= m.width * 2 || hy >= m.height * 2) return false;
        if ((p[i + 2] as number) >= m.objects.types.length) return false;
      }
      return true;
    };
    if (inRange()) return;
    ctx.issues.push({
      code: 'custom',
      message: 'terrain map objects.placements triple out of range (half-cell coords / types index)',
      path: ['objects', 'placements'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    if (m.objects?.levels === undefined || m.objects.levels.length === m.objects.placements.length / 3)
      return;
    ctx.issues.push({
      code: 'custom',
      message: 'terrain map objects.levels must carry one entry per placement triple',
      path: ['objects', 'levels'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    if (m.elevation === undefined || m.elevation.length === m.width * m.height) return;
    ctx.issues.push({
      code: 'custom',
      message: `terrain map elevation length ${m.elevation.length} != width*height (${m.width * m.height})`,
      path: ['elevation'],
      input: m,
    });
  })
  .check((ctx) => {
    const m = ctx.value;
    if (m.brightness === undefined || m.brightness.length === m.width * m.height) return;
    ctx.issues.push({
      code: 'custom',
      message: `terrain map brightness length ${m.brightness.length} != width*height (${m.width * m.height})`,
      path: ['brightness'],
      input: m,
    });
  });
export type TerrainMapFile = z.infer<typeof TerrainMapFile>;
