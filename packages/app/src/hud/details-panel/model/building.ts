import {
  countedBy,
  homeQualityView,
  householdGoodPolicyView,
  indexesOf,
  type WorldSnapshot,
} from '@open-northland/sim';
import { JOB_BUILDER, JOB_TRADER } from '../../../catalog/jobs.js';
import { workerRoleOf } from '../../../game/sandbox/index.js';
import {
  buildingTribeOf,
  buildingTypeOf,
  healthOf,
  homeFamiliesOf,
  isBuilding,
  num,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
  shelterClaimCount,
  staffOf,
} from '../../../game/snapshot.js';
import { entitiesUnder, idsGroupedBy } from '../../../game/snapshot-id-index.js';
import { pickableSeat } from '../../../game/viewer-seat.js';
import { messages, tribeName } from '../../../i18n/index.js';
import { pct } from './bars.js';
import {
  type ConstructionModel,
  constructionModel,
  type StockAlert,
  type StockRow,
  stockRows,
  type UpgradeCostRow,
  upgradeCostRows,
} from './building-materials.js';
import { type ProductionModel, productionModel } from './building-production.js';
import { type BuildingStaffModel, buildingStaff, garrisonPosts, siteCrew } from './building-staff.js';
import { type BuildingStatusModel, buildingStatus } from './building-status.js';
import {
  type BuildingDef,
  buildingDef,
  buildingTitle,
  contentTribeName,
  foreignOwnerLine,
  goodLabel,
  jobDisplayName,
  recipeOutputs,
  type SettlerWorkStatus,
  type UnitPanelModelContext,
} from './context.js';
import type { SeatControl } from './settler-household.js';
import { offerSide, type TradeOfferSide } from './trade.js';
import { workStatusDetail } from './work-status.js';

export * from './building-materials.js';
export * from './building-production.js';
export * from './building-staff.js';
export * from './building-status.js';

export type HouseholdEffect = 'cooking' | 'rest' | 'piety';

export interface HomeQualityRow {
  readonly effect: HouseholdEffect;
  readonly goodId: string;
  readonly label: string;
  readonly value: number;
  readonly capacity: number;
  readonly allowed: boolean;
  /** Remaining household actions; omitted for holy oil, whose pool drains continuously. */
  readonly uses?: number;
  /** Only the holy-oil row carries this live finished-home status. */
  readonly holyFireActive?: boolean;
}

/** Household: the household wares a finished home keeps, and the owner's policy over every home. */
export interface HomeQualityModel {
  readonly rows: readonly HomeQualityRow[];
  /** The seat whose policy the toggles set. */
  readonly player: number;
  /** True while the viewer may set that seat's policy, else the reason. */
  readonly control: SeatControl;
}

/** The orders beside the portrait. A null order is not offered for this house. */
export interface BuildingOrdersModel {
  /** Upgrade: true or the refusal (an unfinished site, a technology), with the next tier's bill; null
   *  for a type with no higher tier. */
  readonly upgrade: { readonly control: SeatControl; readonly cost: readonly UpgradeCostRow[] } | null;
  /** Cancel upgrade, while a tier is being raised; it stands in Upgrade's place. */
  readonly cancelUpgrade: boolean;
  /** The alarm toggle of a house that shelters civilians, and whether it is up. */
  readonly alarm: { readonly on: boolean } | null;
  /** Workers: the trade the residents window lists candidates for; null for a house employing
   *  nobody. */
  readonly hire: { readonly jobType: number; readonly label: string } | null;
}

/** How Storage lists the shelves: a store and the barracks' armory under category tabs, a workshop
 *  its inputs over its products, anything else one list. */
export type StockLayout = 'tabs' | 'split' | 'list';

/** An agreement this house offers a visiting trader: the trader gives one side and takes the other. */
export interface BuildingOfferModel {
  readonly give: TradeOfferSide;
  readonly take: TradeOfferSide;
}

/** The selected building's panel. A null or empty section is not shown; another seat's house shows its name,
 *  owner, health, state and agreements only. */
