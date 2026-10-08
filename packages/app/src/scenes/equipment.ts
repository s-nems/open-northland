import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, type Entity } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Equipment, Settler, Stockpile } = components;

/** Shelf stock the pick menus must list through the headquarters' door: a building's own anchor sits
 *  inside its walk-blocked body, where no goods search reaches. */
const SHELF_STOCK: readonly { slug: string; amount: number }[] = [
  { slug: 'potion_heal_small', amount: 3 },
  { slug: 'amulet_defense', amount: 1 },
];

/** Degree-of-use inputs; the panel shows the remaining condition, `100 -` these. */
const BOOTS_USE_PCT = 70;
const TOOL_USE_PCT = 40;
const MEAD_USE_PCT = 50;
const FOOD_POTION_USE_PCT = 25;
/** Fully spent, so its condition gauge draws empty. */
const STAMINA_POTION_USE_PCT = 100;

/** Kept well clear of the HQ: real content's extracted footprint is larger than the sandbox
 *  approximation, and a pile buried under a building is unreachable to the fetch. */
const YARD_PILES: readonly { slug: string; x: number; y: number; amount: number }[] = [
  { slug: 'sword_shord', x: 4, y: 8, amount: 1 },
  { slug: 'bow_long', x: 5, y: 8, amount: 1 },
  { slug: 'shoes', x: 4, y: 9, amount: 2 },
  { slug: 'tool_wooden', x: 5, y: 9, amount: 1 },
  { slug: 'armor_plate', x: 4, y: 10, amount: 1 },
  { slug: 'mead', x: 5, y: 10, amount: 2 },
];

function build(sim: Simulation): void {
  const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, 9, 12, HUMAN_PLAYER);
  for (const { slug, amount } of SHELF_STOCK) {
    sim.world.mut(hq, Stockpile).amounts.set(goodBySlug(sim, slug), amount);
  }
  for (const pile of YARD_PILES) {
    const node = cellAnchorNode(pile.x, pile.y);
    sim.enqueueSetup({
      kind: 'dropGood',
      good: goodBySlug(sim, pile.slug),
      x: node.hx,
      y: node.hy,
      amount: pile.amount,
    });
  }
  spawnSandboxSettler(sim, JOB_COLLECTOR, 9, 8, HUMAN_PLAYER, {
    equipment: {
      boots: { goodType: goodBySlug(sim, 'shoes'), degreeOfUsePct: BOOTS_USE_PCT },
      tool: { goodType: goodBySlug(sim, 'tool_iron'), degreeOfUsePct: TOOL_USE_PCT },
      misc: [
        { goodType: goodBySlug(sim, 'mead'), degreeOfUsePct: MEAD_USE_PCT },
        { goodType: goodBySlug(sim, 'potion_food_small'), degreeOfUsePct: FOOD_POTION_USE_PCT },
        { goodType: goodBySlug(sim, 'amulet_strength') },
        null,
      ],
    },
  });
  spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, 12, 8, HUMAN_PLAYER, {
    weaponTypeId: WEAPON_SWORD,
    equipment: {
      weapon: { goodType: goodBySlug(sim, 'sword_shord') },
      armor: { goodType: goodBySlug(sim, 'armor_chain') },
      boots: { goodType: goodBySlug(sim, 'shoes'), degreeOfUsePct: BOOTS_USE_PCT },
      misc: [
        { goodType: goodBySlug(sim, 'potion_stamina_small'), degreeOfUsePct: STAMINA_POTION_USE_PCT },
        null,
        null,
        null,
      ],
    },
  });
  spawnSandboxSettler(sim, JOB_COLLECTOR, 15, 8, HUMAN_PLAYER);
}

function equipmentOf(sim: Simulation) {
  return [...sim.world.query(Equipment)].map((e) => sim.world.get(e, Equipment));
}

export const equipmentScene: SceneDefinition = {
  id: 'equipment',
  seed: 7,
  terrain: grassTerrain(24, 16),
  build,
  runTicks: 2,
  checks: [
    {
      label: 'the civilian keeps worn boots, tool and consumables (no weapon slot)',
      predicate: (sim) =>
        equipmentOf(sim).some(
          (eq) =>
            eq.weapon === null &&
            eq.boots?.goodType === goodBySlug(sim, 'shoes') &&
            eq.tool?.goodType === goodBySlug(sim, 'tool_iron') &&
            eq.misc[0]?.goodType === goodBySlug(sim, 'mead') &&
            eq.misc[3] === null,
        ),
    },
    {
      label: 'the soldier keeps a worn sword and chain armour',
      predicate: (sim) =>
        equipmentOf(sim).some(
          (eq) =>
            eq.weapon?.goodType === goodBySlug(sim, 'sword_shord') &&
            eq.armor?.goodType === goodBySlug(sim, 'armor_chain'),
        ),
    },
    {
      label: 'the bare settler carries no Equipment component',
      predicate: (sim) => [...sim.world.query(Settler)].some((e) => !sim.world.has(e, Equipment)),
    },
    {
      label: "the selection menu lists the headquarters' shelf through its door, for every grown man",
      predicate: (sim) => {
        const men = [...sim.world.query(Settler)];
        return SHELF_STOCK.every(({ slug, amount }) =>
          sim
            .equipPicksForSelection(men)
            .some(
              (row) =>
                row.goodType === goodBySlug(sim, slug) &&
                row.available >= amount &&
                row.takers.length === men.length,
            ),
        );
      },
    },
    {
      label: 'the yard piles hold the spare gear the pick menus list',
      predicate: (sim) =>
        YARD_PILES.every((pile) =>
          [...sim.world.query(components.Stockpile)].some(
            (e: Entity) =>
              (sim.world.get(e, components.Stockpile).amounts.get(goodBySlug(sim, pile.slug)) ?? 0) > 0,
          ),
        ),
    },
  ],
};
