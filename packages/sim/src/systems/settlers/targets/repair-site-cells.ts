import type { ContentSet } from '@open-northland/data';
import { Building, Damaged, mooringOf, Palisade, Position, Vehicle } from '../../../components/index.js';
import type { Component } from '../../../ecs/component.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { InteractionCellIndex } from './cell-index.js';

/** What a builder mends: a damaged building, a damaged wall segment or gate, or a damaged moored ship. */
export type RepairSiteKind = 'building' | 'wall' | 'ship';

/** How one kind's damaged structures are found and keyed. */
interface RepairSiteSpec {
  readonly structure: Component<unknown>;
  /** The stores beside `Building` whose writes move a site's key or its standing as a site. */
  readonly values: readonly Component<unknown>[];
  /** Whether a damaged, positioned structure of the kind is a site now. */
  readonly standing: (world: World, e: Entity) => boolean;
  /** The cell a site is keyed by, when it is not the one the index derives. */
  readonly door?: (world: World, terrain: TerrainGraph, e: Entity) => NodeId | null;
}

const ALWAYS = (): boolean => true;

/** A ship is mended only while it lies moored, from the shore it lies at. */
function mooringCell(world: World, terrain: TerrainGraph, ship: Entity): NodeId | null {
  const mooring = mooringOf(world, ship);
  return mooring === null ? null : terrain.nodeAtClamped(mooring.hx, mooring.hy);
}

const SPECS: Readonly<Record<RepairSiteKind, RepairSiteSpec>> = {
  building: { structure: Building, values: [], standing: ALWAYS },
  wall: { structure: Palisade, values: [], standing: ALWAYS },
  ship: {
    structure: Vehicle,
    values: [Vehicle],
    standing: (world, e) => mooringOf(world, e) !== null,
    door: mooringCell,
  },
};

/**
 * The damaged structures of one kind as a cell index, kept across ticks per world like the stockpile
 * index: a building or wall never moves and its door changes only with a `Building` write, and a ship
 * comes and goes with its mooring's `Vehicle` writes, so the membership journals and those value journals
 * name every site whose key changed.
 */
class RepairSiteCells {
  readonly index: InteractionCellIndex;
  private readonly captures: JournaledCaptures<true>;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
    private readonly spec: RepairSiteSpec,
  ) {
    const index = this.freshIndex([]);
    this.index = index;
    const { structure, values, standing } = spec;
    this.captures = new JournaledCaptures(
      world,
      { membership: [Damaged, structure, Position, Building], values: [Building, ...values] },
      () => this.damaged(),
      {
        capture: (e) =>
          world.has(e, Damaged) && world.has(e, structure) && world.has(e, Position) && standing(world, e)
            ? true
            : null,
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
    const fresh = this.freshIndex(this.damaged());
    return this.index.divergence(fresh).map((m) => `repairSiteCells ${kind}: ${m}`);
  }

  private freshIndex(candidates: readonly Entity[]): InteractionCellIndex {
    const { world, content, terrain } = this;
    const door = this.spec.door;
    const doorOf = door === undefined ? undefined : (e: Entity) => door(world, terrain, e);
    return new InteractionCellIndex(world, { content, terrain }, terrain, candidates, doorOf);
  }

  private damaged(): readonly Entity[] {
    const { world, spec } = this;
    return world.canonicalQuery(Damaged, spec.structure, Position).filter((e) => spec.standing(world, e));
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
    ledger = new RepairSiteCells(world, content, terrain, SPECS[kind]);
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
