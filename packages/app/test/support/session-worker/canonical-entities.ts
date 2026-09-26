import type { WorldSnapshot } from '@open-northland/sim';

/** Component records in name order: the mirror appends a component an entity gains, the sim does not. */
export function canonicalEntities(snapshot: WorldSnapshot): string {
  return JSON.stringify(
    snapshot.entities.map((entity) => ({
      id: entity.id,
      components: Object.fromEntries(
        Object.entries(entity.components).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    })),
  );
}
