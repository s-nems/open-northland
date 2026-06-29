import type { ContentSet } from '@vinland/data';
import type { Simulation, TerrainMap } from '@vinland/sim';

/** A single machine-checkable assertion about a scene's run — the mechanic the headless test enforces. */
export interface SceneCheck {
  readonly label: string;
  readonly predicate: (sim: Simulation) => boolean;
}

/**
 * An **acceptance scene**: one deterministic world setup that powers two consumers.
 *
 *  - **Headless (vitest)** — `createSceneSim(scene).run(runTicks)`, then assert every {@link checks}.
 *    The AGENT proves the *mechanic* with no screen (see `packages/app/test/scenes.test.ts`).
 *  - **Browser (`npm run dev` → `?scene=<id>`)** — the SAME sim, rendered each frame with the
 *    {@link checklist} overlaid, so a HUMAN judges the *pixels/animation* — the one thing an agent
 *    cannot self-judge (CLAUDE.md "How to verify your work"; see `docs/SCENES.md`).
 *
 * Because the sim is deterministic, the two consumers observe the SAME run (same seed + content +
 * setup): what the headless test proves is exactly what the human watches. Adding a scene to the
 * registry automatically adds its headless test AND its `?scene=` link.
 */
export interface SceneDefinition {
  /** URL-safe id: the `?scene=<id>` value and the test's `describe()` name. */
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Seed for the deterministic RNG. */
  readonly seed: number;
  /** Validated content set (goods/jobs/buildings/...). SYNTHETIC — never copyrighted game data. */
  readonly content: ContentSet;
  /** Terrain grid the sim navigates and the renderer projects. */
  readonly terrain: TerrainMap;
  /** Populate the fresh sim (enqueue commands, create resource nodes). Runs once before any tick. */
  readonly build: (sim: Simulation) => void;
  /** Ticks the headless acceptance test advances before checking {@link checks}. */
  readonly runTicks: number;
  /** Human-readable "what to look for" — the on-screen acceptance checklist. */
  readonly checklist: readonly string[];
  /** Machine assertions the headless test enforces (the mechanic must hold). */
  readonly checks: readonly SceneCheck[];
}
