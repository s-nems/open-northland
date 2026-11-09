import {
  type FogGhost,
  fogTileVisible,
  ONE,
  type RememberedMarkers,
  tileToScreenX,
  tileToScreenY,
  type WorldBounds,
} from '@open-northland/render';
import {
  type DiplomacyState,
  type EntitySnapshot,
  entitiesWith,
  entityById,
  type FogView,
  indexOfEntity,
  type WorldSnapshot,
} from '@open-northland/sim';
import { entityIdsWith } from '../../game/snapshot/id-index.js';
import {
  isWildlife,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
  workFlagOf,
} from '../../game/snapshot/index.js';
import { teamColour } from '../../view/accessibility/team-colour.js';
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
  /** The world view's remembered statics on explored ground, which the minimap shows as the map does. */
  readonly memory?: RememberedMarkers | undefined;
  readonly bounds: WorldBounds;
  /** Raster px per projected world px. */
  readonly scale: number;
  readonly filters: MinimapFilters;
  /** A soldier or hero trade, read from the running content's job roles. */
  readonly isFighterJob: (jobType: number) => boolean;
  readonly isHeroJob: (jobType: number) => boolean;
  /** The seat the view shows; null on a whole-map view, where every scope shows every owner. */
  readonly viewer: number | null;
  /** The viewer seat's stance toward `owner`. */
  readonly stanceToward: (owner: number) => DiplomacyState;
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/** Carriers walked or markers stamped between two reads of the clock while a step has a deadline. */
const DEADLINE_STRIDE = 64;

/** The markers of one layer in stamping order, held as raster px so the rims pass and the fills pass
 *  cost no second position or fog lookup. A clear keeps the slots, so a replot writes into the arrays a
 *  larger picture grew rather than growing them again. */
class HeldMarks {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly marks: MinimapMark[] = [];
  private readonly colours: number[] = [];
  private size = 0;

  hold(bx: number, by: number, mark: MinimapMark, colour: number): void {
    const at = this.size++;
    this.xs[at] = bx;
    this.ys[at] = by;
    this.marks[at] = mark;
    this.colours[at] = colour;
  }

  /** Send the held markers from index `from` on to `sink`, stopping between two once `performance.now()`
   *  passes `deadline`; answers the index to resume from, the held count once all went. */
  emit(sink: MinimapDotSink, part: MinimapStampPart, from = 0, deadline = Number.POSITIVE_INFINITY): number {
    const timed = deadline !== Number.POSITIVE_INFINITY;
    for (let i = from; i < this.size; i++) {
      if (timed && i > from && (i - from) % DEADLINE_STRIDE === 0 && performance.now() > deadline) return i;
      const bx = this.xs[i];
      const by = this.ys[i];
      const mark = this.marks[i];
      const colour = this.colours[i];
      if (bx !== undefined && by !== undefined && mark !== undefined && colour !== undefined)
        sink(bx, by, mark, colour, part);
    }
    return this.size;
  }

  get count(): number {
    return this.size;
  }

  /** Append every held marker to `target` in order, then clear. */
  moveTo(target: HeldMarks): void {
    for (let i = 0; i < this.size; i++) {
      const bx = this.xs[i];
      const by = this.ys[i];
      const mark = this.marks[i];
      const colour = this.colours[i];
      if (bx !== undefined && by !== undefined && mark !== undefined && colour !== undefined)
        target.hold(bx, by, mark, colour);
    }
    this.clear();
  }

  clear(): void {
    this.size = 0;
  }
}

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

type SettlerMark = Extract<MinimapMark, 'civilian' | 'soldier' | 'hero'>;

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

/** The components whose carriers the plot reads. Held as ids: the plot runs a few times a second, so it
 *  resolves its entities then rather than keeping their objects current every delta. */
const PLOTTED = ['Building', 'Settler', 'Signpost', 'WorkFlag', 'HaulFlag', 'RoadSite'] as const;

/** The component indexes the plot reads, for the frame's index registry. */
export function readMinimapIndexes(snapshot: WorldSnapshot): void {
  for (const name of PLOTTED) entityIdsWith(snapshot, name);
}

