import type {
  BuildingType,
  ContentSet,
  EquipClass,
  GoodFarming,
  GoodGathering,
  GoodQuantity,
  HomeQuality,
  JobEnablesKind,
  WeaponType,
} from '@open-northland/data';

/** The tech edges a reference entry lists; a vehicle edge opens no entry of its own. */
export type EnabledKind = Exclude<JobEnablesKind, 'vehicle'>;

export type EntryKind = 'animal' | 'building' | 'good' | 'job' | 'tribe' | 'vehicle';

/** One entry of the reference. An animal's and a tribe's `id` are the decimal tribe id. */
export interface EntryRef {
  readonly kind: EntryKind;
  readonly id: string;
}

/** What one meal is worth, in percent of a bar. */
export interface KnowledgeMeal {
  readonly hungerPct: number;
  readonly homeHungerPct: number;
  readonly leisurePct: number;
}

export interface KnowledgeGood {
  readonly typeId: number;
  readonly id: string;
  readonly name: string;
  readonly help: string | null;
  readonly producedOnMap: boolean;
  readonly gathering: GoodGathering | null;
  readonly farming: GoodFarming | null;
  readonly homeQuality: HomeQuality | null;
  readonly vehicleHouse: number | null;
  /** What the farm's slaughter takes for a good no recipe makes. */
  readonly slaughterInputs: readonly GoodQuantity[];
  /** The animal tribe a livestock good breeds and walks as. */
  readonly animalTribe: number | null;
  /** What one slaughter of this animal lands in the farm; empty for anything but livestock. */
  readonly slaughterYield: readonly GoodQuantity[];
  /** The edible's good id a dish becomes when it leaves its producer. */
  readonly edibleForm: string | null;
  readonly equip: EquipClass | null;
  readonly meal: KnowledgeMeal | null;
}

export interface KnowledgeWorkerName {
  readonly jobType: number;
  readonly name: string;
}

export interface KnowledgeWorkerSlot extends KnowledgeWorkerName {
  readonly count: number;
}

export interface KnowledgeNamedId {
  readonly id: number;
  readonly name: string;
}

export interface KnowledgeTech {
  readonly jobs: readonly KnowledgeNamedId[];
  readonly goods: readonly KnowledgeNamedId[];
}

export interface KnowledgeRecipe {
  readonly inputs: readonly GoodQuantity[];
  readonly outputs: readonly GoodQuantity[];
  /** The good the batch's produce clip is bound to, before a meal folds into its dish. */
  readonly madeGood: number | null;
  /** The batch's length when no produce clip times it. */
  readonly fallbackTicks: number;
}

export interface KnowledgeBuilding {
  readonly typeId: number;
  readonly id: string;
  readonly name: string;
  readonly kind: BuildingType['kind'];
  readonly row: BuildingType;
  readonly help: string | null;
  readonly homeSize: number;
  readonly schoolSize: number;
  readonly shelterCapacity: number;
  readonly hitpoints: number | null;
  readonly upgradeTarget: number | null;
  readonly workers: readonly KnowledgeWorkerSlot[];
  readonly cost: readonly GoodQuantity[];
  readonly produces: readonly number[];
  readonly recipes: readonly KnowledgeRecipe[];
  /** The house's shelves as decoded: a hidden good keeps its row, so `stock[0]` stays the larder. */
  readonly stock: readonly { readonly goodType: number; readonly capacity: number }[];
  /** The discoveries the reference tribe's house waits for; null when it stands open from the start. */
  readonly tech: KnowledgeTech | null;
}

export interface KnowledgeRequirement {
  readonly route: 'need' | 'train';
  readonly amount: number;
  readonly experience: readonly string[];
  /** The jobs whose practice counts toward this requirement. */
  readonly fromJobs: readonly number[];
}

export interface KnowledgeJob {
  readonly typeId: number;
  readonly id: string;
  readonly name: string;
  readonly baseJob: number | null;
  readonly needsReligion: boolean;
  readonly requirements: readonly KnowledgeRequirement[];
  readonly enables: Readonly<Partial<Record<EnabledKind, readonly KnowledgeNamedId[]>>>;
}

