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

/** Who a carried (`misc`) grant goes to: every man the pass dresses, the fighters alone, or the
 *  civilians alone. */
export const ASSISTANT_GRANT_AUDIENCES = ['everyone', 'soldiers', 'civilians'] as const;
export type AssistantGrantAudience = (typeof ASSISTANT_GRANT_AUDIENCES)[number];

/**
 * The per-player audience limits of {@link AssistantGrants}: the carried (`misc`) good types handed to
 * fighters only. Kept apart from the grant list, so a limit outlives a revoked grant and binds the next
 * one; the carrier lives while the list is non-empty, like {@link AssistantGrants}. A good is never on
 * this list and {@link AssistantCivilianOnlyGrants} at once.
 */
export const AssistantSoldierOnlyGrants = defineComponent<{
  /** The player slot the limits belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  /** Limited good type ids, ascending. */
  goods: readonly number[];
}>('AssistantSoldierOnlyGrants', 'players');

/** The mirror limit of {@link AssistantSoldierOnlyGrants}: the carried good types handed to civilians
 *  only. */
export const AssistantCivilianOnlyGrants = defineComponent<{
  /** The player slot the limits belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  /** Limited good type ids, ascending. */
  goods: readonly number[];
}>('AssistantCivilianOnlyGrants', 'players');

/** A per-player good list carrier: {@link AssistantGrants}, its audience limits and
 *  {@link AssistantWeaponVetoes}. */
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

/** The good types `player`'s assistant hands to fighters alone, ascending; empty by default. */
export function assistantSoldierOnlyGoods(world: World, player: number): readonly number[] {
  return playerGoodList(world, AssistantSoldierOnlyGrants, player);
}

/** The good types `player`'s assistant hands to civilians alone, ascending; empty by default. */
export function assistantCivilianOnlyGoods(world: World, player: number): readonly number[] {
  return playerGoodList(world, AssistantCivilianOnlyGrants, player);
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

/** The recruit intents that arm a weapon class and so also dress him in armor. */
export const ASSISTANT_ARMING_INTENTS = ['trainSword', 'trainSpear', 'trainBow'] as const;
export type AssistantArmingIntent = (typeof ASSISTANT_ARMING_INTENTS)[number];

/** One weapon class's armor choice: every armor good in the order its recruits shop for them, and the
 *  goods the assistant never hands that class. */
export interface AssistantArmorOrder {
  order: readonly number[];
  off: readonly number[];
}

/**
 * The per-player armor choice of each weapon class the assistant arms. A class without an entry shops the
 * default order, strongest protection first, with nothing off; the carrier lives while any class has one.
 */
export const AssistantArmorOrders = defineComponent<{
  /** The player slot the choices belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  trainSword?: AssistantArmorOrder | undefined;
  trainSpear?: AssistantArmorOrder | undefined;
  trainBow?: AssistantArmorOrder | undefined;
}>('AssistantArmorOrders', 'players');

/** `player`'s {@link AssistantArmorOrders} carrier, or null while every class keeps the default. */
export function assistantArmorOrdersEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AssistantArmorOrders)) {
    if (world.get(e, AssistantArmorOrders).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

/** `player`'s own armor choice for `intent`, or undefined while that class keeps the default. */
export function assistantArmorOrder(
  world: World,
  player: number,
  intent: AssistantArmingIntent,
): AssistantArmorOrder | undefined {
  const carrier = assistantArmorOrdersEntity(world, player);
  return carrier === null ? undefined : world.get(carrier, AssistantArmorOrders)[intent];
}

/**
 * The per-player weapon order of each weapon class the assistant arms: the class's weapon goods in the
 * order its recruits shop them. A class without an entry shops the strongest first; which weapons it never
 * takes is {@link AssistantWeaponVetoes}. The carrier lives while any class has an entry.
 */
export const AssistantWeaponOrders = defineComponent<{
  /** The player slot the orders belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  trainSword?: readonly number[] | undefined;
  trainSpear?: readonly number[] | undefined;
  trainBow?: readonly number[] | undefined;
}>('AssistantWeaponOrders', 'players');

/** `player`'s {@link AssistantWeaponOrders} carrier, or null while every class keeps the default. */
export function assistantWeaponOrdersEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AssistantWeaponOrders)) {
    if (world.get(e, AssistantWeaponOrders).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

/** `player`'s own weapon order for `intent`, or undefined while that class keeps the default. */
export function assistantWeaponOrder(
  world: World,
  player: number,
  intent: AssistantArmingIntent,
): readonly number[] | undefined {
  const carrier = assistantWeaponOrdersEntity(world, player);
  return carrier === null ? undefined : world.get(carrier, AssistantWeaponOrders)[intent];
}

/**
 * The per-player assistant counter block - the sibling carrier of {@link AssistantGrants}: at most one per
 * player, created on the first non-default write and destroyed when every counter returns to
 * zero-and-finite.
 */
export const AssistantCounters = defineComponent<{
  /** The player slot the counters belong to (`[0, MAX_PLAYERS)`). */
  player: number;
  counters: AssistantCounterValues;
}>('AssistantCounters', 'players', { simOnly: true });

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
  ...ASSISTANT_ARMING_INTENTS,
] as const satisfies readonly AssistantCounterKind[];
export type AssistantRecruitIntent = (typeof ASSISTANT_RECRUIT_INTENTS)[number];

/**
 * The assistant's training booking on a dispatched recruit, or on a bare-handed soldier a class counter
 * arms: which `train*` counter funds it, whether its weapon has landed, and the barracks where its arming
 * outing ends, the one a recruit drills at or the first a bare soldier can walk to. A `trainSoldiers`
 * recruit is unmarked at enlistment; a class recruit keeps the mark until armed and armored, or until armor
 * proves unavailable, and through the walk back to the barracks; one still waiting for its weapon out of
 * drill is released once its counter is lowered below the bookings.
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

/**
 * The per-player "upgrade to better tools" switch, on while the carrier exists: a worker holding a tool
 * is sent to swap it for a granted one with a higher production bonus while a store holds spare stock.
 * Off by default for a player; a computer seat keeps it on.
 */
export const AssistantUpgradesTools = defineComponent<{
  /** The player slot the switch belongs to (`[0, MAX_PLAYERS)`). */
  player: number;
}>('AssistantUpgradesTools', 'players');

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

/** Whether `player`'s workers swap their tools for better granted ones ({@link AssistantUpgradesTools}). */
export function assistantUpgradesTools(world: World, player: number): boolean {
  return assistantSwitchEntity(world, AssistantUpgradesTools, player) !== null;
}

/** Every per-player carrier the assistant views read: its lists, orders, counters and switches. */
const ASSISTANT_SETTING_COMPONENTS: readonly Component<unknown>[] = [
  AssistantGrants,
  AssistantSoldierOnlyGrants,
  AssistantCivilianOnlyGrants,
  AssistantWeaponVetoes,
  AssistantArmorOrders,
  AssistantWeaponOrders,
  AssistantCounters,
  AssistantPostsGraduates,
  AssistantMovesFlags,
  AssistantUpgradesTools,
];

/** A token that changes whenever any seat's assistant settings may read differently: the sum of the
 *  carriers' membership and value-write generations, which only ever grow within one world. */
export function assistantSettingsVersion(world: World): number {
  let version = 0;
  for (const component of ASSISTANT_SETTING_COMPONENTS) {
    version += world.componentGeneration(component) + world.componentValueGeneration(component);
  }
  return version;
}
