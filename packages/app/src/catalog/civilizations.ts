import type { WorldTribes } from '../game/world-tribes.js';
import { VIKING } from './buildings.js';
import { BYZANTINE } from './unit-variants.js';

/** The `TRIBE_TYPE_HUMAN_*` civilizations (`logicdefines.inc`), viking leading as the base. */
export const FRANK = 2;
export const SARACEN = 4;
export const EGYPTIAN = 7;
export const CIVILIZATIONS: WorldTribes = [VIKING, FRANK, BYZANTINE, SARACEN, EGYPTIAN];
