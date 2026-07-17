import type { CellTerrainMap, Simulation } from '@open-northland/sim';
import type { FogModeName } from '../game/fog.js';

/** A single machine-checkable assertion about a scene's run — the mechanic the headless test enforces. */
export interface SceneCheck {
  readonly label: string;
  readonly predicate: (sim: Simulation) => boolean;
}

/**
 * A deterministic world setup: everything {@link createSceneSim} needs to build a sim, and nothing
 * else. Split out of {@link SceneDefinition} for the second caller that wants a world without
 * acceptance metadata (the sim benchmark's tiled world, `packages/app/bench/`).
 */
export interface SceneWorld {
  /** Seed for the deterministic RNG. */
  readonly seed: number;
  /** Terrain grid authored in cells — the renderer projects it as-is; `createSceneSim` upsamples it
   *  to the sim's half-cell lattice. The global content/rules are not scene-owned. */
  readonly terrain: CellTerrainMap;
  /** Populate the fresh sim (enqueue commands, create resource nodes). Runs once before any tick. */
  readonly build: (sim: Simulation) => void;
  /** Opt back into the needs mechanic (hunger/fatigue/piety/enjoyment rise + starvation). Worlds
   *  default to needs off (an inspection unit must not starve mid-run — see `createSceneSim`);
   *  a scene that exercises needs/starvation sets this true. */
  readonly needs?: boolean;
  /** The fog-of-war mode (`setFogMode` enqueued at build; see `game/fog.ts`). Omit for no fog (the
   *  sim default); the browser `?fog=` flag overrides either way. */
  readonly fog?: FogModeName;
}

/**
 * An **acceptance scene**: one deterministic world setup that powers two consumers.
 *
 *  - **Headless (vitest)** — `createSceneSim(scene).run(runTicks)`, then assert every {@link checks}.
 *    The agent proves the *mechanic* with no screen (see `packages/app/test/scenes.test.ts`).
 *  - **Browser (`npm run dev` → `?scene=<id>`)** — the same sim rendered for human inspection.
 *
 * Because the sim is deterministic, the two consumers observe the same run (same seed + global rules +
 * scene setup): what the headless test proves is exactly what the human watches. Adding a scene to the
 * registry automatically adds its headless test and its `?scene=` link.
 */
export interface SceneDefinition extends SceneWorld {
  /** URL-safe id: the `?scene=<id>` value and the test's `describe()` name. */
  readonly id: string;
  /** Ticks the headless acceptance test advances before checking {@link checks}. */
  readonly runTicks: number;
  /**
   * Starting camera zoom for the browser view (default 1). A scene that spreads many entities sets this
   * below 1 so the whole setup fits before the player adjusts the camera with the mouse wheel.
   */
  readonly initialZoom?: number;
  /** Machine assertions the headless test enforces (the mechanic must hold). */
  readonly checks: readonly SceneCheck[];
}
