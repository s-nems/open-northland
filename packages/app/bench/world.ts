import type { CellTerrainMap, Simulation } from '@open-northland/sim';
import { grassTerrain } from '../src/catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../src/game/rules.js';
import {
  JOB_ARCHER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  spawnSandboxSettler,
  WEAPON_BROADSWORD,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
} from '../src/game/sandbox/index.js';
import { createSceneSim } from '../src/scenes/runtime.js';
import { buildSandboxSettlement, SANDBOX_SETTLEMENT_PITCH } from '../src/scenes/sandbox.js';
import type { SceneWorld } from '../src/scenes/types.js';

/**
 * The benchmark world: N copies of the sandbox scene's authored settlement tiled across one grass map,
 * plus (optionally) two mirrored armies in a strip below them — the sim work a real session does, at a
 * population knob can turn up. Both halves are the acceptance scenes' own builders
 * ({@link buildSandboxSettlement}, {@link spawnSandboxSettler}), so the bench measures the same world
 * the scenes already prove, rather than a second world-builder.
 *
 * Content is the clean-room synthetic sandbox set (`createSceneSim`'s default) — no copyrighted map or
 * IR bytes reach the bench, exactly as in the headless scene tests.
 */

/** The battle scene's four-weapon muster, ordered front rank first — both armies mirror this order
 *  across the front line (swords meet, archers shoot from the back). */
const RANKS_FRONT_TO_BACK: readonly { readonly job: number; readonly weapon: number }[] = [
  { job: JOB_SOLDIER_SWORD, weapon: WEAPON_SWORD },
  { job: JOB_SOLDIER_SPEAR, weapon: WEAPON_SPEAR },
  { job: JOB_SOLDIER_BROADSWORD, weapon: WEAPON_BROADSWORD },
  { job: JOB_ARCHER, weapon: WEAPON_SHORT_BOW },
];

/** The battle strip below the settlements: its depth in cells, and the gap between the two front ranks. */
const BATTLE_STRIP_DEPTH = 44;
const ARMY_GAP = 6;
/** Cells of clear grass around the tiled settlements and the muster — keeps every authored placement,
 *  flag radius and spawn inside the map after tiling. */
const MAP_MARGIN = 4;

export interface BenchWorldOptions {
  /** Copies of the authored settlement, tiled into a near-square grid (each ~72 settlers, 41 buildings).
   *  Clamped to at least 1. */
  readonly settlements: number;
  /**
   * Fighters per side in the battle strip; 0 (the bench default) builds an economy-only world.
   * A fighter run is inherently NON-STATIONARY — the battle resolves inside the window (at 200 a side,
   * ~65% of them are dead 300 ticks in), so its medians describe that window, not a steady state. Use it
   * to profile combat, not to compare two revisions.
   */
  readonly fightersPerSide: number;
}

export interface BenchWorld {
  readonly sim: Simulation;
  readonly terrain: CellTerrainMap;
}

/** The near-square tiling of `settlements` copies: columns first, so 6 lays out 3×2, not 6×1. */
function tiling(settlements: number): { columns: number; rows: number } {
  const columns = Math.ceil(Math.sqrt(settlements));
  return { columns, rows: Math.ceil(settlements / columns) };
}

/** Muster one side's ranks facing the front line at `frontY`, growing away from it: `dir` is -1 for the
 *  army above the line, +1 for the one below. Each rank is one cell row, `width` fighters wide. */
function musterArmy(
  sim: Simulation,
  opts: {
    readonly x0: number;
    readonly frontY: number;
    readonly dir: -1 | 1;
    readonly count: number;
    readonly width: number;
    readonly owner: number;
  },
): void {
  let placed = 0;
  for (const [rank, { job, weapon }] of RANKS_FRONT_TO_BACK.entries()) {
    if (placed >= opts.count) break;
    const y = opts.frontY + opts.dir * rank;
    for (let i = 0; i < opts.width && placed < opts.count; i++) {
      spawnSandboxSettler(sim, job, opts.x0 + i, y, opts.owner, { weaponTypeId: weapon });
      placed++;
    }
  }
}

/**
 * Build the benchmark world. Deterministic: two calls with the same options produce byte-identical runs.
 * The build is not RNG-free (`createSettler` draws each settler's initial needs), but the seed is fixed
 * and the placements run in a fixed order, so the draw order — and thus the state — is reproducible.
 *
 * Needs stay off (the `createSceneSim` default), so hunger cannot starve settlers mid-window and drift
 * the population; the needs/eat/sleep drives are therefore not measured. Note this only holds the
 * ECONOMY half stationary — see {@link BenchWorldOptions.fightersPerSide}.
 */
export function benchWorld(options: BenchWorldOptions): BenchWorld {
  const settlements = Math.max(1, options.settlements);
  const fighters = Math.max(0, options.fightersPerSide);
  const { columns, rows } = tiling(settlements);
  // Ranks are one cell row each, so a side that outnumbers its ranks widens rather than deepens.
  const armyWidth = fighters === 0 ? 0 : Math.ceil(fighters / RANKS_FRONT_TO_BACK.length);

  const width = Math.max(columns * SANDBOX_SETTLEMENT_PITCH, armyWidth + 2 * MAP_MARGIN) + MAP_MARGIN;
  const height = rows * SANDBOX_SETTLEMENT_PITCH + (fighters === 0 ? MAP_MARGIN : BATTLE_STRIP_DEPTH);
  const terrain = grassTerrain(width, height);

  const world: SceneWorld = {
    seed: 41,
    terrain,
    build: (sim) => {
      for (let i = 0; i < settlements; i++) {
        const ox = (i % columns) * SANDBOX_SETTLEMENT_PITCH;
        const oy = Math.floor(i / columns) * SANDBOX_SETTLEMENT_PITCH;
        buildSandboxSettlement(sim, ox, oy);
      }
      if (fighters === 0) return;
      // The armies meet in the strip below the last settlement row, clear of every camp and flag radius.
      const frontY = rows * SANDBOX_SETTLEMENT_PITCH + Math.floor((BATTLE_STRIP_DEPTH - ARMY_GAP) / 2);
      const x0 = MAP_MARGIN;
      musterArmy(sim, { x0, frontY, dir: -1, count: fighters, width: armyWidth, owner: HUMAN_PLAYER });
      musterArmy(sim, {
        x0,
        frontY: frontY + ARMY_GAP,
        dir: 1,
        count: fighters,
        width: armyWidth,
        owner: ENEMY_PLAYER,
      });
    },
  };

  return { sim: createSceneSim(world), terrain };
}
