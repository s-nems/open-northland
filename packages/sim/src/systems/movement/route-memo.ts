import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { findPath, type SearchStats } from '../../nav/pathfinding/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

/**
 * Ticks a walker's last route stays on hand. Covers the obstruction reroute's 4-tick period, the repeat
 * that dominates: a stuck collider drops its route and asks for the same one again. Only memory rides
 * on it; a reuse is proved, never assumed.
 */
export const ROUTE_MEMO_TICKS = 8;

/**
 * One walker's last search. A search reads the walk-block overlay only through `has`, terrain only
 * through static lanes and the road lanes, so the same endpoints, the same empty-overlay verdict, the
 * same road revision and the same answer on every node it asked replay the search settle for settle.
 */
interface MemoEntry {
  start: NodeId;
  goal: NodeId;
  view: number;
  emptyOverlay: boolean;
  roadRevision: number;
  tick: number;
  path: readonly NodeId[] | null;
  explored: number;
  /** Each overlay node the search asked, once: `n` when it was open, `-(n + 1)` when blocked. */
  asked: Int32Array;
  askedCount: number;
}

const blockedCode = (node: number): number => -(node + 1);

/** Int32 stamp ceiling; on the wrap the stamps are cleared so no stale slot matches a reused value. */
const MAX_GENERATION = 2 ** 31 - 1;

/**
 * An overlay that answers through `inner` once per node and search, logging each node with its answer.
 * The answers are pure within a search (the {@link BlockOverlay} contract), so the repeat reads a search
 * makes of a node, up to a dozen as its neighbours settle, skip the layered lookup.
 */
class AskLog implements BlockOverlay {
  size = 0;
  inner: BlockOverlay | undefined;
  count = 0;
  codes = new Int32Array(0);
  private generation = 0;
  private readonly stamps: Int32Array;
  private readonly blocked: Uint8Array;

  constructor(nodeCount: number) {
    this.stamps = new Int32Array(nodeCount);
    this.blocked = new Uint8Array(nodeCount);
  }

  begin(inner: BlockOverlay): void {
    if (this.generation >= MAX_GENERATION) {
      this.stamps.fill(0);
      this.generation = 0;
    }
    this.generation += 1;
    this.inner = inner;
    this.size = inner.size;
    this.count = 0;
  }

  has(node: NodeId): boolean {
    if (this.stamps[node] === this.generation) return this.blocked[node] === 1;
    const answer = this.inner?.has(node) ?? false;
    this.stamps[node] = this.generation;
    this.blocked[node] = answer ? 1 : 0;
    if (this.count === this.codes.length) this.grow();
    this.codes[this.count] = answer ? blockedCode(node) : node;
    this.count += 1;
    return answer;
  }

  private grow(): void {
    const codes = new Int32Array(Math.max(256, this.codes.length * 2));
    codes.set(this.codes);
    this.codes = codes;
  }
}

/** An overlay answering from an entry's log, noting any node the log never recorded. */
class LogReplay implements BlockOverlay {
  readonly size: number;
  unlogged = false;
  private readonly answers = new Map<number, boolean>();
  constructor(entry: MemoEntry) {
    this.size = entry.emptyOverlay ? 0 : 1;
    for (let i = 0; i < entry.askedCount; i++) {
      const code = entry.asked[i] ?? 0;
      this.answers.set(code < 0 ? -code - 1 : code, code < 0);
    }
  }
  has(node: NodeId): boolean {
    const answer = this.answers.get(node);
    if (answer === undefined) this.unlogged = true;
    return answer ?? false;
  }
}

/**
 * The last land route each walker asked for over the last {@link ROUTE_MEMO_TICKS}, served again when the
 * repeat is provably identical. Derived and never hashed: a cold memo routes exactly like a warm one.
 */
export class RouteMemo {
  private readonly entries = new Map<Entity, MemoEntry>();
  private readonly log: AskLog;

  constructor(readonly terrain: TerrainGraph) {
    this.log = new AskLog(terrain.nodeCount);
  }

