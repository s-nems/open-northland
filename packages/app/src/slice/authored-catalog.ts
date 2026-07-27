import { JOB_IDLE } from '../catalog/jobs.js';
import type { SandboxContentExtras } from '../game/sandbox/index.js';
import type { AuthoredJoinRows, AuthoredPlacement } from './authored-placements.js';

/**
 * The catalog rows an authored map's placements add to the sandbox content: every building, job and
 * tribe id the map actually places, named from the served IR where it names them. Ids fold ascending
 * and dedup, so the derived catalog is a deterministic function of the placement list.
 */
export function authoredCatalogExtras(
  placements: readonly AuthoredPlacement[],
  rows: Pick<AuthoredJoinRows, 'buildings'>,
): SandboxContentExtras {
  const defByTypeId = new Map<number, { id: string; kind?: string }>();
  for (const row of rows.buildings ?? []) {
    if (row.typeId !== undefined && row.id !== undefined)
      defByTypeId.set(row.typeId, { id: row.id, ...(row.kind !== undefined ? { kind: row.kind } : {}) });
  }

  const ascending = (ids: Iterable<number>): number[] => [...new Set(ids)].sort((a, b) => a - b);

  return {
    buildings: ascending(placements.filter((p) => p.kind === 'building').map((p) => p.typeId)).map(
      (typeId) => ({ typeId, id: `building_${typeId}`, ...defByTypeId.get(typeId) }),
    ),
    // The idle job is every settler's default, already in the sandbox catalog.
    jobs: ascending(placements.filter((p) => p.kind === 'human').map((p) => p.jobType))
      .filter((typeId) => typeId !== JOB_IDLE)
      .map((typeId) => ({ typeId, id: `job_${typeId}` })),
    tribes: ascending(placements.map((p) => p.tribe)).map((typeId) => ({
      typeId,
      id: `tribe_${typeId}`,
    })),
  };
}
