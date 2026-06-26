// Pure, terminal **read views** — derived projections of world state or `content` that the HUD,
// the renderer, and tests consume but **no sim system mutates or feeds back into a decision**. They
// are deliberately kept out of `systems/shared.ts` (the cross-system helper leaf the system files
// import to break import cycles): a read view participates in no cycle — nothing in the per-tick
// `SYSTEM_ORDER` imports one — so grouping them here keeps `shared.ts` to the genuine helpers and
// makes "this is a projection, not a mechanic" legible at the module boundary. Each adds **no**
// behavior (nothing produced/consumed/moved), so they carry "FIDELITY n/a". See docs/TECH-DEBT.md.
//
// Split by concern into five sibling modules (the views grew past one ~300-line file):
//  - ./hud.ts      — the HUD/goods-graph projections over world state + content.
//  - ./combat.ts   — the static weapon-vs-armor damage lookup table.
//  - ./tribes.ts   — the data-defined civ-vs-animal split + `animaltypes.ini` behaviour + `mayAttack`.
//  - ./vehicles.ts — the data-defined ship/boat classification (the Sea/Northland slice's seed).
//  - ./jobs.ts     — the data-defined sea-job (`fisher_sea`/`trader_sea`) classification.
// This barrel re-exports all five so the `systems/` barrel (and tests) keep a single import site.

export {
  type GoodsGraphNode,
  IDLE_JOB,
  goodsGraph,
  tribePopulationByJob,
  tribeStocks,
} from './hud.js';

export {
  type CombatDamageRow,
  type CombatProfile,
  armorByClass,
  armorClassOf,
  combatDamage,
  isRangedWeapon,
  isSiegeWeapon,
  rangedWeapons,
  siegeWeapons,
  weaponClassOf,
  weaponKey,
  weaponsByClass,
  weaponsByJob,
  weaponsForJob,
} from './combat.js';

export {
  type HerdParams,
  type Locomotion,
  HUNTER_JOB,
  MEAT_GOOD,
  angryGameTimeOf,
  animalCannotBeAttacked,
  animalHitpoints,
  animalRecord,
  cadaverYieldOf,
  herdParams,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isProvokableAnimal,
  isPlayableTribe,
  locomotionOf,
  mayAttack,
  mayHunt,
  playableTribes,
} from './tribes.js';

export {
  isShipVehicle,
  largestShipCapacity,
  shipVehicles,
  vehicleCargoGoods,
  vehicleMayCarry,
} from './vehicles.js';

export { isSeaJob, seaJobs } from './jobs.js';
