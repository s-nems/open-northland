import type { ContentSet } from '@open-northland/data';
import { Building, Position } from '../../../components/index.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingFieldZone, countsMatchCells, translatedCells } from '../../footprint/geometry.js';

/** A node set read only by membership. */
export interface NodeMembership {
  has(node: NodeId): boolean;
}

/**
 * The ground every building reserves against fields, kept across ticks per world and caught up from the
 * Building and Position journals. A node may lie in several zones, so each holds a count in a per-node
 * array, which a building re-captured in place updates without touching a hash table. Membership only.
 */
class FieldZones implements NodeMembership {
  readonly captures: JournaledCaptures<readonly NodeId[]>;
  private readonly counts: Uint16Array;

  constructor(
    readonly world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    const counts = new Uint16Array(terrain.nodeCount);
    this.counts = counts;
    this.captures = new JournaledCaptures<readonly NodeId[]>(
      world,
      // A building never moves in place, and its zone reads only its type and anchor.
      { membership: [Building, Position], values: [Building] },
      () => world.canonicalQuery(Building, Position),
      {
        capture: (e) => zoneOf(world, content, terrain, e),
        apply: (_e, cells) => {
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell !== undefined) counts[cell] = (counts[cell] ?? 0) + 1;
          }
        },
        withdraw: (_e, cells) => {
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell !== undefined) counts[cell] = (counts[cell] ?? 0) - 1;
          }
        },
        clear: () => counts.fill(0),
      },
    );
  }

  has(node: NodeId): boolean {
    return (this.counts[node] ?? 0) > 0;
  }

  verify(): string[] {
    this.captures.catchUp();
    const fresh = new Set<NodeId>();
    for (const e of this.world.canonicalQuery(Building, Position)) {
      for (const cell of zoneOf(this.world, this.content, this.terrain, e) ?? []) fresh.add(cell);
    }
    return countsMatchCells(this.counts, fresh) ? [] : ['fieldZones disagree with a fresh building scan'];
  }
}

function zoneOf(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  e: Entity,
): readonly NodeId[] | null {
  const building = world.tryGet(e, Building);
  const position = world.tryGet(e, Position);
  if (building === undefined || position === undefined) return null;
  return translatedCells(
    terrain,
    buildingFieldZone(content, building.buildingType, building.tribe),
    nodeHxOfPosition(position.x, position.y),
    nodeHyOfPosition(position.y),
  );
}

const zonesByWorld = new WeakMap<World, FieldZones>();

/** Every node some building reserves against fields, caught up to the live world. The view is live: it
 *  holds still only until the next call. */
export function fieldZones(world: World, content: ContentSet, terrain: TerrainGraph): NodeMembership {
  let held = zonesByWorld.get(world);
  if (held === undefined || held.content !== content || held.terrain !== terrain) {
    if (held === undefined) {
      world.registerCacheVerifier('fieldZones', () => zonesByWorld.get(world)?.verify() ?? []);
    }
    held = new FieldZones(world, content, terrain);
    zonesByWorld.set(world, held);
  } else {
    held.captures.catchUp();
  }
  return held;
}
