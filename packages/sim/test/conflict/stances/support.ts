export { ctxOf } from '../../fixtures/context.js';

import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { grassMap };

import { Health, Owner, Position, Settler, Stance } from '../../../src/components/index.js';
import { type Fixed, fx } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, positionOfNode, type Simulation } from '../../../src/index.js';
import type { NodeId } from '../../../src/nav/terrain/index.js';

/**
 * The four **military stances** (`MILITARY_MODE`) as a per-unit auto-engagement mode, plus the civilian
 * **flee** drive. This file pins the stance layer on top of the engagement half (melee-engagement.test.ts):
 * the job-based defaults, the `setStance` command, the ATTACK/DEFEND/IGNORE/FLEE gates, and the
 * order-over-stance precedence — all deterministic, no RNG.
 *
 * The fixture's `test_axe` (viking tribe 1, job 1) has band `[1, 2]`, damage 50 vs unarmored; job 1
 * (woodcutter) is a CIVILIAN, so it defaults to FLEE — the tests give a combatant an explicit ATTACK/
 * DEFEND/IGNORE stance where they mean it to fight.
 */

export const GRASS = 0;
export const VIKING = 1;
export const WOODCUTTER = 1; // has the axe weapon; a civilian job (default FLEE)
export const P0 = 0;
export const P1 = 1;

export const WOOD = 1; // the fixture's wood good (harvest atomic 24), what a woodcutter (job 1) gathers
export const HARVEST_ATOMIC = 24;

/** An owned combatant with an explicit stance at visual cell (x,y) (a direct spawn — full control over
 *  the mode). */
export function combatant(
  sim: Simulation,
  x: number,
  y: number,
  owner: number,
  mode: number,
  opts: { hitpoints?: number; jobType?: number } = {},
): Entity {
  return combatantAtPosition(sim, { x: fx.fromInt(x), y: fx.fromInt(y) }, owner, mode, opts);
}

/** An owned combatant standing exactly on half-cell node (hx, hy) — reach geometry a whole cell
 *  (2 nodes on a row) cannot express, e.g. an ODD node distance from a cell-anchored unit. */
export function combatantAtNode(
  sim: Simulation,
  hx: number,
  hy: number,
  owner: number,
  mode: number,
  opts: { hitpoints?: number; jobType?: number } = {},
): Entity {
  return combatantAtPosition(sim, positionOfNode(hx, hy), owner, mode, opts);
}

export function combatantAtPosition(
  sim: Simulation,
  position: { x: Fixed; y: Fixed },
  owner: number,
  mode: number,
  opts: { hitpoints?: number; jobType?: number } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: position.x, y: position.y });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: opts.jobType ?? WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints: opts.hitpoints ?? 2000, max: opts.hitpoints ?? 2000 });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

/** The nav node id of visual cell (x,y)'s ANCHOR node — where a unit minted at integer cell coords
 *  stands on the half-cell lattice. */
export function cell(sim: Simulation, x: number, y: number): NodeId {
  const t = sim.terrain;
  if (t === undefined) throw new Error('no terrain');
  const n = cellAnchorNode(x, y);
  return t.nodeAtClamped(n.hx, n.hy);
}

export function tileOf(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  return { x: fx.toInt(p.x), y: fx.toInt(p.y) };
}

// ---------------------------------------------------------------------------------------------------
