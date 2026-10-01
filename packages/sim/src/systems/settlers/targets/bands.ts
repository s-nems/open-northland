import type { ContentSet, PrayerSite } from '@open-northland/data';
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
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../../context.js';
import { buildingBlockedCells } from '../../footprint/index.js';
import { isFinishedPrayerSite } from '../../readviews/index.js';
import { InteractionCellIndex } from './cell-index.js';
import { FetchableStock } from './stores/fetchable-stock.js';
import { StoreSinks } from './stores/sinks.js';
import { strandedPile } from './stores/stock.js';

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
 * passes ({@link HeldBand}), so a sync costs one acceptance check per candidate and an index edit per
 * change, not a rebuild.
 */
export class TargetBands {
  private readonly held: HeldBands;
  /** The held bands synced since the last generation move. */
  private readonly synced = new Set<HeldBand>();
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

  private fresh(band: HeldBand): InteractionCellIndex {
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

/** The `Position` and `Building` revisions a member's index key was derived under, and the last sync
 *  that confirmed it. */
interface FiledMember {
  position: number | undefined;
  building: number | undefined;
  sweep: number;
}

/**
 * One question's band kept across passes: {@link sync} re-runs the question and edits the index by the
 * difference, so it holds exactly what a fresh build over the question's answer holds. A member is
 * re-filed when its `Position` or `Building` was written since it was filed, the inputs of its door or
 * node key.
 */
class HeldBand {
  readonly index: InteractionCellIndex;
  private readonly filed = new Map<Entity, FiledMember>();
  private sweep = 0;
  private readonly keepMember = (e: Entity): void => this.keep(e);
  private readonly dropUnseen = (member: FiledMember, e: Entity): void => {
    if (member.sweep === this.sweep) return;
    this.index.remove(e);
    this.filed.delete(e);
  };

  constructor(
    private readonly world: World,
    ctx: MapContext,
    terrain: TerrainGraph,
    /** Visits every entity the question admits right now, each once. */
    private readonly question: (visit: (e: Entity) => void) => void,
  ) {
    this.index = new InteractionCellIndex(world, ctx, terrain);
  }

  sync(): void {
    this.sweep++;
    this.question(this.keepMember);
    this.filed.forEach(this.dropUnseen);
  }

  /** The members as of the last sync, ascending-id. */
  members(): Entity[] {
    return [...this.filed.keys()].sort((a, b) => a - b);
  }

  private keep(e: Entity): void {
    const position = this.world.revisionOf(e, Position);
    const building = this.world.revisionOf(e, Building);
    const member = this.filed.get(e);
    if (member === undefined) {
      this.index.add(e);
      this.filed.set(e, { position, building, sweep: this.sweep });
      return;
    }
    if (member.position !== position || member.building !== building) {
      this.index.remove(e);
      this.index.add(e);
      member.position = position;
      member.building = building;
    }
    member.sweep = this.sweep;
  }
}

/** A world's held holding and sink bands, keyed by good, for one content set and terrain. */
class HeldBands {
  private readonly holdingByGood = new Map<number, HeldBand>();
  private readonly sinksByGood = new Map<number, HeldBand>();
  private readonly storageSinksByGood = new Map<number, HeldBand>();
  readonly ctx: MapContext;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    this.ctx = { content, terrain };
  }

  holding(goodType: number): HeldBand {
    let band = this.holdingByGood.get(goodType);
    if (band === undefined) {
      const { world, ctx, terrain } = this;
      band = new HeldBand(world, ctx, terrain, (visit) => {
        const walls = buildingBlockedCells(world, ctx, terrain);
        for (const e of FetchableStock.of(world, ctx).holders(goodType)) {
          if (!strandedPile(world, ctx, terrain, walls, e)) visit(e);
        }
      });
      this.holdingByGood.set(goodType, band);
    }
    return band;
  }

  sinks(goodType: number, excludeProducers: boolean): HeldBand {
    const memo = excludeProducers ? this.storageSinksByGood : this.sinksByGood;
    let band = memo.get(goodType);
    if (band === undefined) {
      const { world, ctx, terrain } = this;
      band = new HeldBand(world, ctx, terrain, (visit) => {
        for (const e of StoreSinks.of(world, ctx).sinks(goodType, excludeProducers)) visit(e);
      });
      memo.set(goodType, band);
    }
    return band;
  }

  /** A mismatch per held band whose index, synced to the live world, differs from a fresh build over the
   *  same members. */
  verify(): string[] {
    const problems: string[] = [];
    const check = (kind: string, bands: ReadonlyMap<number, HeldBand>): void => {
      for (const [good, band] of bands) {
        band.sync();
        const fresh = new InteractionCellIndex(this.world, this.ctx, this.terrain, band.members());
        for (const m of band.index.divergence(fresh)) problems.push(`targetBands ${kind} ${good}: ${m}`);
      }
    };
    check('holding', this.holdingByGood);
    check('sinks', this.sinksByGood);
    check('storageSinks', this.storageSinksByGood);
    return problems;
  }
}

const heldBandsByWorld = new WeakMap<World, HeldBands>();

function heldBands(world: World, ctx: SystemContext, terrain: TerrainGraph): HeldBands {
  let held = heldBandsByWorld.get(world);
  if (held === undefined || held.content !== ctx.content || held.terrain !== terrain) {
    if (held === undefined) {
      world.registerCacheVerifier('targetBands', () => heldBandsByWorld.get(world)?.verify() ?? []);
    }
    held = new HeldBands(world, ctx.content, terrain);
    heldBandsByWorld.set(world, held);
  }
  return held;
}
