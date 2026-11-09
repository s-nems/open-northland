import { Owner, ownerOf, Stockpile } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import type { InteractionCellIndex } from '../settlers/targets/cell-index.js';
import { settlementReachAt } from '../signposts/settlement-reach.js';
import { isLoosePile } from '../stores/index.js';
import { sameFoodClass } from './goods.js';

/** The holding band of a good: its holders a fetcher can reach, piles filed by their own node. */
export type HoldingBandOf = (good: number) => InteractionCellIndex;

/** A settlement stop's loose ground for one good, read off the holding bands. */
export class SettlementGround {
  private unitsAt = -1;
  private held = 0;

  constructor(
    private readonly world: World,
    private readonly ctx: ContentContext,
    private readonly good: number,
    /** Ascending by id. */
    readonly piles: readonly Entity[],
    /** Each pile's node as an `x, y` pair, in the order of {@link piles}. */
    readonly nodes: Int32Array,
  ) {}

  /** The units of the good, or of a dish of its edible class, the piles hold now. */
  units(): number {
    const { world, ctx, good } = this;
    // Both only rise, so their sum moves with any stock write or pile gone.
    const at = world.componentValueGeneration(Stockpile) + world.componentGeneration(Stockpile);
    if (at === this.unitsAt) return this.held;
    let units = 0;
    for (const pile of this.piles) {
      const amounts = world.tryGet(pile, Stockpile)?.amounts;
      if (amounts === undefined) continue;
      for (const form of amounts.keys()) if (sameFoodClass(ctx, form, good)) units += amounts.get(form) ?? 0;
    }
    this.unitsAt = at;
    this.held = units;
    return units;
  }
}

/** A read held across plans, with every input it was derived from: an equal set means an equal read. */
interface HeldGround {
  readonly ground: SettlementGround;
  readonly reach: SpatialGate;
  readonly bands: readonly InteractionCellIndex[];
  readonly versions: readonly number[];
  readonly owners: number;
  readonly ownerValues: number;
}

const heldGrounds = new WeakMap<World, Map<string, HeldGround>>();
/** Reads held per world before they start over, bounding them as routes come and go. */
const HELD_GROUNDS_CAP = 1024;

/**
 * The loose ground piles of `anchor`'s settlement holding `good` or a dish of its edible class: unowned or
 * the trader's player's, in the anchor's settlement reach. Read off the holding bands, so a pile no
 * fetcher reaches (buried under walls, boxed in) stays out, and only the piles filed in the reach's box are
 * visited. Held until a band's candidates, the reach or an owner change, so the trader's scopes and its
 * helpers share one read.
 */
export function settlementGround(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  trader: Entity,
  anchor: Entity,
  good: number,
  holding: HoldingBandOf,
): SettlementGround {
  const player = ownerOf(world, trader);
  const anchorDoor = interactionNodeId(world, ctx, terrain, anchor);
  if (player === undefined || anchorDoor === null)
    return new SettlementGround(world, ctx, good, [], NO_NODES);
  const reach = settlementReachAt(world, ctx.content, terrain, player, anchorDoor);
  const bands: InteractionCellIndex[] = [];
  for (const { typeId: form } of ctx.content.goods)
    if (sameFoodClass(ctx, form, good)) bands.push(holding(form));
  const owners = world.componentGeneration(Owner);
  const ownerValues = world.componentValueGeneration(Owner);
  let byKey = heldGrounds.get(world);
  if (byKey === undefined) {
    byKey = new Map();
    heldGrounds.set(world, byKey);
  }
  const key = `${player}:${anchor}:${good}`;
  const held = byKey.get(key);
  if (
    held !== undefined &&
    held.reach === reach &&
    held.owners === owners &&
    held.ownerValues === ownerValues &&
    held.bands.length === bands.length &&
    held.bands.every((band, i) => band === bands[i] && band.version === held.versions[i])
  )
    return held.ground;
  const ground = readGround(world, ctx, terrain, player, reach, good, bands);
  if (held === undefined && byKey.size >= HELD_GROUNDS_CAP) byKey.clear();
  byKey.set(key, {
    ground,
    reach,
    bands,
    versions: bands.map((band) => band.version),
    owners,
    ownerValues,
  });
  return ground;
}

function readGround(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  player: number,
  reach: SpatialGate,
  good: number,
  bands: readonly InteractionCellIndex[],
): SettlementGround {
  const found = new Map<Entity, HalfCellNode>();
  for (const band of bands) {
    band.forEachLooseIn(reach.bounds, (pile, hx, hy) => {
      if (found.has(pile) || !isLoosePile(world, pile)) return;
      const owner = ownerOf(world, pile);
      if (owner !== undefined && owner !== player) return;
      if (!reach.allowsNode(terrain.nodeAt(hx, hy))) return;
      found.set(pile, { hx, hy });
    });
  }
  const piles = [...found.keys()].sort((a, b) => a - b);
  const nodes = new Int32Array(2 * piles.length);
  piles.forEach((pile, i) => {
    const at = found.get(pile);
    nodes[2 * i] = at?.hx ?? 0;
    nodes[2 * i + 1] = at?.hy ?? 0;
  });
  return new SettlementGround(world, ctx, good, piles, nodes);
}

const NO_NODES = new Int32Array(0);
