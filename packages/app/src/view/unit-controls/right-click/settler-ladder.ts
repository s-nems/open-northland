import type { EquipCategory } from '@open-northland/data';
import { entityById, MAX_UNIT_ORDER_MEMBERS, nodeOfPosition, systems } from '@open-northland/sim';
import { canOpenChest, chestKindOf, positionOf, settlerJobType } from '../../../game/snapshot/index.js';
import type { Tile } from '../../picking.js';
import { tradeHousePick } from '../highlights/index.js';
import type { FormationUnit } from '../orders/formation.js';
import { atBuilding, atSite, type BuildingIntent, queueAtBuilding } from './building-rungs.js';
import {
  contentLookups,
  type PendingAnswer,
  type RightClickAsks,
  type RightClickContext,
  type RightClickHit,
  type RightClickMods,
} from './context.js';

export type SettlerClickMods = Pick<RightClickMods, 'queued' | 'usesHeap'>;

export interface LadderContext extends Pick<RightClickContext, 'snapshot' | 'content'> {
  readonly asks: Pick<RightClickAsks, 'tradeHouse' | 'equip' | 'formation'>;
}

/** Where the ladder's lower rungs aim, read as the click lands: an order decided later still aims there. */
export interface RightClickAim {
  /** Any building under the cursor, a trader's route candidate. */
  readonly house: number | null;
  /** An own building under the cursor, the building rung. */
  readonly building: number | null;
  /** An own wall or road site under the cursor, which the selected builders take as their site. */
  readonly site: number | null;
  readonly tile: Tile;
}

/** One rung's order. Several groups split one selection; the first rung that takes a settler wins. */
export type SettlerIntent =
  /** The scouts go after a claimable animal; the rest go further down the ladder. */
  | { readonly kind: 'claimAnimal'; readonly animal: number }
  | { readonly kind: 'attack'; readonly enemy: number }
  /** The fighters strike a wild animal; the rest go further down. Original behavior: the right click
   *  offers every settler the attack-animal order; here only fighters take it. */
  | { readonly kind: 'hunt'; readonly prey: number }
  /** Sent only to those that may open the chest; the others get no order. */
  | { readonly kind: 'openChest'; readonly chest: number }
  | { readonly kind: 'eat'; readonly pile: number }
  /** `candidates` (those not already wearing the good) are asked whether they may put it on; with
   *  nobody able, every group member that is no candidate or still answers the click takes the rungs
   *  from the trade route down. */
  | {
      readonly kind: 'equip';
      readonly pile: number;
      readonly goodType: number;
      readonly group: EquipCategory;
      readonly candidates: readonly number[];
    }
  /** The gatherers of the good switch to it; the rest go further down. */
  | { readonly kind: 'gather'; readonly goodType: number }
  /** `detach` take the house off their route at once; `ask` put it on once the sim admits it, and the
   *  refused take the rungs past the route. */
  | {
      readonly kind: 'tradeHouse';
      readonly house: number;
      readonly detach: readonly number[];
      readonly ask: readonly number[];
    }
  | BuildingIntent
  | { readonly kind: 'walk'; readonly tile: Tile };

export interface SettlerGroup {
  readonly units: readonly FormationUnit[];
  readonly intent: SettlerIntent;
  readonly pending?: PendingAnswer;
}

/** The rungs that split the selection, the rest going further down; the press confirms on the rest's
 *  order unless nobody is left. */
export const PARTITION_RUNGS: ReadonlySet<SettlerIntent['kind']> = new Set(['claimAnimal', 'hunt', 'gather']);

export type SettlerPlan =
  /** Nobody in the selection takes orders. */
  | { readonly kind: 'none' }
  /** An own settler under the cursor is selected and its ring opens. */
  | { readonly kind: 'select'; readonly settler: number }
  | { readonly kind: 'orderLimit' }
  | { readonly kind: 'orders'; readonly aim: RightClickAim; readonly groups: readonly SettlerGroup[] };

const jobOf = (ctx: LadderContext, unit: FormationUnit): number | null => {
  const self = entityById(ctx.snapshot, unit.ref);
  return self === undefined ? null : (settlerJobType(self) ?? null);
};

function split(
  units: readonly FormationUnit[],
  takes: (unit: FormationUnit) => boolean,
): [FormationUnit[], FormationUnit[]] {
  const taking: FormationUnit[] = [];
  const others: FormationUnit[] = [];
  for (const unit of units) (takes(unit) ? taking : others).push(unit);
  return [taking, others];
}

/** Whether the snapshot settler's fixed `group` slot already holds `goodType`, worn or not. */
function wearsGood(
  components: Readonly<Record<string, unknown>>,
  group: Exclude<EquipCategory, 'misc'>,
  goodType: number,
): boolean {
  const equipment = components.Equipment as
    | Partial<Record<Exclude<EquipCategory, 'misc'>, { readonly goodType?: unknown } | null>>
    | undefined;
  return equipment?.[group]?.goodType === goodType;
}

