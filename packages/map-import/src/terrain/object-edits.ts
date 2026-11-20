import type { MapObject, MapObjectEdit } from '@open-northland/data';
import type { MapDatTerrainFile } from './index.js';

/** The half-cell lattice is `2W x 2H` over a `W x H` cell map. */
const HALF_CELLS_PER_CELL = 2;
/** A placement is three numbers: its half-cell node and its index into the type list. */
const PLACEMENT_FIELDS = 3;

/**
 * The terrain's objects with `edits` applied, still in row-major half-cell order; the terrain is not
 * mutated. Each edit names a node on the map, its `from` describes what the node holds now, and its `to`
 * names an object type the map already places, so a misspelt name cannot pass as applied. `fail` gets
 * the reason an edit does not fit.
 */
export function applyMapObjectEdits(
  edits: readonly MapObjectEdit[],
  { width, height, objects }: MapDatTerrainFile,
  fail: (why: string) => never,
): MapDatTerrainFile['objects'] {
  if (objects === undefined) return fail('the map has no landscape objects');
  const { types, placements, levels, owners } = objects;
  if (levels === undefined || owners === undefined) return fail('the map lacks its lmlv or lmlp lane');
  const at = new Map<string, MapObject & { readonly hx: number; readonly hy: number }>();
  for (let i = 0; i < placements.length / PLACEMENT_FIELDS; i++) {
    const [hx, hy, typeIndex] = placements.slice(i * PLACEMENT_FIELDS, (i + 1) * PLACEMENT_FIELDS) as [
      number,
      number,
      number,
    ];
    const type = types[typeIndex] ?? fail(`placement ${i} names no type`);
    at.set(`${hx},${hy}`, { hx, hy, type, level: levels[i] ?? 0, owner: owners[i] ?? null });
  }
  for (const { hx, hy, from, to } of edits) {
    const node = `${hx},${hy}`;
    if (hx >= width * HALF_CELLS_PER_CELL || hy >= height * HALF_CELLS_PER_CELL)
      fail(`half-cell (${node}) lies outside the ${width}x${height} map`);
    if (to !== null && !types.includes(to.type)) fail(`the map places no "${to.type}"`);
    const held = at.get(node) ?? null;
    if (!sameMapObject(held, from))
      fail(`half-cell (${node}) holds ${describeObject(held)}, not ${describeObject(from)}`);
    if (to === null) at.delete(node);
    else at.set(node, { hx, hy, ...to });
  }
  const sorted = [...at.values()].sort((a, b) => a.hy - b.hy || a.hx - b.hx);
  return {
    types: [...types],
    placements: sorted.flatMap(({ hx, hy, type }) => [hx, hy, types.indexOf(type)]),
    levels: sorted.map(({ level }) => level),
    owners: sorted.map(({ owner }) => owner),
  };
}

function describeObject(object: MapObject | null): string {
  return object === null ? 'no object' : `${object.type} level ${object.level} owner ${object.owner}`;
}

/** Whether two objects are the same type, level and owner, or both absent. */
export function sameMapObject(held: MapObject | null, expected: MapObject | null): boolean {
  if (held === null || expected === null) return held === expected;
  return held.type === expected.type && held.level === expected.level && held.owner === expected.owner;
}
