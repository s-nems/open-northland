import type { ContentSet } from '@open-northland/data';
import {
  AtomicClock,
  Building,
  Carrying,
  CurrentAtomic,
  FarmAnimal,
  JobAssignment,
  MoveGoal,
  Owner,
  PathFollow,
  Person,
  Position,
  Production,
  Resting,
  Settler,
  SettlerNeeds,
  Stockpile,
  YoungAnimal,
} from '../../../components/index.js';
import type { ChangeFeed } from '../../../ecs/change-feed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { technologyUnlockGeneration } from '../../progression/index.js';
import { type NodeMoveFeed, watchNodeMoves } from '../../spatial/node-moves.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';

/** The due tick of a workshop whose batches wait for a change rather than for a tick. */
export const NEVER_DUE = Number.POSITIVE_INFINITY;

/** A due tick every pass has reached: the workshop is visited on the next one. */
const DUE_NOW = 0;
/** The post of an entity bound to no workshop; entity ids start at 1. */
const NO_POST = 0;
/** Entity ids the per-entity tables start with; they double when an id would not fit. */
const INITIAL_ENTITY_CAPACITY = 1024;

/**
 * Which workshops the production pass visits on a tick. A visit that found nothing to do files the
 * workshop under the tick its batches next complete or pay a need event, or asleep; a change to the
 * workshop, to a settler or herd animal bound to it or to the technology unlocks ends the wait. Derived
 * from the stores alone: a fresh one, as after a load or a content swap, visits every workshop once and
 * files it from there.
 */
export class ProductionDormancy {
  /** By workshop id, the tick its batches are next advanced on. */
  private advanceAt = new Float64Array(INITIAL_ENTITY_CAPACITY);
  /** By workshop id, whether no batch can start there until a change. */
  private startAsleep = new Uint8Array(INITIAL_ENTITY_CAPACITY);
  /** By entity id, the workshop it was bound to when last replayed: a settler's workplace, an animal's
   *  farm. */
  private postOf = new Int32Array(INITIAL_ENTITY_CAPACITY);
  /** The tick of the last pass; any other predecessor makes the next pass visit every workshop. */
  private through: number | undefined;
  private content: ContentSet | undefined;
  private unlocks = 0;

  private readonly rebind = (bound: Entity): void => {
    this.wake(this.postAt(bound));
    const post = boundWorkshopOf(this.world, bound);
    this.wake(post);
    if (post !== NO_POST || bound < this.postOf.length) this.setPost(bound, post);
  };
  private readonly changed = (e: Entity): void => {
    this.wake(e);
    this.wake(this.postAt(e));
  };
  private readonly moved = (e: Entity): void => {
    this.wake(e);
    // A walker is off its station wherever it stands; its arrival is a membership change.
    const post = this.postAt(e);
    if (post !== NO_POST && !this.world.has(e, MoveGoal)) this.wake(post);
  };

  constructor(
    private readonly world: World,
    /** The settlers and animals whose workshop may have changed. */
    private readonly bindings: ChangeFeed,
    /** What a visit reads of a workshop and of those bound to it, their nodes aside. */
    private readonly changes: ChangeFeed,
    /** The entities whose mover node changed, the Position's node a visit reads while
     *  {@link crewOffRoute} holds. */
    private readonly moves: NodeMoveFeed,
  ) {}

  /** Start the pass of `tick` over `content`. */
  begin(tick: number, content: ContentSet): void {
    const continues = this.content === content && this.through === tick - 1;
    this.content = content;
    this.through = tick;
    if (!continues) this.reset();
  }

  /** Take in the changes since the last call: of earlier systems, or of the visit just made. */
  catchUp(): void {
    if (!this.bindings.pending && !this.changes.pending && !this.moves.pending) return;
    // Bindings first, so a settler's other changes reach the workshop it is now bound to.
    const lost = this.bindings.drain(this.rebind);
    if (this.changes.drain(this.changed) || this.moves.drain(this.moved) || lost) this.reset();
  }

  /** Wake every workshop a technology unlock since the last call may let start a batch. */
  catchUpUnlocks(): void {
    const unlocks = technologyUnlockGeneration(this.world);
    if (unlocks === this.unlocks) return;
    this.unlocks = unlocks;
    this.startAsleep.fill(0);
  }

  /** Whether `workshop`'s batches are advanced on `tick`. */
  advanceDue(workshop: Entity, tick: number): boolean {
    return !((this.advanceAt[workshop] as number) > tick);
  }

  /** File `workshop`'s batches as next advanced on tick `due`. */
  fileAdvance(workshop: Entity, due: number): void {
    if (workshop >= this.advanceAt.length) this.grow(workshop);
    this.advanceAt[workshop] = due;
  }

  /** Whether `workshop` is asked for a batch to start. */
  startDue(workshop: Entity): boolean {
    return this.startAsleep[workshop] !== 1;
  }

