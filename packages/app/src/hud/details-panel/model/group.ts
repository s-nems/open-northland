import type { VehicleType } from '@open-northland/data';
import { components, systems, type WorldSnapshot } from '@open-northland/sim';
import { professionDefForJob } from '../../../catalog/professions.js';
import { SOLDIER_CLASS_OF_JOB, SOLDIER_FAMILY_OF_MAIN_TYPE } from '../../../catalog/soldier-classes.js';
import { settlerName } from '../../../game/character-names/index.js';
import {
  healthOf,
  isPlayerControllable,
  isSettler,
  isVehicle,
  needsRuleEnabled,
  num,
  ownerPlayerOf,
  regeneratesInWorld,
  type SnapshotEntity,
  settlerJobType,
  settlerTribeOf,
  stanceModeOf,
  vehicleSeatsOf,
} from '../../../game/snapshot/index.js';
import { soldierWeaponFamily } from '../../../game/unit-kind.js';
import { pickableSeat } from '../../../game/viewer-seat.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { pctRatio, remainingPct } from './bars.js';
import {
  type Comp,
  goodDef,
  goodLabel,
  jobDisplayName,
  type UnitPanelModelContext,
  vehicleTitle,
} from './context.js';
import { satisfactionBars } from './settler.js';
import { type SettlerRole, settlerRole } from './settler-household.js';
import { vehicleClassOf } from './vehicle.js';

type GroupCopy = ReturnType<typeof messages>['hud']['groupPanel'];

export type GroupStance = 'attack' | 'defend' | 'ignore';
export type GroupGear = 'weapon' | 'armor' | 'boots' | 'tool' | 'misc';

/** A kind's tab icon while the names do not fit: a soldier class shows its weapon, the rest a glyph. */
export type GroupKindIcon =
  | { readonly good: string }
  | {
      readonly glyph:
        | 'people'
        | 'banner'
        | 'swords'
        | 'tool'
        | 'man'
        | 'woman'
        | 'child'
        | 'siege'
        | 'ship'
        | 'cart';
    };

/** One selected settler or vehicle as its well shows it. */
export interface GroupMemberModel {
  readonly id: number;
  readonly look: 'settler' | 'vehicle';
  /** The scope the member belongs to: one tab per kind. */
  readonly kind: string;
  readonly name: string;
  /** The kind in the singular, for the well's tooltip. */
  readonly kindLabel: string;
  readonly healthPct: number | null;
  /** Hunger's satisfaction; null for a vehicle, or while the map's needs are off. */
  readonly hungerPct: number | null;
  /** At least one bottle of mead in the misc slots, which the well marks however many there are. */
  readonly carriesMead: boolean;
}

/** One good worn or carried across the scope, with how many hold it; `sips` counts a draught's uses left. */
export interface GroupGearItem {
  readonly goodId: string | undefined;
  readonly ids: readonly number[];
  readonly label: string;
  readonly count: number;
  readonly sips: number | null;
}

/** Goods and holders in one slot; `bare` names the eligible members whose slot is empty. */
export interface GroupGearRow {
  readonly gear: GroupGear;
  readonly items: readonly GroupGearItem[];
  readonly bare: readonly number[];
}

/** The scope's fighters, soldiers and heroes: their shared stance and regeneration rule, null when they
 *  differ or the scope has none, and how many hold each. */
export interface GroupMilitaryModel {
  readonly count: number;
  readonly stance: GroupStance | null;
  readonly stances: Readonly<Record<GroupStance, number>>;
  readonly regeneration: boolean | null;
}

/** The scope's siege vehicles and their shared stance, null when they differ or the scope has none. */
export interface GroupSiegeModel {
  readonly ids: readonly number[];
  readonly stance: components.VehicleStance | null;
  readonly stances: Readonly<Record<components.VehicleStance, number>>;
}

/** The scope's own ships: the ones a dock order moors, and those whose crew may step ashore now. */
export interface GroupFleetModel {
  readonly ids: readonly number[];
  readonly landable: readonly number[];
}

/** What one tab shows and orders: the whole group, or the members of one kind. */
export interface GroupScopeModel {
  readonly key: string;
  readonly label: string;
  readonly icon: GroupKindIcon;
  readonly ids: readonly number[];
  readonly gear: readonly GroupGearRow[];
  readonly military: GroupMilitaryModel | null;
  readonly siege: GroupSiegeModel | null;
  /** Null unless the group is the viewer's own ships and nothing else. */
  readonly fleet: GroupFleetModel | null;
}

