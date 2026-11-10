import type { ContentSet } from '@open-northland/data';
import { Building, Damaged, Palisade, Position } from '../../../components/index.js';
import type { Component } from '../../../ecs/component.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { InteractionCellIndex } from './cell-index.js';

/** What a builder mends: a damaged building, or a damaged wall segment or gate. */
export type RepairSiteKind = 'building' | 'wall';

const STRUCTURE_OF: Readonly<Record<RepairSiteKind, Component<unknown>>> = {
  building: Building,
  wall: Palisade,
};

/**
 * The damaged structures of one kind as a cell index, kept across ticks per world like the stockpile
 * index: a structure never moves, and its door changes only with a `Building` write, so the membership
 * journals and the `Building` value journal name every site whose key changed.
 */
class RepairSiteCells {
  readonly index: InteractionCellIndex;
  private readonly captures: JournaledCaptures<true>;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
    private readonly structure: Component<unknown>,
  ) {
    const index = new InteractionCellIndex(world, { content, terrain }, terrain);
    this.index = index;
    this.captures = new JournaledCaptures(
      world,
      { membership: [Damaged, structure, Position, Building], values: [Building] },
      () => this.damaged(),
      {
        capture: (e) =>
          world.has(e, Damaged) && world.has(e, structure) && world.has(e, Position) ? true : null,
        apply: (e) => index.add(e),
        withdraw: (e) => index.remove(e),
        clear: () => index.clear(),
      },
    );
  }

  catchUp(): void {
    this.captures.catchUp();
  }

  verify(kind: RepairSiteKind): string[] {
    this.catchUp();
    const { world, content, terrain } = this;
    const fresh = new InteractionCellIndex(world, { content, terrain }, terrain, this.damaged());
    return this.index.divergence(fresh).map((m) => `repairSiteCells ${kind}: ${m}`);
  }

  private damaged(): readonly Entity[] {
    return this.world.canonicalQuery(Damaged, this.structure, Position);
  }
}

const ledgers = new WeakMap<World, Map<RepairSiteKind, RepairSiteCells>>();

/** `world`'s damaged structures of `kind` as a cell index, caught up to the ones standing damaged now. */
export function repairSiteCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  kind: RepairSiteKind,
): InteractionCellIndex {
  let byKind = ledgers.get(world);
  if (byKind === undefined) {
    byKind = new Map();
    ledgers.set(world, byKind);
    world.registerCacheVerifier('repairSiteCells', () => verify(world));
  }
  let ledger = byKind.get(kind);
  if (ledger === undefined || ledger.content !== content || ledger.terrain !== terrain) {
    ledger = new RepairSiteCells(world, content, terrain, STRUCTURE_OF[kind]);
    byKind.set(kind, ledger);
  } else {
    ledger.catchUp();
  }
  return ledger.index;
}

function verify(world: World): string[] {
  const problems: string[] = [];
  ledgers.get(world)?.forEach((ledger, kind) => {
    problems.push(...ledger.verify(kind));
  });
  return problems;
}
