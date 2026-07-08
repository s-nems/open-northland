import { VIKING } from '../catalog/buildings.js';

/** The local human player: blue team, selectable/orderable in every scene and map. */
export const HUMAN_PLAYER = 0;

/** The first hostile test player: red team, never selectable by the local controls. */
export const ENEMY_PLAYER = 1;

/** The primary civilization shown in the current sandbox content. */
export const PRIMARY_TRIBE = VIKING;

/** The tribe whose settlement HUD is shown by the standard in-game HUD. */
export const HUD_TRIBE = PRIMARY_TRIBE;
