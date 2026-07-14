/**
 * Mining calibration — the one global source for the mineral-deposit sizes + level counts, so a mined
 * good's unit count and shrink-level count are not re-picked per scene. Every scene that plants a mined
 * good (stone/iron/gold/clay) builds its `gathering` params and its deposits' `MineDeposit`/`Resource`
 * from these constants. Add a new mined good's calibration here, not in the scene. Mirrors
 * {@link import('./felling.js')} for the felling half of the gathering pipeline.
 *
 * The deposit size is observed (source basis "Mineral deposits"): the readable data has no field
 * established to be the harvestable-unit count — `landscapetypes.ini` `maximumValency` is a per-cell
 * valency (constant across a good's stages, e.g. mud_mine = mud_ore = mud = 6), not the count. So these
 * sizes are demonstrative, pending calibration against the original. The level count below is different —
 * it is gfx data, not observed.
 */

/**
 * The units a mineral deposit holds — each chipped off one at a time as an ore pile the collector carries
 * off, the deposit shrinking a visual level as it drains. Observed (no readable unit-count source): a
 * modest count so a scene depletes a deposit within its run while still reading as many units (unlike a
 * fell-once tree). Demonstrative until calibrated against the original.
 */
export const STONE_DEPOSIT_UNITS = 8;
export const CLAY_DEPOSIT_UNITS = 10;
export const IRON_DEPOSIT_UNITS = 8;
export const GOLD_DEPOSIT_UNITS = 6;

/**
 * Work cycles (full authored strikes/digs) a collector lands to chip one unit off a mineral deposit —
 * observed like the deposit sizes: `atomicanimations.ini` pins only the single-swing cycle length
 * (stone 29 / clay 23 ticks), and one swing per unit read as instant. Six strikes ≈ 9–10 s of visible work
 * per unit at the faithful cycle lengths plus the inter-swing rests (sim `HARVEST_REST_TICKS` after every
 * 2nd strike). Sim counter: `MineDeposit.strikesPerUnit`.
 */
export const MINE_STRIKES_PER_UNIT = 6;

/**
 * The discrete visual fill states a mineral deposit steps down through as it empties — data, not observed:
 * the mine's `[GfxLandscape]` record's own state count (`frames.length`/`maxValency`), which the render
 * reads directly (`resource-gfx.ts` `nodeLevelBobs`). It is per-good in the data: the `ls_ground`
 * clay/iron/gold mines carry 5 fill states (`state 5` full → `state 1` dregs), stone's rocks carry 4 (some
 * variants 5), mushroom 1. The sim buckets `remaining/depositSize` into `MINE_LEVELS` uniformly; the render
 * rescales that ladder onto each drawn record's own state count (`resolveResourceDraw` via
 * `DrawItem.levels`), so a 4-state rock and a 5-state mine both draw full when full and dregs at the end —
 * no per-good constant needed here.
 */
export const MINE_LEVELS = 5;