export interface KnowledgeWeapon {
  readonly typeId: number;
  readonly id: string;
  readonly jobType: number | null;
  /** The job whose body draws the row: a trained form can borrow another class's look. */
  readonly filmJob: number | null;
  readonly jobName: string | null;
  readonly goodType: number | null;
  readonly goodName: string | null;
  readonly mainType: number | null;
  readonly weight: number;
  readonly minRange: number;
  readonly maxRange: number;
  readonly damage: WeaponType['damage'];
  /** One attack clip's length; null where the tribe binds no clip to the row's job. */
  readonly clipTicks: number | null;
  /** Blows one clip lands. */
  readonly blows: number;
  /** Whether the tribe's permissions admit the row's job: no tribe fields the saber and axe trades. */
  readonly usable: boolean;
}

export interface KnowledgeArmor {
  readonly typeId: number;
  readonly goodType: number | null;
  readonly name: string;
  readonly material: number | null;
  readonly weight: number;
  readonly blockingValue: number;
}

export type KnowledgeVehicleClass = 'cart' | 'ship' | 'siege';

export interface KnowledgeVehicle {
  readonly id: string;
  readonly name: string;
  readonly vehicleClass: KnowledgeVehicleClass;
  /** The job the tribe's weapon rows key this vehicle's own shot on. */
  readonly jobType: number;
  readonly stockSlots: number;
  readonly passengerSlots: number;
  readonly hitpoints: number;
  readonly commander: string | null;
  readonly commanderJob: number | null;
  /** Ticks to cross one map point on its usual ground, unladen. */
  readonly moveTicks: number;
}

export interface KnowledgeAnimalWeapon {
  readonly damage: WeaponType['damage'];
  readonly minRange: number;
  readonly maxRange: number;
}

export interface KnowledgeAnimal {
  readonly tribe: number;
  readonly name: string;
  readonly hitpoints: number;
  readonly hitpointsYoung: number;
  readonly aggressive: boolean;
  readonly getAngry: boolean;
  readonly angryTicks: number;
  readonly catchable: boolean;
  readonly huntable: boolean;
  readonly moveSpeed: number;
  readonly runSpeed: number;
  readonly groupSize: number;
  readonly leash: number;
  readonly weapon: KnowledgeAnimalWeapon | null;
  /** What a hunter's kill lays, in pluck order: `maximumCadaverSize` plucks across the cadaver stages. */
  readonly carcass: readonly GoodQuantity[];
}

export interface KnowledgeTribe {
  readonly typeId: number;
  readonly name: string;
}

export interface KnowledgeBase {
  /** The content this reference reads, for an article fact no row above carries. */
  readonly content: ContentSet;
  readonly tribes: readonly KnowledgeTribe[];
  readonly goods: readonly KnowledgeGood[];
  readonly buildings: readonly KnowledgeBuilding[];
  readonly jobs: readonly KnowledgeJob[];
  readonly weapons: ReadonlyMap<number, readonly KnowledgeWeapon[]>;
  readonly armor: readonly KnowledgeArmor[];
  readonly vehicles: readonly KnowledgeVehicle[];
  readonly animals: readonly KnowledgeAnimal[];
  readonly goodRequirements: ReadonlyMap<number, readonly KnowledgeRequirement[]>;
  readonly gatheredBy: ReadonlyMap<number, readonly KnowledgeWorkerName[]>;
  readonly goodById: ReadonlyMap<string, KnowledgeGood>;
  /** Also answers a meal's type id with its dish. */
  readonly goodByType: ReadonlyMap<number, KnowledgeGood>;
  readonly buildingById: ReadonlyMap<string, KnowledgeBuilding>;
  readonly buildingByType: ReadonlyMap<number, KnowledgeBuilding>;
  readonly jobById: ReadonlyMap<string, KnowledgeJob>;
  readonly jobByType: ReadonlyMap<number, KnowledgeJob>;
}
