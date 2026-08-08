import { entityById, fx, systems, type WorldSnapshot } from '@open-northland/sim';
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

/**
 * The original has no string for the sim's own states (stance names, status lines, need names), so those
 * carry pinned Polish labels here; everything it does provide is looked up from the decoded string tables
 * at render time.
 */

/** The four military stances (`MILITARY_MODE`), with Polish labels for the live "Postawa" line. */
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
  /** The character's personal name, drawn as the section headline in place of the "Ogólne" title. */
  readonly name: string;
  /** The character's profession (its job label) - the name line under the headline. */
  readonly profession: string;
  /** False for an idle or jobless settler, which has no trade to place. */
  readonly canAssignWorkplace: boolean;
  /** True for a settler currently posted to a workplace, the only state the release has anything to do. */
  readonly canUnassignWorkplace: boolean;
  /** Any adult may be housed; false for a growing child, whose family is housed through its parents. */
  readonly canAssignHome: boolean;
  /** True for an adult that currently has a `Residence` to move its family out of. */
  readonly canUnassignHome: boolean;
  /** Owner/tribe meta line under the name, with the military stance appended for a soldier. */
  readonly meta: string;
  /** A short live-state caption drawn in the portrait box, standing in for the original's animated
   *  "what it's doing" preview. */
  readonly statusCaption: string;
  /** The Ogólne stat bars: Zdrowie (only for a unit with Health), then the need bars when they apply. */
  readonly bars: readonly PanelBar[];
  readonly work: SettlerWorkModel;
  /** Every specialization the settler has trained, most-trained first; empty when it has none. */
  readonly experience: readonly ExperienceRowModel[];
  /** Progress toward the professions this settler's current work unlocks next, drawn dimmed under the
   *  trained rows; empty while progression is off. */
  readonly upcomingUnlocks: readonly UnlockProgressRowModel[];
  /** The Ekwipunek section as labeled rows, from the sim `Equipment` component. */
  readonly equipmentRows: readonly EquipRow[];
}

function needBar(label: string, deficit: number | undefined): PanelBar {
  const level = 100 - pct(deficit);
  return { label, pct: level, hover: `${level}%` };
}

/**
 * The Ogólne stat bars. The sim stores needs as rising deficits (`hunger`↑ = hungrier) while the
 * original's window shows the satisfaction level, so each need bar is `100 - need`. The labels
 * deliberately diverge from the decoded `humanwindow` 11-15 strings: each bar is named after the need it
 * shows (Głód←hunger, Sen←fatigue, Towarzystwo←enjoyment), which the original's stat names do not map
 * onto 1:1. Every need bar drops for a cared-for baby, whose needs never accumulate, and for a match run
 * with the needs rule off.
 */
export function satisfactionBars(ent: SnapshotEntity, needsEnabled: boolean): PanelBar[] {
  const hud = messages().hud;
  const comps: Comp = ent.components;
  const s = (comps.Settler ?? {}) as Comp;
  const bars: PanelBar[] = [];
  const health = healthBar(ent);
  if (health !== null) bars.push(health);
  if (!needsEnabled) return bars;
  if (comps.Age !== undefined && systems.isBaby(num(s.jobType) ?? null)) return bars;
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
    if (track.goodType === undefined) return jobDisplayName(ctx, track.jobType);
    const trackLabels: Readonly<Record<string, string | undefined>> = messages().hud.trackLabels;
    return (
      trackLabels[track.id] ?? `${jobDisplayName(ctx, track.jobType)} - ${goodLabel(ctx, track.goodType)}`
    );
  }
  const weaponKey = WEAPON_XP_KEY.get(spec);
  if (weaponKey !== undefined) return messages().hud.weaponXp[weaponKey];
  if (spec === systems.SCOUT_EXPERIENCE_TYPE) return jobDisplayName(ctx, JOB_SCOUT);
  return formatMessage(messages().hud.specialization, { id: spec });
}

/**
 * A specialization row's percent is the actual effect of that experience, never a raw curve read: the
 * scout bucket shows its vision gain over the scout's base radius, a carrier track none, and every other
 * work track the shared output/speed curve.
 */
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
 * the track's accrual rate back out, so "Zbieracz Drewna 5" means five wood gathered; a track-less
 * bucket (fight, scout) shows raw points.
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

export function settlerStatus(snapshot: WorldSnapshot, components: Comp): string {
  const statuses = messages().hud.statuses;
  // PlayerOrder is a bare en-route marker the sim retires the tick the unit reaches its commanded
  // destination, so a settler carrying it is always still walking there (no post-arrival dwell).
  if ('PlayerOrder' in components) return statuses.ordered;
  if ('CurrentAtomic' in components) return statuses.working;
  if ('PathFollow' in components || 'MoveGoal' in components) return statuses.walking;
  // A settler posted to a site still going up waits there by design, which without its own caption reads
  // as plain idleness.
  if (awaitsItsWorkplace(snapshot, components)) return statuses.awaitingWorkplace;
  return statuses.idle;
}

function awaitsItsWorkplace(snapshot: WorldSnapshot, components: Comp): boolean {
  const assignment = components.JobAssignment as { workplace?: unknown } | undefined;
  const workplaceId = num(assignment?.workplace);
  if (workplaceId === undefined) return false;
  return entityById(snapshot, workplaceId)?.components.UnderConstruction !== undefined;
}
