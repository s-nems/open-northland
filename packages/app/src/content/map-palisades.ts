import type { TerrainObjects } from '@open-northland/data';
import type { Command, Simulation } from '@open-northland/sim';
import type { ContentIr } from './ir/rows.js';
import { forEachPlacement } from './map-placements.js';

const PALISADE_LOGIC_IDS = new Set(['wall', 'wall_gate_closed', 'wall_gate_open']);

export interface MapPalisadeSpawn {
  readonly gfxIndex: number;
  readonly hx: number;
  readonly hy: number;
  readonly placement: number;
  readonly owner: number | undefined;
  readonly valency: number | undefined;
}

/** Map object-name → exact source wall/gate graphics record. */
function palisadeGfxByName(ir: ContentIr): ReadonlyMap<string, number> {
  const logicIds = new Set(
    (ir.landscape ?? []).flatMap((row) =>
      row.typeId !== undefined && row.id !== undefined && PALISADE_LOGIC_IDS.has(row.id) ? [row.typeId] : [],
    ),
  );
  const out = new Map<string, number>();
  for (const gfx of ir.landscapeGfx ?? []) {
    if (gfx.editName !== undefined && logicIds.has(gfx.logicType)) out.set(gfx.editName, gfx.index);
  }
  return out;
}

/** The wall/gate object names promoted from immutable map scenery to live sim entities. */
export function palisadeObjectNames(ir: ContentIr): ReadonlySet<string> {
  return new Set(palisadeGfxByName(ir).keys());
}

/** Source-order authored wall/gate placements on the map's native half-cell lattice. */
export function mapPalisadeSpawns(objects: TerrainObjects, ir: ContentIr): MapPalisadeSpawn[] {
  const byName = palisadeGfxByName(ir);
  const out: MapPalisadeSpawn[] = [];
  forEachPlacement(objects.placements, (hx, hy, typeIndex, placement) => {
    const name = objects.types[typeIndex];
    const gfxIndex = name === undefined ? undefined : byName.get(name);
    if (gfxIndex !== undefined) {
      out.push({
        gfxIndex,
        hx,
        hy,
        placement,
        owner: objects.owners?.[placement] ?? undefined,
        valency: objects.levels?.[placement],
      });
    }
  });
  return out;
}

/**
 * Promote authored wall/gate scenery through the setup command seam. Their exact graphics index is
 * retained; the placement-parallel source owner lane becomes the live command owner when present.
 */
export function spawnMapPalisades(
  sim: Pick<Simulation, 'enqueueSetup'>,
  objects: TerrainObjects,
  ir: ContentIr,
  tribeForOwner: (owner: number | undefined) => number,
): readonly number[] {
  const placements: number[] = [];
  for (const spawn of mapPalisadeSpawns(objects, ir)) {
    const command: Command = {
      kind: 'placePalisade',
      gfxIndex: spawn.gfxIndex,
      x: spawn.hx,
      y: spawn.hy,
      tribe: tribeForOwner(spawn.owner),
      ...(spawn.owner !== undefined ? { owner: spawn.owner } : {}),
      ...(spawn.valency !== undefined ? { valency: spawn.valency } : {}),
      underConstruction: false,
      force: true,
    };
    sim.enqueueSetup(command);
    placements.push(spawn.placement);
  }
  return placements;
}
