import type { Simulation } from '@vinland/sim';
import { components } from '@vinland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  GOOD_AMULET_STRENGTH,
  GOOD_ARMOR_CHAIN,
  GOOD_MEAD,
  GOOD_POTION_FOOD_SMALL,
  GOOD_POTION_STAMINA_SMALL,
  GOOD_SHOES,
  GOOD_SWORD_SHORT,
  GOOD_TOOL_IRON,
  JOB_GATHERER_WOOD,
  JOB_SOLDIER_SWORD,
  WEAPON_SWORD,
  placeSandboxBuilding,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import { countComponent } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The equipment-slots scene: a few settlers wearing (and not wearing) equipment so the selection panel's
 * equipment strip can be inspected. The scene defines only placement + the worn loadouts; slots, icons,
 * the "degree of use" percent and the empty-slot rendering are the details-panel's job.
 *
 * Fidelity: the equipment CATEGORIES and the wear split are source-pinned (goodtypes.ini ids 30–55 +
 * tribetypes.ini `allowequip` + the manual); the misc-slot COUNT (4) and the demo "degree of use" values
 * are named approximations — no consumption drive runs here, so the percents are stamped, not earned.
 */

const MAP_W = 24;
const MAP_H = 16;
const INITIAL_ZOOM = 1.4;
// No mechanic advances over time here — the equipment is stamped at spawn — so one settled tick suffices.
const RUN_TICKS = 2;

const CIVILIAN = { x: 9, y: 8 };
const SOLDIER = { x: 12, y: 8 };
const UNEQUIPPED = { x: 15, y: 8 };
const SOLDIER_HP = 300;

// Demo "degree of use" percents (0..100). Wearing goods only — permanent gear (amulet/weapon/armour)
// shows no percent regardless.
const MEAD_USE = 50;
const TOOL_USE = 40;
const POTION_FOOD_USE = 25;
const BOOTS_USE = 70;
const POTION_STAMINA_USE = 60;

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, 9, 12, HUMAN_PLAYER);

  // A civilian wearing boots, an iron tool and consumables (mead + a nourishing potion + a strength
  // amulet), one misc slot left empty. Mead/potion/tool wear (carry a percent); the amulet does not.
  spawnSandboxSettler(sim, JOB_GATHERER_WOOD, CIVILIAN.x, CIVILIAN.y, HUMAN_PLAYER, {
    equipment: {
      boots: { goodType: GOOD_SHOES, degreeOfUsePct: BOOTS_USE },
      tool: { goodType: GOOD_TOOL_IRON, degreeOfUsePct: TOOL_USE },
      misc: [
        { goodType: GOOD_MEAD, degreeOfUsePct: MEAD_USE },
        { goodType: GOOD_POTION_FOOD_SMALL, degreeOfUsePct: POTION_FOOD_USE },
        { goodType: GOOD_AMULET_STRENGTH },
        null,
      ],
    },
  });

  // A soldier additionally carries weapon + armour slots. The combat `weaponTypeId` (its fighting body)
  // is independent of the equipment `weapon` slot (its display) — the equip drive that unifies them is
  // deferred, so the scene sets both.
  spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, SOLDIER.x, SOLDIER.y, HUMAN_PLAYER, {
    hitpoints: SOLDIER_HP,
    weaponTypeId: WEAPON_SWORD,
    equipment: {
      weapon: { goodType: GOOD_SWORD_SHORT },
      armor: { goodType: GOOD_ARMOR_CHAIN },
      boots: { goodType: GOOD_SHOES, degreeOfUsePct: BOOTS_USE },
      misc: [{ goodType: GOOD_POTION_STAMINA_SMALL, degreeOfUsePct: POTION_STAMINA_USE }, null, null, null],
    },
  });

  // A plain civilian with NO equipment — the panel must still show its empty boots/tool/misc slots.
  spawnSandboxSettler(sim, JOB_GATHERER_WOOD, UNEQUIPPED.x, UNEQUIPPED.y, HUMAN_PLAYER);
}

const { Equipment } = components;

/** True when the civilian's loadout is present: boots = shoes, no weapon slot, and a worn consumable. */
function civilianEquipped(sim: Simulation): boolean {
  for (const e of sim.world.query(Equipment)) {
    const eq = sim.world.get(e, Equipment);
    if (
      eq.boots?.goodType === GOOD_SHOES &&
      eq.weapon === null &&
      eq.misc.some((m) => m !== null && m.degreeOfUse > 0)
    ) {
      return true;
    }
  }
  return false;
}

/** True when a settler carries filled weapon + armour equipment slots (the soldier's loadout). */
function soldierEquipped(sim: Simulation): boolean {
  for (const e of sim.world.query(Equipment)) {
    const eq = sim.world.get(e, Equipment);
    if (eq.weapon?.goodType === GOOD_SWORD_SHORT && eq.armor?.goodType === GOOD_ARMOR_CHAIN) return true;
  }
  return false;
}

export const equipmentScene: SceneDefinition = {
  id: 'equipment',
  title: 'Sloty ekwipunku',
  summary:
    'Kilku osadnikow z ekwipunkiem (i jeden bez): buty, narzedzie, cztery sloty na przedmioty, a u zolnierza ' +
    'dodatkowo bron i pancerz. Zaznacz jednostke, aby zobaczyc pasek ekwipunku z ikonami i procentem zuzycia.',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    'Zaznacz osadnika z ekwipunkiem — pod danymi widac pasek slotow: buty, narzedzie i cztery sloty "misc"',
    'Zajete sloty pokazuja ikone przedmiotu (buty/narzedzie/miod maja ikone; mikstury/amulety jej nie maja)',
    'Przedmioty zuzywalne (miod, mikstura, buty, narzedzie) maja badge z procentem zuzycia; bron/pancerz/amulet nie',
    'Zaznacz zolnierza — oprocz powyzszych widac takze slot na bron i slot na pancerz',
    'Zaznacz osadnika bez ekwipunku — sloty butow/narzedzia/misc sa puste',
  ],
  checks: [
    {
      label: 'exactly the two equipped settlers carry an Equipment component',
      predicate: (sim) => countComponent(sim, Equipment) === 2,
    },
    {
      label: 'the civilian wears boots and a worn consumable, and has no weapon slot',
      predicate: civilianEquipped,
    },
    {
      label: 'the soldier carries filled weapon and armour equipment slots',
      predicate: soldierEquipped,
    },
  ],
};
