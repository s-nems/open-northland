/**
 * The sandbox wildlife catalog: three `animaltypes.ini` records transcribed verbatim (values from the
 * decoded IR, `Data/logic/animaltypes.ini`) on their REAL tribe ids, so a scene's spawns hit the same
 * species rows the real-content browser run resolves art and behaviour by. Three deliberate picks: a
 * provokable solitary heavyweight (bear), a passive leader-following herd (stag), and an aggressive
 * pack with a data-pinned walking pace (wolf).
 */

/** The real `TRIBE_TYPE_ANIMAL_*` ids of the transcribed species (= IR `tribes.typeId`). */
export const ANIMAL_TRIBE_BEARS = 8;
export const ANIMAL_TRIBE_STAGS = 11;
export const ANIMAL_TRIBE_WOLVES = 20;

/** The wildlife tribe rows (id slugs = the IR `tribes` slugs). No `jobEnables`: an empty tech graph
 *  is what makes a tribe an animal tribe (`isAnimalTribe`). */
export const SANDBOX_ANIMAL_TRIBES: readonly { typeId: number; id: string }[] = [
  { typeId: ANIMAL_TRIBE_BEARS, id: 'bears' },
  { typeId: ANIMAL_TRIBE_STAGS, id: 'stags' },
  { typeId: ANIMAL_TRIBE_WOLVES, id: 'wolves' },
];

/** One transcribed `[animaltype]` record (the schema input shape; defaults cover omitted fields). */
export interface SandboxAnimal {
  readonly id: string;
  readonly tribeType: number;
  readonly aggressive?: boolean;
  readonly getAngry?: boolean;
  readonly angryGameTime?: number;
  readonly hitpointsAdult: number;
  readonly hitpointsBaby?: number;
  readonly maximumGroupSize: number;
  readonly maximumCadaverSize?: number;
  readonly maximumLeaderDistance?: number;
  readonly searchForLeader?: boolean;
  readonly maximumDistanceToStayPoint?: number;
  readonly maximumDistanceToBirthPoint?: number;
  readonly moveSpeed?: number;
  readonly runSpeed?: number;
  readonly warrantable?: boolean;
}

/** The transcribed `[animaltype]` records (schema defaults cover the omitted false/0 fields). */
export function buildSandboxAnimals(): readonly SandboxAnimal[] {
  return [
    {
      id: 'bear',
      tribeType: ANIMAL_TRIBE_BEARS,
      getAngry: true,
      angryGameTime: 240,
      hitpointsAdult: 15000,
      hitpointsBaby: 15000,
      maximumGroupSize: 3,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 20,
      maximumDistanceToStayPoint: 20,
      maximumDistanceToBirthPoint: 40,
    },
    {
      id: 'stag',
      tribeType: ANIMAL_TRIBE_STAGS,
      hitpointsAdult: 1000,
      hitpointsBaby: 500,
      maximumGroupSize: 6,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 10,
      searchForLeader: true,
      maximumDistanceToStayPoint: 10,
      maximumDistanceToBirthPoint: 40,
      warrantable: true,
    },
    {
      id: 'wolf',
      tribeType: ANIMAL_TRIBE_WOLVES,
      aggressive: true,
      hitpointsAdult: 1000,
      hitpointsBaby: 500,
      maximumGroupSize: 6,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 10,
      searchForLeader: true,
      maximumDistanceToStayPoint: 20,
      maximumDistanceToBirthPoint: 40,
      moveSpeed: 7,
      runSpeed: 5,
    },
  ];
}
