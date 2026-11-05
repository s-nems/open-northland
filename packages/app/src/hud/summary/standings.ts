import type { ContentSet } from '@open-northland/data';
import { hudPeopleOf } from '@open-northland/render';
import {
  countedBy,
  type EntitySnapshot,
  indexesOf,
  type MatchOutcome,
  type SnapshotIndexSpec,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  isFinishedBuilding,
  num,
  ownerPlayerOf,
  settlerJobType,
  settlerTribeOf,
} from '../../game/snapshot/index.js';
import { isMilitaryJob, type SummaryPopulation, summaryPopulation } from './model.js';

/** How a seat stands: decided by the match rules, out of people and buildings, or still playing. */
export type SeatStatus = 'playing' | 'won' | 'defeated' | 'empty';

/** One seat's figures on the spectator's standings strip. */
export interface SeatStanding {
  readonly player: number;
  readonly people: SummaryPopulation;
  /** Finished buildings; sites and houses under an upgrade are left out. */
  readonly buildings: number;
  readonly status: SeatStatus;
}

const FINISHED_BUILDINGS_BY_OWNER = countedBy(
  (e) => (isFinishedBuilding(e) ? ownerPlayerOf(e) : undefined),
  'finished buildings by owner',
  { values: ['Building', 'Owner'], presence: ['UnderConstruction'] },
);

function statusOf(outcome: MatchOutcome, people: SummaryPopulation, buildings: number): SeatStatus {
  if (outcome === 'victory') return 'won';
  if (outcome === 'defeat') return 'defeated';
  return people.total === 0 && buildings === 0 ? 'empty' : 'playing';
}

/** Each of `seats`' standing, in the given order, off the indexes the mirror keeps per change: the
 *  HUD's people tallies and the finished buildings by owner. Costs the seats and their job kinds,
 *  never the entity list. */
export function seatStandings(
  snapshot: WorldSnapshot,
  seats: readonly number[],
  outcomeOf: (player: number) => MatchOutcome,
): SeatStanding[] {
  const buildingsByOwner = indexesOf(snapshot).get(FINISHED_BUILDINGS_BY_OWNER);
  return seats.map((player) => {
    const people = summaryPopulation(hudPeopleOf(snapshot, player));
    const buildings = buildingsByOwner.get(player) ?? 0;
    return { player, people, buildings, status: statusOf(outcomeOf(player), people, buildings) };
  });
}

/** How many soldiers wield or wear a good, or how many units of it they carry. */
export interface GearCount {
  readonly goodId: string;
  readonly count: number;
}

/** A seat's siege vehicles of one type, named by the good whose production yields it; `undefined` when
 *  the content links no good to the type. */
export interface SiegeCount {
  readonly goodId: string | undefined;
  readonly count: number;
}

/** A seat's army as its standing's breakdown lists it. Gear rows run ascending by good type, so a row keeps
 *  its place while the counts move. */
export interface SeatArmy {
  /** The soldiers the standing counts: the men in a soldier or hero job. */
  readonly soldiers: number;
  /** Soldiers by the weapon good they wield; `unarmed` are the rest. */
  readonly weapons: readonly GearCount[];
  readonly unarmed: number;
  /** Soldiers by the armour good they wear; `unarmoured` are the rest. */
  readonly armour: readonly GearCount[];
  readonly unarmoured: number;
  /** Units of each misc-row good the soldiers carry: potions, mead and amulets. */
  readonly carried: readonly GearCount[];
  readonly siege: readonly SiegeCount[];
}

/**
 * One seat's soldiers and vehicles in raw keys, kept per change; {@link seatArmy} names them against the
 * content, so the index knows none. A soldier with no worn weapon or armour good falls back to the combat
 * class stamped on him, as the unit panel reads it: a weapon class is scoped by tribe, an armour class
 * is not.
 */
export interface ArmyTally {
  soldiers: number;
  readonly wornWeapons: Map<number, number>;
  /** Tribe, then weapon class, of the soldiers wielding no worn weapon good. */
  readonly stampedWeapons: Map<number, Map<number, number>>;
  readonly wornArmour: Map<number, number>;
  /** Armour class of the soldiers wearing no armour good. */
  readonly stampedArmour: Map<number, number>;
  /** Units by misc good. */
  readonly carried: Map<number, number>;
  /** Owned vehicles by type. */
  readonly vehicles: Map<number, number>;
}
type ArmyTallies = Map<number, ArmyTally>;

type RawSlot = { goodType?: unknown } | null | undefined;
type RawEquipment = { weapon?: RawSlot; armor?: RawSlot; misc?: unknown } | undefined;

const slotGood = (slot: RawSlot): number | undefined => num(slot?.goodType);

function bump(counts: Map<number, number>, key: number, by: number): void {
  const left = (counts.get(key) ?? 0) + by;
  if (left === 0) counts.delete(key);
  else counts.set(key, left);
}

