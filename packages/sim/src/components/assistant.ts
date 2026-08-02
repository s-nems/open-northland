import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The assistant's six production counters - the two `extra*` kinds queue births, the four `train*`
 * kinds barracks drills. Dispatch order and priorities live with the dispatcher
 * (`systems/assistant/`); arming with `systems/settlers/planner/recruit-arming.ts`.
 */
export const ASSISTANT_COUNTER_KINDS = [
  'extraWomen',
  'extraMen',
  'trainSoldiers',
  'trainSword',
  'trainSpear',
  'trainBow',
] as const;
export type AssistantCounterKind = (typeof ASSISTANT_COUNTER_KINDS)[number];

/** The counter kinds that accept `infinite` (keep queueing forever). `extraWomen` is excluded: it
 *  outranks `extraMen`, so an infinite women counter would starve every son order for good. */
export const INFINITE_COUNTER_KINDS: ReadonlySet<AssistantCounterKind> = new Set([
  'extraMen',
  'trainSoldiers',
  'trainSword',
  'trainSpear',
  'trainBow',
]);

/** Counter bounds shared with the chest window's steppers. The cap is feature-spec balance. */
export const ASSISTANT_COUNTER_MIN = 0;
export const ASSISTANT_COUNTER_MAX = 100;

/**
 * One counter's state: how many units remain to produce, and whether the queue never drains
 * (`infinite` - the value is retained so switching infinity off restores it).
 */
export interface AssistantCounterState {
  value: number;
  infinite: boolean;
}

export type AssistantCounterValues = Record<AssistantCounterKind, AssistantCounterState>;

/**
 * The per-player assistant grant list - the wearable good types the settlement assistant (the chest
 * window's "give everyone ..." switches) may hand out to settlers with a free slot. At most one
 * carrier entity exists per player (the rules-singleton convention; the `setAssistantGrant` handler
 * in `systems/orders/assistant.ts` owns the carrier lifecycle), so the state hashes and replays
 * like any component, and a command stream that never grants anything leaves every existing golden
 * hash untouched. Which goods a switch maps to is the app's content decision - the sim only reads
 * the good's `equip` class.
 */
export const AssistantGrants = defineComponent<{
  /** The player slot the grants belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  /** Granted good type ids, ascending - canonical for hashing and for a deterministic scan order. */
  goods: readonly number[];
}>('AssistantGrants');

/** The {@link AssistantGrants} carrier for `player`, or null when nothing is granted. Canonical:
 *  the lowest-id carrier wins should more than one ever exist (the rules-singleton convention). */
export function assistantGrantsEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AssistantGrants)) {
    if (world.get(e, AssistantGrants).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

const NO_GRANTS: readonly number[] = [];

/** The good types granted to `player`'s settlers (ascending ids; empty when the assistant is idle). */
export function assistantGrantedGoods(world: World, player: number): readonly number[] {
  const carrier = assistantGrantsEntity(world, player);
  return carrier === null ? NO_GRANTS : world.get(carrier, AssistantGrants).goods;
}

/**
 * The per-player assistant counter block ({@link AssistantCounterValues}) - the sibling carrier of
 * {@link AssistantGrants} with the same rules-singleton lifecycle: at most one per player, created on
 * the first non-default write, destroyed when every counter returns to zero-and-finite
 * (`systems/orders/assistant.ts` owns the lifecycle), so a world that never touches the counters keeps
 * every existing golden hash.
 */
export const AssistantCounters = defineComponent<{
  /** The player slot the counters belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  counters: AssistantCounterValues;
}>('AssistantCounters');

export function defaultAssistantCounters(): AssistantCounterValues {
  const zero = (): AssistantCounterState => ({ value: 0, infinite: false });
  return {
    extraWomen: zero(),
    extraMen: zero(),
    trainSoldiers: zero(),
    trainSword: zero(),
    trainSpear: zero(),
    trainBow: zero(),
  };
}

/** Whether every counter sits at the default (zero, finite) - the carrier-destruction trigger. */
export function assistantCountersAtDefault(counters: AssistantCounterValues): boolean {
  return ASSISTANT_COUNTER_KINDS.every((kind) => {
    const c = counters[kind];
    return c.value === 0 && !c.infinite;
  });
}

/** The {@link AssistantCounters} carrier for `player`, or null when every counter is default.
 *  Canonical: the lowest-id carrier wins should more than one ever exist. */
export function assistantCountersEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AssistantCounters)) {
    if (world.get(e, AssistantCounters).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

/**
 * Pay one produced unit off `player`'s `kind` counter - called at the moment the queued product
 * exists (a birth, an enlistment, a landed weapon). An infinite counter never drains; a counter
 * already at zero (the player reset it while orders were in flight) stays there.
 */
export function consumeAssistantCounter(
  world: World,
  player: number | undefined,
  kind: AssistantCounterKind,
): void {
  if (player === undefined) return;
  const carrier = assistantCountersEntity(world, player);
  if (carrier === null) return;
  const block = world.get(carrier, AssistantCounters);
  const counter = block.counters[kind];
  if (counter.infinite || counter.value <= 0) return;
  counter.value -= 1;
  if (assistantCountersAtDefault(block.counters)) world.destroy(carrier);
}

/**
 * The assistant's standing booking beside a woman's `ChildOrder` - marks the order as
 * counter-funded, so the birth pays the right counter and player/AI `makeChild` orders never do.
 * Removed at the birth, by a superseding player `makeChild`, or by the assistant's stale sweep when
 * the underlying order is gone.
 */
export const AssistantChildOrder = defineComponent<{ sex: 'female' | 'male' }>('AssistantChildOrder');

/** The training-counter kinds a recruit booking can carry (the dispatcher's queue set - deriving the
 *  type from this list keeps a new intent and its dispatch coverage one edit); the three class kinds
 *  also arm. */
export const ASSISTANT_RECRUIT_INTENTS = [
  'trainSoldiers',
  'trainSword',
  'trainSpear',
  'trainBow',
] as const satisfies readonly AssistantCounterKind[];
export type AssistantRecruitIntent = (typeof ASSISTANT_RECRUIT_INTENTS)[number];

/**
 * The assistant's training booking on a dispatched recruit: which `train*` counter funds it, and
 * whether its weapon has landed (`armed` - set with the class transform, when the counter is paid;
 * the armor errand may still follow). `trainSoldiers` recruits are done (and unmarked) at
 * enlistment; class recruits keep the mark until armed and armored (or armor proves unavailable).
 */
export const AssistantRecruit = defineComponent<{
  intent: AssistantRecruitIntent;
  armed: boolean;
}>('AssistantRecruit');
