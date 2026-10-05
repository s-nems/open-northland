/**
 * `Data/logic/animaltypes.ini` records extracted verbatim onto their real tribe ids, so a scene's
 * spawns hit the same species rows a real-content run resolves art and behaviour by.
 */

import {
  ANIMAL_TRIBE_BEARS,
  ANIMAL_TRIBE_CATTLE,
  ANIMAL_TRIBE_DUCKS,
  ANIMAL_TRIBE_HARES,
  ANIMAL_TRIBE_LIONESSES,
  ANIMAL_TRIBE_LIONS,
  ANIMAL_TRIBE_POLAR_BEARS,
  ANIMAL_TRIBE_SHEEP,
  ANIMAL_TRIBE_STAGS,
  ANIMAL_TRIBE_WOLVES,
} from '../../../../catalog/animal-tribes.js';

// Re-exported for convenience; the ids' single owner is `catalog/animal-tribes.ts`.
export {
  ANIMAL_TRIBE_BEARS,
  ANIMAL_TRIBE_CATTLE,
  ANIMAL_TRIBE_DUCKS,
  ANIMAL_TRIBE_HARES,
  ANIMAL_TRIBE_LIONESSES,
  ANIMAL_TRIBE_LIONS,
  ANIMAL_TRIBE_POLAR_BEARS,
  ANIMAL_TRIBE_SHEEP,
  ANIMAL_TRIBE_STAGS,
  ANIMAL_TRIBE_WOLVES,
};

/** The id slugs are the IR `tribes` slugs. Each row needs a matching `[animaltype]` record below,
 *  because carrying one is what makes a tribe wildlife. */
export const SANDBOX_ANIMAL_TRIBES: readonly { typeId: number; id: string }[] = [
  { typeId: ANIMAL_TRIBE_BEARS, id: 'bears' },
  { typeId: ANIMAL_TRIBE_POLAR_BEARS, id: 'evil_hares' },
  { typeId: ANIMAL_TRIBE_CATTLE, id: 'cattle' },
  { typeId: ANIMAL_TRIBE_STAGS, id: 'stags' },
  { typeId: ANIMAL_TRIBE_DUCKS, id: 'ducks' },
  { typeId: ANIMAL_TRIBE_HARES, id: 'hares' },
  { typeId: ANIMAL_TRIBE_SHEEP, id: 'sheep' },
  { typeId: ANIMAL_TRIBE_WOLVES, id: 'wolves' },
  { typeId: ANIMAL_TRIBE_LIONS, id: 'lions' },
  { typeId: ANIMAL_TRIBE_LIONESSES, id: 'lionesses' },
];

/** The schema input shape for one `[animaltype]` record; schema defaults cover the omitted fields. */
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

export function buildSandboxAnimals(): readonly SandboxAnimal[] {
  return [
    {
      id: 'duck',
      tribeType: ANIMAL_TRIBE_DUCKS,
      hitpointsAdult: 100,
      hitpointsBaby: 30,
      maximumGroupSize: 6,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 20,
      searchForLeader: true,
      maximumDistanceToStayPoint: 20,
      maximumDistanceToBirthPoint: 40,
      warrantable: true,
    },
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
      moveSpeed: 8,
    },
    {
      id: 'evil_hare',
      tribeType: ANIMAL_TRIBE_POLAR_BEARS,
      aggressive: true,
      getAngry: true,
      angryGameTime: 240,
      hitpointsAdult: 20000,
      hitpointsBaby: 20000,
      maximumGroupSize: 3,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 20,
      maximumDistanceToStayPoint: 10,
      maximumDistanceToBirthPoint: 30,
      moveSpeed: 8,
    },
    {
      id: 'cattle',
      tribeType: ANIMAL_TRIBE_CATTLE,
      hitpointsAdult: 1000,
      maximumGroupSize: 6,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 20,
      searchForLeader: true,
      maximumDistanceToStayPoint: 20,
      maximumDistanceToBirthPoint: 60,
      catchable: true,
      warrantable: true,
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
    {
      id: 'lion',
      tribeType: ANIMAL_TRIBE_LIONS,
      aggressive: true,
      hitpointsAdult: 10000,
      hitpointsBaby: 5000,
      maximumGroupSize: 6,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 20,
      searchForLeader: true,
      maximumDistanceToStayPoint: 20,
      maximumDistanceToBirthPoint: 40,
      moveSpeed: 8,
      runSpeed: 5,
    },
    {
      id: 'lioness',
      tribeType: ANIMAL_TRIBE_LIONESSES,
      aggressive: true,
      hitpointsAdult: 9000,
      hitpointsBaby: 3500,
      maximumGroupSize: 6,
      maximumCadaverSize: 4,
      maximumLeaderDistance: 20,
      searchForLeader: true,
      maximumDistanceToStayPoint: 20,
      maximumDistanceToBirthPoint: 40,
      moveSpeed: 8,
      runSpeed: 5,
    },
  ];
}
