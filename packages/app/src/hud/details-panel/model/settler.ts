import {
  type AtomicEffect,
  entityById,
  type Fixed,
  fx,
  type NeedKind,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { WEAPON_XP_KEY_BY_TYPE } from '../../../catalog/weapon-experience.js';
import {
  num,
  ridesPinnedShip,
  type SnapshotEntity,
  settlerExperienceOf,
  settlerNeedsOf,
} from '../../../game/snapshot/index.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { healthBar, type PanelBar, pct } from './bars.js';
import {
  type Comp,
  goodLabel,
  isCarrierJob,
  type JobExperienceDef,
  jobDisplayName,
  type UnitPanelModelContext,
} from './context.js';

function needBar(label: string, need: NeedKind, deficit: number | undefined): PanelBar {
  const level = 100 - pct(deficit);
  // A bar can hold reserve above full (`NEED_OVERFILL_FLOOR`), which the gauge cannot show: a settler
  // fresh from a meal at home would otherwise read a flat 100% for minutes with nothing moving.
  const stored = deficit === undefined || deficit >= 0 ? 0 : Math.round(fx.toFloat(deficit as Fixed) * -100);
  return { label, pct: level, hover: stored > 0 ? `${level}% +${stored}%` : `${level}%`, need };
}

/**
 * The General stat bars. The sim stores needs as rising deficits (`hunger`↑ = hungrier) while the
 * original's window shows the satisfaction level, so each need bar is `100 - need`; an overfilled bar
 * reads full rather than over. The labels are the original's `humanwindow` 11-15 stat names.
 */
export function satisfactionBars(
  ent: SnapshotEntity,
  tick: number,
  needsEnabled: boolean,
  carriesNeeds = true,
  canPray = false,
): PanelBar[] {
  const hud = messages().hud;
  const comps: Comp = ent.components;
  const s = settlerNeedsOf(ent, tick);
  const bars: PanelBar[] = [];
  const health = healthBar(ent);
  if (health !== null) bars.push(health);
  if (!needsEnabled || !carriesNeeds) return bars;
  // A settler still growing carries no needs at all (`lifecycle/needs/system.ts`), so it shows its health
  // and nothing else.
  if (comps.Age !== undefined) return bars;
  bars.push(needBar(hud.hunger, 'hunger', s?.hunger));
  bars.push(needBar(hud.sleep, 'fatigue', s?.fatigue));
  bars.push(needBar(hud.company, 'enjoyment', s?.enjoyment));
  const religion = needBar(hud.religion, 'piety', s?.piety);
  bars.push(canPray ? religion : { label: religion.label, pct: religion.pct, hover: religion.hover });
  return bars;
}

/** One Experience row: a specialization's label, its completed-work repeats ("Wood 5" means five
 *  units gathered), its bonus percent (null when that experience buys no bonus, and on the fight row),
 *  the fight counter's own reading (null on every other row), and whether it trains the settler's
 *  current trade. */
export interface ExperienceRowModel {
  readonly label: string;
  readonly repeats: number;
  readonly bonusPct: number | null;
  readonly fight: FightRowModel | null;
  readonly own: boolean;
}

/** What the personal fight counter buys with the weapon in hand, each null when it buys that nothing:
 *  dealt for a melee weapon or bare hands, accuracy for a bow, and the cut on blows taken for everyone
 *  the sim reads one for. */
export interface FightRowModel {
  readonly dealtPct: number | null;
  readonly takenCutPct: number | null;
  readonly accuracyPct: number | null;
}

/** A specialization row's label: the track's `hud.trackLabels` entry, keyed by its content slug, else
 *  the job's name for a general track and "job - good" for a good-specific one. */
export function experienceLabel(
  ctx: UnitPanelModelContext,
  spec: number,
  track: JobExperienceDef | undefined,
): string {
  if (track !== undefined) {
    const trackLabels: Readonly<Record<string, string | undefined>> = messages().hud.trackLabels;
    const own = trackLabels[track.id];
    if (own !== undefined) return own;
    if (track.goodTypes.length === 0) return jobDisplayName(ctx, track.jobType);
    return `${jobDisplayName(ctx, track.jobType)} - ${track.goodTypes.map((good) => goodLabel(ctx, good)).join(' / ')}`;
  }
  const weaponKey = WEAPON_XP_KEY_BY_TYPE.get(spec);
  if (weaponKey !== undefined) return messages().hud.weaponXp[weaponKey];
  return formatMessage(messages().hud.specialization, { id: spec });
}

/** A specialization row's percent is the effect that experience actually buys, not a raw curve read: a
 *  carrier track buys none. `raw` is the bucket's stored value; the fight counter's is in its fine units. */
function experienceBonusPct(
  ctx: UnitPanelModelContext,
  spec: number,
  track: JobExperienceDef | undefined,
  raw: number,
): number | null {
  if (spec === systems.FIGHT_EXPERIENCE_TYPE.PERSONAL) return null; // the fight row states its own
  if (track === undefined && WEAPON_XP_KEY_BY_TYPE.has(spec)) return null; // the catapult's buys aim
  if (track !== undefined && isCarrierJob(ctx, track.jobType)) return null;
  return systems.experiencePercent(systems.experiencePoints(raw));
}

/** The fight row's reading of `experience`, through the sim's seam when the context carries it. */
function fightRow(
  ctx: UnitPanelModelContext,
  comps: Comp,
  experience: ReadonlyMap<number, number>,
): FightRowModel {
  const settler = comps.Settler as { tribe?: unknown; jobType?: unknown; humanForm?: unknown } | undefined;
  const tribe = num(settler?.tribe);
  const effects =
    ctx.fightEffects === undefined || tribe === undefined
      ? undefined
      : ctx.fightEffects(
          { tribe, jobType: num(settler?.jobType) ?? null, humanForm: settler?.humanForm === true },
          num((comps.Weapon as { weaponTypeId?: unknown } | undefined)?.weaponTypeId),
          experience,
        );
  return {
    dealtPct: effects?.dealtPct ?? null,
    takenCutPct: effects?.takenCutPct ?? null,
    accuracyPct: effects?.accuracyPct ?? null,
  };
}

/**
 * The Experience rows: the current trade's tracks first, each group most-trained first, off the
 * settler's `SettlerProgress.experience` map (`humanjobexperiencetypes` id → raw points). Raw points are
 * shown as completed-work repeats, dividing the track's accrual rate back out; a track-less bucket
 * (fight) belongs to the fighter trades and shows its points, the personal counter's whole. A general
 * track that only repeats one good's track is left out.
 */
export function experienceRows(ctx: UnitPanelModelContext, comps: Comp): ExperienceRowModel[] {
  const jobType = num((comps.Settler as { jobType?: unknown } | undefined)?.jobType);
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  const fights = job !== undefined && (systems.isFighterJobRow(job) || systems.isHeroJobRow(job));
  const rows: (ExperienceRowModel & { spec: number })[] = [];
  const experience = settlerExperienceOf(comps);
  for (const [spec, points] of experience) {
    if (points <= 0) continue;
    const track = ctx.jobExperience.find((t) => t.typeId === spec);
    const personal = spec === systems.FIGHT_EXPERIENCE_TYPE.PERSONAL;
    const repeats = personal
      ? systems.personalFightPoints(experience)
      : track !== undefined
        ? systems.experienceRepeats(points, track)
        : points;
    if (repeats <= 0) continue; // partial credit toward the first repeat - nothing to show yet
    const own = track !== undefined ? track.jobType === jobType : WEAPON_XP_KEY_BY_TYPE.has(spec) && fights;
    rows.push({
      label: experienceLabel(ctx, spec, track),
      repeats,
      bonusPct: experienceBonusPct(ctx, spec, track, points),
      fight: personal ? fightRow(ctx, comps, experience) : null,
      own,
      spec,
    });
  }
  rows.sort((a, b) => Number(b.own) - Number(a.own) || b.repeats - a.repeats || a.spec - b.spec);
  return rows
    .filter((row) => !copiesItsGood(ctx, row, rows))
    .map(({ label, repeats, bonusPct, fight, own }) => ({
      label,
      repeats,
      bonusPct,
      fight,
      own,
    }));
}

/** A job's general track that one good-specific track of the same job fully accounts for: work on a
 *  good accrues both, so a trade with a single trained good ("Farming" and "Farming - Wheat") would
 *  show the same count twice. With two goods trained the general track is their total and stays. */
function copiesItsGood(
  ctx: UnitPanelModelContext,
  row: { readonly spec: number; readonly repeats: number },
  rows: readonly { readonly spec: number; readonly repeats: number }[],
): boolean {
  const track = ctx.jobExperience.find((t) => t.typeId === row.spec);
  if (track === undefined || track.goodTypes.length > 0) return false;
  const goods = rows.filter((other) => {
    const t = ctx.jobExperience.find((d) => d.typeId === other.spec);
    return t !== undefined && t.jobType === track.jobType && t.goodTypes.length > 0;
  });
  return goods.length === 1 && goods[0]?.repeats === row.repeats;
}

export const EXPERIENCE_FOLDED_MAX = 3;

/** The rows a folded Experience section keeps: the current trade's, at most
 *  {@link EXPERIENCE_FOLDED_MAX}, or the single best-trained one for a person without a trained trade. */
export function experienceShown(rows: readonly ExperienceRowModel[]): number {
  const own = rows.filter((row) => row.own).length;
  return Math.min(rows.length, EXPERIENCE_FOLDED_MAX, Math.max(1, own));
}

/** The live state the status line opens with, read off the settler's components. */
export type SettlerState =
  | 'ordered'
  | 'working'
  | 'building'
  | 'repairing'
  | 'fighting'
  | 'training'
  | 'eating'
  | 'drinking'
  | 'mealBreak'
  | 'sleeping'
  | 'praying'
  | 'talking'
  | 'walking'
  | 'awaitingWorkplace'
  | 'awaitingTraining'
  | 'awaitingSeat'
  | 'sailingRoute'
  | 'standingTo'
  | 'lost'
  | 'idle';

/**
 * What the running atomic says the person is doing, by its effect. Every economic effect (a stroke, a
 * catch, a pickup, a cart load, a craft cycle) reads as work; a need's effect as that need, so a
 * civilian eating or a builder asleep never reads as working; an `idle` effect is the wait animation.
 */
const ATOMIC_STATE: Readonly<Record<AtomicEffect['kind'], SettlerState>> = {
  move: 'walking',
  idle: 'idle',
  eat: 'eating',
  drink: 'drinking',
  sleep: 'sleeping',
  pray: 'praying',
  attack: 'fighting',
  slay: 'fighting',
  exercise: 'training',
  coinDrill: 'training',
  construct: 'building',
  repair: 'repairing',
  harvest: 'working',
  harvestFollowThrough: 'working',
  fish: 'working',
  forage: 'working',
  pickup: 'working',
  pileup: 'working',
  drop: 'working',
  tradeLoad: 'working',
  tradeUnload: 'working',
  tradeShipStow: 'working',
  tradeShipFetch: 'working',
  haulLoad: 'working',
  haulUnload: 'working',
  vehicleLoad: 'working',
  vehicleUnload: 'working',
  produce: 'working',
  sow: 'working',
  water: 'working',
  equip: 'working',
  unequip: 'working',
  erectSignpost: 'working',
  openChest: 'working',
};

function atomicState(components: Comp): SettlerState | null {
  const atomic = components.CurrentAtomic as { effect?: { kind?: unknown } } | undefined;
  if (atomic === undefined) return null;
  const kind = atomic.effect?.kind;
  return typeof kind === 'string' && Object.hasOwn(ATOMIC_STATE, kind)
    ? ATOMIC_STATE[kind as AtomicEffect['kind']]
    : 'working';
}

export function settlerStatus(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  entityId: number,
  components: Comp,
): SettlerState {
  const state = liveSettlerState(ctx, snapshot, entityId, components);
  return ctx.holdSettlerState?.(entityId, snapshot.tick, state) ?? state;
}

function liveSettlerState(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  entityId: number,
  components: Comp,
): SettlerState {
  // The sim retires PlayerOrder the tick the unit reaches its commanded destination, so a settler
  // carrying it is still walking there.
  if ('PlayerOrder' in components) return 'ordered';
  // A chat holds both people through its atomics; the seeker walking up to its partner is still walking.
  if ((components.Chat as { talking?: unknown } | undefined)?.talking === true) return 'talking';
  const atomic = atomicState(components);
  if (atomic !== null && atomic !== 'idle') return atomic;
  // Hunger took it off its orders: the walk to food is not the order's, and the orders wait for it.
  if ('MealBreak' in components) return 'mealBreak';
  if ('PathFollow' in components || 'MoveGoal' in components) return 'walking';
  // Below the live rungs: a cut-off settler keeps `LostWay` through a meal or an errand in reach, which
  // reads as what it is; standing, it reads lost.
  if ('LostWay' in components) return 'lost';
  // Waiting out a workplace still going up is by design; without its own caption it reads as idleness.
  if (awaitsItsWorkplace(snapshot, components)) return 'awaitingWorkplace';
  // Sent ahead to a barracks or school foundation, it waits beside the door until the house stands.
  if (awaitsItsTrainingHouse(snapshot, components)) return 'awaitingTraining';
  // Sent to a full school or barracks, it waits in the yard for a seat to free.
  if ((components.TrainingOrder as { seated?: unknown } | undefined)?.seated === false) return 'awaitingSeat';
  // A trader aboard its pinned ship is on its route, however long the crossing.
  if (ridesPinnedShip(components)) return 'sailingRoute';
  // A unit holding its ground under the battle alert takes no work and no rest, which without its own
  // caption reads as a soldier that has simply stopped caring about its empty bars.
  if (ctx.standsTo?.(entityId) === true) return 'standingTo';
  return 'idle';
}

/**
 * Keeps one settler's last active state over a single idle read. The sim starts a settler's next atomic on
 * the tick after the last one ends, so a builder between two strokes stands with nothing running for that
 * one tick; idleness shows once a later tick still reads it.
 */
export function settlerStateHold(): SettlerStateHold {
  let entity: number | null = null;
  let active: SettlerState | null = null;
  let idleTick: number | null = null;
  return (id, tick, state) => {
    if (id !== entity) {
      entity = id;
      active = null;
      idleTick = null;
    }
    if (state !== 'idle') {
      active = state;
      idleTick = null;
      return state;
    }
    if (active === null) return state;
    idleTick ??= tick;
    if (tick === idleTick) return active;
    active = null;
    return state;
  };
}

export type SettlerStateHold = (entity: number, tick: number, state: SettlerState) => SettlerState;

function awaitsItsTrainingHouse(snapshot: WorldSnapshot, components: Comp): boolean {
  const house = num((components.TrainingOrder as { house?: unknown } | undefined)?.house);
  if (house === undefined) return false;
  return entityById(snapshot, house)?.components.UnderConstruction !== undefined;
}

function awaitsItsWorkplace(snapshot: WorldSnapshot, components: Comp): boolean {
  const assignment = components.JobAssignment as { workplace?: unknown } | undefined;
  const workplaceId = num(assignment?.workplace);
  if (workplaceId === undefined) return false;
  return entityById(snapshot, workplaceId)?.components.UnderConstruction !== undefined;
}
