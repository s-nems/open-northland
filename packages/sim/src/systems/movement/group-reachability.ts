import type { BlockOverlay } from '../../nav/block-overlay.js';
import { NodeList } from '../../nav/node-list.js';
import {
  NO_READMITTED,
  type NodeId,
  STEP_COSTS,
  StepBuffer,
  StepGate,
  type TerrainGraph,
} from '../../nav/terrain/index.js';
import type { WalkBlockMask } from '../footprint/walk-block-mask.js';

/** The largest search stamp before the shared stamps wrap and are cleared. */
const MAX_STAMP = 0x7fffffff;

/**
 * Rounds a two-sided search takes before one pass labels every region of the overlay instead. Authored:
 * a pair a long wall parts would otherwise exhaust its smaller side through the search's per-node
 * bookkeeping, and the pass answers every later pair of that overlay and version at once.
 */
const LABEL_EVERY_AFTER_ROUNDS = 4096;

/** The lattice edges per node, the bits of a step lane. */
const EDGE_COUNT = STEP_COSTS.length;

/** The group ids written under one overlay; a value below `base` is left over from an earlier owner. */
interface OverlayGroups {
  readonly groups: Int32Array;
  readonly base: number;
}

/** Per-node visit stamps for one terrain. Searches run synchronously, so every instance shares them. */
class SearchStamps {
  readonly seen: Int32Array;
  private stamp = 0;
  private flood: Int32Array | undefined;

  constructor(private readonly nodeCount: number) {
    this.seen = new Int32Array(nodeCount);
  }

  /** A queue with room for every node, for one region flood at a time. */
  floodQueue(): Int32Array {
    this.flood ??= new Int32Array(this.nodeCount);
    return this.flood;
  }

  next(): number {
    if (this.stamp === MAX_STAMP) {
      this.seen.fill(0);
      this.stamp = 0;
    }
    this.stamp += 1;
    return this.stamp;
  }
}

const stampsByTerrain = new WeakMap<TerrainGraph, SearchStamps>();

/**
 * Exact structural connectivity under walk-block overlays, learned lazily per walk-block version. Every
 * searched node joins a group of nodes proven connected; a complete group is a whole region, so a node
 * outside it is proven apart. Group ids carry no ordering meaning. Each owner's overlay keeps its own groups
 * because a post blocks only its enemies.
 */
export class GroupReachability {
  private readonly overlays = new Map<BlockOverlay, OverlayGroups>();
  /** Group arrays of forgotten overlays, reused instead of allocating a lattice per overlay and version. */
  private readonly spare: Int32Array[] = [];
  private version = -1;
  private nextGroup = 1;
  /** The first group id of the current version; the union-find slots below are indexed from it, filled
   *  by {@link groupCount} and never truncated, so a new version reuses their capacity. */
  private firstGroup = 1;
  private groupCount = 0;
  private readonly parent: number[] = [];
  private readonly complete: boolean[] = [];
  /** The search side that last reached each group, so meeting another side's group proves a connection. */
  private readonly reachedBy: number[] = [];
  private nextSide = 0;
  private readonly fromStart = new NodeList();
  private readonly fromGoal = new NodeList();
  private readonly steps = new StepBuffer();
  private readonly gate = new StepGate();
  private searchStamps?: SearchStamps;

  /** `maxOverlays` bounds the overlays held per version, for a caller whose answers never depend on what is
   *  held; the default keeps every overlay, since routing refuses by the regions it already learned. */
  constructor(
    private readonly terrain: TerrainGraph,
    private readonly maxOverlays = Number.POSITIVE_INFINITY,
  ) {}

  /** Whether a structural region can hold `node` at all: walkable ground outside `blocked`. */
  standable(blocked: BlockOverlay, node: NodeId): boolean {
    return this.terrain.isWalkable(node) && !blocked.has(node);
  }

  /** Whether `a` and `b` are both {@link standable} and connected under `blocked`. A known group answers at
   *  once; otherwise both ends search one step per round until they meet or one side exhausts its region. */
  sameRegion(mask: WalkBlockMask, blocked: BlockOverlay, a: NodeId, b: NodeId): boolean {
    this.refresh(mask);
    if (!this.standable(blocked, a) || !this.standable(blocked, b)) return false;
    if (a === b) return true;
    if (this.terrain.componentOf(a) !== this.terrain.componentOf(b)) return false;
    const held = this.groupsOf(blocked);
    const from = this.groupAt(held, a);
    const to = this.groupAt(held, b);
    if (from !== 0 && from === to) return true;
    if (this.isComplete(from) || this.isComplete(to)) return false;
    return this.search(held, blocked, a, b);
  }

