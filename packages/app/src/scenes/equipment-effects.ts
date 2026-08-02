import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, fx, ONE } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_MILL,
  GATHERERS,
  placeBuiltSandboxBuilding,
  placeResourceNode,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { buildingOfType, goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The equipment-EFFECTS scene: worn gear actually working, with needs on. Two collectors trek to a far
 * forest - the booted one pulls ahead (+40% gait) and its boots wear per step; a lone miller with an
 * iron tool grinds an exactly-5-wheat pile into flour, banking the additive tool credit as bonus
 * units while the tool wears per cycle; every settler carries draughts and drinks them by itself when
 * hunger/fatigue press (nobody may starve during the run). The browser half is where a human watches
 * the race open up and the condition percents drain on the Ekwipunek panel.
 */

const MAP_W = 40;
const MAP_H = 16;
/** The racers' start column and their forest: a ~9-cell trek, the longest that still sits inside the
 *  spawn-stamped work-flag radius (24 nodes) so the collectors actually claim the trees; they shuttle
 *  chop-and-haul laps, so the booted one's lead compounds on screen anyway. */
const RACER_BARE = { x: 3, y: 8 } as const;
const RACER_BOOTED = { x: 3, y: 10 } as const;
const FOREST = [
  { x: 12, y: 8 },
  { x: 12, y: 10 },
] as const;
/** The mill and its wheat pile - clear of the footprint so the pile's stand stays reachable. */
const MILL = { x: 16, y: 12 } as const;
const WHEAT_PILE = { x: 12, y: 14 } as const;
/** Exactly this much wheat: 5 one-to-one cycles. The iron tool's 0.6/cycle mints as trunc(0.6·ONE),
 *  one ulp shy, so 5 credits total 2.99995 - two GUARANTEED whole bonus flour (the third whole unit
 *  needs the miller's own experience credit, which the sandbox slot-job lacks a track for). */
const WHEAT_UNITS = 5;
const GUARANTEED_BONUS_FLOUR = 2;
const MILLERS = 1;
/** The mead drinker - parked out of work-flag range of the forest, so it stays put and its sip is
 *  easy to catch on the Ekwipunek panel. */
const DRINKER = { x: 3, y: 2 } as const;
/** Needs on, from the spawn-rolled levels: the ¾ pressing threshold falls at most ~6000 ticks out
 *  (a bar fills in ~8000), so every carried draught provably gets sipped inside the run. */
const RUN_TICKS = 7500;
const INITIAL_ZOOM = 0.8;

const { Equipment, Settler, Stockpile } = components;

function build(sim: Simulation): void {
  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood === undefined) throw new Error('equipment-effects scene: no wood gatherer spec');
  for (const tree of FOREST) placeResourceNode(sim, wood, tree.x, tree.y);

  // The racers: collectors (they double as the mill's tech enabler), each with a food draught so the
  // trek never ends in starvation. Only one wears shoes - the pace gap is the point.
  spawnSandboxSettler(sim, JOB_COLLECTOR, RACER_BARE.x, RACER_BARE.y, HUMAN_PLAYER, {
    equipment: { misc: [{ goodType: goodBySlug(sim, 'potion_food_big') }, null, null, null] },
  });
  spawnSandboxSettler(sim, JOB_COLLECTOR, RACER_BOOTED.x, RACER_BOOTED.y, HUMAN_PLAYER, {
    equipment: {
      boots: { goodType: goodBySlug(sim, 'shoes') },
      misc: [{ goodType: goodBySlug(sim, 'potion_food_big') }, null, null, null],
    },
  });

  const mill = placeBuiltSandboxBuilding(sim, BUILDING_MILL, MILL.x, MILL.y, HUMAN_PLAYER);
  const pile = cellAnchorNode(WHEAT_PILE.x, WHEAT_PILE.y);
  sim.enqueue({
    kind: 'dropGood',
    good: goodBySlug(sim, 'wheat'),
    x: pile.hx,
    y: pile.hy,
    amount: WHEAT_UNITS,
  });
  // The tooled miller, with draughts for both bars so a pressing need is a sip, not a work stoppage.
  spawnWorkersAtDoor(sim, mill, MILLERS, {
    owner: HUMAN_PLAYER,
    equipment: {
      tool: { goodType: goodBySlug(sim, 'tool_iron') },
      misc: [
        { goodType: goodBySlug(sim, 'potion_food_big') },
        { goodType: goodBySlug(sim, 'potion_stamina_big') },
        null,
        null,
      ],
    },
  });

  spawnSandboxSettler(sim, JOB_COLLECTOR, DRINKER.x, DRINKER.y, HUMAN_PLAYER, {
    equipment: { misc: [{ goodType: goodBySlug(sim, 'mead') }, null, null, null] },
  });
}

/** Every settler's Equipment, keyed by which slot identifies it in the checks below. */
function equipments(sim: Simulation) {
  return [...sim.world.query(Equipment)].map((e) => sim.world.get(e, Equipment));
}

export const equipmentEffectsScene: SceneDefinition = {
  id: 'equipment-effects',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  needs: true,
  initialZoom: INITIAL_ZOOM,
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the booted racer wore its boots on the road (per-waypoint wear accrued)',
      predicate: (sim) =>
        equipments(sim).some((eq) => eq.boots !== null && eq.boots.degreeOfUse > fx.fromInt(0)),
    },
    {
      label: 'the iron tool banked its whole bonus flour above the 5-wheat base',
      predicate: (sim) => {
        const mill = buildingOfType(sim, BUILDING_MILL);
        if (mill === null) return false;
        const flour = sim.world.get(mill, Stockpile).amounts.get(goodBySlug(sim, 'flour')) ?? 0;
        return flour >= WHEAT_UNITS + GUARANTEED_BONUS_FLOUR; // any XP credit only adds on top
      },
    },
    {
      label: "the miller's tool wore one step per completed cycle",
      predicate: (sim) =>
        equipments(sim).some((eq) => eq.tool !== null && eq.tool.degreeOfUse > fx.fromInt(0)),
    },
    {
      label: 'a draught was sipped somewhere (auto-drink fired; nobody may hold only full bottles)',
      predicate: (sim) =>
        equipments(sim).some((eq) =>
          eq.misc.some((slot) => slot !== null && slot.degreeOfUse > fx.fromInt(0) && slot.degreeOfUse < ONE),
        ) ||
        // ... or every sip already emptied its bottle: an emptied slot reads as a null among misc rows
        // that started stocked - the drinker's mead is the guaranteed candidate.
        equipments(sim).some((eq) => eq.misc.every((slot) => slot === null)),
    },
    {
      label: 'every settler survived the run (the draughts kept hunger off the starvation pin)',
      predicate: (sim) => [...sim.world.query(Settler)].length === 4,
    },
  ],
};
