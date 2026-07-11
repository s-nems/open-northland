import type { CellTerrainMap, Simulation } from '@vinland/sim';
import type { FogModeName } from '../game/fog.js';

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
 *    cannot self-judge (AGENTS.md "How to verify your work"; see `docs/SCENES.md`).
 *
 * Because the sim is deterministic, the two consumers observe the SAME run (same seed + global rules +
 * scene setup): what the headless test proves is exactly what the human watches. Adding a scene to the
 * registry automatically adds its headless test AND its `?scene=` link.
 */
export interface SceneDefinition {
  /** URL-safe id: the `?scene=<id>` value and the test's `describe()` name. */
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Seed for the deterministic RNG. */
  readonly seed: number;
  /** Terrain grid authored in CELLS — the renderer projects it as-is; `createSceneSim` upsamples it
   *  to the sim's half-cell lattice. The global content/rules are not scene-owned. */
  readonly terrain: CellTerrainMap;
  /** Populate the fresh sim (enqueue commands, create resource nodes). Runs once before any tick. */
  readonly build: (sim: Simulation) => void;
  /** Opt back INTO the needs mechanic (hunger/fatigue/piety/enjoyment rise + starvation). Scenes
   *  default to needs OFF (a checklist unit must not starve mid-inspection — see `createSceneSim`);
   *  a scene that exercises needs/starvation sets this true. */
  readonly needs?: boolean;
  /** The scene's fog-of-war mode (`setFogMode` enqueued at build; see `game/fog.ts`). Omit for no
   *  fog (the sim default); the browser `?fog=` flag overrides either way. */
  readonly fog?: FogModeName;
  /** Ticks the headless acceptance test advances before checking {@link checks}. */
  readonly runTicks: number;
  /**
   * Starting camera zoom for the browser view when `?zoom=` is absent (default 1). A scene that spreads
   * many entities (e.g. every building at once) sets this < 1 so it frames by default; `?zoom=` overrides.
   */
  readonly initialZoom?: number;
  /** Human-readable "what to look for" — the on-screen acceptance checklist. */
  readonly checklist: readonly string[];
  /** Machine assertions the headless test enforces (the mechanic must hold). */
  readonly checks: readonly SceneCheck[];
}
