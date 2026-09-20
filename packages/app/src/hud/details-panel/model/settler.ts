import { entityById, type Fixed, fx, systems, type WorldSnapshot } from '@open-northland/sim';
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
import type { EquipRow } from './settler-equipment.js';
import type { UnlockProgressRowModel } from './settler-unlocks.js';
import type { SettlerWorkModel } from './settler-work.js';
import type { TradePanelModel } from './trade.js';

/** The four military stances (`MILITARY_MODE`). The original carries no string for the sim's own states,
 *  so the "Postawa" line's labels come from the app's own bundle. */
export function stanceLabel(mode: number | undefined): string {
  const hud = messages().hud;
  if (mode === systems.MILITARY_MODE.ATTACK) return hud.attack;
  if (mode === systems.MILITARY_MODE.DEFEND) return hud.defend;
  if (mode === systems.MILITARY_MODE.IGNORE) return hud.ignore;
  if (mode === systems.MILITARY_MODE.FLEE) return hud.flee;
  return '-';
}

export interface SettlerPanelModel {
  readonly kind: 'settler';
  readonly entityId: number;
  readonly name: string;
  readonly profession: string;
  /** False for an idle or jobless settler, which has no trade to place. */
  readonly canAssignWorkplace: boolean;
  /** True for a settler currently posted to a workplace. */
  readonly canUnassignWorkplace: boolean;
  /** Any adult may be housed; false for a growing child, whose family is housed through its parents. */
  readonly canAssignHome: boolean;
  /** True for an adult that currently has a `Residence` to move its family out of. */
  readonly canUnassignHome: boolean;
  /** Owner/tribe meta line under the name, with the military stance appended for a soldier. */
  readonly meta: string;
  /** A short live-state caption standing in for the original's animated "what it's doing" preview. */
  readonly statusCaption: string;
  /** The Ogólne stat bars: Zdrowie (only for a unit with Health), then the need bars when they apply. */
  readonly bars: readonly PanelBar[];
  readonly work: SettlerWorkModel;
  /** The Handel section: non-null for a trader. */
  readonly trade: TradePanelModel | null;
  /** Every specialization the settler has trained, most-trained first; empty when it has none. */
  readonly experience: readonly ExperienceRowModel[];
  /** Progress toward the professions this settler's current work unlocks next; empty while progression
   *  is off. */
  readonly upcomingUnlocks: readonly UnlockProgressRowModel[];
  /** The Ekwipunek section as labeled rows, from the sim `Equipment` component. */
  readonly equipmentRows: readonly EquipRow[];
}

function needBar(label: string, deficit: number | undefined): PanelBar {
  const level = 100 - pct(deficit);
  // A bar can hold reserve above full (`NEED_OVERFILL_FLOOR`), which the gauge cannot show: a settler
  // fresh from a meal at home would otherwise read a flat 100% for minutes with nothing moving.
  const stored = deficit === undefined || deficit >= 0 ? 0 : Math.round(fx.toFloat(deficit as Fixed) * -100);
  return { label, pct: level, hover: stored > 0 ? `${level}% +${stored}%` : `${level}%` };
}

/**
 * The Ogólne stat bars. The sim stores needs as rising deficits (`hunger`↑ = hungrier) while the
 * original's window shows the satisfaction level, so each need bar is `100 - need`; an overfilled bar
 * reads full rather than over. The labels
 * deliberately diverge from the decoded `humanwindow` 11-15 strings: each bar is named after the need it
 * shows (Głód←hunger, Sen←fatigue, Towarzystwo←enjoyment), which the original's stat names do not map
 * onto 1:1.
 */
export function satisfactionBars(
  ent: SnapshotEntity,
  needsEnabled: boolean,
  carriesNeeds = true,
): PanelBar[] {
  const hud = messages().hud;
  const comps: Comp = ent.components;
  const s = (comps.Settler ?? {}) as Comp;
  const bars: PanelBar[] = [];
  const health = healthBar(ent);
  if (health !== null) bars.push(health);
  if (!needsEnabled || !carriesNeeds) return bars;
  // A settler still growing carries no needs at all (`lifecycle/needs/system.ts`), so it shows its health
  // and nothing else.
  if (comps.Age !== undefined) return bars;
  bars.push(needBar(hud.hunger, num(s.hunger)));
  bars.push(needBar(hud.sleep, num(s.fatigue)));
  bars.push(needBar(hud.company, num(s.enjoyment)));
  bars.push(needBar(hud.religion, num(s.piety)));
  return bars;
}