/** The carrier walks of a plot, bottom to top; a walk that ends a layer stamps it. The signpost layer
 *  walks the posts, then the gatherers' own flags, then the flags posted workers took. */
const WALKS = [
  'roadSites',
  'signposts',
  'flags',
  'postFlags',
  'buildingMemory',
  'buildings',
  'settlers',
  'vehicleMemory',
  'vehicles',
] as const;
type Walk = (typeof WALKS)[number];
/** One stage of a plot: a carrier walk, one part of a held group sent to the sink, or the end of a layer,
 *  which clears its groups and moves its hostile markers to the pass after every layer. */
type PlotStage =
  | { readonly kind: 'walk'; readonly walk: Walk }
  | { readonly kind: 'emit'; readonly group: HeldMarks; readonly part: 'rims' | 'fills' }
  | { readonly kind: 'settle' };

const ENDS_LAYER: Readonly<Record<Walk, boolean>> = {
  roadSites: true,
  signposts: false,
  flags: false,
  postFlags: true,
  buildingMemory: false,
  buildings: true,
  settlers: true,
  vehicleMemory: false,
  vehicles: true,
};

/** The walks over the remembered statics, and the ghost kind each plots. */
const MEMORY_KIND = { buildingMemory: 'building', vehicleMemory: 'vehicle' } as const;
type MemoryWalk = keyof typeof MEMORY_KIND;

function isMemoryWalk(walk: Walk): walk is MemoryWalk {
  return walk in MEMORY_KIND;
}

