import type { ContentSet } from '@open-northland/data';
import type { PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import { createPickModeController, type PickModeController } from '../../src/view/unit-controls/pick-mode.js';
import type { UnitTargets } from '../../src/view/unit-controls/unit-targets.js';

/** Targets that name nothing; a test overrides the lanes its press reads. */
export const NO_TARGETS: UnitTargets = {
  owned: () => [],
  buildings: () => [],
  enemies: () => [],
  flags: () => [],
  signposts: () => [],
  chests: () => [],
  goods: () => [],
  resources: () => [],
  wildlife: () => [],
  ownedSettlersIn: () => [],
};

/**
 * A pick-mode controller for the building picks and their highlight: every press names world point
 * (0, 0), and no order controller stands behind the spot and strike modes.
 */
export function buildingPickController(opts: {
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly targets?: UnitTargets;
  readonly enqueue?: (command: PlayerCommand) => void;
}): PickModeController {
  return createPickModeController({
    snapshot: opts.snapshot,
    targets: opts.targets ?? NO_TARGETS,
    content: opts.content,
    mapSize: { width: 8, height: 8 },
    toWorld: () => ({ x: 0, y: 0 }),
    nodeAt: () => ({ col: 0, row: 0 }),
    enqueue: opts.enqueue ?? (() => undefined),
    orders: () => {
      throw new Error('no order controller in this test');
    },
    setArmedCursor: () => undefined,
  });
}
