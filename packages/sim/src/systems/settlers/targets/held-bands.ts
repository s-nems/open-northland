import type { ContentSet } from '@open-northland/data';
import { Building, GroundDrop, Position, Resource } from '../../../components/index.js';
import type { ChangeFeed } from '../../../ecs/change-feed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { MapContext, SystemContext } from '../../context.js';
import { buildingBlockedCells, stanceOverlayEpoch } from '../../footprint/index.js';
import { type WalkBlockMask, walkBlockMask } from '../../footprint/walk-block-mask.js';
import { InteractionCellIndex } from './cell-index.js';
import { FetchableStock } from './stores/fetchable-stock.js';
import { StoreSinks } from './stores/sinks.js';
import { strandedPile, strandedPlainPile } from './stores/stock.js';

/** A band kept across passes, brought up to date by {@link sync}. */
export interface SyncedBand {
  readonly index: InteractionCellIndex;
  sync(): void;
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
    private readonly ctx: MapContext,
    private readonly terrain: TerrainGraph,
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

  /** Re-judge one entity between sweeps: file or re-file it when `admitted`, else drop it. */
  refile(e: Entity, admitted: boolean): void {
    if (admitted) this.keep(e);
    else if (this.filed.delete(e)) this.index.remove(e);
  }

  /** The members as of the last sync, ascending-id. */
  members(): Entity[] {
    return [...this.filed.keys()].sort((a, b) => a - b);
  }