/** Several units selected at once: settlers, vehicles or both. */
export interface GroupPanelModel {
  readonly kind: 'group';
  readonly title: string;
  readonly members: readonly GroupMemberModel[];
  /** The whole group first, then one scope per kind when there are several kinds. */
  readonly scopes: readonly GroupScopeModel[];
  /** Whether the viewer orders any member: the medallion and the stance strips. */
  readonly orders: boolean;
}

export const ALL_SCOPE = 'all';

const FULL_PCT = 100;

/** The good the roster marks on a bearer's well: the drink a player hands out before a march. */
export const MEAD_GOOD_ID = 'mead';

const STANCE_OF_MODE: ReadonlyMap<number, GroupStance> = new Map([
  [systems.MILITARY_MODE.ATTACK, 'attack'],
  [systems.MILITARY_MODE.DEFEND, 'defend'],
  [systems.MILITARY_MODE.IGNORE, 'ignore'],
]);

const ROLE_GLYPH: Readonly<Record<Exclude<SettlerRole, 'soldier'>, GroupKindIcon>> = {
  hero: { glyph: 'banner' },
  worker: { glyph: 'tool' },
  civilian: { glyph: 'man' },
  woman: { glyph: 'woman' },
  child: { glyph: 'child' },
};

/** Tab order: who fights first, then the machines, then the village. */
const KIND_RANK: Readonly<Record<SettlerRole | 'siege' | 'ship' | 'cart', number>> = {
  hero: 0,
  soldier: 1,
  siege: 2,
  ship: 3,
  cart: 4,
  worker: 5,
  civilian: 6,
  woman: 7,
  child: 8,
};

interface RawSlot {
  readonly goodType?: unknown;
  readonly degreeOfUse?: unknown;
}
interface RawEquipment {
  readonly boots?: RawSlot | null;
  readonly weapon?: RawSlot | null;
  readonly armor?: RawSlot | null;
  readonly tool?: RawSlot | null;
  readonly misc?: unknown;
}

/** One member read once off the snapshot; every scope it belongs to sums these. */
interface MemberFacts {
  readonly id: number;
  readonly kind: string;
  readonly rank: number;
  readonly order: number;
  readonly plural: string;
  readonly icon: GroupKindIcon;
  readonly model: GroupMemberModel;
  readonly fighter: boolean;
  readonly worker: boolean;
  readonly owned: boolean;
  readonly weapon: number | null;
  readonly armor: number | null;
  readonly boots: number | null;
  readonly tool: number | null;
  readonly misc: readonly { readonly goodType: number; readonly used: number | undefined }[];
  readonly stance: GroupStance | null;
  readonly regenerates: boolean;
  readonly vehicle: {
    readonly siege: boolean;
    readonly stance: components.VehicleStance;
    /** Null for a land vehicle; `landable` for a moored ship with someone aboard. */
    readonly ship: { readonly landable: boolean } | null;
  } | null;
}

const slotGood = (slot: RawSlot | null | undefined): number | null => {
  const goodType = num(slot?.goodType);
  return goodType === undefined ? null : goodType;
};

/** The weapon the settler fights with: the worn good's row, else the class a scene stamped. */
function weaponRow(ctx: UnitPanelModelContext, ent: SnapshotEntity, worn: number | null) {
  const tribe = settlerTribeOf(ent);
  if (worn !== null) return ctx.weapons?.find((w) => w.tribeType === tribe && w.goodType === worn);
  const typeId = num((ent.components.Weapon as { weaponTypeId?: unknown } | undefined)?.weaponTypeId);
  if (typeId === undefined) return undefined;
  return ctx.weapons?.find((w) => w.tribeType === tribe && w.typeId === typeId);
}

/** The armour good the settler wears, or the good of the tier a scene stamped on it. */
function armorGood(ctx: UnitPanelModelContext, ent: SnapshotEntity, worn: number | null): number | null {
  if (worn !== null) return worn;
  const armorClass = num((ent.components.Armor as { armorClass?: unknown } | undefined)?.armorClass);
  if (armorClass === undefined) return null;
  return ctx.armor?.find((a) => a.typeId === armorClass)?.goodType ?? null;
}

function healthPctOf(ent: SnapshotEntity): number | null {
  const health = healthOf(ent);
  return health === undefined || health.max <= 0 ? null : pctRatio(health.hitpoints, health.max);
}

