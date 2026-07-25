import { components, fx, systems } from '@open-northland/sim';
import { num, settlerExperienceOf } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type PanelBar, pct, pctRatio } from './bars.js';
import {
  type Comp,
  goodDef,
  goodLabel,
  type JobExperienceDef,
  jobDisplayName,
  type UnitPanelModelContext,
} from './context.js';
import type { UnlockProgressRowModel } from './settler-unlocks.js';
import type { SettlerWorkModel } from './settler-work.js';

/**
 * The settler's personal-state half of the details-panel model: the Ogólne satisfaction bars, the
 * Doświadczenie datum, the Ekwipunek rows, and the live status caption — all with no Pixi/DOM in sight
 * (the Praca work menus live in `settler-work.ts`). The orchestrator in `index.ts` assembles a
 * {@link SettlerPanelModel} from these.
 *
 * Label language note: the sim has no matching original string for its own states (stance names, status
 * lines, need names), so those carry pinned Polish fallbacks here; everything the original does provide
 * (section titles, button labels) is looked up from the decoded string tables at render time.
 */

/**
 * The `humanwindow` string ids the settler panel resolves at draw time — the decoded original section
 * titles and equipment-slot labels (`content/gui/strings/<lang>.json`, decoded from the original
 * `ingamegui` tables). Fidelity: everything the original does provide is looked up; the pinned Polish
 * fallbacks the model rows carry only cover a checkout without `content/`. One deliberate exception:
 * the Ogólne stat bars pin their own labels instead of the decoded 11–15 strings — see
 * {@link satisfactionBars}. Named per the no-magic-numbers rule so a slot/label id reads by meaning,
 * not a bare number.
 */
export const HUMANWINDOW = {
  general: 1, // 'Ogólne'
  work: 3, // 'Praca'
  equip: 4, // 'Ekwipunek'
  experience: 5, // 'Doświadczenie'
  assignHome: 28, // 'Przydziel Dom'
  assignWork: 31, // 'Przydziel Miejsce Pracy'
  weapon: 60, // 'Broń'
  armor: 63, // 'Zbroja'
  boots: 66, // 'Buty'
  tools: 69, // 'Narzędzia'
  misc: 72, // 'Ekwipunek'
} as const;

/** The four military stances (`MILITARY_MODE`), with Polish labels for the live "Postawa" line. */
export function stanceLabel(mode: number | undefined): string {
  const hud = messages().hud;
  if (mode === systems.MILITARY_MODE.ATTACK) return hud.attack;
  if (mode === systems.MILITARY_MODE.DEFEND) return hud.defend;
  if (mode === systems.MILITARY_MODE.IGNORE) return hud.ignore;
  if (mode === systems.MILITARY_MODE.FLEE) return hud.flee;
  return '-';
}

/** One equipment slot's contents. Empty (`goodId` undefined, `usePct` null) for an unworn slot. */
export interface EquipSlotModel {
  /** The worn good's string id (the icon key) — undefined when the slot is empty. */
  readonly goodId?: string;
  /** The "degree of use" percent for an occupied wearing item (potion/shoes/tool); null when the slot
   *  is empty or holds a permanent good (weapon/armour/amulet). */
  readonly usePct: number | null;
}

/**
 * One labeled equipment row — the original's `Buty`/`Narzędzia`/`Broń`/`Zbroja`/`Ekwipunek` lines, each
 * a `humanwindow` label id (+ pinned fallback) and its slot(s). Single-slot rows (boots/tool/weapon/
 * armour) carry one; the misc `Ekwipunek` row carries {@link components.MISC_EQUIP_SLOTS}.
 */
export interface EquipRow {
  readonly titleId: number;
  readonly fallback: string;
  readonly slots: readonly EquipSlotModel[];
}