function vehicleTypeOf(e: EntitySnapshot): number | undefined {
  return num((e.components.Vehicle as { vehicleType?: unknown } | undefined)?.vehicleType);
}

/** The men the standing counts as soldiers: `summaryPopulation`'s military men, so the two agree. */
function isSoldier(e: EntitySnapshot): boolean {
  const job = settlerJobType(e);
  return (
    job !== undefined &&
    isMilitaryJob(job) &&
    e.components.Person !== undefined &&
    e.components.Female === undefined
  );
}

function tallyOf(state: ArmyTallies, owner: number): ArmyTally {
  let tally = state.get(owner);
  if (tally === undefined) {
    tally = {
      soldiers: 0,
      wornWeapons: new Map(),
      stampedWeapons: new Map(),
      wornArmour: new Map(),
      stampedArmour: new Map(),
      carried: new Map(),
      vehicles: new Map(),
    };
    state.set(owner, tally);
  }
  return tally;
}

function countSoldier(tally: ArmyTally, e: EntitySnapshot, by: number): void {
  tally.soldiers += by;
  const eq = e.components.Equipment as RawEquipment;
  const weapon = slotGood(eq?.weapon);
  if (weapon !== undefined) bump(tally.wornWeapons, weapon, by);
  else {
    const stamped = num((e.components.Weapon as { weaponTypeId?: unknown } | undefined)?.weaponTypeId);
    const tribe = settlerTribeOf(e);
    if (stamped !== undefined && tribe !== undefined) {
      const classes = tally.stampedWeapons.get(tribe) ?? new Map<number, number>();
      bump(classes, stamped, by);
      if (classes.size === 0) tally.stampedWeapons.delete(tribe);
      else tally.stampedWeapons.set(tribe, classes);
    }
  }
  const armour = slotGood(eq?.armor);
  if (armour !== undefined) bump(tally.wornArmour, armour, by);
  else {
    const stamped = num((e.components.Armor as { armorClass?: unknown } | undefined)?.armorClass);
    if (stamped !== undefined) bump(tally.stampedArmour, stamped, by);
  }
  if (Array.isArray(eq?.misc)) {
    for (const slot of eq.misc as RawSlot[]) {
      const good = slotGood(slot);
      if (good !== undefined) bump(tally.carried, good, by);
    }
  }
}

function tally(state: ArmyTallies, e: EntitySnapshot, by: number): void {
  const owner = ownerPlayerOf(e);
  if (owner === undefined) return;
  const vehicleType = vehicleTypeOf(e);
  if (vehicleType === undefined && !isSoldier(e)) return;
  const seat = tallyOf(state, owner);
  if (vehicleType !== undefined) bump(seat.vehicles, vehicleType, by);
  else countSoldier(seat, e, by);
  if (seat.soldiers === 0 && seat.vehicles.size === 0) state.delete(owner);
}

/** A change that moves no count: a need bar, a step's wear on the boots, a cart's task. */
function sameTally(a: EntitySnapshot, b: EntitySnapshot): boolean {
  const was = a.components;
  const is = b.components;
  return (
    was.Owner === is.Owner &&
    was.Equipment === is.Equipment &&
    was.Weapon === is.Weapon &&
    was.Armor === is.Armor &&
    (was.Person === undefined) === (is.Person === undefined) &&
    (was.Female === undefined) === (is.Female === undefined) &&
    settlerJobType(a) === settlerJobType(b) &&
    settlerTribeOf(a) === settlerTribeOf(b) &&
    vehicleTypeOf(a) === vehicleTypeOf(b)
  );
}

const ARMY_TALLIES: SnapshotIndexSpec<ArmyTallies> = {
  name: 'observer army',
  reads: {
    values: ['Owner', 'Settler', 'Equipment', 'Weapon', 'Armor', 'Vehicle'],
    presence: ['Person', 'Female'],
  },
  empty: () => new Map(),
  add: (state, e) => tally(state, e, 1),
  remove: (state, e) => tally(state, e, -1),
  replace: (state, previous, next) => {
    if (sameTally(previous, next)) return;
    tally(state, previous, -1);
    tally(state, next, 1);
  },
};

/** Every seat's army in raw keys, off the snapshot's mirror. */
export function armyTalliesOf(snapshot: WorldSnapshot): ReadonlyMap<number, Readonly<ArmyTally>> {
  return indexesOf(snapshot).get(ARMY_TALLIES);
}

