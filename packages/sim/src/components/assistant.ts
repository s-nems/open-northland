import type { EquipClass } from '@open-northland/data';
import { type Component, defineComponent, type Entity, type World } from '../ecs/world.js';

/** The assistant's production counters: the `extra*` kinds queue births, the `train*` kinds barracks
 *  drills. */
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

/** The inclusive counter range the assistant commands clamp to, shared with the assistant window's steppers.
 *  The cap is authored. */
export const ASSISTANT_COUNTER_MIN = 0;
export const ASSISTANT_COUNTER_MAX = 100;

/** One counter's state; `value` is retained while `infinite`, so switching infinity off restores it. */
export interface AssistantCounterState {
  value: number;
  infinite: boolean;
}

export type AssistantCounterValues = Record<AssistantCounterKind, AssistantCounterState>;

/**
 * The per-player assistant grant list - the wearable good types the settlement assistant may hand out to
 * settlers with a free slot. At most one carrier entity exists per player, created on the first grant and
 * destroyed when the list empties. Which goods a switch maps to is the app's content decision; the sim
 * reads only the good's `equip` class.
 */
export const AssistantGrants = defineComponent<{
  /** The player slot the grants belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  /** Granted good type ids, ascending - canonical for hashing and for a deterministic scan order. */
  goods: readonly number[];
}>('AssistantGrants', 'players');

/**
 * The grant kinds a player may keep for soldiers alone, read off a good's equip class rather than its id:
 * a drink is a misc good that wears (mead, the potions), a charm a lasting one (the amulets). Gear (boots,
 * tools) has no audience switch: tools already go only to the trades that work with them.
 */
export const ASSISTANT_AUDIENCE_KINDS = ['drink', 'charm'] as const;
export type AssistantAudienceKind = (typeof ASSISTANT_AUDIENCE_KINDS)[number];

/** The audience kind of a wearable, or null for one every dressed settler may receive. */
export function assistantAudienceKindOf(equip: EquipClass): AssistantAudienceKind | null {
  if (equip.category !== 'misc') return null;
  return equip.wears ? 'drink' : 'charm';
}

/**
 * The per-player audience limits of {@link AssistantGrants}: the grant kinds handed to fighters only. The
 * carrier exists while a kind is limited; by default every kind goes to everyone the pass dresses.
 */
export const AssistantSoldierOnlyGrants = defineComponent<{
  /** The player slot the limits belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  /** The limited kinds, in {@link ASSISTANT_AUDIENCE_KINDS} order. */
  kinds: readonly AssistantAudienceKind[];
}>('AssistantSoldierOnlyGrants', 'players');

/** `player`'s {@link AssistantSoldierOnlyGrants} carrier, or null while no kind is limited. The lowest-id
 *  carrier wins should more than one ever exist. */
