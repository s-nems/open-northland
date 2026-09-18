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
}
const views = new WeakMap<World, LandscapeView>();

/** The live placements and the resources standing in for the resource-backed ones, rebuilt when a
 *  script edits the landscape or a resource is depleted. */
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
  const types = landscapeTypes(terrain);
  const placements = [...(terrain.landscapes?.placements ?? []), ...state.added].filter(
    (p) => !removed.has(p.id) && (!p.resourceBacked || resources.has(p.id)),
  );
  const view = { revision, terrain, placements, types, resources };
  views.set(world, view);
  return view;
}

export interface LandscapeBlocks {
  readonly revision: number;
  readonly terrain: TerrainGraph;
  readonly walk: ReadonlySet<NodeId>;
  readonly build: ReadonlySet<NodeId>;
}
const blocks = new WeakMap<World, LandscapeBlocks>();

/** The nodes the standing landscapes block for walking and building. Resources maintain their own
 *  changing footprints through the gathering lifecycle, so only a script edit rebuilds these sets. */
export function landscapeBlocks(world: World, terrain: TerrainGraph): LandscapeBlocks {
  const state = landscapeEditState(world);
  const revision = state.topologyRevision;
  const cached = blocks.get(world);
  if (cached?.revision === revision && cached.terrain === terrain) return cached;
  const removed = new Set(state.removed);
  const types = landscapeTypes(terrain);
  const walk = new Set<NodeId>();
  const build = new Set<NodeId>();
  for (const p of [...(terrain.landscapes?.placements ?? []), ...state.added]) {
    if (p.resourceBacked || removed.has(p.id)) continue;
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
  const built = { revision, terrain, walk, build };
  blocks.set(world, built);
  return built;
}

const typeTables = new WeakMap<TerrainGraph, ReadonlyMap<number, ScriptLandscapeType>>();

function landscapeTypes(terrain: TerrainGraph): ReadonlyMap<number, ScriptLandscapeType> {
  let types = typeTables.get(terrain);
  if (types === undefined) {
    types = new Map(terrain.landscapes?.types.map((type) => [type.typeId, type]));
    typeTables.set(terrain, types);
  }
  return types;
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
      hx: terrain.xOf(node),
      hy: terrain.yOf(node),
      value,
    })),
  };
}
