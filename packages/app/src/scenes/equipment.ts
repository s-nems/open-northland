import type { Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  JOB_COLLECTOR,
  JOB_SOLDIER_SWORD,
  placeSandboxBuilding,
  spawnSandboxSettler,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Three settlers exercising every Ekwipunek slot state: a civilian with worn boots/tool/consumables
 * (mixed use percentages, a permanent amulet, one empty misc slot), a soldier adding the Broń/Zbroja
 * rows plus a spent 100% potion (the widest use badge the slot cell must clear), and a bare settler
 * with no Equipment component.
 */

const { Equipment, Settler } = components;

/** The worn "degree of use" percentages the panel must show (see the details-panel model tests). */
const BOOTS_USE_PCT = 70;
const TOOL_USE_PCT = 40;
const MEAD_USE_PCT = 50;
const FOOD_POTION_USE_PCT = 25;
/** Fully spent - renders the widest "100%" badge, which must not collide with the action buttons. */
const STAMINA_POTION_USE_PCT = 100;

/** A good slug's typeId in the RUNNING content - the sandbox fallback carries the equippables at +100
 *  while real content keeps the `goodtypes.ini` ids, so the scene resolves slugs like every other
 *  spawn path (see `weaponEquipmentFor`) instead of stamping one id space. */
function goodBySlug(sim: Simulation, slug: string): number {
  const good = sim.content.goods.find((g) => g.id === slug);
  if (good === undefined) throw new Error(`equipment scene: content has no '${slug}' good`);
  return good.typeId;
}

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, 9, 12, HUMAN_PLAYER);
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
    hitpoints: 300,
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

/** Every Equipment component's data in the world, in world query order. */
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
  ],
};
