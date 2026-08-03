import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_WOMAN } from '../catalog/jobs.js';
import { placeSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 26;
const MAP_H = 12;

/** The smallest home tier (`logichomesize` 3) with room for the couple plus their newborn. */
const HOME_REF = 'home_level_02';
const HOME = { x: 18, y: 5 } as const;
/** A predicted id: `build` creates settlers 1..4 directly and the enqueued `placeBuilding` adds entity
 *  5 on tick 0, while `assignHouse` must name the home before tick 0 runs. */
const HOME_ENTITY = 5 as Entity;

const WIFE = { x: 14, y: 5 } as const;
const HUSBAND = { x: 15, y: 7 } as const;
/** Far enough apart that the walk-together reads on screen. */
const BRIDE = { x: 3, y: 3 } as const;
const GROOM = { x: 9, y: 3 } as const;
/** Exactly the sim's 3-unit child fund. */
const FOOD_PILE = { x: 11, y: 8, amount: 3 } as const;

/** Walks + 3 food round-trips + the 200-tick hearts phase all finish well inside this. */
const RUN_TICKS = 2500;
const INITIAL_ZOOM = 1.1;

const {
  Age,
  Building,
  ChildOrder,
  Female,
  FoodReserve,
  MakingLove,
  Marriage,
  Residence,
  Settler,
  Stockpile,
} = components;

/** Resolved by slug: real content and the sandbox catalog give `food_simple` different typeIds (16 and
 *  116), so a hardcoded id would silently no-op one of the two. */
function foodGoodType(sim: Simulation): number {
  const good = sim.content.goods.find((g) => g.id === 'food_simple');
  if (good === undefined) throw new Error('family scene: content has no food_simple good');
  return good.typeId;
}

function homeFoodUnits(sim: Simulation): number {
  const stock = sim.world.get(HOME_ENTITY, Stockpile).amounts;
  let total = 0;
  for (const good of sim.content.goods) {
    if (good.id.startsWith('food_')) total += stock.get(good.typeId) ?? 0;
  }
  return total;
}

function build(sim: Simulation): void {
  // Pre-married, so the `makeChild` order below validates on tick 0.
  const wife = spawnSettlerDirect(sim, JOB_WOMAN, WIFE.x, WIFE.y);
  const husband = spawnSettlerDirect(sim, JOB_CIVILIST, HUSBAND.x, HUSBAND.y);
  sim.world.add(wife, Marriage, { spouse: husband, child: null });
  sim.world.add(husband, Marriage, { spouse: wife, child: null });

  const bride = spawnSettlerDirect(sim, JOB_WOMAN, BRIDE.x, BRIDE.y);
  spawnSettlerDirect(sim, JOB_CIVILIST, GROOM.x, GROOM.y);

  placeSandboxBuilding(sim, HOME_REF, HOME.x, HOME.y);
  const pile = cellAnchorNode(FOOD_PILE.x, FOOD_PILE.y);
  sim.enqueue({
    kind: 'dropGood',
    good: foodGoodType(sim),
    x: pile.hx,
    y: pile.hy,
    amount: FOOD_PILE.amount,
  });
  sim.enqueue({ kind: 'marry', entity: bride });
  sim.enqueue({ kind: 'assignHouse', entity: wife, house: HOME_ENTITY });
  sim.enqueue({ kind: 'makeChild', entity: wife, child: 'female' });
}

export const familyScene: SceneDefinition = {
  id: 'family',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the predicted home entity is the placed home (the assignHouse order named the right id)',
      predicate: (sim) =>
        sim.world.has(HOME_ENTITY, Building) &&
        sim.world.tryGet(HOME_ENTITY, Residence) === undefined &&
        sim.world.has(HOME_ENTITY, Stockpile),
    },
    {
      label: 'the marry order wed the single pair - mirrored lifelong Marriages, no lingering wedding',
      predicate: (sim) => {
        const married: Entity[] = [];
        for (const e of sim.world.query(Marriage, Settler)) married.push(e);
        if (married.length !== 4) return false; // both couples (the pre-married one + the wed one)
        for (const e of married) {
          const m = sim.world.get(e, Marriage);
          if (sim.world.get(m.spouse, Marriage).spouse !== e) return false;
        }
        return true;
      },
    },
    {
      label: 'a daughter was born and grew to a child by the end of the run, living in the home',
      predicate: (sim) => {
        for (const e of sim.world.query(Age, Settler)) {
          // She is born around tick 1205, so by tick 2500 she is deterministically past
          // CHILD_AGE_TICKS (960) and short of ADULT_AGE_TICKS (2880).
          if (!systems.isChild(sim.world.get(e, Settler).jobType)) return false;
          if (!sim.world.has(e, Female)) return false;
          return sim.world.tryGet(e, Residence)?.home === HOME_ENTITY;
        }
        return false;
      },
    },
    {
      label: 'the child fund was consumed and the order completed (no reserve, hearts, or order left)',
      predicate: (sim) => {
        if (homeFoodUnits(sim) !== 0) return false;
        if (sim.world.has(HOME_ENTITY, FoodReserve) || sim.world.has(HOME_ENTITY, MakingLove)) return false;
        for (const _e of sim.world.query(ChildOrder)) return false;
        return true;
      },
    },
  ],
};
