/**
 * The sandbox's NON-COMBAT work atomicanimation timing pins — the builder hammer swing, the farmer's
 * three field swings, and the generic store-exchange pair. Each is the logic-timing join key
 * (`atomicDuration`) the sim reads and the render's body clip plays; lengths are TRANSCRIBED from the
 * extracted viking `atomicanimations.ini` records (see the per-constant notes). Combat swing timings
 * live beside the weapons in `./combat.ts`; the building store/recipe caps in `./building-set.ts`.
 */

// The builder's hammer swing length — TRANSCRIBED from the extracted viking `viking_builder_build_house`
// atomicanimation (`length 15`, content/ir.json). Binding it makes each construct swing take 15 ticks
// instead of the 4-tick default, so the builder visibly hammers and the foundation rises over a
// watchable span rather than snapping done. The animation name is the logic-timing join key; the render
// plays the builder's own `human_man_constructionworker_Work_Hammer` body clip (see content/settler-gfx/).
export const BUILD_HOUSE_SWING_LENGTH = 15;
export const BUILD_HOUSE_ANIMATION = 'viking_builder_build_house';
// The farmer's three field-work swings — lengths TRANSCRIBED from the extracted viking atomicanimations
// (`DataCnmd/atomicanimations12/atomicanimations.ini`: harvest_wheat 24, plant 24, cultivate 29). The
// names are the original's own `setatomic 18 29/34/35` bindings; the render plays the farmer's authored
// body clips (`human_man_farmer_work_{reap_grain,sow,water}` — see content/settler-gfx/).
export const FARMER_REAP_ANIMATION = 'viking_farmer_harvest_wheat';
export const FARMER_REAP_LENGTH = 24;
export const FARMER_SOW_ANIMATION = 'viking_farmer_plant';
export const FARMER_SOW_LENGTH = 24;
export const FARMER_WATER_ANIMATION = 'viking_farmer_cultivate';
export const FARMER_WATER_LENGTH = 29;
// The generic store-exchange animations (bound to the catalog's STORE_PICKUP/PILEUP_ATOMIC pair) and
// their duration, TRANSCRIBED from the extracted viking clips: the original binds a per-body-class
// `viking_<class>_pickup`/`_pileup` per job (`tribetypes.ini setatomic <job> 22/23`); the CIVILIST
// pair is `length 20` (`DataCnmd/atomicanimations12/atomicanimations.ini` — other body classes differ,
// e.g. viking_woman_pickup is 30, but every sandbox trade inherits the civilist pair via
// `baseatomics 6`). One shared 20-tick pair serves every sandbox trade; this is also how long a
// settler stays INSIDE a building store on an exchange (the render hides it for the duration).
export const STORE_PICKUP_ANIMATION = 'viking_pickup';
export const STORE_PILEUP_ANIMATION = 'viking_pileup';
export const STORE_EXCHANGE_LENGTH = 20;
