import {
  type BuildingType,
  buildingHitpointsFor,
  type ContentSet,
  cadaverStageGoods,
  type GoodQuantity,
  type JobType,
  type ObjectHelp,
  type TribeType,
  type UnitVariant,
  type WeaponType,
} from '@open-northland/data';
import {
  DEFAULT_NODE_ROUGHNESS,
  DEFAULT_WATER_ROUGHNESS,
  systems,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { ANIMAL_PALETTE_BY_TRIBE } from '../../catalog/animal-roster.js';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
import { JOB_CIVILIST, JOB_HEROINE_BOW, JOB_SOLDIER_UNARMED, JOB_WOMAN } from '../../catalog/jobs.js';
import { professionDefForJob } from '../../catalog/professions.js';
import { withUnitVariants } from '../../catalog/unit-variants.js';
import { WEAPON_XP_KEY_BY_TYPE } from '../../catalog/weapon-experience.js';
import { withGoodOverlays, withHeroFistJob, withShelterCapacity } from '../../content/real-content.js';
import { PRIMARY_TRIBE } from '../../game/rules.js';
import { goodName, messages, tribeName } from '../../i18n/index.js';
import type {
  EnabledKind,
  KnowledgeAnimal,
  KnowledgeAnimalWeapon,
  KnowledgeArmor,
  KnowledgeBase,
  KnowledgeBuilding,
  KnowledgeGood,
  KnowledgeJob,
  KnowledgeMeal,
  KnowledgeNamedId,
  KnowledgeRequirement,
  KnowledgeTech,
  KnowledgeTribe,
  KnowledgeVehicle,
  KnowledgeWeapon,
  KnowledgeWorkerName,
} from './model.js';

/** Seconds one sim tick lasts at normal speed. */
export const SECONDS_PER_TICK = 1 / TICKS_PER_SECOND;

/** A building's durability for a tribe; null for a type with no life pool. */
export function buildingHitpoints(building: KnowledgeBuilding, tribe: number): number | null {
  return buildingHitpointsFor(building.row, tribe) ?? null;
}

const PERCENT = 100;
const NON_GOODS: ReadonlySet<string> = new Set(['anything', 'chest']);
const UNLISTED_BUILDINGS: ReadonlySet<string> = new Set(['work_murek']);
/** The ox-less cart is a stage of the ox cart, never a vehicle of its own. */
const UNLISTED_VEHICLES: ReadonlySet<string> = new Set(['cart_no_ox']);
/** A dish is a meal once it leaves the bakery, so a recipe naming the meal shows the dish. */
const DISH_OF_MEAL: ReadonlyMap<string, string> = new Map([
  ['food_simple', 'bread'],
  ['food_extra', 'candy'],
]);
/** Goods no player handles under that name, or that nothing in the game makes. */
const HIDDEN_GOODS: ReadonlySet<string> = new Set([...DISH_OF_MEAL.keys(), 'sausage', 'fruit']);
const BREEDER_JOB_ID = 'breeder';
/** A building shoots it on its own clock, set by who shelters inside, so its row's clip times nothing. */
const SHELTER_WEAPON = 'house_bow';

/** The edible a dish eaten on the candy slot turns into. */
const CANDY_MEAL_GOOD = 'food_extra';

type Names = Readonly<Record<string, string | undefined>>;

function jobNameOf(row: JobType): string {
  const { heroNames, profession, roleNames, hud } = messages();
  const heroes: Names = heroNames;
  const classes: Names = hud.groupPanel.soldierClass;
  const trades: Names = profession;
  const roles: Names = roleNames;
  const roster = professionDefForJob(row.typeId);
  return (
    heroes[row.id] ??
    classes[row.id] ??
    (roster === undefined ? undefined : profession[roster.key]) ??
    trades[row.id] ??
    roles[row.id] ??
    row.name ??
    row.id
  );
}

function buildingNameOf(row: BuildingType): string {
  const names: Names = messages().building;
  return names[row.id] ?? row.id;
}

/** The lookups every builder below shares: names by type id and the meal-to-dish fold. */
interface Joins {
  readonly content: ContentSet;
  readonly help: ObjectHelp | null;
  /** The tribe whose requirement and technology rows the reference shows. */
  readonly reference: TribeType | undefined;
  readonly typeOfGood: ReadonlyMap<string, number>;
  readonly shownType: (typeId: number) => number;
  readonly shownQuantities: (rows: readonly GoodQuantity[]) => GoodQuantity[];
  readonly goodNameOf: (typeId: number) => string;
  readonly jobNameByType: (typeId: number) => string;
  readonly houseNameByType: (typeId: number) => string;
}

function createJoins(content: ContentSet, help: ObjectHelp | null): Joins {
  const goodRows = new Map(content.goods.map((g) => [g.typeId, g]));
  const typeOfGood = new Map(content.goods.map((g) => [g.id, g.typeId]));
  const jobRows = new Map(content.jobs.map((j) => [j.typeId, j]));
  const houseRows = new Map(content.buildings.map((b) => [b.typeId, b]));
  const shownType = (typeId: number): number => {
    const row = goodRows.get(typeId);
    const dish = row === undefined ? undefined : DISH_OF_MEAL.get(row.id);
    return dish === undefined ? typeId : (typeOfGood.get(dish) ?? typeId);
  };
  const named = <T>(row: T | undefined, typeId: number, name: (row: T) => string): string =>
    row === undefined ? `#${typeId}` : name(row);
  return {
    content,
    help,
    reference: content.tribes.find((t) => t.typeId === PRIMARY_TRIBE),
    typeOfGood,
    shownType,
    shownQuantities: (rows) => rows.map((row) => ({ goodType: shownType(row.goodType), amount: row.amount })),
    goodNameOf: (typeId) => named(goodRows.get(shownType(typeId)), typeId, (row) => goodName(row)),
    jobNameByType: (typeId) => named(jobRows.get(typeId), typeId, jobNameOf),
    houseNameByType: (typeId) => named(houseRows.get(typeId), typeId, buildingNameOf),
  };
}

/** What a meal on `atomicId` is worth, off the clip the common settler plays for it. */
function mealOfAtomic({ content, reference }: Joins, atomicId: number): KnowledgeMeal | null {
  const clip = reference?.atomicBindings.find(
    (b) => b.jobType === JOB_CIVILIST && b.atomicId === atomicId,
  )?.animation;
  if (clip === undefined) return null;
  const percentOf = (channel: number): number =>
    (systems.atomicEventChannelDelta(content, clip, channel) * PERCENT) / systems.NEED_RESERVE_UNITS;
  const hungerPct = percentOf(systems.ATOMIC_EVENT_CHANNEL.HUNGER);
  return {
    hungerPct,
    homeHungerPct: hungerPct * systems.AT_HOME_FACTOR,
    leisurePct: percentOf(systems.ATOMIC_EVENT_CHANNEL.LEISURE),
  };
}

/** Reads one animal's slaughter off the reference tribe's breeder clip, the data the sim lands it from. */
function slaughterYielder({ content, reference }: Joins): (goodType: number) => readonly GoodQuantity[] {
  const breeder = content.jobs.find((j) => j.id === BREEDER_JOB_ID);
  if (breeder === undefined || reference === undefined) return () => [];
  const settler = { tribe: reference.typeId, jobType: breeder.typeId };
  return (goodType) =>
    [...systems.slayYield({ content }, settler, goodType)].map(([good, amount]) => ({
      goodType: good,
      amount,
    }));
}

function buildGoods(joins: Joins): KnowledgeGood[] {
  const { content, help, shownQuantities } = joins;
  const madeByRecipe = new Set(
    content.buildings.flatMap((b) => b.recipes.flatMap((r) => r.outputs.map((o) => o.goodType))),
  );
  const plainMeal = mealOfAtomic(joins, systems.EAT_ATOMIC_ID);
  const candyMeal = mealOfAtomic(joins, systems.EAT_CANDY_ATOMIC_ID);
  const slaughterYield = slaughterYielder(joins);
  return content.goods
    .filter((g) => !NON_GOODS.has(g.id) && !HIDDEN_GOODS.has(g.id))
    .map(withGoodOverlays)
    .map((g) => {
      const edibleForm = systems.EDIBLE_FORM_BY_DISH.get(g.id) ?? null;
      return {
        typeId: g.typeId,
        id: g.id,
        name: goodName(g),
        help: help?.goods[g.typeId] ?? null,
        producedOnMap: g.classification.producedOnMap,
        gathering: g.gathering ?? null,
        farming: g.farming ?? null,
        homeQuality: g.homeQuality ?? null,
        vehicleHouse: g.vehicleHouse ?? null,
        slaughterInputs: madeByRecipe.has(g.typeId) ? [] : shownQuantities(g.productionInputs),
        animalTribe: systems.livestockTribeOfGood(content, g.typeId),
        slaughterYield: slaughterYield(g.typeId),
        edibleForm,
        equip: g.equip ?? null,
        meal: edibleForm === null ? null : edibleForm === CANDY_MEAL_GOOD ? candyMeal : plainMeal,
      };
    });
}

function buildBuildings(joins: Joins): KnowledgeBuilding[] {
  const { content, help, reference, shownType, shownQuantities, goodNameOf, jobNameByType } = joins;
  const techRows = new Map((reference?.technology?.houses ?? []).map((row) => [row.house, row]));
  const techOf = (house: number): KnowledgeTech | null => {
    const row = techRows.get(house);
    return row === undefined
      ? null
      : {
          jobs: row.jobs.map((id) => ({ id, name: jobNameByType(id) })),
          goods: row.goods.map((id) => ({ id: shownType(id), name: goodNameOf(id) })),
        };
  };
  return content.buildings
    .filter((b) => !UNLISTED_BUILDINGS.has(b.id))
    .map(withShelterCapacity)
    .map((b) => ({
      typeId: b.typeId,
      id: b.id,
      name: buildingNameOf(b),
      kind: b.kind,
      row: b,
      help: help?.houses[b.typeId] ?? null,
      homeSize: b.homeSize,
      schoolSize: b.schoolSize ?? 0,
      shelterCapacity: b.shelterCapacity,
      hitpoints: b.hitpoints ?? null,
      upgradeTarget: b.upgradeTarget ?? null,
      workers: b.workers.map((w) => ({
        jobType: w.jobType,
        name: jobNameByType(w.jobType),
        count: w.count,
      })),
      cost: shownQuantities(b.construction),
      produces: b.produces.map(shownType),
      recipes: b.recipes.map((r) => ({
        inputs: shownQuantities(r.inputs),
        outputs: shownQuantities(r.outputs),
        madeGood: r.outputs[0]?.goodType ?? null,
        fallbackTicks: r.ticks,
      })),
      stock: b.stock.map((s) => ({ goodType: s.goodType, capacity: s.capacity })),
      tech: techOf(b.typeId),
    }));
}

/** The name an experience requirement shows; the fight buckets have no track row, and a school course's
 *  marker names nothing, so it has no name. */
function experienceNamer(content: ContentSet): (typeId: number) => string | undefined {
  const tracks = new Map(content.jobExperience.map((track) => [track.typeId, track]));
  const labels: Names = messages().hud.trackLabels;
  const trades: Names = messages().knowledge.entry.experience;
  const fights = messages().hud.weaponXp;
  return (typeId) => {
    const fightKey = WEAPON_XP_KEY_BY_TYPE.get(typeId);
    if (fightKey !== undefined) return fights[fightKey];
    const track = tracks.get(typeId);
    return track === undefined ? undefined : (labels[track.id] ?? trades[track.id]);
  };
}

interface Requirements {
  readonly job: Map<number, KnowledgeRequirement[]>;
  readonly good: Map<number, KnowledgeRequirement[]>;
}

function buildRequirements({ content, reference }: Joins): Requirements {
  const experienceName = experienceNamer(content);
  const trackJob = new Map(content.jobExperience.map((track) => [track.typeId, track.jobType]));
  const rows: Requirements = { job: new Map(), good: new Map() };
  for (const r of reference?.jobRequirements ?? []) {
    const table = rows[r.target];
    const held = table.get(r.targetId) ?? [];
    table.set(r.targetId, held);
    held.push({
      route: r.requirement,
      amount: r.amount,
      experience: r.experienceTypes.flatMap((id) => experienceName(id) ?? []),
      fromJobs: [...new Set(r.experienceTypes.flatMap((id) => trackJob.get(id) ?? []))],
    });
  }
  return rows;
}

interface TechEdges {
  readonly enables: Map<number, Map<EnabledKind, KnowledgeNamedId[]>>;
  /** The trades a good is gathered by, off the tribe's good rows. */
  readonly gatheredBy: Map<number, KnowledgeWorkerName[]>;
}

function buildTechEdges(joins: Joins): TechEdges {
  const { reference, shownType, goodNameOf, houseNameByType, jobNameByType } = joins;
  const edges: TechEdges = { enables: new Map(), gatheredBy: new Map() };
  const named = (kind: EnabledKind, targetId: number): KnowledgeNamedId => {
    if (kind === 'good') return { id: shownType(targetId), name: goodNameOf(targetId) };
    return { id: targetId, name: kind === 'house' ? houseNameByType(targetId) : jobNameByType(targetId) };
  };
  for (const { kind, jobType, targetId } of reference?.jobEnables ?? []) {
    if (kind === 'vehicle') continue;
    const byKind = edges.enables.get(jobType) ?? new Map<EnabledKind, KnowledgeNamedId[]>();
    edges.enables.set(jobType, byKind);
    byKind.set(kind, [...(byKind.get(kind) ?? []), named(kind, targetId)]);
    if (kind === 'good') {
      const gatherers = edges.gatheredBy.get(targetId) ?? [];
      edges.gatheredBy.set(targetId, gatherers);
      gatherers.push({ jobType, name: jobNameByType(jobType) });
    }
  }
  return edges;
}

function buildJobs(joins: Joins, requirements: Requirements, edges: TechEdges): KnowledgeJob[] {
  const permitted = joins.reference?.permissions?.job;
  return joins.content.jobs
    .filter(
      (j) =>
        j.typeId >= JOB_WOMAN &&
        j.typeId <= JOB_HEROINE_BOW &&
        (permitted === undefined || permitted.includes(j.typeId)),
    )
    .map((j) => ({
      typeId: j.typeId,
      id: j.id,
      name: jobNameOf(j),
      baseJob: j.baseJob ?? null,
      needsReligion: j.needsReligion ?? false,
      // The school refuses fighter trades, whatever their `train` rows say.
      requirements: (requirements.job.get(j.typeId) ?? []).filter(
        (r) => r.route === 'need' || j.typeId < JOB_SOLDIER_UNARMED,
      ),
      enables: Object.fromEntries(edges.enables.get(j.typeId) ?? []),
    }));
}

/** The form a player's soldier of this class takes; a native form belongs to the map's placed units. */
function trainedForm(tribe: TribeType, jobType: number | undefined): UnitVariant | undefined {
  return tribe.unitVariants?.find((variant) => variant.jobType === jobType && variant.form === 'human');
}

function weaponRow(
  joins: Joins,
  tribe: TribeType,
  w: WeaponType,
  form: UnitVariant | undefined,
): KnowledgeWeapon {
  const { content, shownType, goodNameOf, jobNameByType } = joins;
  const clipJob = form?.animationJobType ?? w.jobType;
  const clipName = tribe.atomicBindings.find(
    (b) => b.jobType === clipJob && b.atomicId === ATTACK_ATOMIC,
  )?.animation;
  const clip = content.atomicAnimations.find((a) => a.name === clipName);
  const blows = (clip?.events ?? []).filter((e) => e.type === systems.ATOMIC_EVENT_TYPE_ATTACK).length;
  const permitted = tribe.permissions?.job;
  return {
    typeId: w.typeId,
    id: w.id,
    jobType: w.jobType ?? null,
    filmJob: form?.graphicsJobType ?? w.jobType ?? null,
    jobName: w.jobType === undefined ? null : jobNameByType(w.jobType),
    goodType: w.goodType === undefined ? null : shownType(w.goodType),
    goodName: w.goodType === undefined ? null : goodNameOf(w.goodType),
    mainType: w.mainType ?? null,
    weight: w.weight,
    minRange: w.minRange,
    maxRange: w.maxRange,
    damage: w.damage,
    clipTicks: w.id === SHELTER_WEAPON ? null : (clip?.length ?? null),
    blows: Math.max(1, blows),
    usable: w.jobType === undefined || permitted === undefined || permitted.includes(w.jobType),
  };
}

function buildWeapons(
  joins: Joins,
  tribes: readonly TribeType[],
): ReadonlyMap<number, readonly KnowledgeWeapon[]> {
  const rows = joins.content.weapons.map(withHeroFistJob);
  return new Map(
    tribes.map((tribe) => [
      tribe.typeId,
      rows
        .filter((w) => w.tribeType === tribe.typeId)
        .map((w) => {
          const form = trainedForm(withUnitVariants(tribe, joins.content.weapons), w.jobType);
          const fought = form?.weapon;
          const row =
            fought === undefined
              ? w
              : rows.find((r) => r.tribeType === fought.tribeType && r.typeId === fought.typeId);
          return weaponRow(joins, tribe, { ...(row ?? w), jobType: w.jobType }, form);
        }),
    ]),
  );
}

function tribeRow(tribe: TribeType): KnowledgeTribe {
  return { typeId: tribe.typeId, name: tribeName(tribe.typeId, tribe.name ?? tribe.id) };
}

function armorRows({ content, goodNameOf }: Joins): KnowledgeArmor[] {
  return content.armor.map((a) => ({
    typeId: a.typeId,
    goodType: a.goodType ?? null,
    name: a.goodType === undefined ? a.id : goodNameOf(a.goodType),
    material: a.materialType ?? null,
    weight: a.weight,
    blockingValue: a.blockingValue,
  }));
}

function vehicleRows({ content, typeOfGood, goodNameOf, jobNameByType }: Joins): KnowledgeVehicle[] {
  return content.vehicles
    .filter((v) => !UNLISTED_VEHICLES.has(v.id))
    .map((v) => {
      const good = typeOfGood.get(v.id);
      const ship = systems.isShipVehicle(v);
      const siege = systems.isSiegeVehicle(v);
      return {
        id: v.id,
        name: good === undefined ? (v.name ?? v.id) : goodNameOf(good),
        vehicleClass: ship ? 'ship' : siege ? 'siege' : 'cart',
        jobType: v.jobId,
        stockSlots: v.stockSlots,
        passengerSlots: v.passengerSlots,
        hitpoints: v.hitpoints,
        commander: v.commanderJob === undefined ? null : jobNameByType(v.commanderJob),
        commanderJob: v.commanderJob ?? null,
        moveTicks: systems.vehicleMovePeriod(ship ? DEFAULT_WATER_ROUGHNESS : DEFAULT_NODE_ROUGHNESS, siege),
      };
    });
}

/** An animal's own attack, off the weapon rows its tribe owns; a peaceful animal has none. */
function animalWeapon(content: ContentSet, tribe: number): KnowledgeAnimalWeapon | null {
  const weapon = content.weapons.find((w) => w.tribeType === tribe);
  return weapon === undefined
    ? null
    : { damage: weapon.damage, minRange: weapon.minRange, maxRange: weapon.maxRange };
}

/** The goods `size` plucks of a carcass yield, walking the cycle the sim's hunter harvests. */
function carcassYield(cycle: readonly number[], size: number): GoodQuantity[] {
  const amounts = new Map<number, number>();
  for (let pluck = 0; pluck < size && cycle.length > 0; pluck++) {
    const goodType = cycle[pluck % cycle.length];
    if (goodType !== undefined) amounts.set(goodType, (amounts.get(goodType) ?? 0) + 1);
  }
  return [...amounts].map(([goodType, amount]) => ({ goodType, amount }));
}

function harvestCycle(content: ContentSet): readonly number[] {
  const harvestable = new Set(
    content.goods.filter((g) => g.atomics.harvest !== undefined).map((g) => g.typeId),
  );
  const goods = cadaverStageGoods(content.landscape);
  const end = goods.findIndex((good) => !harvestable.has(good));
  return end === -1 ? goods : goods.slice(0, end);
}

function animalRows({ content }: Joins): KnowledgeAnimal[] {
  const cycle = harvestCycle(content);
  const tribes = new Map(content.tribes.map((t) => [t.typeId, t]));
  // A species with no body look draws nothing, and neither a map, a script nor a chest places one.
  const species = new Map(
    content.animals
      .filter((a) => a.hitpointsAdult > 0 && ANIMAL_PALETTE_BY_TRIBE.has(a.tribeType))
      .map((a) => [a.tribeType, a]),
  );
  return [...species.values()].map((a) => {
    const weapon = animalWeapon(content, a.tribeType);
    const tribe = tribes.get(a.tribeType);
    return {
      tribe: a.tribeType,
      name: tribeName(a.tribeType, tribe?.name ?? tribe?.id ?? a.id),
      hitpoints: a.hitpointsAdult,
      hitpointsYoung: a.hitpointsBaby,
      // An animal with no weapon row never swings, whatever its flag says.
      aggressive: a.aggressive && weapon !== null,
      getAngry: a.getAngry,
      angryTicks: a.angryGameTime,
      catchable: a.catchable,
      huntable: a.warrantable && !a.aggressive && a.hitpointsAdult < systems.HUNT_PREY_SCORE_CEILING,
      moveSpeed: a.moveSpeed,
      runSpeed: a.runSpeed,
      groupSize: a.maximumGroupSize,
      leash: a.maximumDistanceToStayPoint,
      weapon,
      carcass: carcassYield(cycle, a.maximumCadaverSize),
    };
  });
}

/** The goods by type, each meal's type answering with its dish. */
function goodsByType(
  goods: readonly KnowledgeGood[],
  typeOfGood: ReadonlyMap<string, number>,
): ReadonlyMap<number, KnowledgeGood> {
  const byType = new Map(goods.map((g) => [g.typeId, g]));
  for (const [meal, dish] of DISH_OF_MEAL) {
    const type = typeOfGood.get(meal);
    const shown = goods.find((g) => g.id === dish);
    if (type !== undefined && shown !== undefined) byType.set(type, shown);
  }
  return byType;
}

/**
 * The typed, localized reference over `content`, decoded or merged alike: the app's clean-room overlays
 * apply to each row. Names are read once, so a language change needs a new base.
 */
export function createKnowledgeBase(content: ContentSet, help: ObjectHelp | null = null): KnowledgeBase {
  const joins = createJoins(content, help);
  const goods = buildGoods(joins);
  const buildings = buildBuildings(joins);
  const requirements = buildRequirements(joins);
  const edges = buildTechEdges(joins);
  const jobs = buildJobs(joins, requirements, edges);
  const playable = systems.playableTribes(content);
  return {
    content,
    tribes: playable.map(tribeRow),
    goods,
    buildings,
    jobs,
    weapons: buildWeapons(joins, playable),
    armor: armorRows(joins),
    vehicles: vehicleRows(joins),
    animals: animalRows(joins),
    goodRequirements: requirements.good,
    gatheredBy: edges.gatheredBy,
    goodById: new Map(goods.map((g) => [g.id, g])),
    goodByType: goodsByType(goods, joins.typeOfGood),
    buildingById: new Map(buildings.map((b) => [b.id, b])),
    buildingByType: new Map(buildings.map((b) => [b.typeId, b])),
    jobById: new Map(jobs.map((j) => [j.id, j])),
    jobByType: new Map(jobs.map((j) => [j.typeId, j])),
  };
}