/** The first index of ascending `ids` holding an id of at least `id`. */
function firstIdFrom(ids: readonly number[], id: number): number {
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((ids[mid] as number) < id) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Plots the enabled layers in the ground raster's px, bottom to top: road sites, signposts and flags,
 * buildings, animals and people, vehicles. Each layer walks only its own component index, and buildings
 * and vehicles also the world view's memory of them on explored ground, so a plot costs the plotted
 * entities, never the whole entity list. Laid roads are the road layer's. Within a layer
 * soldiers stamp after civilians, and a layer's rims all go under its fills, so a crowd reads as one
 * rimmed blob while a later layer's rims still part it from the one below. Hostile owners' markers leave
 * the layers and stamp after all of them, rims then fills, so an intruder keeps its own rim on top of the
 * viewer's crowd, buildings and vehicles instead of melting into them. Heroes stamp last of all, whoever
 * owns them: losing one loses most games, so no crowd or intruder covers one.
 *
 * A plot may run over several steps, each walking on by id from where the last stopped, so a big map's
 * plot spreads over frames instead of stalling one; each carrier is read once, off the snapshot of the
 * step that reaches it. The held markers keep their slots across plots, so a replot grows no arrays once
 * a game has shown its largest picture.
 */
export class MinimapDotPlot {
  private readonly plain = new HeldMarks();
  private readonly soldiers = new HeldMarks();
  private readonly hostiles = new HeldMarks();
  private readonly hostileSoldiers = new HeldMarks();
  private readonly allHostiles = new HeldMarks();
  private readonly heroes = new HeldMarks();
  // A walk meets a handful of owners and trades thousands of times over, so each answer is asked once.
  private readonly stances = new Map<number, DiplomacyState>();
  private readonly colours = new Map<number, number>();
  private readonly roles = new Map<number, SettlerMark>();
  /** The remembered statics as the plot started, walked by index. */
  private readonly remembered: FogGhost[] = [];
  private ctx: MinimapDotContext | null = null;
  private stages: readonly PlotStage[] = [];
  /** The stage under way, and where in it the next step resumes: the least id a walk has yet to read,
   *  the next held marker an emit sends. */
  private stage = 0;
  private resumeAt = 0;

  /** Begin a plot under `ctx`, dropping any plot under way. */
  start(ctx: MinimapDotContext): void {
    this.ctx = ctx;
    this.stages = this.stagesFor(ctx.filters.layers);
    this.stage = 0;
    this.resumeAt = 0;
    this.stances.clear();
    this.colours.clear();
    this.roles.clear();
    this.remembered.length = 0;
    if (ctx.fog !== null) ctx.memory?.markers(this.remembered);
    for (const group of [
      this.plain,
      this.soldiers,
      this.hostiles,
      this.hostileSoldiers,
      this.allHostiles,
      this.heroes,
    ])
      group.clear();
  }

  /** Whether a started plot has walks or stamps left. */
  pending(): boolean {
    return this.ctx !== null;
  }

  /**
   * Walk on through `snapshot` and send each layer it finishes to `sink`; past `deadline`
   * (`performance.now()`) the step stops between two carriers or two markers. True once the whole plot
   * has gone to the sink.
   */
  step(snapshot: WorldSnapshot, sink: MinimapDotSink, deadline = Number.POSITIVE_INFINITY): boolean {
    const ctx = this.ctx;
    if (ctx === null) return true;
    for (; this.stage < this.stages.length; this.stage++, this.resumeAt = 0) {
      const stage = this.stages[this.stage] as PlotStage;
      if (stage.kind === 'walk') {
        if (!this.walkOn(ctx, stage.walk, snapshot, deadline)) return false;
      } else if (stage.kind === 'emit') {
        this.resumeAt = stage.group.emit(sink, stage.part, this.resumeAt, deadline);
        if (this.resumeAt < stage.group.count) return false;
      } else {
        this.plain.clear();
        this.soldiers.clear();
        this.hostiles.moveTo(this.allHostiles);
        this.hostileSoldiers.moveTo(this.allHostiles);
      }
    }
    this.allHostiles.clear();
    this.heroes.clear();
    this.remembered.length = 0;
    this.ctx = null;
    return true;
  }

  /** The stages of a plot of `layers`: each enabled layer's walks, its rims under its fills and plain
   *  markers under soldiers; then every layer's hostile markers, then the heroes. */
  private stagesFor(layers: MinimapFilters['layers']): PlotStage[] {
    const stages: PlotStage[] = [];
    const emit = (group: HeldMarks, part: 'rims' | 'fills'): void => {
      stages.push({ kind: 'emit', group, part });
    };
    for (const walk of WALKS) {
      if (!this.walkEnabled(walk, layers)) continue;
      stages.push({ kind: 'walk', walk });
      if (!ENDS_LAYER[walk]) continue;
      emit(this.plain, 'rims');
      emit(this.soldiers, 'rims');
      emit(this.plain, 'fills');
      emit(this.soldiers, 'fills');
      stages.push({ kind: 'settle' });
    }
    emit(this.allHostiles, 'rims');
    emit(this.allHostiles, 'fills');
    emit(this.heroes, 'rims');
    emit(this.heroes, 'fills');
    return stages;
  }

  private walkEnabled(walk: Walk, layers: MinimapFilters['layers']): boolean {
    switch (walk) {
      case 'roadSites':
        return layers.roads;
      case 'signposts':
      case 'flags':
      case 'postFlags':
        return layers.signposts;
      case 'buildingMemory':
      case 'buildings':
        return layers.buildings;
      case 'settlers':
        return layers.civilians || layers.soldiers || layers.heroes || layers.animals;
      case 'vehicleMemory':
      case 'vehicles':
        return layers.vehicles;
    }
  }

  /** Visit `walk`'s carriers from the least unread id on; false when the deadline cut it. */
  private walkOn(ctx: MinimapDotContext, walk: Walk, snapshot: WorldSnapshot, deadline: number): boolean {
    const timed = deadline !== Number.POSITIVE_INFINITY;
    if (isMemoryWalk(walk)) {
      // Walked by index: the memory is no snapshot index, and the list holds still for the plot.
      for (let at = this.resumeAt, n = 0; at < this.remembered.length; at++, n++) {
        if (timed && n % DEADLINE_STRIDE === 0 && n > 0 && performance.now() > deadline) {
          this.resumeAt = at;
          return false;
        }
        const ghost = this.remembered[at] as FogGhost;
        if (ghost.kind === MEMORY_KIND[walk]) this.visitMemory(ctx, ghost);
      }
      return true;
    }
    if (walk === 'vehicles') {
      const vehicles = entitiesWith(snapshot, 'Vehicle');
      const from = indexOfEntity(vehicles, this.resumeAt);
      for (let at = from < 0 ? -from - 1 : from, n = 0; at < vehicles.length; at++, n++) {
        const vehicle = vehicles[at] as EntitySnapshot;
        if (timed && n % DEADLINE_STRIDE === 0 && n > 0 && performance.now() > deadline) {
          this.resumeAt = vehicle.id;
          return false;
        }
        this.visit(ctx, walk, snapshot, vehicle);
      }
      return true;
    }
    const ids = entityIdsWith(snapshot, CARRIER[walk]);
    for (let at = firstIdFrom(ids, this.resumeAt), n = 0; at < ids.length; at++, n++) {
      const id = ids[at] as number;
      if (timed && n % DEADLINE_STRIDE === 0 && n > 0 && performance.now() > deadline) {
        this.resumeAt = id;
        return false;
      }
      const entity = entityById(snapshot, id);
      if (entity !== undefined) this.visit(ctx, walk, snapshot, entity);
    }
    return true;
  }

  private visit(ctx: MinimapDotContext, walk: Walk, snapshot: WorldSnapshot, e: SnapshotEntity): void {
    const { layers } = ctx.filters;
    const owner = ownerPlayerOf(e);
    switch (walk) {
      case 'roadSites':
        // Few and transient, and like any owned marker they follow the scope and the visible ground,
        // which moves with every sighting; the static laid roads are baked apart. They wear no owner
        // colour, so a hostile one would only clutter the hostile pass.
        if (owner === undefined || this.admits(ctx, owner))
          this.place(ctx, e, 'roadSite', ROAD_SITE_DOT_COLOUR, this.plain);
        return;
      case 'signposts':
      case 'buildings':
        if (owner !== undefined && this.admits(ctx, owner))
          this.owned(
            ctx,
            e,
            owner,
            walk === 'buildings' ? 'building' : 'signpost',
            this.colourOf(ctx, owner),
          );
        return;
      case 'flags':
      case 'postFlags': {
        // A delivery flag carries no owner; its worker's is the flag's, one worker per flag.
        const flagId = workFlagOf(e);
        if (owner === undefined || flagId === undefined || !this.admits(ctx, owner)) return;
        const flag = entityById(snapshot, flagId);
        if (flag !== undefined) this.owned(ctx, flag, owner, 'signpost', this.colourOf(ctx, owner));
        return;
      }
      case 'settlers': {
        if (isWildlife(e)) {
          // Wildlife has no owner and ignores the scope; claimed livestock follows its owner's.
          if (layers.animals && (owner === undefined || this.admits(ctx, owner)))
            this.place(ctx, e, 'animal', ANIMAL_DOT_COLOUR, this.plain);
          return;
        }
        if (owner === undefined || !this.admits(ctx, owner)) return;
        const role = this.roleOf(ctx, settlerJobType(e));
        if (role === 'hero') {
          if (layers.heroes) this.place(ctx, e, 'hero', this.colourOf(ctx, owner), this.heroes);
          return;
        }
        const soldier = role === 'soldier';
        if (soldier ? layers.soldiers : layers.civilians)
          this.owned(ctx, e, owner, soldier ? 'soldier' : 'civilian', this.colourOf(ctx, owner));
        return;
      }
      case 'vehicles': {
        // A vehicle a ship carries stands nowhere on the map.
        const carrier = (e.components.Vehicle as { carrier?: unknown }).carrier ?? null;
        if (owner !== undefined && carrier === null && this.admits(ctx, owner))
          this.owned(ctx, e, owner, 'vehicle', this.colourOf(ctx, owner));
        return;
      }
    }
  }

  /** A remembered static stands on explored ground, where no live marker plots, so it skips the fog. */
  private visitMemory(ctx: MinimapDotContext, ghost: FogGhost): void {
    const owner = ghost.owner;
    if (owner === undefined || !this.admits(ctx, owner)) return;
    const mark = ghost.kind === 'vehicle' ? 'vehicle' : 'building';
    this.hold(ctx, ghost.tileX, ghost.tileY, mark, this.colourOf(ctx, owner), this.groupOf(ctx, owner, mark));
  }

  private stanceToward(ctx: MinimapDotContext, owner: number): DiplomacyState {
    let stance = this.stances.get(owner);
    if (stance === undefined) {
      stance = ctx.stanceToward(owner);
      this.stances.set(owner, stance);
    }
    return stance;
  }

  private admits(ctx: MinimapDotContext, owner: number): boolean {
    return scopeAdmits(ctx.filters.scope, owner, ctx.viewer, (player) => this.stanceToward(ctx, player));
  }

  private hostile(ctx: MinimapDotContext, owner: number): boolean {
    return ctx.viewer !== null && owner !== ctx.viewer && this.stanceToward(ctx, owner) === 'enemy';
  }

  private colourOf(ctx: MinimapDotContext, player: number): number {
    let colour = this.colours.get(player);
    if (colour === undefined) {
      // Without a seat there is no stance to paint, so a whole-map view keeps the team colours.
      if (ctx.filters.colours === 'stance' && ctx.viewer !== null) {
        colour = player === ctx.viewer ? STANCE_SELF_COLOUR : STANCE_COLOURS[this.stanceToward(ctx, player)];
      } else {
        const base =
          MINIMAP_PLAYER_COLOURS[(ctx.playerColourOf?.(player) ?? player) % MINIMAP_PLAYER_COLOURS.length];
        colour = base === undefined ? UNKNOWN_PLAYER_DOT_COLOUR : teamColour(base);
      }
      this.colours.set(player, colour);
    }
    return colour;
  }

  private roleOf(ctx: MinimapDotContext, job: number | undefined): SettlerMark {
    if (job === undefined) return 'civilian';
    let role = this.roles.get(job);
    if (role === undefined) {
      role = ctx.isHeroJob(job) ? 'hero' : ctx.isFighterJob(job) ? 'soldier' : 'civilian';
      this.roles.set(job, role);
    }
    return role;
  }

  /** Only currently-visible ground plots an entity; the viewer's own forces always see their own cell. */
  private place(
    ctx: MinimapDotContext,
    e: SnapshotEntity,
    mark: MinimapMark,
    colour: number,
    group: HeldMarks,
  ): void {
    // Read in place rather than through positionOf, which allocates a point per dot.
    const at = e.components.Position as { x?: unknown; y?: unknown } | undefined;
    if (typeof at?.x !== 'number' || typeof at.y !== 'number') return;
    const col = at.x / ONE;
    const row = at.y / ONE;
    if (ctx.fog !== null && !fogTileVisible(ctx.fog, col, row)) return;
    this.hold(ctx, col, row, mark, colour, group);
  }

  private hold(
    ctx: MinimapDotContext,
    col: number,
    row: number,
    mark: MinimapMark,
    colour: number,
    group: HeldMarks,
  ): void {
    const { bounds, scale } = ctx;
    group.hold(
      (tileToScreenX(col, row) - bounds.minX) * scale,
      (tileToScreenY(row) - bounds.minY) * scale,
      mark,
      colour,
    );
  }

  private owned(
    ctx: MinimapDotContext,
    e: SnapshotEntity,
    owner: number,
    mark: MinimapMark,
    colour: number,
  ): void {
    this.place(ctx, e, mark, colour, this.groupOf(ctx, owner, mark));
  }

  private groupOf(ctx: MinimapDotContext, owner: number, mark: MinimapMark): HeldMarks {
    const soldier = mark === 'soldier';
    if (this.hostile(ctx, owner)) return soldier ? this.hostileSoldiers : this.hostiles;
    return soldier ? this.soldiers : this.plain;
  }
}

/** The component each id walk reads its carriers from. */
const CARRIER: Readonly<Record<Exclude<Walk, 'vehicles' | MemoryWalk>, (typeof PLOTTED)[number]>> = {
  roadSites: 'RoadSite',
  signposts: 'Signpost',
  flags: 'WorkFlag',
  postFlags: 'HaulFlag',
  buildings: 'Building',
  settlers: 'Settler',
};