  /** File `workshop` as `asleep`, starting no batch until a change, or as asked again next tick. */
  fileStart(workshop: Entity, asleep: boolean): void {
    if (workshop >= this.startAsleep.length) this.grow(workshop);
    this.startAsleep[workshop] = asleep ? 1 : 0;
  }

  /**
   * The `verifyCaches` tripwire: a waiting workshop with no change pending has nothing to do on the next
   * tick. `advance` answers the tick a visit on a tick would file the batches under, that tick itself when
   * the visit would act; `starts` whether a visit would leave the workshop asleep.
   */
  verify(
    advance: (workshop: Entity, tick: number) => number,
    starts: (workshop: Entity, tick: number) => boolean,
  ): string[] {
    const { world, through } = this;
    if (through === undefined) return [];
    const pending = new Set<number>();
    const touch = (e: Entity): void => {
      pending.add(e);
      pending.add(this.postAt(e));
      pending.add(boundWorkshopOf(world, e));
    };
    if (this.bindings.peek(touch) || this.changes.peek(touch) || this.moves.peek(touch)) return [];
    const next = through + 1;
    const violations: string[] = [];
    for (const e of world.query(Production, Stockpile)) {
      const filed = this.advanceAt[e] ?? DUE_NOW;
      if (pending.has(e) || filed <= next) continue;
      const due = advance(e, next);
      if (due < filed) {
        violations.push(`productionDormancy: workshop ${e} advances on tick ${filed}, due on ${due}`);
      }
    }
    if (technologyUnlockGeneration(world) !== this.unlocks) return violations;
    for (const e of world.query(Building, Stockpile)) {
      if (pending.has(e) || this.startAsleep[e] !== 1 || starts(e, next)) continue;
      violations.push(`productionDormancy: workshop ${e} sleeps with a batch it may start`);
    }
    return violations;
  }

  private wake(workshop: number): void {
    if (workshop >= this.advanceAt.length) return;
    this.advanceAt[workshop] = DUE_NOW;
    this.startAsleep[workshop] = 0;
  }

  private postAt(bound: Entity): number {
    return this.postOf[bound] ?? NO_POST;
  }

  private setPost(bound: Entity, post: number): void {
    if (bound >= this.postOf.length) this.grow(bound);
    this.postOf[bound] = post;
  }

  /** Forget every wait and replay the bindings from the store. */
  private reset(): void {
    const { world } = this;
    this.bindings.drain(ignore);
    this.changes.drain(ignore);
    this.moves.drain(ignore);
    this.advanceAt.fill(DUE_NOW);
    this.startAsleep.fill(0);
    this.postOf.fill(NO_POST);
    for (const e of world.query(JobAssignment)) this.setPost(e, boundWorkshopOf(world, e));
    for (const e of world.query(FarmAnimal)) this.setPost(e, boundWorkshopOf(world, e));
    this.unlocks = technologyUnlockGeneration(world);
  }

  private grow(id: number): void {
    let capacity = this.advanceAt.length;
    while (capacity <= id) capacity *= 2;
    const advanceAt = new Float64Array(capacity);
    advanceAt.set(this.advanceAt);
    this.advanceAt = advanceAt;
    const startAsleep = new Uint8Array(capacity);
    startAsleep.set(this.startAsleep);
    this.startAsleep = startAsleep;
    const postOf = new Int32Array(capacity);
    postOf.set(this.postOf);
    this.postOf = postOf;
  }
}

const ignore = (): void => {};

/** The workshop whose visits read `e`: the workplace of a settler, the farm whose herd holds an animal. */
function boundWorkshopOf(world: World, e: Entity): number {
  return world.tryGet(e, JobAssignment)?.workplace ?? world.tryGet(e, FarmAnimal)?.farm ?? NO_POST;
}

/**
 * Whether every settler bound to `workshop` that stands still holds no route: its node is then its
 * Position's, so a node change names every step onto or off the door. One standing on a route it dropped
 * mid-step may read another node, and its workshop is asked every tick.
 */
export function crewOffRoute(world: World, workshop: Entity): boolean {
  const crew = assignedWorkers(world, workshop);
  for (let i = 0; i < crew.length; i++) {
    const settler = crew[i] as Entity;
    if (world.has(settler, PathFollow) && !world.has(settler, MoveGoal)) return false;
  }
  return true;
}

/** A dormancy over `world`, watching the stores a production visit reads. */
export function watchProduction(world: World): ProductionDormancy {
  const workshop = [Production, Stockpile, Building, Owner];
  const crew = [Settler, SettlerNeeds, Resting, CurrentAtomic, AtomicClock];
  const bindings = [JobAssignment, FarmAnimal];
  return new ProductionDormancy(
    world,
    world.watchChanges(bindings, bindings),
    world.watchChanges(
      [...workshop, ...crew, Person, MoveGoal, Carrying, Position, PathFollow, YoungAnimal],
      [...workshop, ...crew],
    ),
    watchNodeMoves(world),
  );
}
