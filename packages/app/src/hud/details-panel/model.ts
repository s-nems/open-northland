import type { ContentSet } from '@vinland/data';
import { ONE, TICKS_PER_SECOND, type WorldSnapshot, systems } from '@vinland/sim';
import { vikingBuildingByTypeId } from '../../catalog/buildings.js';
import { professionDefForJob } from '../../catalog/professions.js';
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

/**
 * The needs drawn as bars. Labels are pinned fallbacks: the original human window's stat set
 * (`humanwindow` 11–15: Zdrowie/Energia/Wytrzymałość/Motywacja Społeczna/Religia) differs from the
 * sim's four needs, so there is no 1:1 extracted label to reuse yet.
 */
const NEEDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'hunger', label: 'Głód' },
  { key: 'fatigue', label: 'Zmęczenie' },
  { key: 'piety', label: 'Pobożność' },
  { key: 'enjoyment', label: 'Radość' },
];

interface Comp {
  readonly [k: string]: unknown;
}

export interface PanelNeed {
  readonly key: string;
  readonly label: string;
  readonly pct: number;
}

export interface StockRow {
  readonly goodType: number;
  /** The good's STRING id (stable across content sets) — the key the HUD resolves its icon by. */
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
  /** The stock-window category tab (0–7) this good belongs to — see `stock-tabs.ts`. */
  readonly category: number;
}

export interface WorkerRow {
  readonly id: number;
  readonly label: string;
  readonly active: boolean;
}

export interface ProductionModel {
  readonly label: string;
  readonly pct: number;
}

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
  readonly workers: readonly WorkerRow[];
  /** Total worker+carrier slots this building type employs (sum of its `workers` slot counts) — how many
   *  settlers can be assigned here, shown against the filled count. 0 for a building that employs nobody. */
  readonly capacity: number;
  readonly showDefense: boolean;
  /** Approximation until a real building-defense mode component exists. */
  readonly defenseLabel: string;
  readonly production: ProductionModel | null;
}

export interface SettlerPanelModel {
  readonly kind: 'settler';
  readonly entityId: number;
  readonly title: string;
  readonly owner: string;
  readonly tribe: string;
  readonly needs: readonly PanelNeed[];
  readonly carry: string;
  readonly stance: string;
  readonly status: string;
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
  return vikingBuildingByTypeId(typeId)?.label ?? buildingDef(ctx, typeId)?.id ?? `typ ${typeId}`;
}

function goodDef(ctx: UnitPanelModelContext, goodType: number): GoodDef | undefined {
  return ctx.goods.find((g) => g.typeId === goodType);
}

function goodLabel(ctx: UnitPanelModelContext, goodType: number): string {
  return goodDef(ctx, goodType)?.id ?? `dobro ${goodType}`;
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
 * Ordering: held goods (amount > 0) first, then the declared slot order — so a big store's actual stock
 * stays visible above the panel's fixed row cap (the render caps to `MAX_STOCK_ROWS × 2` with a `+N`).
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
  for (const slot of def?.stock ?? []) push(slot.goodType);
  for (const goodType of live.keys()) push(goodType);

  const rows = order.map((goodType, index) => {
    const goodId = goodDef(ctx, goodType)?.id;
    return {
      goodType,
      label: goodLabel(ctx, goodType),
      amount: live.get(goodType) ?? 0,
      category: goodCategoryTab(goodId),
      index,
      ...(goodId !== undefined ? { goodId } : {}),
    };
  });
  rows.sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0) || a.index - b.index);
  return rows.map(({ index: _index, ...row }) => row);
}

function workersFor(ctx: UnitPanelModelContext, snapshot: WorldSnapshot, buildingId: number): WorkerRow[] {
  const rows: WorkerRow[] = [];
  for (const e of snapshot.entities) {
    if (!isSettler(e)) continue;
    const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
    if (num(assignment?.workplace) !== buildingId) continue;
    const settler = (e.components.Settler ?? {}) as Comp;
    const atomic = e.components.CurrentAtomic as { targetEntity?: unknown } | undefined;
    const jobType = num(settler.jobType);
    // The shared profession catalog + i18n names a known job (a gatherer → "Zbieracz drewna", carrier →
    // "Tragarz"); a worker-slot job the catalog doesn't carry (a backfilled generic worker) falls back to
    // its content job name ("Pracownik"), then to the localized idle label.
    const label =
      professionDefForJob(jobType) !== undefined
        ? jobLabel(jobType)
        : (ctx.jobs.find((j) => j.typeId === jobType)?.name ?? jobLabel(jobType));
    rows.push({
      id: e.id,
      label,
      active: num(atomic?.targetEntity) === buildingId,
    });
  }
  return rows;
}

function productionModel(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  ent: NonNullable<ReturnType<typeof entityById>>,
): ProductionModel | null {
  const production = ent.components.Production as { elapsed?: unknown; duration?: unknown } | undefined;
  const recipe = def?.recipe;
  const outputs = recipe?.outputs ?? def?.produces?.map((goodType) => ({ goodType, amount: 1 })) ?? [];
  if (production === undefined && recipe === undefined && outputs.length === 0) return null;
  const out = outputs.map((o) => `${goodLabel(ctx, o.goodType)} x${o.amount}`).join(', ');
  return {
    label: out.length > 0 ? out : 'gotowe do pracy',
    pct: pctRatio(num(production?.elapsed), num(production?.duration)),
  };
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
      workers: workersFor(ctx, snapshot, entityId),
      capacity: def?.workers?.reduce((sum, w) => sum + w.count, 0) ?? 0,
      showDefense: catalog?.id === HEADQUARTERS_ID || category === 'tower',
      // Pinned approximation until a defence-mode component exists; the original state/toggle strings
      // live at `housewindow` 140–143 ("Rozpocznij/Zatrzymaj Tryb Obrony", "Obrona rozpoczęta/zakończona.").
      defenseLabel: 'Obrona zatrzymana',
      production: productionModel(ctx, def, ent),
    };
  }

  if (settlerIds.length === 1) {
    const entityId = settlerIds[0] as number;
    const ent = entityById(snapshot, entityId);
    if (ent === undefined) return { kind: 'empty' };
    const s = (ent.components.Settler ?? {}) as Comp;
    const carry = ent.components.Carrying as { goodType?: unknown; amount?: unknown } | undefined;
    const stance = ent.components.Stance as { mode?: unknown } | undefined;
    return {
      kind: 'settler',
      entityId,
      title: jobLabel(num(s.jobType)),
      owner: `#${ownerPlayerOf(ent) ?? '-'}`,
      tribe: `${num(s.tribe) ?? '-'}`,
      needs: NEEDS.map((n) => ({ key: n.key, label: n.label, pct: pct(num(s[n.key])) })),
      carry:
        carry === undefined ? '-' : `${goodLabel(ctx, num(carry.goodType) ?? -1)} x${num(carry.amount) ?? 0}`,
      stance: stanceLabel(num(stance?.mode)),
      status: settlerStatus(ent.components as Comp, snapshot.tick),
    };
  }

  if (settlerIds.length > 1) return { kind: 'multi-settler', count: settlerIds.length };
  return { kind: 'generic', count: selected.size };
}