function settlerFacts(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  needsOn: boolean,
  owned: boolean,
): MemberFacts {
  const copy = messages().hud.groupPanel;
  const role = settlerRole(ctx, ent);
  const jobType = settlerJobType(ent);
  const fighter = role === 'soldier' || role === 'hero';
  const soldierClass = jobType === undefined ? undefined : SOLDIER_CLASS_OF_JOB.get(jobType)?.soldierClass;
  const profession = professionDefForJob(jobType)?.key;
  let kind: string;
  let plural: string;
  let singular: string;
  switch (role) {
    case 'soldier': {
      const family = soldierWeaponFamily(ctx.weapons ?? [], ent);
      const label = family === undefined ? undefined : SOLDIER_FAMILY_OF_MAIN_TYPE.get(family);
      kind = family === undefined ? `job:${jobType ?? ''}` : `soldier:${family}`;
      plural =
        label === undefined
          ? soldierClass === undefined
            ? jobDisplayName(ctx, jobType)
            : copy.soldierClasses[soldierClass]
          : copy.soldierFamilies[label];
      singular = soldierClass === undefined ? jobDisplayName(ctx, jobType) : copy.soldierClass[soldierClass];
      break;
    }
    case 'worker':
      kind = `job:${jobType ?? ''}`;
      plural = profession === undefined ? jobDisplayName(ctx, jobType) : copy.professions[profession];
      singular = jobDisplayName(ctx, jobType);
      break;
    default:
      kind = `role:${role}`;
      plural = copy.roles[role];
      // A hero and a child read the name their job shows on every other surface; the children's row
      // gathers babies, girls and boys under one plural.
      singular = role === 'hero' || role === 'child' ? jobDisplayName(ctx, jobType) : copy.role[role];
  }
  const hunger = satisfactionBars(ent, snapshot.tick, needsOn, role !== 'hero').find(
    (bar) => bar.need === 'hunger',
  );
  const eq = ent.components.Equipment as RawEquipment | undefined;
  const wornWeapon = slotGood(eq?.weapon);
  const weapon = fighter ? weaponRow(ctx, ent, wornWeapon) : undefined;
  const misc = (Array.isArray(eq?.misc) ? (eq.misc as (RawSlot | null)[]) : []).flatMap((slot) => {
    const goodType = slotGood(slot);
    return goodType === null ? [] : [{ goodType, used: num(slot?.degreeOfUse) }];
  });
  const mode = stanceModeOf(ent);
  const weaponGood = fighter ? (wornWeapon ?? (weapon?.goodType || null)) : null;
  const weaponId = weaponGood === null ? undefined : goodDef(ctx, weaponGood)?.id;
  return {
    id: ent.id,
    kind,
    rank: KIND_RANK[role],
    order: jobType ?? 0,
    plural,
    icon:
      role !== 'soldier'
        ? ROLE_GLYPH[role]
        : weaponId === undefined
          ? { glyph: 'swords' }
          : { good: weaponId },
    model: {
      id: ent.id,
      look: 'settler',
      kind,
      name: settlerName(ctx, ent),
      kindLabel: singular,
      healthPct: healthPctOf(ent),
      hungerPct: hunger?.pct ?? null,
      carriesMead: misc.some((item) => goodDef(ctx, item.goodType)?.id === MEAD_GOOD_ID),
    },
    fighter,
    worker: role === 'worker' || role === 'civilian',
    owned,
    weapon: weaponGood,
    armor: fighter ? armorGood(ctx, ent, slotGood(eq?.armor)) : null,
    boots: slotGood(eq?.boots),
    tool: slotGood(eq?.tool),
    misc,
    stance: mode === undefined ? null : (STANCE_OF_MODE.get(mode) ?? null),
    regenerates: regeneratesInWorld(ent),
    vehicle: null,
  };
}

