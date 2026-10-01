import { fogTileVisible, ONE, tileToScreenX, tileToScreenY, type WorldBounds } from '@open-northland/render';
import {
  type DiplomacyState,
  entitiesWith,
  entityById,
  type FogView,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  isWildlife,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerJobType,
  workFlagOf,
} from '../../game/snapshot.js';
import type { MinimapFilters, MinimapScope } from './filters.js';
import { MINIMAP_PLAYER_COLOURS, STANCE_COLOURS, STANCE_SELF_COLOUR } from './palette.js';
import type { MinimapMark, MinimapStampPart } from './stamps.js';

/** Fallback dot colour for a player outside the swatch table. */
const UNKNOWN_PLAYER_DOT_COLOUR = 0xffffff;
/** Animals keep one fauna tint whoever owns them, so a herd never reads as a crowd of settlers. */
export const ANIMAL_DOT_COLOUR = 0xd8c595;
/** Ordered road sites, a shade darker than the laid roads of `road-layer.ts`. */
export const ROAD_SITE_DOT_COLOUR = 0x9a8a6a;

export interface MinimapDotContext {
  readonly fog: FogView | null;
  readonly bounds: WorldBounds;
  /** Raster px per projected world px. */
  readonly scale: number;
  readonly filters: MinimapFilters;
  /** A soldier or hero trade, read from the running content's job roles. */
  readonly isFighterJob: (jobType: number) => boolean;
  /** The seat the view shows; null on a whole-map view, where every scope shows every owner. */
  readonly viewer: number | null;
  /** The viewer seat's stance toward `owner`. */
  readonly stanceToward: (owner: number) => DiplomacyState;
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/** The markers of one layer in stamping order, held as raster px so the rims pass and the fills pass
 *  cost no second position or fog lookup. */
class HeldMarks {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly marks: MinimapMark[] = [];
  private readonly colours: number[] = [];

  hold(bx: number, by: number, mark: MinimapMark, colour: number): void {
    this.xs.push(bx);
    this.ys.push(by);
    this.marks.push(mark);
    this.colours.push(colour);
  }

  emit(sink: MinimapDotSink, part: MinimapStampPart): void {
    for (let i = 0; i < this.xs.length; i++) {
      const bx = this.xs[i];
      const by = this.ys[i];
      const mark = this.marks[i];
      const colour = this.colours[i];
      if (bx !== undefined && by !== undefined && mark !== undefined && colour !== undefined)
        sink(bx, by, mark, colour, part);
    }
  }