  unreachable(mask: WalkBlockMask, blocked: BlockOverlay, start: NodeId, goal: NodeId): boolean {
    this.refresh(mask);
    if (this.terrain.componentOf(start) !== this.terrain.componentOf(goal)) return true;
    // A blocked start may escape into several regions; leave that special case to the pathfinder.
    if (blocked.has(start) || blocked.has(goal)) return false;
    const held = this.overlays.get(blocked);
    if (held === undefined) return false;
    const from = this.groupAt(held, start);
    const to = this.groupAt(held, goal);
    // A complete group is a whole region, so an endpoint outside it cannot belong to it.
    return from !== to && (this.isComplete(from) || this.isComplete(to));
  }

  /** Learn the region of a refused pair: the search exhausts the smaller endpoint region, so a tiny sealed
   *  goal never floods its open surroundings. */
  rememberFailure(mask: WalkBlockMask, blocked: BlockOverlay, start: NodeId, goal: NodeId): void {
    this.sameRegion(mask, blocked, start, goal);
  }

  /** Both searches take one step per round. Meeting proves the pair connected and joins everything both
   *  sides reached into one group; an exhausted side is its complete region, and the other side's nodes still
   *  share a group with their start. A search past {@link LABEL_EVERY_AFTER_ROUNDS} labels every region. */
  private search(held: OverlayGroups, blocked: BlockOverlay, a: NodeId, b: NodeId): boolean {
    const stamps = this.stamps();
    const seenStart = stamps.next();
    const seenGoal = stamps.next();
    const sideStart = ++this.nextSide;
    const sideGoal = ++this.nextSide;
    const { fromStart, fromGoal } = this;
    fromStart.clear();
    fromGoal.clear();
    fromStart.push(a);
    fromGoal.push(b);
    stamps.seen[a] = seenStart;
    stamps.seen[b] = seenGoal;
    this.reach(held, a, sideStart, sideGoal);
    this.reach(held, b, sideGoal, sideStart);
    let complete: NodeList | undefined;
    for (let cursor = 0; ; cursor++) {
      if (cursor >= LABEL_EVERY_AFTER_ROUNDS) {
        this.labelEvery(held, blocked);
        return held.groups[a] === held.groups[b];
      }
      if (
        this.expand(held, blocked, fromStart, cursor, seenStart, seenGoal, sideStart, sideGoal) ||
        this.expand(held, blocked, fromGoal, cursor, seenGoal, seenStart, sideGoal, sideStart)
      ) {
        const joined = this.newGroup(false);
        this.join(held, fromStart, joined);
        this.join(held, fromGoal, joined);
        return true;
      }
      if (cursor + 1 === fromStart.length) {
        complete = fromStart;
        break;
      }
      if (cursor + 1 === fromGoal.length) {
        complete = fromGoal;
        break;
      }
    }
    this.join(held, complete, this.newGroup(true));
    this.join(held, complete === fromStart ? fromGoal : fromStart, this.newGroup(false));
    return false;
  }

  /**
   * Give every region under `blocked` its own complete group, in one flood per region over the step
   * lane. The groups are fresh, so each node's written id is its root, and what earlier searches learned
   * under this overlay is superseded.
   */
  private labelEvery(held: OverlayGroups, blocked: BlockOverlay): void {
    const { terrain, gate } = this;
    terrain.resetGate(gate, 'land', blocked, NO_READMITTED);
    const lane = gate.lane;
    const groups = held.groups;
    const queue = this.stamps().floodQueue();
    const firstLabel = this.nextGroup;
    for (let seed = 0 as NodeId; seed < terrain.nodeCount; seed++) {
      if ((groups[seed] ?? 0) >= firstLabel || !terrain.isWalkable(seed) || gate.closes(seed)) continue;
      const group = this.newGroup(true);
      groups[seed] = group;
      queue[0] = seed;
      let queued = 1;
      for (let cursor = 0; cursor < queued; cursor++) {
        const node = queue[cursor] ?? 0;
        const open = lane[node] ?? 0;
        if (open === 0) continue;
        const offsets = terrain.stepOffsets(terrain.yOf(node as NodeId));
        for (let edge = 0; edge < EDGE_COUNT; edge++) {
          if ((open & (1 << edge)) === 0) continue;
          const next = node + (offsets[edge] ?? 0);
          if ((groups[next] ?? 0) >= firstLabel || gate.closes(next)) continue;
          groups[next] = group;
          queue[queued++] = next;
        }
      }
    }
  }

