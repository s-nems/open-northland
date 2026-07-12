import type { ContentSet } from '@vinland/data';
import { components, ONE, systems, TICKS_PER_SECOND, type WorldSnapshot } from '@vinland/sim';
import { localizedBuildingName } from '../../catalog/building-i18n.js';
import { vikingBuildingByTypeId } from '../../catalog/buildings.js';
import { professionDefForJob } from '../../catalog/professions.js';
import { DEFAULT_UI_LANG } from '../../content/gui-gfx.js';
import { characterName } from '../../game/character-names.js';
import { PRIMARY_TRIBE } from '../../game/rules.js';
import { entityById, isBuilding, isSettler, num, ownerPlayerOf } from '../../game/snapshot.js';
import { professionLabel } from '../../i18n/index.js';
import { goodCategoryTab } from './stock-tabs.js';

/**
 * The PURE selection→panel-model half of the details panel: what the bottom-right panel shows for the
 * current selection, with no Pixi/DOM in sight (the headless tests exercise exactly this seam). The
 * rendering half lives in `sections.ts`/`panel.ts`.
 *
 * Label language note: the sim has no matching original string for its own states (stance names, status
 * lines, need names), so those carry pinned Polish fallbacks here; everything the original DOES provide
 * (section titles, button labels) is looked up from the decoded string tables at render time.
 */

/**
 * The `humanwindow` string ids the settler panel resolves at draw time — the DECODED original section
 * titles and equipment-slot labels (`content/gui/strings/<lang>.json`, decoded from the original
 * `ingamegui` tables). Fidelity: everything the original DOES provide is looked up; the pinned Polish
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
const STANCES: ReadonlyArray<{ mode: number; label: string }> = [
  { mode: systems.MILITARY_MODE.ATTACK, label: 'Atak' },
  { mode: systems.MILITARY_MODE.DEFEND, label: 'Obrona' },
  { mode: systems.MILITARY_MODE.IGNORE, label: 'Ignoruj' },
  { mode: systems.MILITARY_MODE.FLEE, label: 'Ucieczka' },
];

function stanceLabel(mode: number | undefined): string {
  return STANCES.find((s) => s.mode === mode)?.label ?? '-';
}

type BuildingDef = ContentSet['buildings'][number];
type GoodDef = ContentSet['goods'][number];
type JobDef = ContentSet['jobs'][number];

export interface UnitPanelModelContext {
  readonly buildings: readonly BuildingDef[];
  readonly goods: readonly GoodDef[];
  /** The content jobs — the worker-row labels resolve a bound settler's job name from here (a building's
   *  worker vs carrier slots), so the panel names them even when they're not in the profession catalog. */
  readonly jobs: readonly JobDef[];
}

interface Comp {
  readonly [k: string]: unknown;
}

/**
 * One stat bar in the Ogólne section: a pinned label + a 0..100 LEVEL + the hover value text. The bars
 * show the original's SATISFACTION (full = content, like the original's coloured bars), not the sim's
 * rising deficit — see {@link satisfactionBars}.
 */
export interface PanelBar {
  readonly label: string;
  readonly pct: number;
  /** The cursor-tooltip value for the hovered bar row: raw points for health ("300/1000"),
   *  the satisfaction percent for a need ("75%"). */
  readonly hover: string;
}

/** A bar gauge's colour band: full/high draws green, a draining stat turns orange, a nearly-empty one red. */
export type BarTone = 'ok' | 'warn' | 'critical';
/** Below this satisfaction/health percent a FALLBACK bar turns orange. The banded colours are only the
 *  no-`content/` fallback — with decoded art the gauge colour comes from the original's continuous
 *  `bar_hitpoints`/`bar_standart` level ramps; these band thresholds are our own choice. */
const BAR_WARN_BELOW_PCT = 50;
/** Below this percent a fallback bar turns red. */
const BAR_CRITICAL_BELOW_PCT = 25;

/** The green/orange/red band a 0..100 bar level falls into — the no-`content/` fallback colouring
 *  (`chrome.ts` `BAR_TONE_FILL`; with content the decoded `GuiBarRamp` colours the gauge instead). */
