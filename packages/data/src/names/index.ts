import type { PersonalNamePool } from '../schema/actors/personal-names.js';
import { BYZANTINE_FEMALE } from './byzantine-female.js';
import { BYZANTINE_MALE } from './byzantine-male.js';
import { EGYPTIAN_FEMALE } from './egyptian-female.js';
import { EGYPTIAN_MALE } from './egyptian-male.js';
import { FRANK_FEMALE } from './frank-female.js';
import { FRANK_MALE } from './frank-male.js';
import { SARACEN_FEMALE } from './saracen-female.js';
import { SARACEN_MALE } from './saracen-male.js';
import { VIKING_FEMALE } from './viking-female.js';
import { VIKING_MALE } from './viking-male.js';
import { WERESNAKE_NEUTRAL } from './weresnake-neutral.js';
import { WEREWOLF_NEUTRAL } from './werewolf-neutral.js';

export const PERSONAL_NAMES: readonly PersonalNamePool[] = [
  { id: 'viking-male', tribe: 1, sex: 'male', names: VIKING_MALE },
  { id: 'viking-female', tribe: 1, sex: 'female', names: VIKING_FEMALE },
  { id: 'frank-male', tribe: 2, sex: 'male', names: FRANK_MALE },
  { id: 'frank-female', tribe: 2, sex: 'female', names: FRANK_FEMALE },
  { id: 'byzantine-male', tribe: 3, sex: 'male', names: BYZANTINE_MALE },
  { id: 'byzantine-female', tribe: 3, sex: 'female', names: BYZANTINE_FEMALE },
  { id: 'saracen-male', tribe: 4, sex: 'male', names: SARACEN_MALE },
  { id: 'saracen-female', tribe: 4, sex: 'female', names: SARACEN_FEMALE },
  { id: 'egyptian-male', tribe: 7, sex: 'male', names: EGYPTIAN_MALE },
  { id: 'egyptian-female', tribe: 7, sex: 'female', names: EGYPTIAN_FEMALE },
  { id: 'weresnake-neutral', tribe: 5, sex: 'neutral', names: WERESNAKE_NEUTRAL },
  { id: 'werewolf-neutral', tribe: 6, sex: 'neutral', names: WEREWOLF_NEUTRAL },
];
