import type { ContentSet } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { isCivilianJob } from '../../../catalog/jobs.js';
import {
  SOLDIER_ARMOR_OF_MAIN_TYPE,
  SOLDIER_CLASS_OF_JOB,
  type SoldierArmor,
  type SoldierFamily,
} from '../../../catalog/soldier-classes.js';
import { settlerName } from '../../../game/character-names/index.js';
import {
  buildingTypeOf,
  childAgeYearsOf,
  isAdult,
  isBoundByMarriage,
  isFemale,
  isMarrying,
  isWildlife,
  marriageOf,
  num,
  residenceHomeOf,
  type SnapshotEntity,
  settlerJobType,
  settlersOwnedBy,
  workFlagOf,
  workplaceOf,
} from '../../../game/snapshot/index.js';
import { vehicleLabel } from '../../../game/technology.js';
import { messages } from '../../../i18n/index.js';
import { buildingTitle, jobDisplayName } from '../../details-panel/model/context.js';
import type { ProductSelection } from '../../details-panel/model/settler-work.js';
import type { ResidentKind, ResidentLack, ResidentRow } from './rows.js';

/** The mead's content id, the same slug the assistant's mead grant resolves. */
export const MEAD_GOOD_ID = 'mead';

export interface ResidentsProjectionContext {
  readonly localPlayer: number;
  /** The running content: the job roles and the workplaces' worker slots. */
  readonly content: ContentSet;
  /** The map's own string by id, which names a settler the map named. */
  readonly mapText?: ((stringId: number) => string | undefined) | undefined;
  /** The mead good's type id; without one in the content nobody lacks mead. */
  readonly meadGood: number | undefined;
  /** What a worker is set to make (`createProductSelectionCache`); absent lists no products. */
  readonly products?: ((snapshot: WorldSnapshot, ent: SnapshotEntity) => ProductSelection | null) | undefined;
}

interface WornSlots {
  readonly boots: boolean;
  readonly tool: boolean;
  readonly weapon: boolean;
  /** The worn armour's good type. */
  readonly armor: number | undefined;
  readonly misc: readonly number[];
}

function wornSlots(ent: SnapshotEntity): WornSlots {
  const eq = ent.components.Equipment as
    | { boots?: unknown; tool?: unknown; weapon?: unknown; armor?: unknown; misc?: unknown }
    | undefined;
  const held = (slot: unknown): boolean => slot !== null && slot !== undefined;
  const misc = Array.isArray(eq?.misc) ? eq.misc : [];
  return {
    boots: held(eq?.boots),
    tool: held(eq?.tool),
    weapon: held(eq?.weapon),
    armor: num((eq?.armor as { goodType?: unknown } | null | undefined)?.goodType),
    misc: misc.flatMap((slot: unknown) => {
      const goodType = num((slot as { goodType?: unknown } | null)?.goodType);
      return goodType === undefined ? [] : [goodType];
    }),
  };
}

export function residentKindOf(
  content: ContentSet,
  ent: SnapshotEntity,
  jobType: number | null,
): ResidentKind {
  if (!isAdult(ent)) return 'child';
  if (systems.isHeroJob(content, jobType)) return 'hero';
  if (systems.isSoldierJob(content, jobType)) return 'soldier';
  if (isFemale(ent)) return 'woman';
  if (isCivilianJob(jobType)) return 'civilian';
  return 'worker';
}

/**
 * What the resident goes without. The groups follow the original subjects window: no home and no
 * partner skip soldiers and heroes, no children counts the women, no weapon the soldiers. The worn
 * lacks ask only a man whose equipment may change (the sim's `mayChangeEquipment`), so a woman and a
 * hero lack no shoes, tool, weapon or mead. Two are this project's own: no post is a worker whose trade
 * a workplace employs, standing at none and tied to no work flag; no mead is such a man with a job and
 * no bottle, the people the assistant's mead grant reaches. Approximation: the sim tracks a couple's
 * one growing child, so "no children" means none growing now, not a family history.
 */