export function barTone(pct: number): BarTone {
  if (pct < BAR_CRITICAL_BELOW_PCT) return 'critical';
  if (pct < BAR_WARN_BELOW_PCT) return 'warn';
  return 'ok';
}

export interface StockRow {
  readonly goodType: number;
  /** The good's STRING id (stable across content sets) — the key the HUD resolves its icon by. */
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
  /** The good's declared store ceiling (its `stock` slot capacity) — the row then reads "7.0 / 25.0".
   *  Undefined for a good the building holds without a declared slot (a dynamic drop): amount only. */
  readonly capacity?: number;
  /** The stock-window category tab (0–7) this good belongs to — see `stock-tabs.ts`. */
  readonly category: number;
}

/** One worker SLOT of a building, as a filled/capacity line — e.g. "Cieśla 1/3", "Tragarz 1/1",
 *  "Zbieracz 0/1". One per declared `workers` slot, so each trade shows its own limit, not one aggregate. */
export interface WorkerSlotRow {
  readonly jobType: number;
  readonly label: string;
  /** Settlers currently bound to this building for this job. */
  readonly filled: number;
  /** The slot's `count` — how many of this job the building employs. */
  readonly capacity: number;
}

/**
 * The Produkcja section's content, one of two shapes:
 *  - `recipe` — a workshop's abstract cycle (its outputs + the running cycle's progress bar);
 *  - `fields` — a FARM's live field state (the produced good's icon + the sown/growing/ripe counters),
 *    for a workplace producing a field-farmed good (`farming` on the good, no recipe): there is no
 *    recipe to show, the "production" IS the fields its farmers work around the building.
 */
export type ProductionModel =
  | {
      readonly kind: 'recipe';
      /** The FIRST output's STRING id — the row's icon key (like {@link StockRow.goodId}). */
      readonly goodId?: string;
      readonly label: string;
      /**
       * One 0..100 progress per IN-FLIGHT batch (the sim `Production.cycles` list — each operator
       * works its own independent batch, so a twin-staffed mill shows two bars). Empty when the
       * workplace is idle.
       */
      readonly pcts: readonly number[];
      /**
       * The bar rows the section RESERVES — `max(1, operator headcount, pcts.length)`, so the panel
       * geometry is stable while batches start/finish staggered (a mill always shows two bar rows,
       * empty or not), instead of growing/shrinking a row mid-work. The single source both the
       * layout's height math and the section's bar loop consume — they can never drift apart.
       */
      readonly rows: number;
    }
  | {
      readonly kind: 'fields';
      /** The farmed good's STRING id — the icon key (like {@link StockRow.goodId}). */
      readonly goodId?: string;
      /** The farmed good's display name. */
      readonly label: string;
      /** All standing fields of this farm (growing + ripe). */
      readonly sown: number;
      /** Fields still growing (below their top stage). */
      readonly growing: number;
      /** Ripe fields awaiting the scythe. */
      readonly ripe: number;
    };

export interface BuildingPanelModel {
  readonly kind: 'building';
  readonly entityId: number;
  readonly typeId: number;
  readonly title: string;
  readonly category: string;
  readonly owner: string;
  readonly tribe: string;
  readonly level: number;
  readonly builtPct: number;
  readonly stock: readonly StockRow[];
  /** One row per worker slot (trade), each with its filled/capacity — the per-trade limits the panel
   *  lists ("Cieśla 1/3 · Tragarz 1/1 · Zbieracz 0/1"). Empty for a building that employs nobody. */
  readonly workerSlots: readonly WorkerSlotRow[];
  readonly showDefense: boolean;
  /** Approximation until a real building-defense mode component exists. */
  readonly defenseLabel: string;
  readonly production: ProductionModel | null;
}