export interface BuildingPanelModel {
  readonly kind: 'building';
  readonly entityId: number;
  readonly typeId: number;
  /** The building's civilization, the per-tribe art join key. */
  readonly tribeId: number | undefined;
  /** The type's name without its tier. */
  readonly title: string;
  /** The type's full name, which Knowledge and the demolition question use. */
  readonly name: string;
  /** The tier in the type's upgrade chain from 1, the line under the title; null for a single tier. */
  readonly tier: number | null;
  readonly foreign: boolean;
  /** Another seat's owner line, or the civilization while the seat keeps houses of several. */
  readonly meta: string | null;
  /** Null for a type declaring no hitpoints (`work_murek`). */
  readonly health: { readonly hitpoints: number; readonly max: number } | null;
  readonly status: BuildingStatusModel;
  readonly orders: BuildingOrdersModel | null;
  /** Present while the building is a site, raised from nothing or a tier up. */
  readonly construction: (ConstructionModel & { readonly pct: number; readonly upgrade: boolean }) | null;
  readonly staff: BuildingStaffModel | null;
  /** A site's builders, beside the staff it already has; null once it stands. */
  readonly crew: BuildingStaffModel | null;
  readonly production: ProductionModel | null;
  readonly stock: readonly StockRow[];
  readonly stockLayout: StockLayout;
  readonly homeQuality: HomeQualityModel | null;
  readonly offers: readonly BuildingOfferModel[];
}

/** Composite index keys: an owner times the span, plus a type or tribe id under it. */
const OWNER_KEY_SPAN = 1 << 16;
const NO_OWNER = OWNER_KEY_SPAN - 1;

function ownerKey(owner: number | undefined, id: number): number {
  return (owner ?? NO_OWNER) * OWNER_KEY_SPAN + id;
}

/** What the two building indexes place a building by. */
const BUILDING_OWNER_READS = { values: ['Building', 'Owner'] };

const BUILDINGS_BY_OWNER_TYPE = idsGroupedBy(
  (e) => {
    if (!isBuilding(e)) return undefined;
    const type = buildingTypeOf(e);
    return type === undefined ? undefined : ownerKey(ownerPlayerOf(e), type);
  },
  'buildings by owner and type',
  BUILDING_OWNER_READS,
);

const BUILDINGS_BY_OWNER_TRIBE = countedBy(
  (e) => {
    if (!isBuilding(e)) return undefined;
    const tribe = buildingTribeOf(e);
    return tribe === undefined ? undefined : ownerKey(ownerPlayerOf(e), tribe);
  },
  'buildings by owner and tribe',
  BUILDING_OWNER_READS,
);

/** The owner's buildings of `ent`'s type, ascending: the head's browse. */
export function buildingPeersOf(snapshot: WorldSnapshot, ent: SnapshotEntity): readonly number[] {
  const type = buildingTypeOf(ent);
  if (type === undefined) return [];
  return (
    indexesOf(snapshot)
      .get(BUILDINGS_BY_OWNER_TYPE)
      .get(ownerKey(ownerPlayerOf(ent), type)) ?? []
  );
}

/** `owner`'s buildings of type `type`, ascending by id. An index read. */
export function ownedBuildingsOfType(
  snapshot: WorldSnapshot,
  owner: number,
  type: number,
): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, BUILDINGS_BY_OWNER_TYPE, ownerKey(owner, type));
}

/** Whether `owner` keeps buildings of more than one civilization, so each house names its own. */
function ownsSeveralTribes(snapshot: WorldSnapshot, owner: number | undefined): boolean {
  const low = ownerKey(owner, 0);
  let tribes = 0;
  for (const key of indexesOf(snapshot).get(BUILDINGS_BY_OWNER_TRIBE).keys()) {
    if (key >= low && key < low + OWNER_KEY_SPAN) tribes++;
  }
  return tribes > 1;
}

/** The locale tables name a tier of an upgrade chain "<name> (poziom N)"; the head shows the tier on
 *  its own line. */
const TIER_SUFFIX = /\s*\([^()]*\)$/;

const HOUSEHOLD_ORDER: Readonly<Record<HouseholdEffect, number>> = { cooking: 0, rest: 1, piety: 2 };

function homeQuality(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef,
  ent: SnapshotEntity,
  level: number,
): HomeQualityModel | null {
  const player = ownerPlayerOf(ent);
  if (player === undefined || def.kind !== 'home') return null;
  const pools = homeQualityView(snapshot, ent.id) ?? { cooking: 0, rest: 0, piety: 0 };
  const policy = householdGoodPolicyView(snapshot, player);
  const rows = ctx.goods
    .flatMap((good): HomeQualityRow[] => {
      const use = good.homeQuality;
      if (use === undefined || level < use.minimumHomeLevel) return [];
      const value = pools[use.effect];
      return [
        {
          effect: use.effect,
          goodId: good.id,
          label: goodLabel(ctx, good.typeId),
          value,
          capacity: use.capacity,
          allowed: policy[use.effect],
          ...(use.effect === 'piety'
            ? { holyFireActive: value > 0 && policy.piety }
            : { uses: Math.floor(value / use.useCost) }),
        },
      ];
    })
    .sort((a, b) => HOUSEHOLD_ORDER[a.effect] - HOUSEHOLD_ORDER[b.effect]);
  if (rows.length === 0) return null;
  return {
    rows,
    player,
    control: player === ctx.viewer?.seat() ? true : messages().hud.buildingPanel.policyForeign,
  };
}

