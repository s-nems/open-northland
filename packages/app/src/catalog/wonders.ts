/**
 * The wonders, transcribed from `ir.json`'s `buildings` (kind `wonder`) and `buildingBobs`. Each wonder's
 * `[GfxHouse]` record draws all its stages on one `typeId`, so `levels` counts the distinct size levels
 * its rows draw; `wonder-levels.test.ts` in the real-content suite holds this table to the IR.
 */

/** The `[GfxHouse]` `LogicTribeType` every wonder record is drawn under. */
export const WONDER_TRIBE = 5;

export interface Wonder {
  readonly typeId: number;
  readonly id: string;
  readonly levels: number;
}

export const WONDERS: readonly Wonder[] = [
  { typeId: 47, id: 'wonder_lighthouse_of_alexandria', levels: 3 },
  { typeId: 48, id: 'wonder_gardens_of_semiramis', levels: 3 },
  { typeId: 49, id: 'wonder_rhodos', levels: 4 },
  { typeId: 50, id: 'wonder_mausolos', levels: 2 },
  { typeId: 51, id: 'wonder_artemis_temple', levels: 3 },
  { typeId: 52, id: 'wonder_zeus_statue', levels: 3 },
  { typeId: 53, id: 'wonder_pyramid_of_gizeh', levels: 2 },
  { typeId: 54, id: 'wonder_8th_wonder', levels: 1 },
];
