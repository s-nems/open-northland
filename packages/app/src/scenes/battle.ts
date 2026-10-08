import { components, type Entity, fx, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
} from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerAtNode } from '../game/sandbox/index.js';
import { blueLivingSettlers, enemyLivingSettlers, goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 96;
const MAP_H = 80;
const COLUMNS = 20;
const ROWS = 50;
const PER_SIDE = COLUMNS * ROWS;
const JOBS = [JOB_SOLDIER_SWORD, JOB_SOLDIER_BROADSWORD, JOB_SOLDIER_SPEAR, JOB_ARCHER, JOB_ARCHER_LONG];
const ARMOR = [null, 'armor_wool', 'armor_leather', 'armor_chain', 'armor_plate'] as const;
const { Equipment, Health, Position, Settler } = components;

/** Independent balanced decks keep both armies comparable without sorting the field by equipment. */
function shuffledDeck<T>(sim: Simulation, choices: readonly T[]): T[] {
  const deck = Array.from({ length: PER_SIDE }, (_, i) => choices[i % choices.length]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = sim.rng.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.filter((item): item is T => item !== undefined);
}

function army(sim: Simulation, owner: number, firstX: number): void {
  const jobs = shuffledDeck(sim, JOBS);
  const armor = shuffledDeck(
    sim,
    ARMOR.map((slug) => (slug === null ? null : goodBySlug(sim, slug))),
  );
  const members: { entity: Entity; x: number; y: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    const stagger = sim.rng.int(7) - 3;
    for (let col = 0; col < COLUMNS; col++) {
      const index = row * COLUMNS + col;
      const job = jobs[index];
      const armorGood = armor[index];
      if (job === undefined || armorGood === undefined) throw new Error('incomplete battle equipment deck');
      // Jitter within disjoint half-cell slots: loose ranks, with no overlapping spawn positions.
      const hx = firstX + col * 3 + stagger + sim.rng.int(2);
      const hy = 30 + row * 2 + sim.rng.int(2);
      const entity = spawnSettlerAtNode(sim, job, { hx, hy }, owner);
      sim.world.mut(entity, Equipment).armor =
        armorGood === null ? null : { goodType: armorGood, degreeOfUse: fx.fromInt(0) };
      members.push({ entity, x: 2 * MAP_W - 1 - hx, y: hy });
    }
  }
  // Every rear rank advances into the opposing deployment, retaining its own arrival slot.
  sim.enqueueSetup({ kind: 'attackMoveUnitGroup', members });
}

function build(sim: Simulation): void {
  army(sim, HUMAN_PLAYER, 20);
  army(sim, ENEMY_PLAYER, 112);
}

function nobodyStacks(sim: Simulation): boolean {
  const perPosition = new Map<string, number>();
  for (const e of sim.world.query(Settler, Health, Position)) {
    if (sim.world.get(e, Health).hitpoints <= 0) continue;
    const p = sim.world.get(e, Position);
    // Distinct sub-cell positions can share a half-cell; only coincident feet form an actual stack.
    const key = `${p.x},${p.y}`;
    const count = (perPosition.get(key) ?? 0) + 1;
    if (count > 2) return false;
    perPosition.set(key, count);
  }
  return true;
}

export const battleScene: SceneDefinition = {
  id: 'battle',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 400,
  initialZoom: 0.35,
  checks: [
    {
      label: 'the battle leaves at least 120 casualties across 2000 fighters',
      predicate: (sim) => 2 * PER_SIDE - blueLivingSettlers(sim) - enemyLivingSettlers(sim) >= 120,
    },
    {
      label: 'no more than two living fighters share a foot position',
      predicate: nobodyStacks,
    },
    {
      label: 'both armies take casualties after advancing into combat',
      predicate: (sim) =>
        blueLivingSettlers(sim) <= PER_SIDE - 50 && enemyLivingSettlers(sim) <= PER_SIDE - 50,
    },
  ],
};
