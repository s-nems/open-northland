import { footprintCellDx } from '@open-northland/data';
import {
  LandscapeResource,
  landscapeEditState,
  landscapeRevision,
  landscapeTopologyRevision,
} from '../../components/landscape.js';
import type { Entity, World } from '../../ecs/world.js';
import type {
  NodeId,
  ScriptLandscapePlacement,
  ScriptLandscapeType,
  TerrainGraph,
} from '../../nav/terrain/index.js';

interface LandscapeView {
  readonly revision: number;
  readonly terrain: TerrainGraph;
  readonly placements: readonly ScriptLandscapePlacement[];
  readonly types: ReadonlyMap<number, ScriptLandscapeType>;
  readonly resources: ReadonlyMap<number, readonly Entity[]>;
  readonly walk: ReadonlySet<NodeId>;
  readonly build: ReadonlySet<NodeId>;
}
const views = new WeakMap<World, LandscapeView>();

export function landscapeView(world: World, terrain: TerrainGraph): LandscapeView {
  const revision = landscapeTopologyRevision(world);
  const cached = views.get(world);
  if (cached?.revision === revision && cached.terrain === terrain) return cached;
  const state = landscapeEditState(world);
  const removed = new Set(state.removed);
  const resources = new Map<number, Entity[]>();
  for (const entity of world.query(LandscapeResource)) {
    const id = world.get(entity, LandscapeResource).id;
    const held = resources.get(id);
    if (held === undefined) resources.set(id, [entity]);
    else held.push(entity);
  }
  const types = new Map(terrain.landscapes?.types.map((type) => [type.typeId, type]));
  const placements = [...(terrain.landscapes?.placements ?? []), ...state.added].filter(
    (p) => !removed.has(p.id) && (!p.resourceBacked || resources.has(p.id)),
  );
  const walk = new Set<NodeId>();
  const build = new Set<NodeId>();
  for (const p of placements) {
    // Resources maintain their own changing footprints through the gathering lifecycle.
    if (p.resourceBacked) continue;
    const type = types.get(p.typeId);
    for (const [cells, target] of [
      [type?.walk ?? [], walk],
      [type?.build ?? [], build],
    ] as const) {
      for (const cell of cells) {
        const hx = p.hx + footprintCellDx(p.hy, cell);
        const hy = p.hy + cell.dy;
        if (terrain.inBounds(hx, hy)) target.add(terrain.nodeAt(hx, hy));
      }
    }
  }
  const view = { revision, terrain, placements, types, resources, walk, build };
  views.set(world, view);
  return view;
}

export interface LandscapeEditView {
  readonly revision: number;
  readonly removed: readonly number[];
  readonly added: readonly ScriptLandscapePlacement[];
  readonly tints: readonly { readonly hx: number; readonly hy: number; readonly value: number }[];
}

export function landscapeEdits(world: World, terrain: TerrainGraph | undefined): LandscapeEditView {
  const state = landscapeEditState(world);
  if (terrain === undefined) return { revision: landscapeRevision(world), removed: [], added: [], tints: [] };
  const view = landscapeView(world, terrain);
  const present = new Set(view.placements.map((p) => p.id));
  return {
    revision: landscapeRevision(world),
    removed: (terrain.landscapes?.placements ?? []).filter((p) => !present.has(p.id)).map((p) => p.id),
    added: state.added.filter((p) => present.has(p.id)).map((p) => ({ ...p })),
    tints: [...state.tints].map(([node, value]) => ({
      hx: node % terrain.width,
      hy: Math.floor(node / terrain.width),
      value,
    })),
  };
}