  clear(): void {
    this.xs.length = 0;
    this.ys.length = 0;
    this.marks.length = 0;
    this.colours.length = 0;
  }
}

/** The four stamping groups of a layer, kept across walks so a replot grows no arrays once a game has
 *  shown its largest layer; a walk clears them first and after each layer. One walk runs at a time. */
const HELD = {
  plain: new HeldMarks(),
  soldiers: new HeldMarks(),
  hostiles: new HeldMarks(),
  hostileSoldiers: new HeldMarks(),
} as const;
const HELD_GROUPS: readonly HeldMarks[] = [HELD.plain, HELD.soldiers, HELD.hostiles, HELD.hostileSoldiers];

/** A plotted marker part: raster-px centre `(bx, by)`, its shape, packed `0xRRGGBB` colour and which
 *  part to paint; each layer sends every rim, then every fill. Loose primitives keep the sink itself
 *  free of allocation. */
export type MinimapDotSink = (
  bx: number,
  by: number,
  mark: MinimapMark,
  colour: number,
  part: MinimapStampPart,
) => void;

/** Whether an owned marker of `owner` passes the scope as seen from `viewer`. */
export function scopeAdmits(
  scope: MinimapScope,
  owner: number,
  viewer: number | null,
  stanceToward: (owner: number) => DiplomacyState,
): boolean {
  if (scope === 'everyone' || viewer === null) return true;
  if (owner === viewer) return scope === 'mine';
  if (scope === 'mine') return false;
  return stanceToward(owner) === (scope === 'friendly' ? 'friend' : 'enemy');
}

/** The component indexes the plot reads, for the frame's index registry. */
export function readMinimapIndexes(snapshot: WorldSnapshot): void {
  for (const name of ['Building', 'Settler', 'Signpost', 'WorkFlag', 'RoadSite'])
    entitiesWith(snapshot, name);
}

/**
 * Plot the enabled layers of `snapshot` in the ground raster's px, bottom to top: road sites, signposts
 * and flags, buildings, animals and people, vehicles. Each layer walks only its own component index, so
 * a replot costs the plotted entities, never the whole entity list. Laid roads are the road layer's.
 * Within a layer, hostile owners' markers stamp last and soldiers after civilians, so an enemy army is
 * never buried under the viewer's own crowd; the layer's rims all go under its fills, so a crowd reads
 * as one rimmed blob, while a later layer's rims still part it from the one below.
 */
export function forEachMinimapDot(
  snapshot: WorldSnapshot,
  ctx: MinimapDotContext,
  sink: MinimapDotSink,
): void {
  const { layers, scope } = ctx.filters;
  const { fog, bounds, scale, viewer, stanceToward } = ctx;
  const admits = (owner: number): boolean => scopeAdmits(scope, owner, viewer, stanceToward);
  const hostile = (owner: number): boolean =>
    viewer !== null && owner !== viewer && stanceToward(owner) === 'enemy';
  // Without a seat there is no stance to paint, so a whole-map view keeps the team colours.
  const byStance = ctx.filters.colours === 'stance' && viewer !== null;
  const colourOf = (player: number): number => {
    if (byStance) return player === viewer ? STANCE_SELF_COLOUR : STANCE_COLOURS[stanceToward(player)];
    return (
      MINIMAP_PLAYER_COLOURS[(ctx.playerColourOf?.(player) ?? player) % MINIMAP_PLAYER_COLOURS.length] ??
      UNKNOWN_PLAYER_DOT_COLOUR
    );
  };
  const { plain, soldiers, hostiles, hostileSoldiers } = HELD;
  for (const group of HELD_GROUPS) group.clear();
  // Only currently-visible ground plots an entity; the viewer's own forces always see their own cell.
  const place = (e: SnapshotEntity, mark: MinimapMark, colour: number, group: HeldMarks): void => {
    const at = positionOf(e);
    if (at === undefined) return;
    const col = at.x / ONE;
    const row = at.y / ONE;
    if (fog !== null && !fogTileVisible(fog, col, row)) return;
    group.hold(
      (tileToScreenX(col, row) - bounds.minX) * scale,
      (tileToScreenY(row) - bounds.minY) * scale,
      mark,
      colour,
    );
  };
  const plot = (e: SnapshotEntity, mark: MinimapMark, colour: number): void => place(e, mark, colour, plain);
  const owned = (e: SnapshotEntity, owner: number, mark: MinimapMark, colour: number): void => {
    const soldier = mark === 'soldier';
    place(
      e,
      mark,
      colour,
      hostile(owner) ? (soldier ? hostileSoldiers : hostiles) : soldier ? soldiers : plain,
    );
  };
  const endLayer = (): void => {
    for (const group of HELD_GROUPS) group.emit(sink, 'rims');
    for (const group of HELD_GROUPS) {
      group.emit(sink, 'fills');
      group.clear();
    }
  };

  if (layers.roads) {
    // Few and transient, and like any owned marker they follow the scope and the visible ground, which
    // moves with every sighting; the static laid roads are baked apart.
    for (const site of entitiesWith(snapshot, 'RoadSite')) {
      const owner = ownerPlayerOf(site);
      if (owner === undefined) plot(site, 'roadSite', ROAD_SITE_DOT_COLOUR);
      else if (admits(owner)) owned(site, owner, 'roadSite', ROAD_SITE_DOT_COLOUR);
    }
    endLayer();
  }

  if (layers.signposts) {
    for (const post of entitiesWith(snapshot, 'Signpost')) {
      const owner = ownerPlayerOf(post);
      if (owner !== undefined && admits(owner)) owned(post, owner, 'signpost', colourOf(owner));
    }
    // A delivery flag carries no owner; its gatherer's is the flag's, one gatherer per flag.
    for (const gatherer of entitiesWith(snapshot, 'WorkFlag')) {
      const owner = ownerPlayerOf(gatherer);
      const flagId = workFlagOf(gatherer);
      if (owner === undefined || flagId === undefined || !admits(owner)) continue;
      const flag = entityById(snapshot, flagId);
      if (flag !== undefined) owned(flag, owner, 'signpost', colourOf(owner));
    }
    endLayer();
  }

  if (layers.buildings) {
    for (const building of entitiesWith(snapshot, 'Building')) {
      const owner = ownerPlayerOf(building);
      if (owner !== undefined && admits(owner)) owned(building, owner, 'building', colourOf(owner));
    }
    endLayer();
  }

  if (layers.civilians || layers.soldiers || layers.animals) {
    for (const settler of entitiesWith(snapshot, 'Settler')) {
      const owner = ownerPlayerOf(settler);
      if (isWildlife(settler)) {
        // Wildlife has no owner and ignores the scope; claimed livestock follows its owner's.
        if (layers.animals && (owner === undefined || admits(owner)))
          plot(settler, 'animal', ANIMAL_DOT_COLOUR);
        continue;
      }
      if (owner === undefined || !admits(owner)) continue;
      const job = settlerJobType(settler);
      const soldier = job !== undefined && ctx.isFighterJob(job);
      if (soldier ? layers.soldiers : layers.civilians)
        owned(settler, owner, soldier ? 'soldier' : 'civilian', colourOf(owner));
    }
    endLayer();
  }

  if (layers.vehicles) {
    for (const vehicle of entitiesWith(snapshot, 'Vehicle')) {
      const owner = ownerPlayerOf(vehicle);
      // A vehicle a ship carries stands nowhere on the map.
      const carrier = (vehicle.components.Vehicle as { carrier?: unknown }).carrier ?? null;
      if (owner !== undefined && carrier === null && admits(owner))
        owned(vehicle, owner, 'vehicle', colourOf(owner));
    }
    endLayer();
  }
}