function vehicleFacts(ctx: UnitPanelModelContext, ent: SnapshotEntity, owned: boolean): MemberFacts {
  const copy = messages().hud.groupPanel;
  const v = (ent.components.Vehicle ?? {}) as Comp;
  const typeId = num(v.vehicleType);
  const type: VehicleType | undefined = ctx.vehicles.find((t) => t.typeId === typeId);
  const vehicleClass = vehicleClassOf(type);
  const title = vehicleTitle(ctx, typeId);
  const plural =
    type === undefined ? title : (copy.vehicleKinds[type.id as keyof GroupCopy['vehicleKinds']] ?? title);
  const stance = (components.VEHICLE_STANCES as readonly string[]).includes(v.stance as string)
    ? (v.stance as components.VehicleStance)
    : 'hold';
  const kind = `vehicle:${typeId ?? ''}`;
  return {
    id: ent.id,
    kind,
    rank: KIND_RANK[vehicleClass],
    order: typeId ?? 0,
    plural,
    icon: { glyph: vehicleClass },
    model: {
      id: ent.id,
      look: 'vehicle',
      kind,
      name: title,
      kindLabel: title,
      healthPct: healthPctOf(ent),
      hungerPct: null,
      carriesMead: false,
    },
    fighter: false,
    worker: false,
    owned,
    weapon: null,
    armor: null,
    boots: null,
    tool: null,
    misc: [],
    stance: null,
    regenerates: false,
    vehicle: {
      siege: vehicleClass === 'siege',
      stance,
      ship:
        vehicleClass === 'ship'
          ? {
              landable:
                v.moored === true && num(v.carrier) === undefined && vehicleSeatsOf(v.passengers).length > 0,
            }
          : null,
    },
  };
}