/** A marker's building is walked to where it stands, not to the ground under its flag. */
function aimOf(ctx: LadderContext, hit: RightClickHit, onBuilding: number | null): RightClickAim {
  const standing = onBuilding === null ? undefined : entityById(ctx.snapshot, onBuilding);
  const position = standing === undefined ? undefined : positionOf(standing);
  const node = position === undefined ? undefined : nodeOfPosition(position.x, position.y);
  return {
    house: onBuilding ?? hit.building,
    building: onBuilding ?? hit.ownBuilding,
    site: hit.site,
    tile: node === undefined ? hit.tile : { col: node.hx, row: node.hy },
  };
}

/**
 * What the selected settlers' right click does. `commanded` are the selection's settlers that take
 * orders; `onBuilding` is a building resolved from a marker rather than the point (a garrison flag
 * hangs far above the tower it stands for).
 */
export function resolveSettlerRightClick(
  ctx: LadderContext,
  commanded: readonly FormationUnit[],
  hit: RightClickHit,
  mods: SettlerClickMods,
  onBuilding: number | null,
): SettlerPlan {
  if (hit.ownSettler !== null) return { kind: 'select', settler: hit.ownSettler };
  // A selected building, flag or signpost takes no orders: nobody to command, nothing to confirm.
  if (commanded.length === 0) return { kind: 'none' };
  if (commanded.length > MAX_UNIT_ORDER_MEMBERS) return { kind: 'orderLimit' };
  const aim = aimOf(ctx, hit, onBuilding);
  return { kind: 'orders', aim, groups: ladder(ctx, commanded, hit, aim, mods) };
}

function ladder(
  ctx: LadderContext,
  commanded: readonly FormationUnit[],
  hit: RightClickHit,
  aim: RightClickAim,
  { queued, usesHeap }: SettlerClickMods,
): SettlerGroup[] {
  const { content, snapshot } = ctx;
  const groups: SettlerGroup[] = [];
  let rest = commanded;
  // An animal the scouts are claiming is struck by nobody: the others take their order under it.
  let claimed: number | null = null;
  const animal = hit.claimableLivestock;
  if (animal !== null) {
    const [scouts, others] = split(rest, (unit) => systems.isScoutJob(content, jobOf(ctx, unit)));
    if (scouts.length > 0) {
      groups.push({ units: scouts, intent: { kind: 'claimAnimal', animal } });
      claimed = animal;
    }
    rest = others;
    if (rest.length === 0) return groups;
  }
  if (hit.enemy !== null && hit.enemy !== claimed) {
    groups.push({ units: rest, intent: { kind: 'attack', enemy: hit.enemy } });
    return groups;
  }
  const prey = hit.wildlife;
  if (prey !== null && prey !== claimed) {
    const [fighters, others] = split(rest, (unit) => systems.isFighterJob(content, jobOf(ctx, unit)));
    if (fighters.length > 0) {
      groups.push({ units: fighters, intent: { kind: 'hunt', prey } });
      rest = others;
      if (rest.length === 0) return groups;
    }
  }
  // Only a settler that may open the chest is sent, as the original's default click offers it only to
  // one, and so one the sim would refuse never lands in the replay log. A chest nobody selected may
  // open is walked to like any ground.
  const chest = hit.chest;
  const chestEntity = chest === null ? undefined : entityById(snapshot, chest);
  const chestKind = chestEntity === undefined ? undefined : chestKindOf(chestEntity);
  if (chest !== null && chestKind !== undefined) {
    const openers = rest.filter((unit) => {
      const self = entityById(snapshot, unit.ref);
      return self !== undefined && canOpenChest(self, chestKind, content);
    });
    if (openers.length > 0) {
      groups.push({ units: openers, intent: { kind: 'openChest', chest } });
      return groups;
    }
  }
  // Original behavior: the plain click on a good lying on the ground eats it or puts it on. Here that
  // takes the heap modifier, our choice, so a plain click among heaps still walks.
  const pile = usesHeap ? hit.pile : null;
  if (pile !== null && systems.isFoodIn(content, systems.edibleGoodFormOf(content, pile.goodType))) {
    groups.push({ units: rest, intent: { kind: 'eat', pile: pile.ref } });
    return groups;
  }
  const equip = pile === null || !ctx.asks.equip ? null : equipOf(ctx, rest, pile.ref, pile.goodType);
  if (equip !== null) {
    groups.push({ units: rest, intent: equip, pending: 'equip' });
    return groups;
  }
  // A gathered good is a standing setting, so a Shift click on a resource walks there.
  const resource = hit.resource;
  if (!queued && resource !== null) {
    const goodType = resource.goodType;
    const [gatherers, others] = split(rest, (unit) => {
      const job = jobOf(ctx, unit);
      return (
        job !== null &&
        systems.jobChangesProduction(content, job) &&
        systems.jobGathersGood({ content }, job, goodType)
      );
    });
    if (gatherers.length > 0) groups.push({ units: gatherers, intent: { kind: 'gather', goodType } });
    rest = others;
    if (rest.length === 0) return groups;
  }
  groups.push(...routeRungs(ctx, rest, aim, queued));
  return groups;
}

