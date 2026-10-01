import type { VehicleType } from '@open-northland/data';
import { components, type NeedKind, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_AXE_BIG,
  JOB_SOLDIER_AXE_SMALL,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SABER_LONG,
  JOB_SOLDIER_SABER_SHORT,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from '../../../catalog/jobs.js';
import { professionDefForJob } from '../../../catalog/professions.js';
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
  settlerExperienceOf,
  settlerJobType,
  settlerTribeOf,
  stanceModeOf,
  vehicleSeatsOf,
} from '../../../game/snapshot.js';
import { pickableSeat } from '../../../game/viewer-seat.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { type BarTone, barTone, NEED_LOW_BELOW_PCT, pctRatio, remainingPct } from './bars.js';
import { type Comp, goodDef, goodLabel, jobDisplayName, type UnitPanelModelContext } from './context.js';
import { satisfactionBars } from './settler.js';
import { type SettlerRole, settlerRole } from './settler-household.js';
import { settlerDisplayName } from './settler-name.js';
import { vehicleClassOf, vehicleTitle } from './vehicle.js';

type GroupCopy = ReturnType<typeof messages>['hud']['groupPanel'];

export type GroupStance = 'attack' | 'defend' | 'ignore';
export type GroupGear = 'weapon' | 'armor' | 'tool' | 'misc';
export type GroupDetail = keyof GroupCopy['detailRows'];

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
  readonly tone: BarTone;
}

/** One good worn or carried across the scope, with how many hold it; `sips` counts a draught's uses left. */
export interface GroupGearItem {
  readonly goodId: string | undefined;
  readonly label: string;
  readonly count: number;
  readonly sips: number | null;
}

/** One gear line: the goods the scope's members wear in that slot, and how many of those the slot is
 *  for hold nothing in it. */
export interface GroupGearRow {
  readonly gear: GroupGear;
  readonly items: readonly GroupGearItem[];
  readonly bare: number;
}

/** A need's average satisfaction over the members that carry it. */
export interface GroupNeedModel {
  readonly need: NeedKind;
  readonly label: string;
  readonly pct: number;
}

/** The scope's fighters, soldiers and heroes: their shared stance and regeneration rule, null when they
 *  differ, and how many hold each. */
export interface GroupMilitaryModel {
  readonly count: number;
  readonly stance: GroupStance | null;
  readonly stances: Readonly<Record<GroupStance, number>>;
  readonly regeneration: boolean | null;
}

/** The scope's siege vehicles and their shared stance, null when they differ. */
export interface GroupSiegeModel {
  readonly ids: readonly number[];
  readonly stance: components.VehicleStance | null;
  readonly stances: Readonly<Record<components.VehicleStance, number>>;
}

/** One line of the folded details: a count of members in some state, which a press selects, or a value
 *  without members to select. */
export interface GroupDetailRow {
  readonly detail: GroupDetail;
  readonly value: string;
  readonly ids: readonly number[] | null;
}

/** What one tab shows and orders: the whole group, or the members of one kind. */
export interface GroupScopeModel {
  readonly key: string;
  readonly label: string;
  readonly ids: readonly number[];
  readonly health: { readonly pct: number; readonly wounded: number } | null;
  readonly needs: readonly GroupNeedModel[];
  readonly gear: readonly GroupGearRow[];
  readonly crew: { readonly filled: number; readonly capacity: number } | null;
  readonly military: GroupMilitaryModel | null;
  readonly siege: GroupSiegeModel | null;
  readonly details: readonly GroupDetailRow[];
}

/** Several units selected at once: settlers, vehicles or both (FOUNDATION.md, "Group panel"). */
export interface GroupPanelModel {
  readonly kind: 'group';
  readonly title: string;
  readonly members: readonly GroupMemberModel[];
  /** The whole group first, then one scope per kind when there are several kinds. */
  readonly scopes: readonly GroupScopeModel[];
  /** Whether the viewer orders any member: the medallion, the need lines and the stance strips. */
  readonly orders: boolean;
}

export const ALL_SCOPE = 'all';

const FULL_PCT = 100;

const STANCE_OF_MODE: ReadonlyMap<number, GroupStance> = new Map([
  [systems.MILITARY_MODE.ATTACK, 'attack'],
  [systems.MILITARY_MODE.DEFEND, 'defend'],
  [systems.MILITARY_MODE.IGNORE, 'ignore'],
]);

