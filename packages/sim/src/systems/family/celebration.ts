import {
  AttackOrder,
  Carrying,
  Chat,
  CurrentAtomic,
  Engagement,
  FamilyDuty,
  Fleeing,
  Health,
  ownerOf,
  Position,
  Resting,
  Settler,
  Sheltering,
  TrainingOrder,
  Wedding,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { atomicAnimationByName, atomicClipName } from '../readviews/animations.js';
import { isFighterJob } from '../readviews/jobs.js';
import { startAtomic } from '../settlers/atomics/start.js';
import { stationaryOwnedSettlers } from '../settlers/planner/spacing.js';
import { isAdultSettler } from './eligibility.js';

/** `tribetypes.ini` civilian enjoyment slot. */
export const CHEER_ATOMIC_ID = 17;
/** Approximation: wedding guests within four visual tiles celebrate once, without abandoning tasks. */
const WEDDING_CHEER_RADIUS_NODES = 8;

export function celebrateWedding(world: World, ctx: SystemContext, a: Entity, b: Entity): void {
  const owner = ownerOf(world, a);
  if (owner === undefined) return;
  const p = world.get(a, Position);
  const at = nodeOfPosition(p.x, p.y);
  const nearby = stationaryOwnedSettlers(world);
  const radius = WEDDING_CHEER_RADIUS_NODES;
  for (let hy = at.hy - radius; hy <= at.hy + radius; hy++) {
    for (let hx = at.hx - radius; hx <= at.hx + radius; hx++) {
      if (hexDistanceBetween(at.hx, at.hy, hx, hy) > radius) continue;
      for (const e of nearby.at(hx, hy)) {
        if (e === a || e === b || ownerOf(world, e) !== owner || !isAdultSettler(world, e)) continue;
        if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
        if (
          world.has(e, CurrentAtomic) ||
          world.has(e, Carrying) ||
          world.has(e, Resting) ||
          world.has(e, Engagement) ||
          world.has(e, Fleeing) ||
          world.has(e, AttackOrder) ||
          world.has(e, Sheltering) ||
          world.has(e, Wedding) ||
          world.has(e, Chat) ||
          world.has(e, FamilyDuty) ||
          world.has(e, TrainingOrder)
        )
          continue;
        const settler = world.get(e, Settler);
        if (isFighterJob(ctx.content, settler.jobType)) continue;
        const name = atomicClipName(ctx.content, settler, CHEER_ATOMIC_ID);
        const clip = name === undefined ? undefined : atomicAnimationByName(ctx.content, name);
        if (clip === undefined || clip.length <= 0) continue;
        startAtomic(world, e, CHEER_ATOMIC_ID, { kind: 'idle' }, clip.length, null);
      }
    }
  }
}