  /**
   * {@link findPath} over land for `e` under `blocked`, whose answers must depend only on `view` and the
   * world within the tick. A replayable repeat returns the held path and charges `stats` the settles its
   * search took, so a budget keyed on them cuts where a fresh search would.
   */
  route(
    e: Entity,
    tick: number,
    start: NodeId,
    goal: NodeId,
    view: number,
    blocked: BlockOverlay,
    stats: SearchStats,
  ): NodeId[] | null {
    const emptyOverlay = blocked.size === 0;
    const roadRevision = this.terrain.mirroredRoadRevision;
    const held = this.entries.get(e);
    if (
      held !== undefined &&
      held.start === start &&
      held.goal === goal &&
      held.view === view &&
      held.emptyOverlay === emptyOverlay &&
      held.roadRevision === roadRevision &&
      answersHold(held, blocked)
    ) {
      held.tick = tick;
      stats.explored += held.explored;
      return held.path === null ? null : [...held.path];
    }
    const log = this.log;
    log.begin(blocked);
    const before = stats.explored;
    const path = findPath(this.terrain, start, goal, log, stats);
    log.inner = undefined;
    const entry = held ?? {
      start,
      goal,
      view,
      emptyOverlay,
      roadRevision,
      tick,
      path: null,
      explored: 0,
      asked: new Int32Array(0),
      askedCount: 0,
    };
    entry.start = start;
    entry.goal = goal;
    entry.view = view;
    entry.emptyOverlay = emptyOverlay;
    entry.roadRevision = roadRevision;
    entry.tick = tick;
    entry.path = path === null ? null : [...path];
    entry.explored = stats.explored - before;
    if (entry.asked.length < log.count) entry.asked = new Int32Array(log.codes.length);
    entry.asked.set(log.codes.subarray(0, log.count));
    entry.askedCount = log.count;
    this.entries.set(e, entry);
    return path;
  }

  /** Drop the routes no walker asked for within {@link ROUTE_MEMO_TICKS}. */
  expire(tick: number): void {
    for (const [e, entry] of this.entries) {
      if (tick - entry.tick > ROUTE_MEMO_TICKS) this.entries.delete(e);
    }
  }

  /** Replays every entry's search from its log: a node asked outside the log, or another path or settle
   *  count, means a hit could serve a route a fresh search would not. */
  verify(): string[] {
    const problems: string[] = [];
    for (const [e, entry] of this.entries) {
      if (entry.roadRevision !== this.terrain.mirroredRoadRevision) continue;
      const replay = new LogReplay(entry);
      const stats: SearchStats = { explored: 0 };
      const path = findPath(this.terrain, entry.start, entry.goal, replay, stats);
      const samePath =
        path === null || entry.path === null
          ? path === entry.path
          : path.length === entry.path.length && path.every((n, i) => n === entry.path?.[i]);
      if (replay.unlogged || !samePath || stats.explored !== entry.explored) {
        problems.push(`routeMemo entry for entity ${e} does not replay its search`);
      }
    }
    return problems;
  }
}

function answersHold(entry: MemoEntry, blocked: BlockOverlay): boolean {
  const { asked, askedCount } = entry;
  for (let i = 0; i < askedCount; i++) {
    const code = asked[i] ?? 0;
    const node = (code < 0 ? -code - 1 : code) as NodeId;
    if (blocked.has(node) !== code < 0) return false;
  }
  return true;
}

const memos = new WeakMap<World, RouteMemo>();

/** The world's route memo over `terrain`, created with its cache verifier on first use. */
export function routeMemoOf(world: World, terrain: TerrainGraph): RouteMemo {
  const held = memos.get(world);
  if (held !== undefined && held.terrain === terrain) return held;
  const memo = new RouteMemo(terrain);
  if (held === undefined) world.registerCacheVerifier('routeMemo', () => memos.get(world)?.verify() ?? []);
  memos.set(world, memo);
  return memo;
}
