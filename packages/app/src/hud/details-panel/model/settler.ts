import {
  type AtomicEffect,
  entityById,
  type Fixed,
  fx,
  type NeedKind,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { JOB_SCOUT } from '../../../catalog/jobs.js';
import { num, type SnapshotEntity, settlerExperienceOf } from '../../../game/snapshot.js';
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
 * reads full rather than over. The labels
 * deliberately diverge from the decoded `humanwindow` 11-15 strings: each bar is named after the need it
 * shows (Hungry←hunger, Sleep←fatigue, Company←enjoyment), which the original's stat names do not map
 * onto 1:1.
 */
export function satisfactionBars(
  ent: SnapshotEntity,
  needsEnabled: boolean,
  carriesNeeds = true,
): PanelBar[] {
  const hud = messages().hud;
  const comps: Comp = ent.components;
  const s = (comps.SettlerNeeds ?? {}) as Comp;
  const bars: PanelBar[] = [];
  const health = healthBar(ent);
  if (health !== null) bars.push(health);
  if (!needsEnabled || !carriesNeeds) return bars;
  // A settler still growing carries no needs at all (`lifecycle/needs/system.ts`), so it shows its health
  // and nothing else.
  if (comps.Age !== undefined) return bars;
  bars.push(needBar(hud.hunger, 'hunger', num(s.hunger)));
  bars.push(needBar(hud.sleep, 'fatigue', num(s.fatigue)));
  bars.push(needBar(hud.company, 'enjoyment', num(s.enjoyment)));
  bars.push(needBar(hud.religion, 'piety', num(s.piety)));
  return bars;
}

/** One Experience row: a specialization's label, its completed-work repeats ("Wood 5" means five
 *  units gathered), its bonus percent (null when that experience buys no bonus), and whether it trains
 *  the settler's current trade. */
export interface ExperienceRowModel {
  readonly label: string;
  readonly repeats: number;
  readonly bonusPct: number | null;
  readonly own: boolean;
}

const PERCENT = 100;

const WEAPON_XP_KEY: ReadonlyMap<number, keyof ReturnType<typeof messages>['hud']['weaponXp']> = new Map([
  [systems.FIGHT_EXPERIENCE_TYPE.FIST, 'fist'],
  [systems.FIGHT_EXPERIENCE_TYPE.SPEAR, 'spear'],
  [systems.FIGHT_EXPERIENCE_TYPE.SWORD, 'sword'],
  [systems.FIGHT_EXPERIENCE_TYPE.BOW, 'bow'],
  [systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, 'catapult'],
]);

/** A specialization row's label; a good-specific track uses its `hud.trackLabels` entry, keyed by the
 *  track's content id slug, and falls back to "job - good". */
export function experienceLabel(
  ctx: UnitPanelModelContext,
  spec: number,
  track: JobExperienceDef | undefined,
): string {
  if (track !== undefined) {
    if (track.goodTypes.length === 0) return jobDisplayName(ctx, track.jobType);
    const trackLabels: Readonly<Record<string, string | undefined>> = messages().hud.trackLabels;
    return (
      trackLabels[track.id] ??
      `${jobDisplayName(ctx, track.jobType)} - ${track.goodTypes.map((good) => goodLabel(ctx, good)).join(' / ')}`
    );
  }
  const weaponKey = WEAPON_XP_KEY.get(spec);
  if (weaponKey !== undefined) return messages().hud.weaponXp[weaponKey];
  if (spec === systems.SCOUT_EXPERIENCE_TYPE) return jobDisplayName(ctx, JOB_SCOUT);
  return formatMessage(messages().hud.specialization, { id: spec });
}

/** A specialization row's percent is the effect that experience actually buys, not a raw curve read: the
 *  scout bucket its vision gain over the scout's base radius, a carrier track none. */
function experienceBonusPct(
  ctx: UnitPanelModelContext,
  spec: number,
  track: JobExperienceDef | undefined,
  points: number,
): number | null {
  if (track === undefined && WEAPON_XP_KEY.has(spec)) {
    return systems.withFightExperience(PERCENT, points) - PERCENT;
  }
  if (spec === systems.SCOUT_EXPERIENCE_TYPE) {
    return Math.round((systems.scoutVisionBonusNodes(points) / systems.SCOUT_VISION_NODES) * 100);
  }
  if (track !== undefined && isCarrierJob(ctx, track.jobType)) return null;
  return systems.experiencePercent(systems.experiencePoints(points));
}

/**
 * The Experience rows: the current trade's tracks first, each group most-trained first, off the
 * settler's `SettlerProgress.experience` map (`humanjobexperiencetypes` id → raw points). Raw points are
 * shown as completed-work repeats, dividing the track's accrual rate back out; a track-less bucket
 * (fight, scout) shows raw points and belongs to the fighter or scout trades.
 */
export function experienceRows(ctx: UnitPanelModelContext, comps: Comp): ExperienceRowModel[] {
  const jobType = num((comps.Settler as { jobType?: unknown } | undefined)?.jobType);
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  const fights = job !== undefined && (systems.isFighterJobRow(job) || systems.isHeroJobRow(job));
  const rows: (ExperienceRowModel & { spec: number })[] = [];
  for (const [spec, points] of settlerExperienceOf(comps)) {
    if (points <= 0) continue;
    const track = ctx.jobExperience.find((t) => t.typeId === spec);
    const repeats = track !== undefined ? systems.experienceRepeats(points, track) : points;
    if (repeats <= 0) continue; // partial credit toward the first repeat - nothing to show yet
    const own =
      track !== undefined
        ? track.jobType === jobType
        : WEAPON_XP_KEY.has(spec)
          ? fights
          : spec === systems.SCOUT_EXPERIENCE_TYPE && jobType === JOB_SCOUT;
    rows.push({
      label: experienceLabel(ctx, spec, track),
      repeats,
      bonusPct: experienceBonusPct(ctx, spec, track, points),
      own,
      spec,
    });
  }
  rows.sort((a, b) => Number(b.own) - Number(a.own) || b.repeats - a.repeats || a.spec - b.spec);
  return rows.map(({ label, repeats, bonusPct, own }) => ({ label, repeats, bonusPct, own }));
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
  | 'sleeping'
  | 'praying'
  | 'talking'
  | 'walking'
  | 'awaitingWorkplace'
  | 'awaitingTraining'
  | 'standingTo'
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
  sleep: 'sleeping',
  pray: 'praying',
  attack: 'fighting',
  slay: 'fighting',
  exercise: 'training',
  construct: 'building',
  repair: 'repairing',
  harvest: 'working',
  harvestFollowThrough: 'working',
  fish: 'working',
  forage: 'working',
  pickup: 'working',
  pileup: 'working',
  drop: 'working',
  cartLoad: 'working',
  cartUnload: 'working',
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
  if ('PathFollow' in components || 'MoveGoal' in components) return 'walking';
  // Waiting out a workplace still going up is by design; without its own caption it reads as idleness.
  if (awaitsItsWorkplace(snapshot, components)) return 'awaitingWorkplace';
  // Sent ahead to a barracks or school foundation, it waits beside the door until the house stands.
  if (awaitsItsTrainingHouse(snapshot, components)) return 'awaitingTraining';
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