/** Each soldier class's name, by its `jobtypes.ini` id: the profession list names every class "Soldier". */
const SOLDIER_CLASS: ReadonlyMap<number, keyof GroupCopy['soldierClasses']> = new Map([
  [JOB_SOLDIER_UNARMED, 'soldier_unarmed'],
  [JOB_SOLDIER_SPEAR_WOODEN, 'soldier_spear_wooden'],
  [JOB_SOLDIER_SPEAR, 'soldier_spear_iron'],
  [JOB_SOLDIER_SWORD, 'soldier_sword_short'],
  [JOB_SOLDIER_BROADSWORD, 'soldier_sword_long'],
  [JOB_SOLDIER_SABER_SHORT, 'soldier_saber_short'],
  [JOB_SOLDIER_SABER_LONG, 'soldier_saber_long'],
  [JOB_SOLDIER_AXE_SMALL, 'soldier_axe_small'],
  [JOB_SOLDIER_AXE_BIG, 'soldier_axe_big'],
  [JOB_ARCHER, 'soldier_bow_short'],
  [JOB_ARCHER_LONG, 'soldier_bow_long'],
]);

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
  readonly model: GroupMemberModel;
  readonly fighter: boolean;
  readonly worker: boolean;
  readonly owned: boolean;
  readonly needs: readonly { readonly need: NeedKind; readonly label: string; readonly pct: number }[];
  readonly weapon: number | null;
  readonly armor: number | null;
  readonly tool: number | null;
  readonly misc: readonly { readonly goodType: number; readonly used: number | undefined }[];
  readonly healing: boolean;
  readonly stance: GroupStance | null;
  readonly regenerates: boolean;
  readonly fightBonusPct: number | null;
  readonly aboard: boolean;
  readonly vehicle: {
    readonly siege: boolean;
    readonly stance: components.VehicleStance;
    readonly filled: number;
    readonly capacity: number;
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
  const soldierClass = jobType === undefined ? undefined : SOLDIER_CLASS.get(jobType);
  const profession = professionDefForJob(jobType)?.key;
  let kind: string;
  let plural: string;
  let singular: string;
  switch (role) {
    case 'soldier':
      kind = `job:${jobType ?? ''}`;
      plural = soldierClass === undefined ? jobDisplayName(ctx, jobType) : copy.soldierClasses[soldierClass];
      singular = soldierClass === undefined ? jobDisplayName(ctx, jobType) : copy.soldierClass[soldierClass];
      break;
    case 'worker':
      kind = `job:${jobType ?? ''}`;
      plural = profession === undefined ? jobDisplayName(ctx, jobType) : copy.professions[profession];
      singular = jobDisplayName(ctx, jobType);
      break;
    default:
      kind = `role:${role}`;
      plural = copy.roles[role];
      singular = role === 'hero' ? jobDisplayName(ctx, jobType) : copy.role[role];
  }
  const healthPct = healthPctOf(ent);
  const needs = satisfactionBars(ent, needsOn, role !== 'hero').flatMap((bar) =>
    bar.need === undefined ? [] : [{ need: bar.need, label: bar.label, pct: bar.pct }],
  );
  const eq = ent.components.Equipment as RawEquipment | undefined;
  const wornWeapon = slotGood(eq?.weapon);
  const weapon = fighter ? weaponRow(ctx, ent, wornWeapon) : undefined;
  const misc = (Array.isArray(eq?.misc) ? (eq.misc as (RawSlot | null)[]) : []).flatMap((slot) => {
    const goodType = slotGood(slot);
    return goodType === null ? [] : [{ goodType, used: num(slot?.degreeOfUse) }];
  });
  const fightTrack =
    weapon?.mainType === undefined ? undefined : systems.fightExperienceTypeFor(weapon.mainType);
  const fightXp = fightTrack === undefined ? undefined : settlerExperienceOf(ent.components).get(fightTrack);
  const rider = ent.components.Rider !== undefined && ent.components.Position === undefined;
  const mode = stanceModeOf(ent);
  return {
    id: ent.id,
    kind,
    rank: KIND_RANK[role],
    order: jobType ?? 0,
    plural,
    model: {
      id: ent.id,
      look: 'settler',
      kind,
      name: settlerDisplayName(ctx, snapshot, ent),
      kindLabel: singular,
      healthPct,
      tone: healthPct === null ? 'ok' : barTone(healthPct),
    },
    fighter,
    worker: role === 'worker' || role === 'civilian',
    owned,
    needs,
    weapon: fighter ? (wornWeapon ?? (weapon?.goodType || null)) : null,
    armor: fighter ? armorGood(ctx, ent, slotGood(eq?.armor)) : null,
    tool: slotGood(eq?.tool),
    misc,
    healing: misc.some((item) => (goodDef(ctx, item.goodType)?.equip?.restorePct?.healthMax ?? 0) > 0),
    stance: mode === undefined ? null : (STANCE_OF_MODE.get(mode) ?? null),
    regenerates: regeneratesInWorld(ent),
    fightBonusPct:
      fighter && fightTrack !== undefined
        ? systems.withFightExperience(FULL_PCT, fightXp ?? 0) - FULL_PCT
        : null,
    aboard: rider,
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
  const healthPct = healthPctOf(ent);
  const stance = (components.VEHICLE_STANCES as readonly string[]).includes(v.stance as string)
    ? (v.stance as components.VehicleStance)
    : 'hold';
  const capacity = Array.isArray(v.passengers) ? v.passengers.length : 0;
  const kind = `vehicle:${typeId ?? ''}`;
  return {
    id: ent.id,
    kind,
    rank: KIND_RANK[vehicleClass],
    order: typeId ?? 0,
    plural,
    model: {
      id: ent.id,
      look: 'vehicle',
      kind,
      name: title,
      kindLabel: title,
      healthPct,
      tone: healthPct === null ? 'ok' : barTone(healthPct),
    },
    fighter: false,
    worker: false,
    owned,
    needs: [],
    weapon: null,
    armor: null,
    tool: null,
    misc: [],
    healing: false,
    stance: null,
    regenerates: false,
    fightBonusPct: null,
    aboard: false,
    vehicle: {
      siege: vehicleClass === 'siege',
      stance,
      filled: vehicleSeatsOf(v.passengers).length,
      capacity,
    },
  };
}

/** Count goods across members, most common first; a draught sums the sips its bottles have left. */
function gearItems(
  ctx: UnitPanelModelContext,
  entries: readonly { readonly goodType: number; readonly used?: number | undefined }[],
): GroupGearItem[] {
  const tally = new Map<number, { count: number; sips: number }>();
  for (const entry of entries) {
    const row = tally.get(entry.goodType) ?? { count: 0, sips: 0 };
    row.count += 1;
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
        count: row.count,
        sips: def?.equip?.uses === undefined ? null : row.sips,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function gearRows(ctx: UnitPanelModelContext, facts: readonly MemberFacts[]): GroupGearRow[] {
  const fighters = facts.filter((f) => f.fighter);
  const workers = facts.filter((f) => f.worker);
  const rows: GroupGearRow[] = [];
  const slotRow = (
    gear: GroupGear,
    holders: readonly MemberFacts[],
    good: (f: MemberFacts) => number | null,
  ) => {
    if (holders.length === 0) return;
    const goods = holders.flatMap((f) => {
      const goodType = good(f);
      return goodType === null ? [] : [{ goodType }];
    });
    rows.push({ gear, items: gearItems(ctx, goods), bare: holders.length - goods.length });
  };
  slotRow('weapon', fighters, (f) => f.weapon);
  slotRow('armor', fighters, (f) => f.armor);
  slotRow('tool', workers, (f) => f.tool);
  const bag = facts.filter((f) => f.vehicle === null);
  if (bag.length > 0) {
    const carried = bag.flatMap((f) => f.misc);
    rows.push({
      gear: 'misc',
      items: gearItems(ctx, carried),
      bare: bag.filter((f) => f.misc.length === 0).length,
    });
  }
  return rows;
}

function needAverages(facts: readonly MemberFacts[]): GroupNeedModel[] {
  const sums = new Map<NeedKind, { label: string; total: number; count: number }>();
  for (const f of facts) {
    for (const bar of f.needs) {
      const sum = sums.get(bar.need) ?? { label: bar.label, total: 0, count: 0 };
      sum.total += bar.pct;
      sum.count += 1;
      sums.set(bar.need, sum);
    }
  }
  return [...sums].map(([need, sum]) => ({ need, label: sum.label, pct: Math.round(sum.total / sum.count) }));
}

/** The one value every entry shares, else null. */
function shared<T>(values: readonly T[]): T | null {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : null;
}

function militaryOf(facts: readonly MemberFacts[]): GroupMilitaryModel | null {
  const fighters = facts.filter((f) => f.fighter);
  if (fighters.length === 0) return null;
  const stances: Record<GroupStance, number> = { attack: 0, defend: 0, ignore: 0 };
  for (const f of fighters) if (f.stance !== null) stances[f.stance] += 1;
  return {
    count: fighters.length,
    stance: shared(fighters.map((f) => f.stance)),
    stances,
    regeneration: shared(fighters.map((f) => f.regenerates)),
  };
}

function siegeOf(facts: readonly MemberFacts[]): GroupSiegeModel | null {
  const siege = facts.filter((f) => f.vehicle?.siege === true && f.owned);
  if (siege.length === 0) return null;
  const stances: Record<components.VehicleStance, number> = { attack: 0, defence: 0, hold: 0 };
  for (const f of siege) if (f.vehicle !== null) stances[f.vehicle.stance] += 1;
  return {
    ids: siege.map((f) => f.id),
    stance: shared(siege.map((f) => f.vehicle?.stance ?? null)),
    stances,
  };
}

function detailRows(ctx: UnitPanelModelContext, facts: readonly MemberFacts[]): GroupDetailRow[] {
  const copy = messages().hud.groupPanel;
  const rows: GroupDetailRow[] = [];
  const count = (detail: GroupDetail, test: (f: MemberFacts) => boolean): void => {
    const ids = facts.filter(test).map((f) => f.id);
    if (ids.length > 0) rows.push({ detail, value: String(ids.length), ids });
  };
  const settler = (f: MemberFacts): boolean => f.vehicle === null;
  const health = (f: MemberFacts): number => f.model.healthPct ?? FULL_PCT;
  const need = (f: MemberFacts, kind: NeedKind): number =>
    f.needs.find((n) => n.need === kind)?.pct ?? FULL_PCT;
  count('wounded', (f) => settler(f) && barTone(health(f)) !== 'ok');
  count('critical', (f) => settler(f) && barTone(health(f)) === 'critical');
  count('hungry', (f) => need(f, 'hunger') < NEED_LOW_BELOW_PCT);
  count('tired', (f) => need(f, 'fatigue') < NEED_LOW_BELOW_PCT);
  count('unarmored', (f) => f.fighter && f.armor === null);
  count('noHealing', (f) => f.fighter && !f.healing);
  count('aboard', (f) => f.aboard);
  count('damaged', (f) => !settler(f) && health(f) < FULL_PCT);
  const bonuses = facts.flatMap((f) => (f.fightBonusPct === null ? [] : [f.fightBonusPct]));
  if (bonuses.length > 0) {
    const avg = Math.round(bonuses.reduce((sum, b) => sum + b, 0) / bonuses.length);
    rows.push({
      detail: 'experience',
      value: formatMessage(copy.experienceValue, { avg, max: Math.max(...bonuses) }),
      ids: null,
    });
  }
  const healing = facts.flatMap((f) =>
    f.misc.filter((item) => (goodDef(ctx, item.goodType)?.equip?.restorePct?.healthMax ?? 0) > 0),
  );
  const sips = gearItems(ctx, healing).reduce((sum, item) => sum + (item.sips ?? 0), 0);
  if (sips > 0) rows.push({ detail: 'healingSips', value: String(sips), ids: null });
  return rows;
}

function scopeOf(
  ctx: UnitPanelModelContext,
  key: string,
  label: string,
  facts: readonly MemberFacts[],
): GroupScopeModel {
  const healths = facts.flatMap((f) => (f.model.healthPct === null ? [] : [f.model.healthPct]));
  const vehicles = facts.flatMap((f) => (f.vehicle === null ? [] : [f.vehicle]));
  return {
    key,
    label,
    ids: facts.map((f) => f.id),
    health:
      healths.length === 0
        ? null
        : {
            pct: Math.round(healths.reduce((sum, h) => sum + h, 0) / healths.length),
            wounded: healths.filter((h) => barTone(h) !== 'ok').length,
          },
    needs: needAverages(facts),
    gear: gearRows(ctx, facts),
    crew:
      vehicles.length === 0
        ? null
        : {
            filled: vehicles.reduce((sum, v) => sum + v.filled, 0),
            capacity: vehicles.reduce((sum, v) => sum + v.capacity, 0),
          },
    military: militaryOf(facts),
    siege: siegeOf(facts),
    details: detailRows(ctx, facts),
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
  const scopes = [scopeOf(ctx, ALL_SCOPE, messages().hud.groupPanel.all, facts)];
  if (kinds.size > 1) {
    for (const [kind, list] of kinds) scopes.push(scopeOf(ctx, kind, list[0]?.plural ?? kind, list));
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
