import type { PrayerSite } from '@open-northland/data';
import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Palisade,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingBlockedCells } from '../../footprint/index.js';
import { isFinishedPrayerSite } from '../../readviews/index.js';
import { lowestStockedGood } from '../../stores/index.js';
import { InteractionCellIndex } from './cell-index.js';
import { FetchableStock } from './stores/fetchable-stock.js';
import { StoreSinks } from './stores/sinks.js';
import { buriedUnderBuilding } from './stores/stock.js';

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
  private readonly prayerSiteBands = new Map<PrayerSite, InteractionCellIndex>();
  private groundPileBand: InteractionCellIndex | undefined;
  private stamp: number;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    /** Canonical ascending-id `Stockpile + Position` candidates, the ground-pile question's universe. */
    private readonly stockpiles: readonly Entity[],
    /** Canonical ascending-id `Building + Position` candidates, the prayer-site questions' universe. */
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

  /** Stores {@link canStoreGood} accepts `goodType` into, keyed separately per `excludeProducers` mode and
   *  drawn from the cross-tick sink ledger. */
  sinksFor(goodType: number, excludeProducers: boolean): InteractionCellIndex {
    this.ensureFresh();
    const memo = excludeProducers ? this.storageSinksByGood : this.sinksByGood;
    let index = memo.get(goodType);
    if (index === undefined) {
      const sinks = StoreSinks.of(this.world, this.ctx).sinks(goodType, excludeProducers);
      index = this.indexOver([...sinks].sort((a, b) => a - b));
      memo.set(goodType, index);
    }
    return index;
  }

  /** Unburied building-less piles holding any good, loose heaps and boat hulls alike: the porter pickup's
   *  seeker-independent half. */
  groundPiles(): InteractionCellIndex {
    this.ensureFresh();
    if (this.groundPileBand === undefined) {
      const { world, terrain } = this;
      const walls = buildingBlockedCells(world, this.ctx, terrain);
      this.groundPileBand = this.indexOver(
        this.stockpiles.filter((e) => {
          if (world.has(e, Building) || !world.has(e, Position)) return false;
          const stock = world.tryGet(e, Stockpile);
          return (
            stock !== undefined &&
            lowestStockedGood(stock) !== null &&
            !buriedUnderBuilding(world, terrain, walls, e)
          );
        }),
      );
    }
    return this.groundPileBand;
  }

  /** The player-blind band of finished `site` buildings; a seeker's own-side filter stays per query. */
  prayerSites(site: PrayerSite): InteractionCellIndex {
    this.ensureFresh();
    let band = this.prayerSiteBands.get(site);
    if (band === undefined) {
      band = this.indexOver(
        this.buildings.filter((e) => isFinishedPrayerSite(this.world, this.ctx, e, site)),
      );
      this.prayerSiteBands.set(site, band);
    }
    return band;
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
      w.componentGeneration(Palisade) +
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
    this.prayerSiteBands.clear();
    this.groundPileBand = undefined;
  }
}