export interface SettlerPanelModel {
  readonly kind: 'settler';
  readonly entityId: number;
  /** The character's personal name — faction- and sex-appropriate, stable per entity. Drawn as the
   *  section headline in place of the generic "Ogólne" title. See {@link characterName}. */
  readonly name: string;
  /** The character's profession (its job label) — the name line under the headline. */
  readonly profession: string;
  /** Whether the "przydziel miejsce pracy" button is active — true for a settler with a real trade (an
   *  idle/jobless settler has no trade to place, so the button is greyed until a profession is chosen). */
  readonly canAssignWorkplace: boolean;
  /** Whether the "przypisz dom" button is active — any adult settler may be housed (the sim's
   *  `assignHouse` gates the rest); greyed for a growing child, whose family is housed via its parents. */
  readonly canAssignHome: boolean;
  /** Whether the "usuń z domu" button is active — an adult who currently has a home (a `Residence`), so
   *  its family can move out and free the slot; greyed otherwise (homeless, or a child moved by parents).
   *  The sim's `unassignHouse` gates the rest. */
  readonly canUnassignHome: boolean;
  /** Owner/tribe meta line under the name, with the military stance appended for a soldier. */
  readonly meta: string;
  /** A short live-state caption drawn in the portrait box — an honest stand-in for the original's
   *  animated "what it's doing" preview (the live settler bob render is a deferred follow-up). */
  readonly statusCaption: string;
  /** The Ogólne stat bars: Zdrowie (only for a unit with Health) then Głód/Sen/Towarzystwo/Religia,
   *  all as satisfaction levels — see {@link satisfactionBars}. */
  readonly bars: readonly PanelBar[];
  readonly work: SettlerWorkModel;
  /** The Doświadczenie section: every specialization the settler has trained, most-trained first.
   *  Empty when it has none. See {@link experienceRows}. */
  readonly experience: readonly ExperienceRowModel[];
  /** Progress toward the professions this settler's current work unlocks next — drawn dimmed under
   *  the trained rows; empty while progression is off. See {@link unlockProgressRows}. */
  readonly upcomingUnlocks: readonly UnlockProgressRowModel[];
  /** The Ekwipunek section as labeled rows, from the sim `Equipment` component. See {@link equipmentRows}. */
  readonly equipmentRows: readonly EquipRow[];
}

/** A cloned `Equipment` slot as it appears in the snapshot (`{ degreeOfUse, goodType }`) — or empty. */
type RawEquipSlot = { readonly goodType?: unknown; readonly degreeOfUse?: unknown } | null | undefined;

/** The `Equipment` component as the snapshot serializes it (slots + the misc array). */
interface RawEquipment {
  readonly boots?: RawEquipSlot;
  readonly tool?: RawEquipSlot;
  readonly weapon?: RawEquipSlot;
  readonly armor?: RawEquipSlot;
  readonly misc?: unknown;
}

/** One equipment slot → its panel model. Empty when unworn/unresolved; an occupied wearing good
 *  (potion/shoes/tool) carries its "degree of use" percent, a permanent good (weapon/armour/amulet,
 *  `equip.wears` false) none. */
function slotModel(ctx: UnitPanelModelContext, slot: RawEquipSlot): EquipSlotModel {
  if (slot == null) return { usePct: null };
  const goodType = num(slot.goodType);
  if (goodType === undefined) return { usePct: null };
  const def = goodDef(ctx, goodType);
  const wears = def?.equip?.wears ?? false;
  return {
    usePct: wears ? pct(num(slot.degreeOfUse)) : null,
    ...(def?.id !== undefined ? { goodId: def.id } : {}),
  };
}

/**
 * The settler's equipment as labeled rows: Buty then Narzędzia, then Broń + Zbroja for a soldier (a unit
 * with a combat `Weapon` component or an equipped weapon/armour slot), then the misc Ekwipunek row (its
 * {@link components.MISC_EQUIP_SLOTS} consumable slots). Reads the sim `Equipment` component; a settler
 * without one shows every base slot empty. The Broń/Zbroja rows are the original's soldier-only equip
 * slots (`tribetypes` `allowequip`) — surfaced here off the combat components the sim already stamps.
 */
