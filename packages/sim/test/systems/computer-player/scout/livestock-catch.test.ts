import { describe, expect, it } from 'vitest';
import { FOG_MODE, mapBriefOf, Position } from '../../../../src/components/index.js';
import { positionOfNode, Simulation } from '../../../../src/index.js';
import { nextLivestockCatch } from '../../../../src/systems/computer-player/index.js';
import type { SystemContext } from '../../../../src/systems/index.js';
import { cellOfNode } from '../../../../src/systems/vision/gates.js';
import type { FogState } from '../../../../src/systems/vision/state.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import { ctxOf, makeAiSeat, placeAnimal, placeHq, SEAT } from '../support.js';

const HOME = { x: 64, y: 64 };
const HERD_START = { x: 110, y: 64 };
const HERD_LATER = { x: 64, y: 120 };
const SIGHT_RADIUS = 2;

/** A computer seat whose map brief saw one wild cow at {@link HERD_START}, under fog of war with nothing
 *  in its sight. */
function herdSim(): { sim: Simulation; fog: FogState; cow: ReturnType<typeof placeAnimal> } {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
  makeAiSeat(sim, SEAT);
  placeHq(sim, HOME.x, HOME.y);
  const cow = placeAnimal(sim, HERD_START.x, HERD_START.y);
  sim.step();
  const fog = sim.fog;
  if (fog === undefined) throw new Error('setup: a mapped sim has fog');
  fog.activeMode = FOG_MODE.CLASSIC_FOG_OF_WAR;
  return { sim, fog, cow };
}

function look(fog: FogState, at: { x: number; y: number }): void {
  const { cx, cy } = cellOfNode(at.x, at.y);
  fog.stampSight(SEAT, cx, cy, SIGHT_RADIUS);
}

const fogCtx = (sim: Simulation, fog: FogState): SystemContext => ({ ...ctxOf(sim, sim.tick), fog });

describe('the round-up under fog of war', () => {
  it('walks to a herd start the seat never saw, without claiming the unseen animal', () => {
    const { sim, fog } = herdSim();
    expect(mapBriefOf(sim.world)?.livestock).toEqual([{ hx: HERD_START.x, hy: HERD_START.y }]);
    expect(nextLivestockCatch(sim.world, fogCtx(sim, fog), SEAT)).toEqual({
      kind: 'look',
      node: { hx: HERD_START.x, hy: HERD_START.y },
    });
  });

  it('goes after the animal once the seat sees it', () => {
    const { sim, fog, cow } = herdSim();
    look(fog, HERD_START);
    expect(nextLivestockCatch(sim.world, fogCtx(sim, fog), SEAT)).toEqual({ kind: 'claim', animal: cow });
  });

  it('forgets a start spot it saw empty: where the herd moved is found only by seeing it', () => {
    const { sim, fog, cow } = herdSim();
    sim.world.mut(cow, Position).x = positionOfNode(HERD_LATER.x, HERD_LATER.y).x;
    sim.world.mut(cow, Position).y = positionOfNode(HERD_LATER.x, HERD_LATER.y).y;
    look(fog, HERD_START);
    expect(nextLivestockCatch(sim.world, fogCtx(sim, fog), SEAT)).toBeNull();
    look(fog, HERD_LATER);
    expect(nextLivestockCatch(sim.world, fogCtx(sim, fog), SEAT)).toEqual({ kind: 'claim', animal: cow });
  });
});
