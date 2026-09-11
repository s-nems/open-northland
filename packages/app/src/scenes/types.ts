import type { CellTerrainMap, MissionScript, Simulation } from '@open-northland/sim';
import type { FogModeName } from '../game/fog.js';

export interface SceneCheck {
  readonly label: string;
  readonly predicate: (sim: Simulation) => boolean;
}

/** A deterministic world setup: everything `createSceneSim` needs to build a sim, and nothing else. */
export interface SceneWorld {
  readonly seed: number;
  /** Authored in cells; `createSceneSim` upsamples it to the sim's half-cell lattice. */
  readonly terrain: CellTerrainMap;
  /** Optional dry-land mask on the half-cell grid for land-only terrain color edits. */
  readonly landVertices?: readonly boolean[];
  /** Runs once before any tick. */
  readonly build: (sim: Simulation) => void;
  /** Opts back into the needs mechanic; a scene world otherwise runs with needs off. */
  readonly needs?: boolean;
  /** Omit for no fog; the browser `?fog=` flag overrides either way. */
  readonly fog?: FogModeName;

  /** `false` staffs every civilian trade from zero XP; omit for the sim default of gated progression. */
  readonly progression?: boolean;
  /** The seats that can win or lose the skirmish; omit for a scene that decides nothing. */
  readonly participants?: readonly number[];
  /** A script the world runs from its first tick, written with resolved ids; omit for none. */
  readonly missions?: MissionScript;
}

/**
 * An acceptance scene: one deterministic world setup that the headless test asserts over and the
 * browser renders for human inspection. Registering a scene adds both its test and its `?scene=` link.
 */
export interface SceneDefinition extends SceneWorld {
  /** URL-safe id: the `?scene=<id>` value and the test's `describe()` name. */
  readonly id: string;
  /** Ticks the headless acceptance test advances before checking. */
  readonly runTicks: number;
  /** Starting camera zoom for the browser view; 1 when omitted. */
  readonly initialZoom?: number;
  readonly checks: readonly SceneCheck[];
}