/** The trade Workers looks for: a site's builders, a store's traders, else the house's own craft,
 *  one with a free seat first. The carriers and gatherers (collectors) a workshop keeps are never it. */
function hireJob(
  def: BuildingDef | undefined,
  staff: BuildingStaffModel | null,
  site: boolean,
): number | null {
  if (site) return JOB_BUILDER;
  if (def?.kind === 'storage') return JOB_TRADER;
  if (staff?.kind !== 'workers') return null;
  const helper = (jobType: number): boolean => ['carrier', 'gatherer'].includes(workerRoleOf(jobType));
  const crafts = staff.groups.flatMap((group) =>
    group.jobType === null || group.capacity === null || helper(group.jobType)
      ? []
      : [{ jobType: group.jobType, free: group.people.length < group.capacity }],
  );
  return (crafts.find((slot) => slot.free) ?? crafts[0])?.jobType ?? null;
}

function ordersModel(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
  finished: boolean,
  hire: number | null,
): BuildingOrdersModel {
  const copy = messages().hud.buildingPanel;
  const tribe = buildingTribeOf(ent) ?? 0;
  const next = def?.upgradeTarget;
  const upgradeControl = (target: number): SeatControl =>
    !finished
      ? copy.upgradeUnfinished
      : (ctx.technologyReason?.('house', target, tribe, ownerPlayerOf(ent)) ?? true);
  const shelters = (def?.shelterCapacity ?? 0) > 0;
  return {
    upgrade: next === undefined ? null : { control: upgradeControl(next), cost: upgradeCostRows(ctx, def) },
    cancelUpgrade: ent.components.Upgrading !== undefined,
    // `shelterCapacity` is the gate the sim's `setDefenceMode` reads, so the toggle is never refused.
    alarm: shelters && finished ? { on: ent.components.DefenceMode !== undefined } : null,
    hire: hire === null ? null : { jobType: hire, label: jobDisplayName(ctx, hire) },
  };
}

/** The shelves marked for Storage: the inputs its posted workers wait for, its products' full shelves,
 *  and the products themselves, listed after the inputs. */
function markedStock(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  building: number,
  rows: readonly StockRow[],
): StockRow[] {
  const waiting = new Set<number>();
  for (const worker of staffOf(snapshot, building)) {
    const status = ctx.workStatus?.(worker.id);
    if (status?.kind === 'waitingInput') {
      for (const input of status.missingInputs) waiting.add(input.goodType);
    }
  }
  const products = new Set(recipeOutputs(ctx, def).map((output) => output.goodType));
  const marked = rows.map((row): StockRow => {
    const product = products.has(row.goodType);
    const full = product && row.capacity !== undefined && row.amount >= row.capacity;
    const alert: StockAlert | null = waiting.has(row.goodType) ? 'waiting' : full ? 'full' : null;
    return { ...row, ...(alert === null ? {} : { alert }), ...(product ? { product } : {}) };
  });
  return [...marked.filter((row) => row.product !== true), ...marked.filter((row) => row.product === true)];
}

function stockLayoutOf(def: BuildingDef | undefined, rows: readonly StockRow[]): StockLayout {
  if (def?.kind === 'storage' || def?.kind === 'training') return 'tabs';
  const products = rows.filter((row) => row.product === true).length;
  return products > 0 && products < rows.length ? 'split' : 'list';
}

/** Prefer the craftsman's diagnosis to a collector's errand, and either to a carrier's unrelated activity. */
function firstWorkerStatus(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  building: number,
): SettlerWorkStatus | undefined {
  const workers = staffOf(snapshot, building);
  const roleOf = (worker: SnapshotEntity) => {
    const job = settlerJobType(worker);
    return job === undefined ? undefined : workerRoleOf(job);
  };
  const worker =
    workers.find((w) => roleOf(w) === 'craftsman') ??
    workers.find((w) => roleOf(w) !== undefined && roleOf(w) !== 'carrier') ??
    workers[0];
  return worker === undefined ? undefined : ctx.workStatus?.(worker.id);
}

