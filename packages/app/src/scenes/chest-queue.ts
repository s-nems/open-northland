import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR } from '../catalog/jobs.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Shift-queued chests: one collector stands below a row of four wooden food chests. Setup orders it to
 * the first and Shift-queues the second, as Shift + right click does, so it opens the two one after the
 * other and stops. The last two stay closed for the player: select the collector, Shift + right click
 * both, and it walks to each in the clicked order, opening one before setting out for the next.
 */

const MAP_W = 30;
const MAP_H = 12;
const ROW_Y = 4;
const OPENER = { x: 4, y: 8 } as const;
const FIRST_CHEST_X = 4;
/** Tile gap between the chests, so each one's stance cell is its own. */
const CHEST_GAP = 6;
const CHEST_COUNT = 4;
/** The chests setup orders; the rest are left for the player's Shift clicks. */
const ORDERED_CHESTS = 2;
/** The wooden food chest (`chesttypes` row 20). */
const FOOD_CHEST = 20;
/** Long enough for both ordered walks and their open-chest clips. */
const RUN_TICKS = 500;
const INITIAL_ZOOM = 1.2;

const { Chest, OrderQueue } = components;

function build(sim: Simulation): void {
  const chests = Array.from({ length: CHEST_COUNT }, (_, i) => {
    const node = cellAnchorNode(FIRST_CHEST_X + i * CHEST_GAP, ROW_Y);
    return systems.createChest(sim.world, sim.content, {
      kind: 'wooden',
      contents: FOOD_CHEST,
      x: node.hx,
      y: node.hy,
    });
  });
  const opener = spawnSettlerDirect(sim, JOB_COLLECTOR, OPENER.x, OPENER.y);
  chests.slice(0, ORDERED_CHESTS).forEach((chest, i) => {
    sim.enqueueSetup({ kind: 'openChest', entity: opener, chest, ...(i > 0 ? { queued: true } : {}) });
  });
}

export const chestQueueScene: SceneDefinition = {
  id: 'chest-queue',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the collector opened the ordered chest and then the queued one, leaving the last two closed',
      predicate: (sim) => [...sim.world.query(Chest)].length === CHEST_COUNT - ORDERED_CHESTS,
    },
    {
      label: 'nothing is left waiting in its queue',
      predicate: (sim) => [...sim.world.query(OrderQueue)].length === 0,
    },
  ],
};