/** Count goods across members, most common first; a draught sums the sips its bottles have left. */
function gearItems(
  ctx: UnitPanelModelContext,
  entries: readonly { readonly id: number; readonly goodType: number; readonly used?: number | undefined }[],
): GroupGearItem[] {
  const tally = new Map<number, { ids: Set<number>; sips: number }>();
  for (const entry of entries) {
    const row = tally.get(entry.goodType) ?? { ids: new Set<number>(), sips: 0 };
    row.ids.add(entry.id);
    const uses = goodDef(ctx, entry.goodType)?.equip?.uses;
    if (uses !== undefined) row.sips += Math.round((uses * remainingPct(entry.used)) / FULL_PCT);
    tally.set(entry.goodType, row);
  }
  return [...tally]
    .map(([goodType, row]): GroupGearItem => {
      const def = goodDef(ctx, goodType);
      return {
        goodId: def?.id,
        label: goodLabel(ctx, goodType),
        count: row.ids.size,
        ids: [...row.ids],
        sips: def?.equip?.uses === undefined ? null : row.sips,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Which lines the whole group has: every scope shows the same lines, empty or faded where they do not
 *  apply, so a tab switch never moves the panel's sections. */
interface GroupShape {
  readonly fighters: boolean;
  readonly workers: boolean;
  readonly settlers: boolean;
  readonly siege: boolean;
  readonly ships: boolean;
}

function shapeOf(facts: readonly MemberFacts[]): GroupShape {
  return {
    fighters: facts.some((f) => f.fighter),
    workers: facts.some((f) => f.worker),
    settlers: facts.some((f) => f.vehicle === null),
    siege: facts.some((f) => f.vehicle?.siege === true && f.owned),
    ships: facts.length > 0 && facts.every((f) => f.vehicle?.ship != null && f.owned),
  };
}

function gearRows(
  ctx: UnitPanelModelContext,
  facts: readonly MemberFacts[],
  shape: GroupShape,
): GroupGearRow[] {
  const fighters = facts.filter((f) => f.fighter);
  const workers = facts.filter((f) => f.worker);
  const rows: GroupGearRow[] = [];
  const slotRow = (
    gear: GroupGear,
    present: boolean,
    holders: readonly MemberFacts[],
    good: (f: MemberFacts) => number | null,
  ) => {
    if (!present) return;
    const goods = holders.flatMap((f) => {
      const goodType = good(f);
      return goodType === null ? [] : [{ id: f.id, goodType }];
    });
    rows.push({
      gear,
      items: gearItems(ctx, goods),
      bare: holders.filter((f) => good(f) === null).map((f) => f.id),
    });
  };
  slotRow('weapon', shape.fighters, fighters, (f) => f.weapon);
  slotRow('armor', shape.fighters, fighters, (f) => f.armor);
  const settlers = facts.filter((f) => f.vehicle === null);
  slotRow('boots', shape.settlers, settlers, (f) => f.boots);
  slotRow('tool', shape.workers, workers, (f) => f.tool);
  if (shape.settlers) {
    rows.push({
      gear: 'misc',
      items: gearItems(
        ctx,
        settlers.flatMap((f) => f.misc.map((item) => ({ ...item, id: f.id }))),
      ),
      bare: settlers.filter((f) => f.misc.length === 0).map((f) => f.id),
    });
  }
  return rows;
}

/** The one value every entry shares, else null. */
function shared<T>(values: readonly T[]): T | null {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : null;
}

function militaryOf(facts: readonly MemberFacts[], shape: GroupShape): GroupMilitaryModel | null {
  const fighters = facts.filter((f) => f.fighter);
  if (!shape.fighters) return null;
  const stances: Record<GroupStance, number> = { attack: 0, defend: 0, ignore: 0 };
  for (const f of fighters) if (f.stance !== null) stances[f.stance] += 1;
  return {
    count: fighters.length,
    stance: shared(fighters.map((f) => f.stance)),
    stances,
    regeneration: shared(fighters.map((f) => f.regenerates)),
  };
}

function siegeOf(facts: readonly MemberFacts[], shape: GroupShape): GroupSiegeModel | null {
  const siege = facts.filter((f) => f.vehicle?.siege === true && f.owned);
  if (!shape.siege) return null;
  const stances: Record<components.VehicleStance, number> = { attack: 0, defence: 0, hold: 0 };
  for (const f of siege) if (f.vehicle !== null) stances[f.vehicle.stance] += 1;
  return {
    ids: siege.map((f) => f.id),
    stance: shared(siege.map((f) => f.vehicle?.stance ?? null)),
    stances,
  };
}

function fleetOf(facts: readonly MemberFacts[], shape: GroupShape): GroupFleetModel | null {
  if (!shape.ships) return null;
  return {
    ids: facts.map((f) => f.id),
    landable: facts.filter((f) => f.vehicle?.ship?.landable === true).map((f) => f.id),
  };
}

function scopeOf(
  ctx: UnitPanelModelContext,
  key: string,
  label: string,
  facts: readonly MemberFacts[],
  shape: GroupShape,
): GroupScopeModel {
  return {
    key,
    label,
    icon: key === ALL_SCOPE ? { glyph: 'people' } : (facts[0]?.icon ?? { glyph: 'people' }),
    ids: facts.map((f) => f.id),
    gear: gearRows(ctx, facts, shape),
    military: militaryOf(facts, shape),
    siege: siegeOf(facts, shape),
    fleet: fleetOf(facts, shape),
  };
}

function groupTitle(settlers: number, vehicles: number): string {
  const copy = messages().hud.groupPanel;
  const tag = bcp47Tag();
  const parts: string[] = [];
  if (settlers > 0) parts.push(formatMessage(pluralForm(settlers, copy.settlers, tag), { count: settlers }));
  if (vehicles > 0) parts.push(formatMessage(pluralForm(vehicles, copy.vehicles, tag), { count: vehicles }));
  return parts.join(' · ');
}

/**
 * The group panel's model over the selected settlers and vehicles: one read per member, then every scope
 * sums its members, so a rebuild costs the selection's size, never the map's.
 */
export function groupPanelModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  members: readonly SnapshotEntity[],
): GroupPanelModel {
  const seat = ctx.viewer === undefined ? null : pickableSeat(ctx.viewer);
  const needsOn = needsRuleEnabled(snapshot);
  const facts = members
    .flatMap((ent): MemberFacts[] => {
      const owned =
        (seat === null || ownerPlayerOf(ent) === seat) && (!isSettler(ent) || isPlayerControllable(ent));
      if (isSettler(ent)) return [settlerFacts(ctx, snapshot, ent, needsOn, owned)];
      if (isVehicle(ent)) return [vehicleFacts(ctx, ent, owned)];
      return [];
    })
    .sort((a, b) => a.rank - b.rank || a.order - b.order || a.id - b.id);
  const kinds = new Map<string, MemberFacts[]>();
  for (const f of facts) {
    const list = kinds.get(f.kind);
    if (list === undefined) kinds.set(f.kind, [f]);
    else list.push(f);
  }
  const shape = shapeOf(facts);
  const scopes = [scopeOf(ctx, ALL_SCOPE, messages().hud.groupPanel.all, facts, shape)];
  if (kinds.size > 1) {
    for (const [kind, list] of kinds) scopes.push(scopeOf(ctx, kind, list[0]?.plural ?? kind, list, shape));
  }
  const vehicles = facts.filter((f) => f.vehicle !== null).length;
  const [only] = kinds.size === 1 ? kinds.values() : [];
  return {
    kind: 'group',
    title:
      only?.[0] === undefined
        ? groupTitle(facts.length - vehicles, vehicles)
        : formatMessage(messages().hud.groupPanel.oneKind, { kind: only[0].plural, count: only.length }),
    members: facts.map((f) => f.model),
    scopes,
    orders: facts.some((f) => f.owned && f.vehicle === null),
  };
}
