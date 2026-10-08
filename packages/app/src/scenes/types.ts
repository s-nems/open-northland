import type {
  CellTerrainMap,
  Command,
  MissionScript,
  PlayerCommand,
  Simulation,
  WorldSnapshot,
} from '@open-northland/sim';
import type { FogModeName } from '../game/fog.js';
import type { WorldTribes } from '../game/world-tribes.js';

export interface SceneCheck {
  readonly label: string;
  readonly predicate: (sim: Simulation) => boolean;
}

/** A deterministic world setup: everything `createSceneSim` needs to build a sim, and nothing else. */
export interface SceneWorld {
  readonly seed: number;
  /** Authored in cells; `createSceneSim` upsamples it to the sim's half-cell lattice. */
  readonly terrain: CellTerrainMap;
  /** Optional dry-land mask on the half-cell grid: unwalkable ground off it is water a ship sails and
   *  land-only terrain color edits skip. Omitted, every unwalkable node is water. */
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
  /** Civilization body libraries this scene fields; the first is the fallback look. */
  readonly graphicTribes?: WorldTribes;
  /** Ticks the headless acceptance test advances before checking. */
  readonly runTicks: number;
  /** Starting camera zoom for the browser view; 1 when omitted. */
  readonly initialZoom?: number;
  readonly checks: readonly SceneCheck[];
  /** The browser view mounts the network panel over a scripted feed that cycles through its states:
   *  the panel's design preview. The world itself stays a local one. */
  readonly netPanelPreview?: boolean;
  /** Places in the world the browser view steps between, each with the orders it can issue there. */
  readonly stages?: readonly SceneStage[];
}

/** An order a stage issues: the viewing seat's goes through the HUD's own order path, answer and
 *  all; another seat's enters as trusted input. */
export type StageOrder =
  | { readonly by: 'viewer'; readonly command: PlayerCommand }
  | { readonly by: 'admin'; readonly command: Command };

/** A stage's button: orders read off the world as it stands when pressed, or a camera zoom. `label`
 *  keys the scene's `stages` copy, formatted with `values`. */
export type StageAction = {
  readonly label: string;
  readonly values?: Readonly<Record<string, number>>;
} & (
  | { readonly kind: 'orders'; readonly orders: (snapshot: WorldSnapshot) => StageOrder[] }
  | { readonly kind: 'zoom'; readonly zoom: number }
);

/** A place the browser view jumps the camera to; `id` keys its label in the scene's `stages` copy. */
export interface SceneStage {
  readonly id: string;
  /** The tile the camera centres on, and its zoom. */
  readonly focus: { readonly x: number; readonly y: number };
  readonly zoom: number;
  readonly actions: readonly StageAction[];
}
