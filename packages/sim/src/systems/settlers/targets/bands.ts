import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingBlockedCells } from '../../footprint/index.js';
import { isTemple } from '../../readviews/index.js';
import {
  accessibleStockAmounts,
  mayFetchGoodFrom,
  typeProducesGoodWithoutInputs,
} from '../../stores/index.js';
import { InteractionCellIndex } from './cell-index.js';
import { FetchableStock } from './stores/fetchable-stock.js';
import { buriedUnderBuilding, canStoreGood } from './stores/stock.js';

/** How a missing-input candidate supplies the good: lift it from a store's stock, or crank a built
 *  input-less utility (a well, a hive) in place. */
export type InputSourceKind = 'fetch' | 'draw';

/** The missing-input band for one good: its members re-indexed for the ring search, with each member's
 *  derived kind so no query re-probes stock or content. */
export interface InputSourceBand {
  readonly index: InteractionCellIndex;
  readonly kindOf: ReadonlyMap<Entity, InputSourceKind>;
}

/**
 * Tick-local memo of question-keyed candidate bands: the candidates passing one question's
 * position-independent acceptance, re-indexed for the ring search so every asker this tick shares one
 * filtered scan. Per-seeker filters (owner side, signpost gate, failed-goal veto, ranking origin) stay
 * per query, so a band query returns exactly the winner a full scan with the same acceptance picks:
 * the candidate set is identical and the `(distance, cell-id, entity-id)` order is the index's.
 *
 * Every band drops when a component generation its acceptances read moves, so a tracked intra-tick
 * write or membership change rebuilds instead of serving a stale winner. Position values and untracked
 * raw writes (`Building.built` progress) are not stamped: the pass snapshot freezes them, exactly as
 * it does for the unfiltered per-tick indexes.
 */
export class TargetBands {
  private readonly holdingByGood = new Map<number, InteractionCellIndex>();
  private readonly sinksByGood = new Map<number, InteractionCellIndex>();
  private readonly storageSinksByGood = new Map<number, InteractionCellIndex>();
  private readonly inputSourcesByGood = new Map<number, InputSourceBand>();
  private templeBand: InteractionCellIndex | undefined;
  private stamp: number;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    /** Canonical ascending-id `Stockpile + Position` candidates, the store questions' universe. */
    private readonly stockpiles: readonly Entity[],
    /** Canonical ascending-id `Building + Position` candidates, the temple question's universe. */
    private readonly buildings: readonly Entity[],
  ) {
    this.stamp = this.generationSum();
  }

  /** Stores {@link storeYieldsGood} would strip of `goodType`, drawn from the cross-tick holder ledger so
   *  a rebuild costs the good's holders rather than every stockpile. */
  holding(goodType: number): InteractionCellIndex {
    this.ensureFresh();
    let index = this.holdingByGood.get(goodType);
    if (index === undefined) {
      const { world, terrain } = this;
      const walls = buildingBlockedCells(world, this.ctx, terrain);
      const members: Entity[] = [];
      for (const e of FetchableStock.of(world, this.ctx).holders(goodType)) {
        if (!buriedUnderBuilding(world, terrain, walls, e)) members.push(e);
      }
      index = this.indexOver(members.sort((a, b) => a - b));
      this.holdingByGood.set(goodType, index);
    }
    return index;
  }

  /** Stores {@link canStoreGood} accepts `goodType` into, keyed separately per `excludeProducers` mode. */
  sinksFor(goodType: number, excludeProducers: boolean): InteractionCellIndex {
    this.ensureFresh();
    const memo = excludeProducers ? this.storageSinksByGood : this.sinksByGood;
    let index = memo.get(goodType);
    if (index === undefined) {
      index = this.indexOver(
        this.stockpiles.filter((e) => canStoreGood(this.world, this.ctx, e, goodType, excludeProducers)),
      );
      memo.set(goodType, index);
    }
    return index;
  }

  /** Fetch and draw sources for a missing recipe input of `goodType`; fetch wins when a candidate
   *  qualifies both ways, matching the unshared accept's test order. */
  inputSources(goodType: number): InputSourceBand {
    this.ensureFresh();
    let band = this.inputSourcesByGood.get(goodType);
    if (band === undefined) {
      const walls = buildingBlockedCells(this.world, this.ctx, this.terrain);
      const kindOf = new Map<Entity, InputSourceKind>();
      const members: Entity[] = [];
      for (const e of this.stockpiles) {
        const kind = this.inputSourceKind(walls, e, goodType);
        if (kind === null) continue;
        kindOf.set(e, kind);
        members.push(e);
      }
      band = { index: this.indexOver(members), kindOf };
      this.inputSourcesByGood.set(goodType, band);
    }
    return band;
  }

  /** The player-blind temple band; a seeker's own-side filter stays per query. */
  temples(): InteractionCellIndex {
    this.ensureFresh();
    this.templeBand ??= this.indexOver(this.buildings.filter((e) => isTemple(this.world, this.ctx, e)));
    return this.templeBand;
  }

  private inputSourceKind(walls: ReadonlySet<NodeId>, e: Entity, goodType: number): InputSourceKind | null {
    const { world, ctx, terrain } = this;
    const stock = accessibleStockAmounts(world, e);
    if (
      (stock?.get(goodType) ?? 0) > 0 &&
      mayFetchGoodFrom(world, ctx, e, goodType) &&
      !buriedUnderBuilding(world, terrain, walls, e)
    ) {
      return 'fetch';
    }
    const b = world.tryGet(e, Building);
    if (b !== undefined && b.built >= ONE && typeProducesGoodWithoutInputs(ctx, b.buildingType, goodType)) {
      return 'draw';
    }
    return null;
  }

  private indexOver(members: readonly Entity[]): InteractionCellIndex {
    return new InteractionCellIndex(this.world, this.ctx, this.terrain, members);
  }

  /** The tracked component generations the band acceptances read, folded to one number: every channel
   *  only increments, so any movement strictly raises the sum and the check allocates nothing. */
  private generationSum(): number {
    const w = this.world;
    return (
      w.componentValueGeneration(Stockpile) +
      w.componentGeneration(Stockpile) +
      w.componentGeneration(Position) +
      w.componentGeneration(UnderConstruction) +
      w.componentGeneration(GroundDrop) +
      w.componentGeneration(Building) +
      w.componentValueGeneration(Building) +
      w.componentGeneration(Upgrading) +
      w.componentValueGeneration(Upgrading) +
      w.componentGeneration(Vehicle) +
      w.componentGeneration(DeliveryFlag)
    );
  }

  private ensureFresh(): void {
    const now = this.generationSum();
    if (now === this.stamp) return;
    this.stamp = now;
    this.holdingByGood.clear();
    this.sinksByGood.clear();
    this.storageSinksByGood.clear();
    this.inputSourcesByGood.clear();
    this.templeBand = undefined;
  }
}