function lacksOf(
  ctx: ResidentsProjectionContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  kind: ResidentKind,
  jobType: number | null,
  postedTrades: ReadonlySet<number>,
  worn: WornSlots,
): ResidentLack[] {
  if (kind === 'child') return [];
  const fighter = kind === 'soldier' || kind === 'hero';
  const lacks: ResidentLack[] = [];
  if (!fighter && residenceHomeOf(ent) === undefined) lacks.push('home');
  if (
    kind === 'worker' &&
    jobType !== null &&
    postedTrades.has(jobType) &&
    workplaceOf(ent) === undefined &&
    workFlagOf(ent) === undefined
  ) {
    lacks.push('post');
  }
  // The assistant hands no tool to a scout, so the list asks none of one.
  if (kind === 'worker' && !systems.isScoutJob(ctx.content, jobType) && !worn.tool) lacks.push('tool');
  const dressable = kind !== 'hero' && kind !== 'woman';
  if (dressable && !worn.boots) lacks.push('shoes');
  if (!fighter && !isBoundByMarriage(snapshot, ent) && !isMarrying(ent)) lacks.push('partner');
  if (kind === 'woman' && !hasGrowingChild(snapshot, ent)) lacks.push('children');
  if (kind === 'soldier' && !worn.weapon) lacks.push('weapon');
  if (dressable && ctx.meadGood !== undefined && jobType !== null && !worn.misc.includes(ctx.meadGood)) {
    lacks.push('mead');
  }
  return lacks;
}

/** A soldier's weapon family, by its class: `weapons.ini` gives some tribes' wooden spearman a fist. */
function weaponFamilyOf(jobType: number | null): SoldierFamily | null {
  return (jobType === null ? undefined : SOLDIER_CLASS_OF_JOB.get(jobType)?.family) ?? null;
}

interface ArmorLookup {
  readonly byGood: ReadonlyMap<number, SoldierArmor>;
  readonly byClass: ReadonlyMap<number, SoldierArmor>;
}

const armorLookupByContent = new WeakMap<ContentSet, ArmorLookup>();

function armorLookup(content: ContentSet): ArmorLookup {
  let lookup = armorLookupByContent.get(content);
  if (lookup === undefined) {
    const byGood = new Map<number, SoldierArmor>();
    const byClass = new Map<number, SoldierArmor>();
    for (const row of content.armor) {
      const armor = row.mainType === undefined ? undefined : SOLDIER_ARMOR_OF_MAIN_TYPE.get(row.mainType);
      if (armor === undefined) continue;
      byClass.set(row.typeId, armor);
      if (row.goodType !== undefined) byGood.set(row.goodType, armor);
    }
    lookup = { byGood, byClass };
    armorLookupByContent.set(content, lookup);
  }
  return lookup;
}

/** What a soldier wears, read off the armour good's `armortypes.ini` row, or off the armour class a
 *  scene stamped without a good, as the group panel reads it. */
function armorOf(content: ContentSet, ent: SnapshotEntity, worn: WornSlots): SoldierArmor {
  const { byGood, byClass } = armorLookup(content);
  if (worn.armor !== undefined) return byGood.get(worn.armor) ?? 'none';
  const armorClass = num((ent.components.Armor as { armorClass?: unknown } | undefined)?.armorClass);
  return (armorClass === undefined ? undefined : byClass.get(armorClass)) ?? 'none';
}

/** The vehicle `ent` rides, inside or on its way to board. */
function riddenVehicleOf(snapshot: WorldSnapshot, ent: SnapshotEntity): SnapshotEntity | undefined {
  const vehicle = num((ent.components.Rider as { vehicle?: unknown } | undefined)?.vehicle);
  return vehicle === undefined ? undefined : entityById(snapshot, vehicle);
}

function vehicleName(content: ContentSet, vehicle: SnapshotEntity): string {
  const typeId = num((vehicle.components.Vehicle as { vehicleType?: unknown } | undefined)?.vehicleType);
  return (typeId === undefined ? undefined : vehicleLabel(content, typeId)) ?? messages().hud.vehicle;
}