/** One Doświadczenie row: a specialization's label, its completed-work repeats ("Drewno 5" means five
 *  units gathered), and its bonus percent, null when that experience buys no bonus. */
export interface ExperienceRowModel {
  readonly label: string;
  readonly repeats: number;
  readonly bonusPct: number | null;
}

const WEAPON_XP_KEY: ReadonlyMap<number, keyof ReturnType<typeof messages>['hud']['weaponXp']> = new Map([
  [systems.FIGHT_EXPERIENCE_TYPE.FIST, 'fist'],
  [systems.FIGHT_EXPERIENCE_TYPE.SPEAR, 'spear'],
  [systems.FIGHT_EXPERIENCE_TYPE.SWORD, 'sword'],
  [systems.FIGHT_EXPERIENCE_TYPE.AXE, 'axe'],
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
  repeats: number,
): number | null {
  if (track === undefined && WEAPON_XP_KEY.has(spec)) {
    return Math.round(fx.toFloat(systems.fightDamageBonus(points)) * 100);
  }
  if (spec === systems.SCOUT_EXPERIENCE_TYPE) {
    return Math.round((systems.scoutVisionBonusNodes(points) / systems.SCOUT_VISION_NODES) * 100);
  }
  if (track !== undefined && isCarrierJob(ctx, track.jobType)) return null;
  return Math.round(fx.toFloat(systems.experienceBonus(repeats)) * 100);
}

/**
 * The Doświadczenie rows, most-trained first, off the settler's `Settler.experience` map
 * (`humanjobexperiencetypes` id → raw points). Raw points are shown as completed-work repeats, dividing
 * the track's accrual rate back out; a track-less bucket (fight, scout) shows raw points.
 */
export function experienceRows(ctx: UnitPanelModelContext, comps: Comp): ExperienceRowModel[] {
  const rows: (ExperienceRowModel & { spec: number })[] = [];
  for (const [spec, points] of settlerExperienceOf(comps)) {
    if (points <= 0) continue;
    const track = ctx.jobExperience.find((t) => t.typeId === spec);
    const repeats = track !== undefined ? systems.experienceRepeats(points, track) : points;
    if (repeats <= 0) continue; // partial credit toward the first repeat - nothing to show yet
    rows.push({
      label: experienceLabel(ctx, spec, track),
      repeats,
      bonusPct: experienceBonusPct(ctx, spec, track, points, repeats),
      spec,
    });
  }
  rows.sort((a, b) => b.repeats - a.repeats || a.spec - b.spec);
  return rows.map(({ label, repeats, bonusPct }) => ({ label, repeats, bonusPct }));
}

export function settlerStatus(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  entityId: number,
  components: Comp,
): string {
  const statuses = messages().hud.statuses;
  // The sim retires PlayerOrder the tick the unit reaches its commanded destination, so a settler
  // carrying it is still walking there.
  if ('PlayerOrder' in components) return statuses.ordered;
  if ('CurrentAtomic' in components) return statuses.working;
  if ('PathFollow' in components || 'MoveGoal' in components) return statuses.walking;
  // Waiting out a workplace still going up is by design; without its own caption it reads as idleness.
  if (awaitsItsWorkplace(snapshot, components)) return statuses.awaitingWorkplace;
  // A unit holding its ground under the battle alert takes no work and no rest, which without its own
  // caption reads as a soldier that has simply stopped caring about its empty bars.
  if (ctx.standsTo?.(entityId) === true) return statuses.standingTo;
  return statuses.idle;
}

function awaitsItsWorkplace(snapshot: WorldSnapshot, components: Comp): boolean {
  const assignment = components.JobAssignment as { workplace?: unknown } | undefined;
  const workplaceId = num(assignment?.workplace);
  if (workplaceId === undefined) return false;
  return entityById(snapshot, workplaceId)?.components.UnderConstruction !== undefined;
}
