import type { Entity, Fixed, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  JOB_BABY_MALE,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  placeSandboxBerryBush,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The children scene: prove the child eat drive — a hungry CHILD feeds itself like an adult (the
 * original binds child eat animations, `setatomic 3/4 10`), while a BABY is cared for: its family
 * keeps it sated (its needs never accumulate — NeedsSystem) and it never self-feeds. Three stations,
 * each a hungry young settler beside its own ripe berry bush: the girl and boy walk over, play the
 * child eat clip, and their hunger resets (their bushes go bare); the baby — authored hungry, a state
 * real play can't reach, exactly so the planner's baby gate is checkable — ignores its bush (it stays
 * ripe). The browser half is where a human judges the pixels: the two child eat clips on the child
 * bodies and the baby never feeding.
 */

const MAP_W = 24;
const MAP_H = 10;
/** The row the bushes sit on; each young settler stands one tile above its own bush. */
const ROW_Y = 6;
const GIRL = { x: 5, y: ROW_Y - 1 } as const;
const BOY = { x: 11, y: ROW_Y - 1 } as const;
const BABY = { x: 17, y: ROW_Y - 1 } as const;
/** Well past the eat threshold (¾·ONE), so both children seek food from tick 0. */
const HUNGRY = fx.div(fx.fromInt(9), fx.fromInt(10));
/** One walked tile + the eat clip finish well inside this, and it stays far below the bush regrow
 *  ({@link systems.BERRY_REGROW_TICKS} = 1200), so the two foraged bushes are still bare at check time. */
const RUN_TICKS = 600;
const INITIAL_ZOOM = 1.2;
/** An Age tick count squarely inside the child stage (past baby, well short of adulthood). */
const CHILD_AGE_TICKS = systems.CHILD_TICKS + 100;

const { Age, BerryBush, Settler } = components;

/** Spawn a young settler (a born-life-stage jobType plus the Age marker) directly, pre-tick-0. */
function spawnYoung(
  sim: Simulation,
  jobType: number,
  x: number,
  y: number,
  ageTicks: number,
  hunger: Fixed,
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
  });
  if (e === null) throw new Error('children scene: unknown age-class job');
  sim.world.add(e, Age, { ticks: ageTicks });
  sim.world.get(e, Settler).hunger = hunger;
  return e;
}

function build(sim: Simulation): void {
  // None of the young get a Residence, so the child stroll never fires — they stand when not feeding
  // (the stroll is the family scene's vignette; this one isolates the feed-or-not contrast).
  for (const station of [GIRL, BOY, BABY]) placeSandboxBerryBush(sim, station.x, ROW_Y);
  spawnYoung(sim, JOB_CHILD_FEMALE, GIRL.x, GIRL.y, CHILD_AGE_TICKS, HUNGRY);
  spawnYoung(sim, JOB_CHILD_MALE, BOY.x, BOY.y, CHILD_AGE_TICKS, HUNGRY);
  // The baby is AUTHORED hungry — unreachable in real play (a cared-for baby's needs are frozen,
  // NeedsSystem) — so the no-self-feed gate is observable: it sits beside ripe food and never eats.
  spawnYoung(sim, JOB_BABY_MALE, BABY.x, BABY.y, 0, HUNGRY);
}

/** The scene's young settlers split by stage: `[girl, boy]` children and the lone baby. */
function youngByStage(sim: Simulation): { children: Entity[]; babies: Entity[] } {
  const children: Entity[] = [];
  const babies: Entity[] = [];
  for (const e of sim.world.query(Age, Settler)) {
    if (systems.isChild(sim.world.get(e, Settler).jobType)) children.push(e);
    else babies.push(e);
  }
  return { children, babies };
}

export const childrenScene: SceneDefinition = {
  id: 'children',
  seed: 9,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'both children ended FED — the eat drive ran for them (the only food was their bushes)',
      predicate: (sim) => {
        const { children } = youngByStage(sim);
        return (
          children.length === 2 && children.every((e) => sim.world.get(e, Settler).hunger === fx.fromInt(0))
        );
      },
    },
    {
      label: 'the hungry baby never self-fed — its authored hunger never reset (cared for, no eat drive)',
      predicate: (sim) => {
        const { babies } = youngByStage(sim);
        return babies.length === 1 && babies.every((e) => sim.world.get(e, Settler).hunger === HUNGRY);
      },
    },
    {
      label: "exactly the children's two bushes were foraged; the baby's stayed ripe",
      predicate: (sim) => {
        let bare = 0;
        let ripe = 0;
        for (const e of sim.world.query(BerryBush)) {
          if (sim.world.get(e, BerryBush).stage === 'ripe') ripe++;
          else bare++;
        }
        return bare === 2 && ripe === 1;
      },
    },
  ],
};
