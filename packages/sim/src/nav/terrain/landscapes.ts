import type { FootprintCell, LandscapeBlockArea } from '@open-northland/data';
import type { BerryBushStage } from '../../components/economy/resources.js';

export type LandscapeRemovalGroup = 'blocker' | 'fx1' | 'fx2' | 'smoke' | 'wave';

/** The ground a type may be laid on (`landscapetypes.ini` `allowedoneverything`, `allowedonland`,
 *  `allowedonwater`): anywhere, or land and water by node kind. Void ground takes only `anywhere`. */
export interface LandscapeGround {
  readonly anywhere: boolean;
  readonly land: boolean;
  readonly water: boolean;
}

/** The resource a landscape type stands for, resolved by the caller: the felling and deposit balance
 *  constants live in the app catalog. A placed node adds its position and landscape id. */
export interface ResourceSpec {
  readonly good: number;
  readonly remaining: number;
  readonly harvestAtomic: number;
  /** The decoded-map species record index: the render variant, and the record a placed node takes its
   *  footprint from when the good's harvest stage in the sim's content lists it. Omitted for an admin or
   *  scene spawn. */
  readonly gfxIndex?: number;
  /** A felled node such as a tree when true. Mutually exclusive with `deposit`. */
  readonly felling?: boolean;
  /** A mined finite deposit: its level ladder. `initial` is the deposit's full size, the ladder
   *  denominator, for a node placed already part-mined; omitted it is `remaining`. */
  readonly deposit?: {
    readonly levels: number;
    readonly initial?: number;
  };
}

export interface ScriptLandscapeType {
  readonly typeId: number;
  /** The full-grown object's cells: what a placement blocks when the type has no `blockAreas`. */
  readonly walk: readonly FootprintCell[];
  readonly build: readonly FootprintCell[];
  /** The record's `[state, dx, dy, run]` rows, which a placement stamps up to its level
   *  (`placementBlockCells`). */
  readonly blockAreas?: {
    readonly walk: readonly Readonly<LandscapeBlockArea>[];
    readonly build: readonly Readonly<LandscapeBlockArea>[];
  };
  readonly groups: readonly LandscapeRemovalGroup[];
  /** The largest level a script may lay: the lower of the record's and its logic type's maximum
   *  valency. Absent, a script level is laid as written. */
  readonly maxLevel?: number;
  /** Absent, the type may be laid anywhere. */
  readonly ground?: LandscapeGround;
  /** Points a placement holds beyond its walk and build areas, at every level. */
  readonly attach?: readonly FootprintCell[];
  readonly resource?: ResourceSpec;
  /** A placement is a live berry bush laid at `stage`, drawn from the fruited-bush record `gfxIndex`. */
  readonly bush?: { readonly gfxIndex: number; readonly stage: BerryBushStage };
  /** A placed record backed by the interactive chest entity rather than the static landscape layer. */
  readonly chest?: { readonly kind: 'wooden' | 'magical'; readonly gfxIndex: number };
  /** A good's ground form (`goodtypes.ini` `landscapetype`): a placement is a loose heap of the good
   *  holding its level in units, drawn from the goods sheet rather than the static landscape layer. The
   *  slug resolves against the world's content when the heap is laid. */
  readonly good?: { readonly goodId: string };
  /** A player-buildable wooden wall record. `maxHitpoints` is the readable logic type's maximum valency;
   * `repairPerStrike` is its positive repair transition delta. Both stay in data rather than id branches. */
  readonly wall?: {
    readonly maxHitpoints: number;
    readonly repairPerStrike: number;
    readonly construction: readonly { readonly goodType: number; readonly amount: number }[];
    readonly gate?: { readonly open: boolean; readonly counterpartGfxIndex: number };
  };
}

export interface ScriptLandscapePlacement {
  readonly id: number;
  readonly typeId: number;
  readonly hx: number;
  readonly hy: number;
  readonly level: number;
  /** The associated live resource/bush owns this placement's lifetime and collision. */
  readonly resourceBacked?: boolean;
}

/** Placement fields packed into {@link LandscapePlacements.flags}. */
const RESOURCE_BACKED_FLAG = 1;

/**
 * A map's authored placements as columns in file order, index `i` being the file position: a 650x650
 * map lays some 600k, which as objects would hold ~170 MB. A value that does not fit its column throws,
 * so a read returns exactly what was laid.
 */
export class LandscapePlacements {
  private readonly ids: Int32Array;
  private readonly typeIds: Uint16Array;
  private readonly hxs: Int16Array;
  private readonly hys: Int16Array;
  private readonly levels: Int32Array;
  private readonly flags: Uint8Array;
  private count = 0;

  constructor(capacity: number) {
    this.ids = new Int32Array(capacity);
    this.typeIds = new Uint16Array(capacity);
    this.hxs = new Int16Array(capacity);
    this.hys = new Int16Array(capacity);
    this.levels = new Int32Array(capacity);
    this.flags = new Uint8Array(capacity);
  }

  static from(placements: readonly ScriptLandscapePlacement[]): LandscapePlacements {
    const columns = new LandscapePlacements(placements.length);
    for (const p of placements) columns.push(p.id, p.typeId, p.hx, p.hy, p.level, p.resourceBacked === true);
    return columns;
  }

  get length(): number {
    return this.count;
  }

  /** Append a placement; throws once `capacity` is full. */
  push(id: number, typeId: number, hx: number, hy: number, level: number, resourceBacked: boolean): void {
    const i = this.count;
    if (i >= this.ids.length)
      throw new RangeError(`landscape placements: capacity ${this.ids.length} is full`);
    this.ids[i] = id;
    this.typeIds[i] = typeId;
    this.hxs[i] = hx;
    this.hys[i] = hy;
    this.levels[i] = level;
    this.flags[i] = resourceBacked ? RESOURCE_BACKED_FLAG : 0;
    if (
      this.ids[i] !== id ||
      this.typeIds[i] !== typeId ||
      this.hxs[i] !== hx ||
      this.hys[i] !== hy ||
      this.levels[i] !== level
    ) {
      throw new RangeError(
        `landscape placement ${id} (type ${typeId} at ${hx},${hy} level ${level}) overflows a column`,
      );
    }
    this.count = i + 1;
  }

  id(i: number): number {
    return this.ids[i] ?? 0;
  }
  typeId(i: number): number {
    return this.typeIds[i] ?? 0;
  }
  hx(i: number): number {
    return this.hxs[i] ?? 0;
  }
  hy(i: number): number {
    return this.hys[i] ?? 0;
  }
  level(i: number): number {
    return this.levels[i] ?? 0;
  }
  resourceBacked(i: number): boolean {
    return ((this.flags[i] ?? 0) & RESOURCE_BACKED_FLAG) !== 0;
  }

  /** The placement at file position `i` as a fresh object, `resourceBacked` present only when set. */
  at(i: number): ScriptLandscapePlacement {
    const placement = {
      id: this.id(i),
      typeId: this.typeId(i),
      hx: this.hx(i),
      hy: this.hy(i),
      level: this.level(i),
    };
    return this.resourceBacked(i) ? { ...placement, resourceBacked: true } : placement;
  }
}

export interface LandscapeMapInput {
  readonly types: readonly ScriptLandscapeType[];
  /** A map's own placements come as columns; a scene or test may list objects. */
  readonly placements: readonly ScriptLandscapePlacement[] | LandscapePlacements;
}