  /** Expand one node of a side; true once it reaches the other side's nodes or groups. */
  private expand(
    held: OverlayGroups,
    blocked: BlockOverlay,
    queue: NodeList,
    cursor: number,
    seenMine: number,
    seenOther: number,
    sideMine: number,
    sideOther: number,
  ): boolean {
    if (cursor >= queue.length) throw new Error('group region queue missing a node');
    const node = queue.at(cursor);
    const seen = this.stamps().seen;
    this.terrain.stepsInto(node, blocked, this.steps);
    for (let i = 0; i < this.steps.length; i++) {
      const next = this.steps.nodeAt(i);
      const mark = seen[next];
      if (mark === seenMine) continue;
      if (mark === seenOther) return true;
      seen[next] = seenMine;
      queue.push(next);
      if (this.reach(held, next, sideMine, sideOther)) return true;
    }
    return false;
  }

  /** Note that a side reached `node`'s group; true when the other side reached that group first. A side
   *  never reaches a complete group: its own start would already belong to it. */
  private reach(held: OverlayGroups, node: NodeId, sideMine: number, sideOther: number): boolean {
    const group = this.groupAt(held, node);
    if (group === 0) return false;
    const slot = group - this.firstGroup;
    if (this.reachedBy[slot] === sideOther) return true;
    this.reachedBy[slot] = sideMine;
    return false;
  }

  private join(held: OverlayGroups, queue: NodeList, group: number): void {
    for (let i = 0; i < queue.length; i++) {
      const node = queue.at(i);
      const prior = this.groupAt(held, node);
      if (prior !== 0 && prior !== group) this.parent[prior - this.firstGroup] = group;
      held.groups[node] = group;
    }
  }

  private newGroup(complete: boolean): number {
    const group = this.nextGroup++;
    const slot = this.groupCount++;
    this.parent[slot] = group;
    this.complete[slot] = complete;
    this.reachedBy[slot] = 0;
    return group;
  }

  /** The root group of `node`, or 0 when no search reached it this version. */
  private groupAt(held: OverlayGroups, node: NodeId): number {
    const written = held.groups[node] ?? 0;
    if (written < held.base) return 0;
    const first = this.firstGroup;
    let group = written;
    for (;;) {
      const up = group - first < this.groupCount ? this.parent[group - first] : undefined;
      if (up === undefined) throw new Error('group region missing its parent');
      if (up === group) return group;
      // Path halving keeps later finds short without a second pass.
      const grand = this.parent[up - first] ?? up;
      this.parent[group - first] = grand;
      group = grand;
    }
  }

  private isComplete(group: number): boolean {
    return group !== 0 && this.complete[group - this.firstGroup] === true;
  }

  private groupsOf(blocked: BlockOverlay): OverlayGroups {
    const held = this.overlays.get(blocked);
    if (held !== undefined) return held;
    if (this.overlays.size >= this.maxOverlays) this.evictOldest();
    const fresh = {
      groups: this.spare.pop() ?? new Int32Array(this.terrain.nodeCount),
      base: this.nextGroup,
    };
    this.overlays.set(blocked, fresh);
    return fresh;
  }

  /** Drop the overlay held longest; the groups the others learned this version stay. */
  private evictOldest(): void {
    for (const [blocked, held] of this.overlays) {
      this.overlays.delete(blocked);
      this.spare.push(held.groups);
      return;
    }
  }

  private stamps(): SearchStamps {
    if (this.searchStamps !== undefined) return this.searchStamps;
    let stamps = stampsByTerrain.get(this.terrain);
    if (stamps === undefined) {
      stamps = new SearchStamps(this.terrain.nodeCount);
      stampsByTerrain.set(this.terrain, stamps);
    }
    this.searchStamps = stamps;
    return stamps;
  }

  private refresh(mask: WalkBlockMask): void {
    const version = mask.version;
    if (this.version === version) return;
    this.version = version;
    this.forget();
  }

  private forget(): void {
    for (const held of this.overlays.values()) this.spare.push(held.groups);
    this.overlays.clear();
    if (this.nextGroup >= MAX_STAMP) {
      for (const groups of this.spare) groups.fill(0);
      this.nextGroup = 1;
    }
    this.firstGroup = this.nextGroup;
    this.groupCount = 0;
    this.nextSide = 0;
  }
}
