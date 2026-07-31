/**
 * The sandbox wildlife catalog: `animaltypes.ini` records transcribed verbatim (values from the
 * decoded IR, `Data/logic/animaltypes.ini`) on their REAL tribe ids, so a scene's spawns hit the same
 * species rows the real-content browser run resolves art and behaviour by. Deliberate picks: a
 * provokable solitary heavyweight (bear), a passive leader-following herd (stag), an aggressive pack
 * with a data-pinned walking pace (wolf), and the two hunting-tier species — small game (hare) and
 * last-resort livestock (sheep) — the hunter scenes exercise (`catalog/hunting.ts`).
 */

import {
  ANIMAL_TRIBE_BEARS,
  ANIMAL_TRIBE_HARES,
  ANIMAL_TRIBE_SHEEP,
  ANIMAL_TRIBE_STAGS,
  ANIMAL_TRIBE_WOLVES,
} from '../../../../catalog/animal-tribes.js';

// Re-exported for the sandbox consumers (scenes, the natural-weapon rows) that address the wildlife
// through this catalog; the ids' single owner is `catalog/animal-tribes.ts`.
export {
  ANIMAL_TRIBE_BEARS,
  ANIMAL_TRIBE_HARES,
  ANIMAL_TRIBE_SHEEP,
  ANIMAL_TRIBE_STAGS,
  ANIMAL_TRIBE_WOLVES,
};

/** The wildlife tribe rows (id slugs = the IR `tribes` slugs). No `jobEnables`: an empty tech graph
 *  is what makes a tribe an animal tribe (`isAnimalTribe`). */
export const SANDBOX_ANIMAL_TRIBES: readonly { typeId: number; id: string }[] = [
  { typeId: ANIMAL_TRIBE_BEARS, id: 'bears' },
  { typeId: ANIMAL_TRIBE_STAGS, id: 'stags' },
  { typeId: ANIMAL_TRIBE_HARES, id: 'hares' },
  { typeId: ANIMAL_TRIBE_SHEEP, id: 'sheep' },
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
  readonly catchable?: boolean;
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
      id: 'hare',
      tribeType: ANIMAL_TRIBE_HARES,
      hitpointsAdult: 300,
      hitpointsBaby: 150,
      maximumGroupSize: 4,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 3,
      searchForLeader: true,
      maximumDistanceToStayPoint: 3,
      maximumDistanceToBirthPoint: 10,
      moveSpeed: 6,
      warrantable: true,
    },
    {
      id: 'sheep',
      tribeType: ANIMAL_TRIBE_SHEEP,
      hitpointsAdult: 1000,
      hitpointsBaby: 500,
      maximumGroupSize: 6,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 10,
      searchForLeader: true,
      maximumDistanceToStayPoint: 10,
      maximumDistanceToBirthPoint: 80,
      catchable: true,
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
