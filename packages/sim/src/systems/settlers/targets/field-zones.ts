import type { ContentSet } from '@open-northland/data';
import { Building, Position } from '../../../components/index.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingFieldZone, translatedCells } from '../../footprint/geometry.js';

/**
 * The ground every building reserves against fields, kept across ticks per world and caught up from the
 * Building and Position journals. A node may lie in several zones, so each holds a count, and `zones`
 * holds exactly the nodes with a positive one. Membership only: its iteration order depends on the
 * journal's replay history, so a restored run would walk it differently.
 */
class FieldZones {
  readonly zones = new Set<NodeId>();
  readonly captures: JournaledCaptures<readonly NodeId[]>;
  private readonly counts = new Map<NodeId, number>();

  constructor(
    readonly world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    this.captures = new JournaledCaptures<readonly NodeId[]>(
      world,
      // A building never moves in place, and its zone reads only its type and anchor.
      { membership: [Building, Position], values: [Building] },
      () => world.canonicalQuery(Building, Position),
      {
        capture: (e) => zoneOf(world, content, terrain, e),
        apply: (_e, cells) => {
          for (const cell of cells) {
            const count = (this.counts.get(cell) ?? 0) + 1;
            this.counts.set(cell, count);
            if (count === 1) this.zones.add(cell);
          }
        },
        withdraw: (_e, cells) => {
          for (const cell of cells) {
            const count = (this.counts.get(cell) ?? 0) - 1;
            if (count > 0) {
              this.counts.set(cell, count);
            } else {
              this.counts.delete(cell);
              this.zones.delete(cell);
            }
          }
        },
        clear: () => {
          this.counts.clear();
          this.zones.clear();
        },
      },
    );
  }

  verify(): string[] {
    this.captures.catchUp();
    const fresh = new Set<NodeId>();
    for (const e of this.world.canonicalQuery(Building, Position)) {
      for (const cell of zoneOf(this.world, this.content, this.terrain, e) ?? []) fresh.add(cell);
    }
    const same = fresh.size === this.zones.size && [...fresh].every((cell) => this.zones.has(cell));
    return same ? [] : ['fieldZones disagree with a fresh building scan'];
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
  const anchor = nodeOfPosition(position.x, position.y);
  return translatedCells(terrain, buildingFieldZone(content, building.buildingType), anchor.hx, anchor.hy);
}

const zonesByWorld = new WeakMap<World, FieldZones>();

/** Every node some building reserves against fields, caught up to the live world. The set is live: it
 *  holds still only until the next call. */
export function fieldZones(world: World, content: ContentSet, terrain: TerrainGraph): ReadonlySet<NodeId> {
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
  return held.zones;
}