export function equipmentRows(ctx: UnitPanelModelContext, comps: Comp): EquipRow[] {
  const slots = messages().hud.equipmentSlots;
  const eq = comps.Equipment as RawEquipment | undefined;
  const rows: EquipRow[] = [
    { titleId: HUMANWINDOW.boots, fallback: slots.boots, slots: [slotModel(ctx, eq?.boots)] },
    { titleId: HUMANWINDOW.tools, fallback: slots.tools, slots: [slotModel(ctx, eq?.tool)] },
  ];
  const soldier = 'Weapon' in comps || eq?.weapon != null || eq?.armor != null;
  if (soldier) {
    rows.push({ titleId: HUMANWINDOW.weapon, fallback: slots.weapon, slots: [slotModel(ctx, eq?.weapon)] });
    rows.push({ titleId: HUMANWINDOW.armor, fallback: slots.armor, slots: [slotModel(ctx, eq?.armor)] });
  }
  const misc = Array.isArray(eq?.misc) ? (eq.misc as RawEquipSlot[]) : [];
  const miscSlots: EquipSlotModel[] = [];
  for (let i = 0; i < components.MISC_EQUIP_SLOTS; i++) miscSlots.push(slotModel(ctx, misc[i] ?? null));
  rows.push({ titleId: HUMANWINDOW.misc, fallback: slots.misc, slots: miscSlots });
  return rows;
}

/** A need bar's model: its satisfaction level as the gauge percent, the same percent as the hover value. */
function needBar(label: string, deficit: number | undefined): PanelBar {
  const level = 100 - pct(deficit);
  return { label, pct: level, hover: `${level}%` };
}

/**
 * The Ogólne stat bars. The sim stores needs as rising deficits (`hunger`↑ = hungrier); the original's
 * window shows the satisfaction level (full = content), so each need bar is `100 − need`. Health leads
 * (only for a unit with a `Health` component, as `hitpoints/max` — its hover shows the raw points, the
 * need bars their percent). A cared-for BABY (an `Age` carrier in a baby stage) hides the four need bars
 * — its needs never accumulate (the NeedsSystem skips it whole), so only Health shows (combat can still
 * hurt it). The labels are pinned, deliberately diverging from the decoded `humanwindow`
 * 11–15 strings (Zdrowie/Energia/Wytrzymałość/Motywacja Społeczna/Religia): each bar is named after the
 * need it actually shows — Głód←hunger, Sen←fatigue, Towarzystwo←enjoyment — because the original's stat
 * names don't map 1:1 to the sim's four needs and read poorly (user decision 2026-07-11).
 */
export function satisfactionBars(comps: Comp): PanelBar[] {
  const hud = messages().hud;
  const s = (comps.Settler ?? {}) as Comp;
  const bars: PanelBar[] = [];
  const health = comps.Health as { hitpoints?: unknown; max?: unknown } | undefined;
  if (health !== undefined) {
    const hp = num(health.hitpoints) ?? 0;
    const max = num(health.max) ?? 0;
    bars.push({ label: hud.health, pct: pctRatio(hp, max), hover: `${hp}/${max}` });
  }
  if (comps.Age !== undefined && systems.isBaby(num(s.jobType) ?? null)) return bars;
  bars.push(needBar(hud.hunger, num(s.hunger)));
  bars.push(needBar(hud.sleep, num(s.fatigue)));
  bars.push(needBar(hud.company, num(s.enjoyment)));
  bars.push(needBar(hud.religion, num(s.piety)));
  return bars;
}

/** One Doświadczenie row: a specialization's label, its completed-work repeats (the player-facing
 *  experience number — "Drewno 5" means five units gathered), and its bonus percent — `null` for a
 *  specialization whose experience buys nothing (the carrier; design rule, user-specified). */