  /** A mismatch per member whose index entry differs from a fresh build over the same members. */
  divergence(): string[] {
    return this.index.divergence(
      new InteractionCellIndex(this.world, this.ctx, this.terrain, this.members()),
    );
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

/** Where a judged plain pile is filed: under its anchor's block while that node is clear, else among the
 *  piles every structure move re-judges. */
type PilePlace = 'open' | 'covered' | 'unfiled';

/** A holder's burial verdict and what it reads besides the overlay, fixed until the ledger recaptures it. */
interface JudgedHolder {
  /** A store is never stranded by its own walls, so an overlay move leaves it alone. */
  readonly store: boolean;
  /** A plain pile's node; null for a store or a ground drop, which a standing resource may cover. */
  readonly anchor: NodeId | null;
  admitted: boolean;
  place: PilePlace;
}

/** Side, in half-cell nodes, of the blocks the open piles are filed in, so a walk-block flip re-judges only
 *  the blocks it touched. Performance knob: any size re-judges every pile that could change. */
const OPEN_PILE_BLOCK = 16;

const ANY_FLIP = (): boolean => true;

/**
 * The band of stores {@link storeYieldsGood} would strip of one good, kept off the holder ledger: a sync
 * judges again the holders the ledger recaptured since the last one, since a positioned stockpile never
 * moves, and only the piles' burial when the structure overlay that check reads moved. A `supplying`
 * band also admits the good's self-filling houses while they are empty.
 *
 * A plain pile's verdict reads only the walls and the stance pools of its anchor, which the overlay epoch
 * versions, so a move of the standing resources alone re-judges just the ground drops. A pile on a
 * walkable anchor outside the walk-block union stands there itself, and the walls and resource blocks
 * lie inside that union, so it stays admitted until its anchor flips: such an open pile is re-judged only
 * when the mask stamps a flip in its block.
 */
class HoldingBand implements SyncedBand {
  private readonly band: HeldBand;
  private readonly judged = new Map<Entity, JudgedHolder>();
  /** The open plain piles by the block of their anchor; see {@link OPEN_PILE_BLOCK}. */
  private readonly openPiles = new Map<number, Map<Entity, JudgedHolder>>();
  /** The plain piles that are not open, re-judged on every structure move. Stores, which an overlay move
   *  never re-judges, are filed in neither. */
  private readonly coveredPiles = new Map<Entity, JudgedHolder>();
  private readonly drops = new Map<Entity, JudgedHolder>();
  private ledger: FetchableStock | null = null;
  private feed: ChangeFeed | null = null;
  /** The overlay the verdicts were judged under: the walls, the stance pool epoch and the
   *  standing-resource generation a ground drop's work cells are looked up by. */
  private walls: ReadonlySet<NodeId> = NO_WALLS;
  private overlay = -1;
  private resources = -1;
  /** The walk-block mask the open piles were filed under, and its version then. */
  private mask: WalkBlockMask | null = null;
  private maskVersion = -1;
  private readonly blockColumns: number;
  private readonly blockArea = { minHx: 0, minHy: 0, maxHx: 0, maxHy: 0 };
  private readonly rejudgeHolder = (e: Entity): void => this.rejudge(e);
  private readonly visitAdmitted = (visit: (e: Entity) => void): void => {
    this.judged.forEach((holder, e) => {
      if (holder.admitted) visit(e);
    });
  };

  constructor(
    private readonly world: World,
    private readonly ctx: MapContext,
    private readonly terrain: TerrainGraph,
    private readonly goodType: number,
    private readonly supplying: boolean,
  ) {
    this.band = new HeldBand(world, ctx, terrain, this.visitAdmitted);
    this.blockColumns = Math.ceil(terrain.width / OPEN_PILE_BLOCK);
  }

  get index(): InteractionCellIndex {
    return this.band.index;
  }

  sync(): void {
    const { world, ctx, terrain } = this;
    const ledger = FetchableStock.of(world, ctx);
    const walls = buildingBlockedCells(world, ctx, terrain);
    const overlay = stanceOverlayEpoch(world, ctx, terrain);
    const resources = world.componentGeneration(Resource);
    const mask = walkBlockMask(world, ctx, terrain);
    const structuresMoved = walls !== this.walls || overlay !== this.overlay;
    const resourcesMoved = resources !== this.resources;
    const flippedSince = mask === this.mask ? this.maskVersion : null;
    this.walls = walls;
    this.overlay = overlay;
    this.resources = resources;
    this.mask = mask;
    this.maskVersion = mask.version;
    if (this.feed === null || ledger !== this.ledger || flippedSince === null) {
      this.ledger = ledger;
      this.feed = this.supplying ? ledger.watchSuppliers(this.goodType) : ledger.watchHolders(this.goodType);
      this.rebuild();
      return;
    }
    if (this.feed.drain(this.rejudgeHolder)) {
      this.rebuild();
      return;
    }
    if (structuresMoved) this.coveredPiles.forEach(this.reburyPile);
    if (flippedSince !== this.maskVersion) this.reburyFlippedOpenPiles(mask, flippedSince);
    if (structuresMoved || resourcesMoved) this.drops.forEach(this.reburyPile);
  }

  /** A mismatch per member that differs from a cold judgement of every holder, or whose index entry
   *  differs from a fresh build. */
  verify(): string[] {
    this.sync();
    const members = new Set(this.holders());
    for (const e of this.refillers()) members.add(e);
    const cold = [...members].filter((e) => this.admitsCold(e)).sort((a, b) => a - b);
    const held = this.band.members();
    const problems = this.band.divergence();
    if (cold.length !== held.length || cold.some((e, i) => held[i] !== e)) {
      problems.push(`members [${held.join(',')}] differ from a cold judgement [${cold.join(',')}]`);
    }
    return problems;
  }

  private rebuild(): void {
    this.judged.clear();
    this.openPiles.clear();
    this.coveredPiles.clear();
    this.drops.clear();
    for (const e of this.holders()) this.record(e, this.judge(e));
    for (const e of this.refillers()) this.record(e, this.judge(e));
    this.band.sync();
  }

  private rejudge(e: Entity): void {
    const held = this.judged.get(e);
    if (held !== undefined) this.unfile(e, held);
    if (!this.holders().has(e) && !this.refillers().has(e)) {
      this.judged.delete(e);
      this.band.refile(e, false);
      return;
    }
    const holder = this.judge(e);
    this.record(e, holder);
    this.band.refile(e, holder.admitted);
  }

  /** File `holder` as `e`'s verdict, and under its pile kind unless it is a store. */
  private record(e: Entity, holder: JudgedHolder): void {
    this.judged.set(e, holder);
    if (holder.store) return;
    if (holder.anchor === null) this.drops.set(e, holder);
    else this.filePile(e, holder, holder.anchor);
  }

  /** File plain pile `e` as open or covered by its verdict and its anchor's current block, unless it is
   *  filed there already: a pile re-filed while its map is walked would be walked again. */
  private filePile(e: Entity, holder: JudgedHolder, anchor: NodeId): void {
    const mask = this.mask;
    const place: PilePlace =
      holder.admitted && mask !== null && this.terrain.isWalkable(anchor) && !mask.has(anchor)
        ? 'open'
        : 'covered';
    if (place === holder.place) return;
    this.unfile(e, holder);
    holder.place = place;
    if (place === 'covered') {
      this.coveredPiles.set(e, holder);
      return;
    }
    const block = this.blockOf(anchor);
    let piles = this.openPiles.get(block);
    if (piles === undefined) {
      piles = new Map();
      this.openPiles.set(block, piles);
    }
    piles.set(e, holder);
  }

  /** Drop `e` from whichever pile map holds it. */
  private unfile(e: Entity, holder: JudgedHolder): void {
    if (holder.anchor === null) {
      this.drops.delete(e);
      return;
    }
    if (holder.place === 'covered') this.coveredPiles.delete(e);
    else if (holder.place === 'open') {
      const block = this.blockOf(holder.anchor);
      const piles = this.openPiles.get(block);
      piles?.delete(e);
      if (piles?.size === 0) this.openPiles.delete(block);
    }
    holder.place = 'unfiled';
  }

  private blockOf(anchor: NodeId): number {
    const { terrain } = this;
    return (
      Math.floor(terrain.yOf(anchor) / OPEN_PILE_BLOCK) * this.blockColumns +
      Math.floor(terrain.xOf(anchor) / OPEN_PILE_BLOCK)
    );
  }

  /** Re-judge the open piles whose anchor the mask now blocks, in the blocks it stamped a flip in after
   *  version `since`. One whose anchor is clear again stands where it stood, admitted. */
  private reburyFlippedOpenPiles(mask: WalkBlockMask, since: number): void {
    const area = this.blockArea;
    this.openPiles.forEach((piles, block) => {
      const column = block % this.blockColumns;
      const row = (block - column) / this.blockColumns;
      area.minHx = column * OPEN_PILE_BLOCK;
      area.maxHx = area.minHx + OPEN_PILE_BLOCK - 1;
      area.minHy = row * OPEN_PILE_BLOCK;
      area.maxHy = area.minHy + OPEN_PILE_BLOCK - 1;
      if (!mask.flippedSince(area, since, ANY_FLIP)) return;
      piles.forEach((holder, e) => {
        if (holder.anchor !== null && mask.has(holder.anchor)) this.reburyPile(holder, e);
      });
    });
  }

  private readonly reburyPile = (holder: JudgedHolder, e: Entity): void => {
    const { world, ctx, terrain, walls } = this;
    const admitted =
      holder.anchor === null
        ? !strandedPile(world, ctx, terrain, walls, e)
        : !strandedPlainPile(world, ctx, terrain, walls, holder.anchor);
    if (admitted !== holder.admitted) {
      holder.admitted = admitted;
      this.band.refile(e, admitted);
    }
    if (holder.anchor !== null) this.filePile(e, holder, holder.anchor);
  };

  private judge(e: Entity): JudgedHolder {
    const { world, terrain } = this;
    const store = world.has(e, Building);
    let anchor: NodeId | null = null;
    if (!store && !world.has(e, GroundDrop)) {
      const p = world.get(e, Position);
      anchor = terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
    }
    return { store, anchor, admitted: this.admitsCold(e), place: 'unfiled' };
  }

  private admitsCold(e: Entity): boolean {
    return !strandedPile(this.world, this.ctx, this.terrain, this.walls, e);
  }

  private holders(): ReadonlySet<Entity> {
    return this.ledger?.holders(this.goodType) ?? NO_HOLDERS;
  }

  /** The self-filling houses a `supplying` band admits besides the holders; none for a holding band. */
  private refillers(): ReadonlySet<Entity> {
    return (this.supplying ? this.ledger?.refillers(this.goodType) : undefined) ?? NO_HOLDERS;
  }
}

const NO_WALLS: ReadonlySet<NodeId> = new Set();
const NO_HOLDERS: ReadonlySet<Entity> = new Set();

/** A world's held holding and sink bands, keyed by good, for one content set and terrain. */
export class HeldBands {
  private readonly holdingByGood = new Map<number, HoldingBand>();
  private readonly supplyingByGood = new Map<number, HoldingBand>();
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

  holding(goodType: number): HoldingBand {
    return this.holdingBand(this.holdingByGood, goodType, false);
  }

  /** {@link holding} plus the good's self-filling houses, empty ones included. */
  supplying(goodType: number): HoldingBand {
    return this.holdingBand(this.supplyingByGood, goodType, true);
  }

  private holdingBand(memo: Map<number, HoldingBand>, goodType: number, supplying: boolean): HoldingBand {
    let band = memo.get(goodType);
    if (band === undefined) {
      band = new HoldingBand(this.world, this.ctx, this.terrain, goodType, supplying);
      memo.set(goodType, band);
    }
    return band;
  }

  sinks(goodType: number, excludeProducers: boolean): HeldBand {
    const memo = excludeProducers ? this.storageSinksByGood : this.sinksByGood;
    let band = memo.get(goodType);
    if (band === undefined) {
      const { world, ctx, terrain } = this;
      band = new HeldBand(world, ctx, terrain, (visit) => {
        // forEach, not for-of: a set's iterator costs a result per member on this per-sync walk.
        StoreSinks.of(world, ctx)
          .sinks(goodType, excludeProducers)
          .forEach((e) => {
            visit(e);
          });
      });
      memo.set(goodType, band);
    }
    return band;
  }

  /** A mismatch per held band whose index, synced to the live world, differs from a fresh build over the
   *  same members, or whose holding members differ from a cold judgement. */
  verify(): string[] {
    const problems: string[] = [];
    for (const [good, band] of this.holdingByGood) {
      for (const m of band.verify()) problems.push(`targetBands holding ${good}: ${m}`);
    }
    for (const [good, band] of this.supplyingByGood) {
      for (const m of band.verify()) problems.push(`targetBands supplying ${good}: ${m}`);
    }
    const check = (kind: string, bands: ReadonlyMap<number, HeldBand>): void => {
      for (const [good, band] of bands) {
        band.sync();
        for (const m of band.divergence()) problems.push(`targetBands ${kind} ${good}: ${m}`);
      }
    };
    check('sinks', this.sinksByGood);
    check('storageSinks', this.storageSinksByGood);
    return problems;
  }
}

const heldBandsByWorld = new WeakMap<World, HeldBands>();

export function heldBands(world: World, ctx: SystemContext, terrain: TerrainGraph): HeldBands {
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