export function assistantSoldierOnlyEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AssistantSoldierOnlyGrants)) {
    if (world.get(e, AssistantSoldierOnlyGrants).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

const NO_KINDS: readonly AssistantAudienceKind[] = [];

/** The grant kinds `player` keeps for soldiers alone; empty by default. */
export function assistantSoldierOnlyKinds(world: World, player: number): readonly AssistantAudienceKind[] {
  const carrier = assistantSoldierOnlyEntity(world, player);
  return carrier === null ? NO_KINDS : world.get(carrier, AssistantSoldierOnlyGrants).kinds;
}

/** A per-player good list carrier: {@link AssistantGrants} and {@link AssistantWeaponVetoes}. */
export type PlayerGoodList = Component<{ player: number; goods: readonly number[] }>;

/** `list`'s carrier for `player`, or null when the list is empty. The lowest-id carrier wins should more
 *  than one ever exist. */
export function playerGoodListEntity(world: World, list: PlayerGoodList, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(list)) {
    if (world.get(e, list).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

const NO_GOODS: readonly number[] = [];

/** `player`'s goods on `list`, ascending; empty when the list is. */
export function playerGoodList(world: World, list: PlayerGoodList, player: number): readonly number[] {
  const carrier = playerGoodListEntity(world, list, player);
  return carrier === null ? NO_GOODS : world.get(carrier, list).goods;
}

/** The good types granted to `player`'s settlers, ascending; empty when nothing is granted. */
export function assistantGrantedGoods(world: World, player: number): readonly number[] {
  return playerGoodList(world, AssistantGrants, player);
}

/**
 * The per-player recruit weapon vetoes: weapon good types the assistant's arming pass never hands a
 * recruit, so his class waits for a better weapon instead. The carrier lives while the list is non-empty,
 * like {@link AssistantGrants}.
 */
export const AssistantWeaponVetoes = defineComponent<{
  /** The player slot the vetoes belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  /** Vetoed good type ids, ascending. */
  goods: readonly number[];
}>('AssistantWeaponVetoes', 'players');

/**
 * The per-player assistant counter block - the sibling carrier of {@link AssistantGrants}: at most one per
 * player, created on the first non-default write and destroyed when every counter returns to
 * zero-and-finite.
 */
export const AssistantCounters = defineComponent<{
  /** The player slot the counters belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  counters: AssistantCounterValues;
}>('AssistantCounters', 'players');

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

/** The {@link AssistantCounters} carrier for `player`, or null when every counter is default. The
 *  lowest-id carrier wins should more than one ever exist. */
export function assistantCountersEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AssistantCounters)) {
    if (world.get(e, AssistantCounters).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

/**
 * Pay one produced unit off `player`'s `kind` counter, at the moment the queued product exists. An
 * infinite counter never drains, and a counter already at zero stays there.
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
  world.mut(carrier, AssistantCounters).counters[kind].value -= 1;
  if (assistantCountersAtDefault(block.counters)) world.destroy(carrier);
}

/**
 * The assistant's standing booking beside a woman's `ChildOrder`, marking the order as counter-funded so
 * the birth pays the right counter and player or AI `makeChild` orders never do. Removed at the birth, by
 * a superseding player `makeChild`, or by the assistant's stale sweep.
 */
export const AssistantChildOrder = defineComponent<{ sex: 'female' | 'male' }>(
  'AssistantChildOrder',
  'players',
);

/** The training-counter kinds a recruit booking can carry; the three class kinds also arm the recruit. */
export const ASSISTANT_RECRUIT_INTENTS = [
  'trainSoldiers',
  'trainSword',
  'trainSpear',
  'trainBow',
] as const satisfies readonly AssistantCounterKind[];
export type AssistantRecruitIntent = (typeof ASSISTANT_RECRUIT_INTENTS)[number];

/**
 * The assistant's training booking on a dispatched recruit: which `train*` counter funds it, whether its
 * weapon has landed, and the barracks it drills at, where its arming outing ends. A `trainSoldiers` recruit
 * is unmarked at enlistment; a class recruit keeps the mark until armed and armored, or until armor proves
 * unavailable, and through the walk back to the barracks.
 */
export const AssistantRecruit = defineComponent<{
  intent: AssistantRecruitIntent;
  armed: boolean;
  barracks: Entity;
}>('AssistantRecruit', 'players');

/**
 * The per-player "send graduates to work" switch, on while the carrier exists: a settler leaving school is
 * bound once to a free workplace slot in its new trade. Off by default.
 */
export const AssistantPostsGraduates = defineComponent<{
  /** The player slot the switch belongs to (`[0, MAX_PLAYERS)`). */
  player: number;
}>('AssistantPostsGraduates', 'players');

/**
 * The per-player "gatherers move their flags" switch, on while the carrier exists: a flag gatherer's flag is
 * kept within 3-5 tiles of a resource he can work, moving as his patch runs out. Off by default for a
 * player; a computer seat keeps it on.
 */
export const AssistantMovesFlags = defineComponent<{
  /** The player slot the switch belongs to (`[0, MAX_PLAYERS)`). */
  player: number;
}>('AssistantMovesFlags', 'players');

/** An on/off assistant switch: the per-player carrier exists while the switch is on. */
export type AssistantSwitch = Component<{ player: number }>;

/** `player`'s carrier of `toggle`, or null while the switch is off. The lowest-id carrier wins should more
 *  than one ever exist. */
export function assistantSwitchEntity(world: World, toggle: AssistantSwitch, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(toggle)) {
    if (world.get(e, toggle).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

/** The {@link AssistantPostsGraduates} carrier for `player`, or null while the switch is off. */
export function assistantPostsGraduatesEntity(world: World, player: number): Entity | null {
  return assistantSwitchEntity(world, AssistantPostsGraduates, player);
}

/** Whether `player`'s gatherers move their own flags ({@link AssistantMovesFlags}). */
export function assistantMovesFlags(world: World, player: number): boolean {
  return assistantSwitchEntity(world, AssistantMovesFlags, player) !== null;
}