export interface ExperienceRowModel {
  readonly label: string;
  readonly repeats: number;
  readonly bonusPct: number | null;
}

/** The fight-XP buckets' i18n keys — `systems.FIGHT_EXPERIENCE_TYPE` id → `hud.weaponXp` label key. */
const WEAPON_XP_KEY: ReadonlyMap<number, keyof ReturnType<typeof messages>['hud']['weaponXp']> = new Map([
  [systems.FIGHT_EXPERIENCE_TYPE.FIST, 'fist'],
  [systems.FIGHT_EXPERIENCE_TYPE.SPEAR, 'spear'],
  [systems.FIGHT_EXPERIENCE_TYPE.SWORD, 'sword'],
  [systems.FIGHT_EXPERIENCE_TYPE.AXE, 'axe'],
  [systems.FIGHT_EXPERIENCE_TYPE.BOW, 'bow'],
  [systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, 'catapult'],
]);

/** A specialization row's label: a good-specific track by its hand-translated `hud.trackLabels` entry
 *  (keyed by the track's content id slug) falling back to "job - good"; a general track by its owning
 *  job ("Piekarz"); a track-less fight bucket by its weapon class ("Walka - Łuk"); the scout bucket by
 *  the scout job name. Shared with the unlock forecast (`settler-unlocks.ts`). */
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
  if (spec === systems.SCOUT_EXPERIENCE_TYPE) return jobDisplayName(ctx, systems.SCOUT_JOB);
  return formatMessage(messages().hud.specialization, { id: spec });
}

/**
 * A specialization row's shown percent — always the REAL effect of that experience, never a raw curve
 * read: a fight bucket shows its damage scale (`systems.fightDamageBonus`, deeper mastery + 50% cap);
 * the scout bucket shows its vision gain (`scoutVisionBonusNodes` over the scout's base radius); a
 * carrier track shows none (its XP is display-only, mirroring the sim's carrier exclusions); every
 * other work track shows the shared curve, which IS its output/speed effect.
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
  const trackJob = track !== undefined ? ctx.jobs.find((j) => j.typeId === track.jobType) : undefined;
  if (trackJob?.id === 'carrier') return null; // the sim's isCarrierJob rule, by the same content slug
  return Math.round(fx.toFloat(systems.experienceBonus(repeats)) * 100);
}

/**
 * The Doświadczenie rows: every specialization on the settler's `Settler.experience` map
 * (`humanjobexperiencetypes` id → raw points, serialized as a sorted `[id, points]` array), most-trained
 * first. Raw points are shown as completed-work REPEATS (`systems.experienceRepeats` divides the track's
 * accrual rate back out) so the number matches the user's mental model — "Zbieracz Drewna 5" = five wood
 * gathered; a track-less bucket (fight, scout) shows raw points. Labels via {@link experienceLabel},
 * percents via {@link experienceBonusPct}.
 */
export function experienceRows(ctx: UnitPanelModelContext, comps: Comp): ExperienceRowModel[] {
  const rows: (ExperienceRowModel & { spec: number })[] = [];
  for (const [spec, points] of settlerExperienceOf(comps)) {
    if (points <= 0) continue;
    const track = ctx.jobExperience.find((t) => t.typeId === spec);
    const repeats = track !== undefined ? systems.experienceRepeats(points, track) : points;
    if (repeats <= 0) continue; // partial credit toward the first repeat — nothing to show yet
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

export function settlerStatus(components: Comp): string {
  const statuses = messages().hud.statuses;
  // PlayerOrder is a bare en-route marker the sim retires the tick the unit reaches its commanded
  // destination, so a settler carrying it is always still walking there (no post-arrival dwell).
  if ('PlayerOrder' in components) return statuses.ordered;
  if ('CurrentAtomic' in components) return statuses.working;
  if ('PathFollow' in components || 'MoveGoal' in components) return statuses.walking;
  return statuses.idle;
}