/** The product of the craft cycle furthest along, labelled; null while none runs. */
function craftingNow(ctx: UnitPanelModelContext, ent: SnapshotEntity): string | null {
  const production = ent.components.Production as { cycles?: unknown } | undefined;
  let best: { good: number; share: number } | null = null;
  for (const c of Array.isArray(production?.cycles) ? production.cycles : []) {
    const cycle = c as { elapsed?: unknown; duration?: unknown; goodType?: unknown } | null;
    const good = num(cycle?.goodType);
    const duration = num(cycle?.duration) ?? 0;
    if (good === undefined || duration <= 0) continue;
    const share = (num(cycle?.elapsed) ?? 0) / duration;
    if (best === null || share > best.share) best = { good, share };
  }
  return best === null ? null : goodLabel(ctx, best.good);
}

export function buildingPanelModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
): BuildingPanelModel {
  const b = (ent.components.Building ?? {}) as { buildingType?: unknown; built?: unknown; level?: unknown };
  const rawType = num(b.buildingType);
  const def = buildingDef(ctx, rawType);
  const tribeId = buildingTribeOf(ent);
  const owner = ownerPlayerOf(ent);
  const seat = ctx.viewer === undefined ? null : pickableSeat(ctx.viewer);
  const foreign = seat !== null && owner !== undefined && owner !== seat;
  const builtPct = pct(num(b.built));
  const site = ent.components.UnderConstruction !== undefined;
  const finished = !site && builtPct >= 100;
  const upgrade = ent.components.Upgrading !== undefined;
  const construction = constructionModel(ctx, snapshot, def, ent);
  const shelterCapacity = def?.shelterCapacity ?? 0;
  const sheltered = shelterClaimCount(snapshot, ent.id);
  const alarm = ent.components.DefenceMode !== undefined ? { sheltered, capacity: shelterCapacity } : null;
  const staff = foreign ? null : buildingStaff(ctx, snapshot, def, ent);
  const crew = foreign || !site ? null : siteCrew(ctx, snapshot, ent.id);
  const seats = !site && staff?.kind === 'workers' && staff.count !== null ? staff.count.filled : null;
  const work = foreign || site ? undefined : firstWorkerStatus(ctx, snapshot, ent.id);
  const health = healthOf(ent);
  const kind = def?.kind;
  const status = buildingStatus({
    site:
      construction === null ? null : { upgrade, pct: builtPct, stall: foreign ? null : construction.status },
    alarm,
    crafting: site ? null : craftingNow(ctx, ent),
    seats,
    garrison: site ? null : garrisonPosts(snapshot, def, ent.id),
    workDetail: work === undefined ? null : workStatusDetail(ctx, work),
    families: kind === 'home' && !site ? (homeFamiliesOf(snapshot, ent.id)?.length ?? 0) : null,
  });
  const level = num(b.level) ?? 0;
  const name = buildingTitle(ctx, rawType);
  // The sim keeps the rung of the upgrade chain; a type outside any chain has no tier to name.
  const tier = level > 0 || def?.upgradeTarget !== undefined ? level + 1 : null;
  const stock =
    foreign || site
      ? []
      : markedStock(
          ctx,
          snapshot,
          def,
          ent.id,
          stockRows(ctx, def, ent.components.Stockpile, ent.components.ProductionBonus),
        );
  const meta = foreign
    ? foreignOwnerLine(ctx, owner, tribeId)
    : ownsSeveralTribes(snapshot, owner)
      ? tribeName(tribeId, contentTribeName(ctx, tribeId))
      : null;
  return {
    kind: 'building',
    entityId: ent.id,
    typeId: rawType ?? -1,
    tribeId,
    title: tier === null ? name : name.replace(TIER_SUFFIX, ''),
    name,
    tier,
    foreign,
    meta,
    health: health === undefined || health.max <= 0 ? null : health,
    status,
    orders: foreign ? null : ordersModel(ctx, def, ent, finished, hireJob(def, staff, site)),
    construction: construction === null || foreign ? null : { ...construction, pct: builtPct, upgrade },
    staff,
    crew,
    production: foreign || site ? null : productionModel(ctx, snapshot, def, ent),
    stock,
    stockLayout: stockLayoutOf(def, stock),
    homeQuality:
      foreign || def === undefined || !finished ? null : homeQuality(ctx, snapshot, def, ent, level),
    offers: (ctx.tradeOffersAt?.(ent.id) ?? []).map((offer) => ({
      give: offerSide(ctx, offer.giveAmount, offer.giveGood),
      take: offerSide(ctx, offer.takeAmount, offer.takeGood),
    })),
  };
}
