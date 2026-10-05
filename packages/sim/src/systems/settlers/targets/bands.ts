import type { PrayerSite } from '@open-northland/data';
import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Palisade,
  Position,
  RoadSite,
  Stockpile,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SpatialGate } from '../../../nav/node-circle.js';
import { intersectReach } from '../../../nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isFinishedPrayerSite } from '../../readviews/index.js';
import { goodsSearchLimitAt } from '../../signposts/reach.js';
import { InteractionCellIndex } from './cell-index.js';
import { type HeldBands, heldBands, type SyncedBand } from './held-bands.js';

/**
 * Tick-local memo of question-keyed candidate bands: the candidates passing one question's
 * position-independent acceptance, re-indexed for the ring search so every asker this tick shares one
 * filtered scan. Per-seeker filters (owner side, signpost gate, failed-goal veto, ranking origin) stay
 * per query, so a band query returns exactly the winner a full scan with the same acceptance picks:
 * the candidate set is identical and the `(distance, cell-id, entity-id)` order is the index's.
 *
 * Every band re-syncs when a component generation its acceptances read moves, so a tracked intra-tick
 * write or membership change re-files instead of serving a stale winner. Position values and untracked
 * raw writes (`Building.built` progress) are not stamped: the pass snapshot freezes them, exactly as
 * it does for the unfiltered per-tick indexes. The holding and sink bands keep their index across
 * passes (`held-bands.ts`), so a sink sync costs one acceptance check per candidate, a holding sync one
 * per changed holder plus a burial check per pile when the structure overlay moved, and an index edit
 * per change, not a rebuild.
 */
export class TargetBands {
  private readonly held: HeldBands;
  /** The held bands synced since the last generation move. */
  private readonly synced = new Set<SyncedBand>();
  private readonly prayerSiteBands = new Map<PrayerSite, InteractionCellIndex>();
  private stamp: number;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    /** Canonical ascending-id `Building + Position` candidates, the prayer-site questions' universe. */
    private readonly buildings: readonly Entity[],
  ) {
    this.held = heldBands(world, ctx, terrain);
    this.stamp = this.generationSum();
  }

  goodsGate(here: NodeId, owner: number | undefined, gate?: SpatialGate): SpatialGate | undefined {
    return intersectReach(
      gate,
      goodsSearchLimitAt(
        this.world,
        this.ctx.content,
        this.terrain,
        owner,
        this.terrain.xOf(here),
        this.terrain.yOf(here),
      ),
    );
  }

  /** Stores {@link storeYieldsGood} would strip of `goodType`, drawn from the cross-tick holder ledger so
   *  a sync costs the good's holders rather than every stockpile. */
  holding(goodType: number): InteractionCellIndex {
    return this.fresh(this.held.holding(goodType));
  }

  /** Stores {@link canStoreGood} accepts `goodType` into, keyed separately per `excludeProducers` mode and
   *  drawn from the cross-tick sink ledger. */
  sinksFor(goodType: number, excludeProducers: boolean): InteractionCellIndex {
    return this.fresh(this.held.sinks(goodType, excludeProducers));
  }

  /** The player-blind band of finished `site` buildings; a seeker's own-side filter stays per query. */
  prayerSites(site: PrayerSite): InteractionCellIndex {
    this.ensureFresh();
    let band = this.prayerSiteBands.get(site);
    if (band === undefined) {
      band = new InteractionCellIndex(
        this.world,
        this.ctx,
        this.terrain,
        this.buildings.filter((e) => isFinishedPrayerSite(this.world, this.ctx, e, site)),
      );
      this.prayerSiteBands.set(site, band);
    }
    return band;
  }

  private fresh(band: SyncedBand): InteractionCellIndex {
    this.ensureFresh();
    if (!this.synced.has(band)) {
      band.sync();
      this.synced.add(band);
    }
    return band.index;
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
      w.componentGeneration(RoadSite) +
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
    this.synced.clear();
    this.prayerSiteBands.clear();
  }
}