/** One equipment slot's contents. Empty (`goodId` undefined, `usePct` null) for an unworn slot. */
export interface EquipSlotModel {
  /** The worn good's STRING id (the icon key) — undefined when the slot is empty. */
  readonly goodId?: string;
  /** The "degree of use" percent for an occupied WEARING item (potion/shoes/tool); null when the slot
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

export interface MultiSettlerPanelModel {
  readonly kind: 'multi-settler';
  readonly count: number;
}

export interface GenericSelectionPanelModel {
  readonly kind: 'generic';
  readonly count: number;
}

export interface EmptyPanelModel {
  readonly kind: 'empty';
}

export type UnitPanelModel =
  | EmptyPanelModel
  | BuildingPanelModel
  | SettlerPanelModel
  | MultiSettlerPanelModel
  | GenericSelectionPanelModel;

function pct(fixed: number | undefined): number {
  return fixed === undefined ? 0 : Math.max(0, Math.min(100, Math.round((fixed / ONE) * 100)));
}

function pctRatio(elapsed: number | undefined, duration: number | undefined): number {
  if (elapsed === undefined || duration === undefined || duration <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((elapsed / duration) * 100)));
}

/**
 * A settler's profession name for the panel — resolved through the shared profession catalog + i18n
 * (`catalog/professions.ts` + `i18n/`), so a settler's label always matches the picker's. Any soldier-band
 * job reads "Żołnierz"; idle/unknown falls back to the localized "Bezrobotny".
 */
function jobLabel(jobType: number | undefined): string {
  const def = professionDefForJob(jobType);
  if (def !== undefined) return professionLabel(def.key);
  return professionLabel('idle');
}

function buildingDef(ctx: UnitPanelModelContext, typeId: number | undefined): BuildingDef | undefined {
  if (typeId === undefined) return undefined;
  return ctx.buildings.find((b) => b.typeId === typeId);
}

function buildingTitle(ctx: UnitPanelModelContext, typeId: number | undefined): string {
  if (typeId === undefined) return 'Budynek';
  const catalog = vikingBuildingByTypeId(typeId);
  // The panel title reads the SAME localized name the build menu shows (catalog/building-i18n.ts —
  // "Farma", "Chata"), falling back to the English catalog label for a building not yet localized.
  if (catalog !== undefined) return localizedBuildingName(catalog.id, catalog.label, DEFAULT_UI_LANG);
  return buildingDef(ctx, typeId)?.id ?? `typ ${typeId}`;
}

function goodDef(ctx: UnitPanelModelContext, goodType: number): GoodDef | undefined {
  return ctx.goods.find((g) => g.typeId === goodType);
}

/** A good's display name: its localized content `name` (the pipeline's per-locale good-name table,
 *  loaded by the browser entries — "Mąka"), falling back to the machine id on a bare checkout. */
function goodLabel(ctx: UnitPanelModelContext, goodType: number): string {
  const def = goodDef(ctx, goodType);
  return def?.name ?? def?.id ?? `dobro ${goodType}`;
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
function equipmentRows(ctx: UnitPanelModelContext, comps: Comp): EquipRow[] {
  const eq = comps.Equipment as RawEquipment | undefined;
  const rows: EquipRow[] = [
    { titleId: HUMANWINDOW.boots, fallback: 'Buty', slots: [slotModel(ctx, eq?.boots)] },
    { titleId: HUMANWINDOW.tools, fallback: 'Narzędzia', slots: [slotModel(ctx, eq?.tool)] },
  ];
  const soldier = 'Weapon' in comps || eq?.weapon != null || eq?.armor != null;
  if (soldier) {
    rows.push({ titleId: HUMANWINDOW.weapon, fallback: 'Broń', slots: [slotModel(ctx, eq?.weapon)] });
    rows.push({ titleId: HUMANWINDOW.armor, fallback: 'Zbroja', slots: [slotModel(ctx, eq?.armor)] });
  }
  const misc = Array.isArray(eq?.misc) ? (eq.misc as RawEquipSlot[]) : [];
  const miscSlots: EquipSlotModel[] = [];
  for (let i = 0; i < components.MISC_EQUIP_SLOTS; i++) miscSlots.push(slotModel(ctx, misc[i] ?? null));
  rows.push({ titleId: HUMANWINDOW.misc, fallback: 'Ekwipunek', slots: miscSlots });
  return rows;
}

/** A need bar's model: its satisfaction LEVEL as the gauge percent, the same percent as the hover value. */
function needBar(label: string, deficit: number | undefined): PanelBar {
  const level = 100 - pct(deficit);
  return { label, pct: level, hover: `${level}%` };
}

/**
 * The Ogólne stat bars. The sim stores needs as rising DEFICITS (`hunger`↑ = hungrier); the original's
 * window shows the SATISFACTION LEVEL (full = content), so each need bar is `100 − need`. Health leads
 * (only for a unit with a `Health` component, as `hitpoints/max` — its hover shows the raw points, the
 * need bars their percent). The labels are PINNED, deliberately diverging from the decoded `humanwindow`
 * 11–15 strings (Zdrowie/Energia/Wytrzymałość/Motywacja Społeczna/Religia): each bar is named after the
 * NEED it actually shows — Głód←hunger, Sen←fatigue, Towarzystwo←enjoyment — because the original's stat
 * names don't map 1:1 to the sim's four needs and read poorly (user decision 2026-07-11).
 */
function satisfactionBars(comps: Comp): PanelBar[] {
  const s = (comps.Settler ?? {}) as Comp;
  const bars: PanelBar[] = [];
  const health = comps.Health as { hitpoints?: unknown; max?: unknown } | undefined;
  if (health !== undefined) {
    const hp = num(health.hitpoints) ?? 0;
    const max = num(health.max) ?? 0;
    const level = max > 0 ? Math.max(0, Math.min(100, Math.round((hp / max) * 100))) : 0;
    bars.push({ label: 'Zdrowie', pct: level, hover: `${hp}/${max}` });
  }
  bars.push(needBar('Głód', num(s.hunger)));
  bars.push(needBar('Sen', num(s.fatigue)));
  bars.push(needBar('Towarzystwo', num(s.enjoyment)));
  bars.push(needBar('Religia', num(s.piety)));
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
function settlerWork(
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
  if (workplaceId === undefined) return { place: 'brak miejsca pracy', product: carried ?? '-' };
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
function highestExperience(comps: Comp): { label: string; points: number } | null {
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
  return best === null ? null : { label: `spec. ${best.spec}`, points: best.points };
}

/** The current holdings of a building's {@link Stockpile}, as a goodType→amount map. */
function liveAmounts(stockpile: unknown): Map<number, number> {
  const live = new Map<number, number>();
  const amounts = (stockpile as { amounts?: unknown } | undefined)?.amounts;
  if (!Array.isArray(amounts)) return live;
  for (const pair of amounts) {
    if (!Array.isArray(pair)) continue;
    const goodType = num(pair[0]);
    const amount = num(pair[1]);
    if (goodType !== undefined && amount !== undefined) live.set(goodType, amount);
  }
  return live;
}

/**
 * The Magazyn rows: every good the building can STORE (its `def.stock` slots), shown with its current
 * amount — 0 when empty — so each storable good appears with its own icon, matching the original stock
 * window (which lists a store's accepted goods, not only what it currently holds). A good held but not in
 * the declared slots (defensive — dynamic drops) is appended.
 *
 * Ordering: the DECLARED slot order, stable while amounts change — a compact store's rows (the mill's
 * Pszenica/Mąka) must never swap places mid-work (user feedback 2026-07-11). Only the big tabbed store
 * bubbles its held goods up, and it does so at draw time (`sections.ts`), where the fixed row cap
 * (`MAX_STOCK_ROWS × 2` with a `+N`) makes visibility worth the reshuffle.
 *
 * Each row carries its `category` (the stock tab it belongs to, via {@link goodCategoryTab}); the render
 * filters the list to the active tab. The good→category mapping is a named approximation (not in the
 * extracted data — see `stock-tabs.ts`), so the tab assignment is provisional, not source-pinned.
 */
function stockRows(ctx: UnitPanelModelContext, def: BuildingDef | undefined, stockpile: unknown): StockRow[] {
  const live = liveAmounts(stockpile);
  const order: number[] = [];
  const seen = new Set<number>();
  const push = (goodType: number): void => {
    if (seen.has(goodType)) return;
    seen.add(goodType);
    order.push(goodType);
  };
  // Declared slot → its capacity, so each row can read "amount / capacity" (a dynamic drop has none).
  const capacities = new Map<number, number>();
  for (const slot of def?.stock ?? []) {
    push(slot.goodType);
    capacities.set(slot.goodType, slot.capacity);
  }
  for (const goodType of live.keys()) push(goodType);

  return order.map((goodType) => {
    const goodId = goodDef(ctx, goodType)?.id;
    const capacity = capacities.get(goodType);
    return {
      goodType,
      // The stock row's display name (localized content name, else the id) — shown by the hover tooltip;
      // the row itself draws only the icon + amount, so a nicer name here doesn't change the drawn row.
      label: goodLabel(ctx, goodType),
      amount: live.get(goodType) ?? 0,
      category: goodCategoryTab(goodId),
      ...(goodId !== undefined ? { goodId } : {}),
      ...(capacity !== undefined ? { capacity } : {}),
    };
  });
}

/**
 * A job's display name — shared by a building's worker-slot rows AND a settler's own profession title, so
 * the two never drift. The shared profession catalog + i18n names a known job (a gatherer → "Zbieracz
 * drewna", carrier → "Tragarz"); a trade the catalog doesn't carry (a rebased building slot like
 * "Cieśla"/"Druid" — a bound settler's `jobType` is that same rebased id) falls back to its content job
 * name, then to the localized idle label. `undefined` (an unbound settler) resolves to the idle label.
 */
function jobDisplayName(ctx: UnitPanelModelContext, jobType: number | undefined): string {
  if (jobType === undefined) return jobLabel(undefined);
  return professionDefForJob(jobType) !== undefined
    ? jobLabel(jobType)
    : (ctx.jobs.find((j) => j.typeId === jobType)?.name ?? jobLabel(jobType));
}

/** How many settlers are currently BOUND to `buildingId`, per job — the per-slot "filled" count. */
function boundCountsByJob(snapshot: WorldSnapshot, buildingId: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
    if (num(assignment?.workplace) !== buildingId) continue;
    const jobType = num((e.components.Settler as Comp | undefined)?.jobType);
    if (jobType === undefined) continue;
    counts.set(jobType, (counts.get(jobType) ?? 0) + 1);
  }
  return counts;
}

/**
 * The per-trade worker rows: one per declared `workers` slot (in declared order), each with its
 * filled/capacity — so the panel lists "Cieśla 1/3 · Tragarz 1/1 · Zbieracz 0/1" instead of one aggregate
 * "Pracownicy 4/5". A building that employs nobody (a home) yields no rows.
 */
function workerSlotsFor(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  buildingId: number,
): WorkerSlotRow[] {
  const counts = boundCountsByJob(snapshot, buildingId);
  return (def?.workers ?? []).map((slot) => ({
    jobType: slot.jobType,
    label: jobDisplayName(ctx, slot.jobType),
    filled: counts.get(slot.jobType) ?? 0,
    capacity: slot.count,
  }));
}

/** Count a FARM's fields in the snapshot: every `Crop` whose `farm` is this building, split into still
 *  growing vs ripe (`stage >= stages`). One entity pass, shared shape with the other snapshot scans. */
function fieldCounts(snapshot: WorldSnapshot, buildingId: number): { growing: number; ripe: number } {
  let growing = 0;
  let ripe = 0;
  for (const e of snapshot.entities) {
    const crop = e.components.Crop as { farm?: unknown; stage?: unknown; stages?: unknown } | undefined;
    if (crop === undefined || num(crop.farm) !== buildingId) continue;
    const stage = num(crop.stage) ?? 0;
    const stages = num(crop.stages) ?? Number.POSITIVE_INFINITY;
    if (stage >= stages) ripe++;
    else growing++;
  }
  return { growing, ripe };
}

function productionModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  ent: NonNullable<ReturnType<typeof entityById>>,
): ProductionModel | null {
  // A FARM produces a field-farmed good — checked BEFORE the recipe, mirroring the sim: farmWorkGood
  // ignores recipe presence and ai.ts ranks the farmer rung above the producer rung precisely because
  // real extracted content synthesizes an abstract recipe from `logicproduction` for every producer.
  // Wherever the sim farms, the panel must show live field state, never a dead recipe bar.
  const recipe = def?.recipe;
  const fieldGood = (def?.produces ?? []).map((g) => goodDef(ctx, g)).find((g) => g?.farming !== undefined);
  if (fieldGood !== undefined) {
    const { growing, ripe } = fieldCounts(snapshot, ent.id);
    return {
      kind: 'fields',
      label: fieldGood.name ?? fieldGood.id,
      sown: growing + ripe,
      growing,
      ripe,
      ...(fieldGood.id !== undefined ? { goodId: fieldGood.id } : {}),
    };
  }
  const production = ent.components.Production as { cycles?: unknown } | undefined;
  const outputs = recipe?.outputs ?? def?.produces?.map((goodType) => ({ goodType, amount: 1 })) ?? [];
  if (production === undefined && recipe === undefined && outputs.length === 0) return null;
  const out = outputs.map((o) => `${goodLabel(ctx, o.goodType)} x${o.amount}`).join(', ');
  const firstOutId = outputs[0] === undefined ? undefined : goodDef(ctx, outputs[0].goodType)?.id;
  // One progress per in-flight batch (each operator grinds its own — the panel bars one per cycle).
  const rawCycles = Array.isArray(production?.cycles) ? production.cycles : [];
  const pcts = rawCycles.map((c) => {
    const cycle = c as { elapsed?: unknown; duration?: unknown } | null;
    return pctRatio(num(cycle?.elapsed), num(cycle?.duration));
  });
  return {
    kind: 'recipe',
    label: out.length > 0 ? out : 'gotowe do pracy',
    pcts,
    rows: Math.max(1, operatorHeadcount(ctx, def), pcts.length),
    ...(firstOutId !== undefined ? { goodId: firstOutId } : {}),
  };
}

/**
 * The declared OPERATOR headcount of a workplace — its `workers` slot counts minus the carrier
 * transport slots (mirrors the sim's `operatorJobsOf`: a carrier-ONLY building keeps its slots, the
 * well's carrier IS its operator). This is the batch ceiling, so the Produkcja section reserves this
 * many bar rows and keeps a stable height while batches start/finish staggered.
 */
function operatorHeadcount(ctx: UnitPanelModelContext, def: BuildingDef | undefined): number {
  const slots = def?.workers ?? [];
  const operators = slots.filter((s) => ctx.jobs.find((j) => j.typeId === s.jobType)?.id !== 'carrier');
  const counted = operators.length > 0 ? operators : slots;
  return counted.reduce((sum, s) => sum + s.count, 0);
}

function settlerStatus(components: Comp, tick: number): string {
  const order = components.PlayerOrder as { expiresAt?: unknown } | undefined;
  const moving = 'PathFollow' in components || 'MoveGoal' in components;
  if (order !== undefined) {
    if (moving) return 'idzie na rozkaz';
    const expires = num(order.expiresAt);
    return expires === undefined
      ? 'na pozycji'
      : `stoi (${Math.max(0, Math.ceil((expires - tick) / TICKS_PER_SECOND))}s)`;
  }
  if ('CurrentAtomic' in components) return 'pracuje';
  if (moving) return 'idzie';
  return 'bezczynny';
}

/** The catalog id of the one storage building that also mounts a defence (the HQ's defence section). */
const HEADQUARTERS_ID = 'headquarters';

export function buildUnitPanelModel(
  snapshot: WorldSnapshot,
  selected: ReadonlySet<number>,
  ctx: UnitPanelModelContext,
): UnitPanelModel {
  if (selected.size === 0) return { kind: 'empty' };

  // ONE entity pass classifies the whole selection (never O(selected × entities) — a marquee can hold
  // hundreds of ids). Ascending-id sort keeps the single-pick branches' winner deterministic.
  const settlerIds: number[] = [];
  const buildingIds: number[] = [];
  for (const e of snapshot.entities) {
    if (!selected.has(e.id)) continue;
    if (isSettler(e)) settlerIds.push(e.id);
    else if (isBuilding(e)) buildingIds.push(e.id);
  }
  settlerIds.sort((a, b) => a - b);
  buildingIds.sort((a, b) => a - b);

  if (settlerIds.length === 0 && buildingIds.length === 1) {
    const entityId = buildingIds[0] as number;
    const ent = entityById(snapshot, entityId);
    if (ent === undefined) return { kind: 'empty' };
    const b = (ent.components.Building ?? {}) as Comp;
    const rawType = num(b.buildingType);
    const typeId = rawType ?? -1;
    const def = buildingDef(ctx, rawType);
    const catalog = rawType === undefined ? undefined : vikingBuildingByTypeId(rawType);
    const category = def?.kind ?? catalog?.kind ?? 'unknown';
    return {
      kind: 'building',
      entityId,
      typeId,
      title: buildingTitle(ctx, rawType),
      category,
      owner: `#${ownerPlayerOf(ent) ?? '-'}`,
      tribe: `${num(b.tribe) ?? '-'}`,
      level: num(b.level) ?? 0,
      builtPct: pct(num(b.built)),
      stock: stockRows(ctx, def, ent.components.Stockpile),
      workerSlots: workerSlotsFor(ctx, snapshot, def, entityId),
      showDefense: catalog?.id === HEADQUARTERS_ID || category === 'tower',
      // Pinned approximation until a defence-mode component exists; the original state/toggle strings
      // live at `housewindow` 140–143 ("Rozpocznij/Zatrzymaj Tryb Obrony", "Obrona rozpoczęta/zakończona.").
      defenseLabel: 'Obrona zatrzymana',
      production: productionModel(ctx, snapshot, def, ent),
    };
  }

  if (settlerIds.length === 1) {
    const entityId = settlerIds[0] as number;
    const ent = entityById(snapshot, entityId);
    if (ent === undefined) return { kind: 'empty' };
    const comps = ent.components as Comp;
    const s = (ent.components.Settler ?? {}) as Comp;
    const stance = ent.components.Stance as { mode?: unknown } | undefined;
    // Meta line: owner + tribe, with the military stance appended only for a unit that has one (a soldier).
    const stanceMode = num(stance?.mode);
    const stanceSuffix = stanceMode !== undefined ? ` · ${stanceLabel(stanceMode)}` : '';
    const meta = `Gracz #${ownerPlayerOf(ent) ?? '-'} · Plemię ${num(s.tribe) ?? '-'}${stanceSuffix}`;
    // Only a born-young (baby/child) settler carries `Age`; that flag, with the job, fixes the drawn body's
    // sex so the name matches the character (mirrors the render body-join in `content/settler-gfx.ts`).
    const young = comps.Age !== undefined;
    return {
      kind: 'settler',
      entityId,
      name: characterName(num(s.tribe) ?? PRIMARY_TRIBE, num(s.jobType), young, entityId),
      // The profession name resolves through the shared catalog + i18n (and, for a building-bound settler,
      // its rebased slot job's content name) so a bound druid reads "Druid", not "Bezrobotny".
      profession: jobDisplayName(ctx, num(s.jobType)),
      meta,
      statusCaption: settlerStatus(comps, snapshot.tick),
      bars: satisfactionBars(comps),
      work: settlerWork(ctx, snapshot, comps),
      experience: highestExperience(comps),
      equipmentRows: equipmentRows(ctx, comps),
    };
  }

  if (settlerIds.length > 1) return { kind: 'multi-settler', count: settlerIds.length };
  return { kind: 'generic', count: selected.size };
}