/** The content joins {@link seatArmy} names raw keys with, memoized per content. */
interface ArmyContent {
  readonly goodIdOf: ReadonlyMap<number, string>;
  /** Tribe, then weapon class, to the weapon's good; a natural weapon (a fist) has none. */
  readonly weaponGood: ReadonlyMap<number, ReadonlyMap<number, number>>;
  readonly armourGood: ReadonlyMap<number, number>;
  /** Each siege vehicle type to the good whose production yields it (`goods` `vehicleHouse` to the
   *  house's `vehicleType`), or undefined when none does. */
  readonly siegeGood: ReadonlyMap<number, string | undefined>;
}
const armyContentMemo = new WeakMap<ContentSet, ArmyContent>();

function armyContentOf(content: ContentSet): ArmyContent {
  const memo = armyContentMemo.get(content);
  if (memo !== undefined) return memo;
  const weaponGood = new Map<number, Map<number, number>>();
  for (const weapon of content.weapons) {
    if (weapon.tribeType === undefined || weapon.goodType === undefined) continue;
    const classes = weaponGood.get(weapon.tribeType) ?? new Map<number, number>();
    classes.set(weapon.typeId, weapon.goodType);
    weaponGood.set(weapon.tribeType, classes);
  }
  const armourGood = new Map<number, number>();
  for (const armour of content.armor) {
    if (armour.goodType !== undefined) armourGood.set(armour.typeId, armour.goodType);
  }
  const vehicleOfHouse = new Map<number, number>();
  for (const house of content.buildings) {
    if (house.vehicleType !== undefined) vehicleOfHouse.set(house.typeId, house.vehicleType);
  }
  const goodOfVehicle = new Map<number, string>();
  for (const good of content.goods) {
    const vehicle = good.vehicleHouse === undefined ? undefined : vehicleOfHouse.get(good.vehicleHouse);
    if (vehicle !== undefined && !goodOfVehicle.has(vehicle)) goodOfVehicle.set(vehicle, good.id);
  }
  const siegeGood = new Map<number, string | undefined>();
  for (const vehicle of content.vehicles) {
    if (systems.isSiegeVehicle(vehicle)) siegeGood.set(vehicle.typeId, goodOfVehicle.get(vehicle.typeId));
  }
  const made: ArmyContent = {
    goodIdOf: new Map(content.goods.map((good) => [good.typeId, good.id])),
    weaponGood,
    armourGood,
    siegeGood,
  };
  armyContentMemo.set(content, made);
  return made;
}

const NO_ARMY: SeatArmy = {
  soldiers: 0,
  weapons: [],
  unarmed: 0,
  armour: [],
  unarmoured: 0,
  carried: [],
  siege: [],
};

/** The goods among `counts` the content names, ascending by good type, and the count of every good,
 *  named or not, so an unnamed good is never read as a bare soldier. */
function namedRows(
  counts: ReadonlyMap<number, number>,
  names: ReadonlyMap<number, string>,
): { rows: GearCount[]; total: number } {
  let total = 0;
  const rows: GearCount[] = [];
  for (const goodType of [...counts.keys()].sort((a, b) => a - b)) {
    const count = counts.get(goodType) ?? 0;
    total += count;
    const goodId = names.get(goodType);
    if (goodId !== undefined) rows.push({ goodId, count });
  }
  return { rows, total };
}

/**
 * `player`'s army off the per-change tallies, named against `content`: soldiers by weapon and armour
 * good, the misc goods they carry, and the siege vehicles. Costs the seat's distinct gear and vehicle
 * types, never its soldiers; the breakdown asks only while it is open.
 */
export function seatArmy(snapshot: WorldSnapshot, player: number, content: ContentSet): SeatArmy {
  const tally = armyTalliesOf(snapshot).get(player);
  if (tally === undefined) return NO_ARMY;
  const joins = armyContentOf(content);
  const weapons = new Map(tally.wornWeapons);
  for (const [tribe, classes] of tally.stampedWeapons) {
    for (const [weaponClass, count] of classes) {
      const good = joins.weaponGood.get(tribe)?.get(weaponClass);
      if (good !== undefined) bump(weapons, good, count);
    }
  }
  const armour = new Map(tally.wornArmour);
  for (const [armourClass, count] of tally.stampedArmour) {
    const good = joins.armourGood.get(armourClass);
    if (good !== undefined) bump(armour, good, count);
  }
  const armed = namedRows(weapons, joins.goodIdOf);
  const armoured = namedRows(armour, joins.goodIdOf);
  const siege: SiegeCount[] = [];
  for (const vehicleType of [...tally.vehicles.keys()].sort((a, b) => a - b)) {
    if (!joins.siegeGood.has(vehicleType)) continue;
    siege.push({ goodId: joins.siegeGood.get(vehicleType), count: tally.vehicles.get(vehicleType) ?? 0 });
  }
  return {
    soldiers: tally.soldiers,
    weapons: armed.rows,
    unarmed: tally.soldiers - armed.total,
    armour: armoured.rows,
    unarmoured: tally.soldiers - armoured.total,
    carried: namedRows(tally.carried, joins.goodIdOf).rows,
    siege,
  };
}