/** The profession column's text: a soldier reads as its class ("Iron Spearman"), so the Profession
 *  filter can pick one class. */
function professionOf(
  nameCtx: Parameters<typeof jobDisplayName>[0],
  kind: ResidentKind,
  jobType: number | null,
): string {
  const soldierClass =
    kind === 'soldier' && jobType !== null ? SOLDIER_CLASS_OF_JOB.get(jobType)?.soldierClass : undefined;
  if (soldierClass !== undefined) return messages().hud.groupPanel.soldierClass[soldierClass];
  return jobDisplayName(nameCtx, jobType ?? undefined);
}

/** The sim's own test of a couple's child: the id lingers on the marriage after the child grew up
 *  or died, so only a living minor counts. */
function hasGrowingChild(snapshot: WorldSnapshot, ent: SnapshotEntity): boolean {
  const child = marriageOf(ent)?.child ?? null;
  const living = child === null ? undefined : entityById(snapshot, child);
  return living !== undefined && !isAdult(living);
}

/** The trades some workplace employs: a builder or a scout works in the open and needs no post. */
function tradesWithPosts(content: ContentSet): ReadonlySet<number> {
  const trades = new Set<number>();
  for (const building of content.buildings) {
    for (const slot of building.workers ?? []) trades.add(slot.jobType);
  }
  return trades;
}

const postedTradesByContent = new WeakMap<ContentSet, ReadonlySet<number>>();

/**
 * The seat's people as the residents window lists them, in snapshot order: humans the local player
 * owns, so animals, vehicles and other seats' people stay out. One walk over the seat's settlers off the
 * owner index; pull it only while the window is open.
 */
export function residentRows(snapshot: WorldSnapshot, ctx: ResidentsProjectionContext): ResidentRow[] {
  let postedTrades = postedTradesByContent.get(ctx.content);
  if (postedTrades === undefined) {
    postedTrades = tradesWithPosts(ctx.content);
    postedTradesByContent.set(ctx.content, postedTrades);
  }
  const nameCtx = { jobs: ctx.content.jobs, mapText: ctx.mapText };
  const rows: ResidentRow[] = [];
  for (const ent of settlersOwnedBy(snapshot, ctx.localPlayer)) {
    if (isWildlife(ent)) continue;
    const jobType = settlerJobType(ent) ?? null;
    const kind = residentKindOf(ctx.content, ent, jobType);
    const workplace = workplaceOf(ent);
    const workplaceEnt = workplace === undefined ? undefined : entityById(snapshot, workplace);
    const vehicleEnt = riddenVehicleOf(snapshot, ent);
    const worn = wornSlots(ent);
    const ageYears = childAgeYearsOf(ent, snapshot.tick);
    rows.push({
      id: ent.id,
      name: settlerName(nameCtx, ent),
      kind,
      female: isFemale(ent),
      jobType,
      profession: professionOf(nameCtx, kind, jobType),
      trade: jobDisplayName(nameCtx, jobType ?? undefined),
      weapon: kind === 'soldier' ? weaponFamilyOf(jobType) : null,
      armor: kind === 'soldier' ? armorOf(ctx.content, ent, worn) : null,
      ageYears: ageYears ?? null,
      // A ridden vehicle stands in for the workplace.
      workplace:
        workplaceEnt !== undefined
          ? buildingTitle(ctx.content, buildingTypeOf(workplaceEnt))
          : vehicleEnt !== undefined
            ? vehicleName(ctx.content, vehicleEnt)
            : '',
      posted: workplaceEnt !== undefined || vehicleEnt !== undefined,
      products: kind === 'worker' ? (ctx.products?.(snapshot, ent) ?? null) : null,
      lacks: lacksOf(ctx, snapshot, ent, kind, jobType, postedTrades, worn),
    });
  }
  return rows;
}
