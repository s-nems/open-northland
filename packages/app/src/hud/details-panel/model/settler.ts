import { components, systems, type WorldSnapshot } from '@open-northland/sim';
import { entityById, num } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { type PanelBar, pct, pctRatio } from './bars.js';
import {
  buildingDef,
  buildingTitle,
  type Comp,
  goodDef,
  goodLabel,
  type UnitPanelModelContext,
} from './context.js';

/**
 * The pure settler half of the details-panel model: the Ogólne satisfaction bars, the Praca workplace/
 * product line, the Doświadczenie datum, the Ekwipunek rows, and the live status caption — all with no
 * Pixi/DOM in sight. The orchestrator in `index.ts` assembles a {@link SettlerPanelModel} from these.
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
  weapon: 60, // 'Broń'
  none: 61, // 'żadna' / 'żadne' — an empty slot
  armor: 63, // 'Zbroja'
  boots: 66, // 'Buty'
  tools: 69, // 'Narzędzia'
  misc: 72, // 'Ekwipunek'
  highestExp: 130, // 'Najwyższe Doświadczenie'
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
  /** Owner/tribe meta line under the name, with the military stance appended for a soldier. */
  readonly meta: string;
  /** A short live-state caption drawn in the portrait box — an honest stand-in for the original's
   *  animated "what it's doing" preview (the live settler bob render is a deferred follow-up). */
  readonly statusCaption: string;
  /** The Ogólne stat bars: Zdrowie (only for a unit with Health) then Głód/Sen/Towarzystwo/Religia,
   *  all as satisfaction levels — see {@link satisfactionBars}. */
  readonly bars: readonly PanelBar[];
  /** The Praca section: the workplace's name and the good it makes (or what the settler carries). */
  readonly work: { readonly place: string; readonly product: string };
  /** The Doświadczenie section: the settler's highest recorded specialization, or null when it has none
   *  (the sim awards no experience yet, so this is null in practice — the row then reads empty). */
  readonly experience: { readonly label: string; readonly points: number } | null;
  /**
   * The Ekwipunek section as labeled rows: Buty, Narzędzia, then Broń + Zbroja for a soldier (a unit
   * with a combat `Weapon` or an equipped weapon/armour slot), then the misc Ekwipunek row. Read from
   * the sim `Equipment` component; every slot empty for an unequipped settler. See {@link equipmentRows}.
   */
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
 * need bars their percent). The labels are pinned, deliberately diverging from the decoded `humanwindow`
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
  bars.push(needBar(hud.hunger, num(s.hunger)));
  bars.push(needBar(hud.sleep, num(s.fatigue)));
  bars.push(needBar(hud.company, num(s.enjoyment)));
  bars.push(needBar(hud.religion, num(s.piety)));
  return bars;
}

/**
 * The Praca section: the settler's workplace name and the good it makes. The workplace is the building
 * its `JobAssignment` points at; the product is that building's first recipe output (or `produces`
 * entry), falling back to what the settler is carrying. A settler with no `JobAssignment` reads
 * "brak miejsca pracy" — a pinned Polish fallback (the model returns the string directly; it matches
 * the original's `humanwindow` 41 wording but isn't resolved from the decoded table like the section
 * titles are).
 */
export function settlerWork(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  comps: Comp,
): { place: string; product: string } {
  const carry = comps.Carrying as { goodType?: unknown; amount?: unknown } | undefined;
  const carried =
    carry === undefined
      ? undefined
      : `${goodLabel(ctx, num(carry.goodType) ?? -1)} ×${num(carry.amount) ?? 0}`;
  const assignment = comps.JobAssignment as { workplace?: unknown } | undefined;
  const workplaceId = num(assignment?.workplace);
  if (workplaceId === undefined) return { place: messages().hud.noWorkplace, product: carried ?? '-' };
  const ent = entityById(snapshot, workplaceId);
  const rawType = num((ent?.components.Building as { buildingType?: unknown } | undefined)?.buildingType);
  const def = buildingDef(ctx, rawType);
  const outputs = def?.recipe?.outputs ?? def?.produces?.map((goodType) => ({ goodType, amount: 1 })) ?? [];
  const product = outputs[0] === undefined ? undefined : goodLabel(ctx, outputs[0].goodType);
  return { place: buildingTitle(ctx, rawType), product: product ?? carried ?? '-' };
}

/**
 * The Doświadczenie section's headline datum: the specialization the settler is most trained in, from its
 * `Settler.experience` map (`humanjobexperiencetypes` id → points, serialized as a sorted `[id, points]`
 * array). Null when the map is empty — which it always is today: the sim awards no experience yet, so the
 * row renders empty. (The per-specialization label/icon strip the original shows is a deferred follow-up;
 * the id→category-name map — `humanwindow` 131–140 — is not yet pinned to the sim's specialization ids.)
 */
export function highestExperience(comps: Comp): { label: string; points: number } | null {
  const exp = (comps.Settler as Comp | undefined)?.experience;
  if (!Array.isArray(exp) || exp.length === 0) return null;
  let best: { spec: number; points: number } | null = null;
  for (const pair of exp) {
    if (!Array.isArray(pair)) continue;
    const spec = num(pair[0]);
    const points = num(pair[1]);
    if (spec === undefined || points === undefined) continue;
    if (best === null || points > best.points) best = { spec, points };
  }
  return best === null
    ? null
    : { label: formatMessage(messages().hud.specialization, { id: best.spec }), points: best.points };
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
