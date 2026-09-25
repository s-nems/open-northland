import type { TerrainObjects } from '@open-northland/data';
import type { Command, Simulation } from '@open-northland/sim';
import type { ContentIr } from './ir/rows.js';
import { forEachPlacement } from './map-placements.js';
import { playerWallRows } from './palisade-rows.js';

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
  const walls = playerWallRows(ir);
  const out = new Map<string, number>();
  for (const gfx of ir.landscapeGfx ?? []) {
    if (gfx.editName !== undefined && walls.has(gfx.logicType)) out.set(gfx.editName, gfx.index);
  }
  return out;
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
 * An absent seat's walls are not placed, yet their placements are still returned so the static
 * layer does not draw them as scenery.
 */
export function spawnMapPalisades(
  sim: Pick<Simulation, 'enqueueSetup'>,
  objects: TerrainObjects,
  ir: ContentIr,
  tribeForOwner: (owner: number | undefined) => number,
  absentSeats: ReadonlySet<number> = new Set(),
): readonly number[] {
  const placements: number[] = [];
  for (const spawn of mapPalisadeSpawns(objects, ir)) {
    placements.push(spawn.placement);
    if (spawn.owner !== undefined && absentSeats.has(spawn.owner)) continue;
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
  }
  return placements;
}
