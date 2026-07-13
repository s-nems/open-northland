import { beforeEach } from 'vitest';
import { Armor, CurrentAtomic, Health, Position, Settler } from '../../../src/components/index.js';
import type { AtomicEffect } from '../../../src/core/atomic-effect.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  type Fixed,
  fx,
  halfCellMapFromCells,
  positionOfNode,
  type Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { clearComponentStores } from '../../fixtures/stores.js';

import { ATTACK_ATOMIC } from './content.js';

export * from './content.js';

export function grass(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(0) });
}

export function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** A combatant of `tribe`/`jobType` at visual cell (x,y), optionally armored. */
export function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  tribe: number,
  jobType: number | null,
  opts: { hitpoints?: number; armorClass?: number } = {},
): Entity {
  return fighterAtPosition(sim, { x: fx.fromInt(x), y: fx.fromInt(y) }, tribe, jobType, opts);
}

/** A combatant standing exactly on half-cell node (hx, hy) — reach geometry a whole cell (2 nodes on a
 *  row) cannot express, e.g. a maxRange-1 weapon needs an ADJACENT node. */
export function fighterAtNode(
  sim: Simulation,
  hx: number,
  hy: number,
  tribe: number,
  jobType: number | null,
  opts: { hitpoints?: number; armorClass?: number } = {},
): Entity {
  return fighterAtPosition(sim, positionOfNode(hx, hy), tribe, jobType, opts);
}

export function fighterAtPosition(
  sim: Simulation,
  position: { x: Fixed; y: Fixed },
  tribe: number,
  jobType: number | null,
  opts: { hitpoints?: number; armorClass?: number } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: position.x, y: position.y });
  sim.world.add(e, Settler, {
    tribe,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints: opts.hitpoints ?? 100_000, max: opts.hitpoints ?? 100_000 });
  if (opts.armorClass !== undefined) sim.world.add(e, Armor, { armorClass: opts.armorClass });
  return e;
}

/** Hand-build a swing (bypassing targeting) so an executor mechanic can be driven in isolation. */
export function startSwing(
  sim: Simulation,
  attacker: Entity,
  effect: Omit<Extract<AtomicEffect, { kind: 'attack' }>, 'kind'>,
  duration: number,
  atomicId = ATTACK_ATOMIC,
): void {
  sim.world.add(attacker, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect: { kind: 'attack', ...effect },
    targetEntity: effect.target,
    targetTile: null,
  });
}

beforeEach(clearComponentStores);
