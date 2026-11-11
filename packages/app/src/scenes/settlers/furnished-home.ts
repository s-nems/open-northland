import type { HomeQualityUse } from '@open-northland/data';
import type { Entity, Simulation } from '@open-northland/sim';
import { components, fx } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_WOMAN } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { BUILDING_HOME_00, placeBuiltSandboxBuilding, spawnSettlerDirect } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const MAP_W = 22;
const MAP_H = 18;
/** West to east: a well furnished home, a home with its furniture nearly gone, an empty home. */
const FURNISHED = { x: 4, y: 5 } as const;
const WORN = { x: 10, y: 5 } as const;
const SPARE = { x: 16, y: 5 } as const;
/** Where a home's two women stand at the start, south of its door. */
const WOMEN_ROW_BELOW = 9;
const WOMEN_COLUMN_OFFSET = 1;
/** The worn home's furniture lasts this many sleeps above its base. */
const SLEEPS_LEFT = 2;
/** The furnished home's furniture: a full pool, two pieces. */
const FURNISHED_PIECES = 2;
/** The worn home's women want sleep: the bar sits below the drive level and above the notice level. */
const TIRED_PERCENT = 85;
const PERCENT = 100;
/** Tick a home's first family moved in, and the later tick its second did. */
const FIRST_MOVE_IN = 0;
const LATER_MOVE_IN = 1;
/** A crowded home_level_00 holds two families, one above its base. */
const CROWDED_FAMILIES = 2;
const LONE_FAMILY = 1;
const RUN_TICKS = 300;
const INITIAL_ZOOM = 1;

const { Building, HomeQuality, Residence, SettlerNeeds, Stockpile } = components;

function furniture(sim: Simulation): Extract<HomeQualityUse, { readonly effect: 'lodging' }> {
  const ware = sim.content.goods.find((good) => good.homeQuality?.effect === 'lodging')?.homeQuality;
  if (ware?.effect !== 'lodging') throw new Error('furnished-home scene: no furniture in the content');
  return ware;
}

/** The scene's homes, west to east as `build` placed them. */
function homes(sim: Simulation): {
  readonly furnished: Entity;
  readonly worn: Entity;
  readonly spare: Entity;
} {
  const [furnished, worn, spare] = [...sim.world.query(Building)].sort((a, b) => a - b);
  if (furnished === undefined || worn === undefined || spare === undefined)
    throw new Error('furnished-home scene: a home is missing');
  return { furnished, worn, spare };
}

/** The women of a home: the one that moved in first, then the later one. */
function residentsOf(sim: Simulation, home: Entity): readonly Entity[] {
  return [...sim.world.query(Residence)]
    .filter((e) => sim.world.get(e, Residence).home === home)
    .sort((a, b) => sim.world.get(a, Residence).since - sim.world.get(b, Residence).since || a - b);
}

/** Two single women of `home`, each a family of her own: one more than a home_level_00's base. */
function settleTwo(sim: Simulation, home: Entity, at: { readonly x: number; readonly y: number }): Entity[] {
  return [FIRST_MOVE_IN, LATER_MOVE_IN].map((since, i) => {
    const woman = spawnSettlerDirect(
      sim,
      JOB_WOMAN,
      at.x + (i === 0 ? -WOMEN_COLUMN_OFFSET : WOMEN_COLUMN_OFFSET),
      at.y + WOMEN_ROW_BELOW,
    );
    sim.world.add(woman, Residence, { home, since });
    return woman;
  });
}

function build(sim: Simulation): void {
  const ware = furniture(sim);
  const furnished = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, FURNISHED.x, FURNISHED.y);
  const worn = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, WORN.x, WORN.y);
  placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, SPARE.x, SPARE.y);
  sim.world.add(furnished, HomeQuality, {
    cooking: 0,
    lodging: FURNISHED_PIECES * ware.deliveryValue,
    piety: 0,
  });
  sim.world.add(worn, HomeQuality, { cooking: 0, lodging: SLEEPS_LEFT * ware.wear.sleep, piety: 0 });
  // An empty larder, so no meal at home wears the worn home's furniture before the two sleeps do.
  sim.world.mut(worn, Stockpile).amounts.clear();
  settleTwo(sim, furnished, FURNISHED);
  for (const woman of settleTwo(sim, worn, WORN)) {
    sim.world.mut(woman, SettlerNeeds).fatigue = fx.div(fx.fromInt(TIRED_PERCENT), fx.fromInt(PERCENT));
  }
  sim.enqueueSetup({ kind: 'setAssistantFoundFamilies', player: HUMAN_PLAYER, enabled: true });
}

export const furnishedHomeScene: SceneDefinition = {
  id: 'furnished-home',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  needs: true,
  checks: [
    {
      label: 'the well furnished home keeps its second family above its base size',
      predicate: (sim) => residentsOf(sim, homes(sim).furnished).length === CROWDED_FAMILIES,
    },
    {
      label: 'the sleeps of the crowded home wore its furniture out',
      predicate: (sim) => sim.world.get(homes(sim).worn, HomeQuality).lodging === 0,
    },
    {
      label: 'the family that moved in last moved out, the first one stayed',
      predicate: (sim) => {
        const residents = residentsOf(sim, homes(sim).worn);
        const first = residents[0];
        return (
          residents.length === LONE_FAMILY &&
          first !== undefined &&
          sim.world.get(first, Residence).since === FIRST_MOVE_IN
        );
      },
    },
    {
      label: 'the assistant moved the family that moved out into the empty home',
      predicate: (sim) => residentsOf(sim, homes(sim).spare).length === LONE_FAMILY,
    },
  ],
};