/**
 * The equip rung: the good lying on the ground is offered to each selected human who does not already
 * wear that item type, as the original offers it. A misc good (mead, potions, amulets) skips
 * the worn check, as its slots stack. Null when the good is no equipment or everyone wears it.
 */
function equipOf(
  ctx: LadderContext,
  units: readonly FormationUnit[],
  pile: number,
  goodType: number,
): SettlerIntent | null {
  const group = contentLookups(ctx.content).goods.get(goodType)?.equip?.category;
  if (group === undefined) return null;
  const candidates = units
    .map((unit) => unit.ref)
    .filter((ref) => {
      const self = entityById(ctx.snapshot, ref);
      return self !== undefined && (group === 'misc' || !wearsGood(self.components, group, goodType));
    });
  return candidates.length === 0 ? null : { kind: 'equip', pile, goodType, group, candidates };
}

/**
 * The ladder from the trade route down: a trader's route toggle, then the building, then the walk.
 * Original behavior: a trader's right-click on a standing house puts it on the trade route, another
 * tribe's house included, and takes it off when the route already names it. A route stop is a
 * standing setting, so a `queued` click skips the toggle.
 */
export function routeRungs(
  ctx: LadderContext,
  units: readonly FormationUnit[],
  aim: RightClickAim,
  queued: boolean,
): SettlerGroup[] {
  if (queued) return pastRouteRungs(ctx, units, aim, true);
  const groups: SettlerGroup[] = [];
  let others = units;
  if (aim.house !== null) {
    const { detach, ask } = tradeHouseSplit(ctx, units, aim.house);
    if (detach.length + ask.length > 0) {
      const routed = new Set([...detach, ...ask]);
      groups.push({
        units: units.filter((unit) => routed.has(unit.ref)),
        intent: { kind: 'tradeHouse', house: aim.house, detach, ask },
        ...(ask.length > 0 ? { pending: 'tradeAttach' as const } : {}),
      });
      others = units.filter((unit) => !routed.has(unit.ref));
    }
  }
  if (others.length > 0) groups.push(...pastRouteRungs(ctx, others, aim, false));
  return groups;
}

/** The traders among `units` whose route already names `house`, and those the trade-stop rule is
 *  asked about; without the rule, a trader puts no house on its route. */
export function tradeHouseSplit(
  ctx: LadderContext,
  units: readonly { readonly ref: number }[],
  house: number,
): { readonly detach: number[]; readonly ask: number[] } {
  const detach: number[] = [];
  const ask: number[] = [];
  for (const unit of units) {
    const self = entityById(ctx.snapshot, unit.ref);
    if (self === undefined || !systems.isTraderJob(ctx.content, settlerJobType(self) ?? null)) continue;
    if (tradeHousePick.onRoute(ctx.snapshot, house, unit.ref)) detach.push(unit.ref);
    else if (ctx.asks.tradeHouse) ask.push(unit.ref);
  }
  return { detach, ask };
}

/** The building rung, then the site, then the walk. */
export function pastRouteRungs(
  ctx: LadderContext,
  units: readonly FormationUnit[],
  aim: RightClickAim,
  queued: boolean,
): SettlerGroup[] {
  if (aim.building !== null) {
    const intent = queued
      ? queueAtBuilding(ctx, units, aim.building, aim.tile)
      : atBuilding(ctx, units, aim.building);
    return [withWalkers(units, intent, ctx)];
  }
  if (aim.site !== null) return [withWalkers(units, atSite(ctx, units, aim.site, aim.tile), ctx)];
  return [{ units, intent: { kind: 'walk', tile: aim.tile }, ...formationPending(ctx) }];
}

const formationPending = (ctx: LadderContext): { pending?: PendingAnswer } =>
  ctx.asks.formation ? { pending: 'formation' } : {};

/** A building rung whose walkers wait on the formation query carries that pending answer. */
function withWalkers(
  units: readonly FormationUnit[],
  intent: BuildingIntent,
  ctx: LadderContext,
): SettlerGroup {
  const walks = (intent.kind === 'queueAtBuilding' || intent.kind === 'site') && intent.walkers.length > 0;
  return { units, intent, ...(walks ? formationPending(ctx) : {}) };
}
