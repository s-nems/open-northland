import type { ContentSet, EquipCategory } from '@open-northland/data';
import type {
  BuildingHighlightItem,
  Camera,
  DoorBadge,
  DrawItem,
  ElevationField,
  EntityBounds,
  SpriteSheet,
} from '@open-northland/render';
import type { Command, EquipPickEntry, WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../../catalog/professions.js';
import type { PortraitBox } from '../../hud/details-panel/index.js';

export interface UnitControlsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly uiscale?: number;
  readonly camera: () => Camera;
  readonly snapshot: () => WorldSnapshot;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly humanPlayer: number;
  /** The observer session: every player's entities are pickable as if owned (attack targeting is
   *  moot - with no side to fight for, no unit reads as an enemy). Default false. */
  readonly observer?: boolean;
  readonly lang: string;
  readonly professions: readonly PickerEntry[];
  readonly content: ContentSet;
  readonly sheet?: SpriteSheet;
  /** Owner slot → team-colour slot for the details panel's worker sprites (a map roster's colour
   *  choices); absent = identity. */
  readonly playerColourOf?: (player: number) => number;
  readonly enqueue: (command: Command) => void;
  /** Re-centre the main view on a world-px point at the current zoom - the camera controller's jump,
   *  injected like the minimap's (the hud layer never reaches the camera itself). */
  readonly centerOn: (worldX: number, worldY: number) => void;
  /** The renderer's culled, depth-sorted draw list for the last drawn frame (empty before the first) -
   *  what a click hit-tests against, so selection and attack targeting inherit the frame's viewport and
   *  fog culls instead of re-deriving them from the snapshot. */
  readonly drawnItems: () => readonly DrawItem[];
  /** The frame's fog-filtered door badges - what a click on a building's sign chain hit-tests to select
   *  the settler a row stands for. Absent (or empty, e.g. no decoded sign art) disables badge picking. */
  readonly doorBadges?: () => readonly DoorBadge[];
  /** The sim's equip pick-list read seam (`Simulation.equipPickList`) - what the equipment panel's
   *  plus/swap buttons list. Absent (a shell with no live sim handle) leaves those buttons inert. */
  readonly equipPickList?: (entity: number, group: EquipCategory) => readonly EquipPickEntry[];
  readonly boundsOf?: (ref: number) => EntityBounds | undefined;
  readonly pixelHitOf?: (ref: number, wx: number, wy: number) => boolean | undefined;
  readonly claimPointer?: (clientX: number, clientY: number) => boolean;
  readonly tooltip?: {
    show(clientX: number, clientY: number, text: string): void;
    hide(): void;
  };
}

export interface UnitControls {
  readonly selectedIds: () => ReadonlySet<number>;
  /** Bumped on every actual selection change - {@link selectedIds} is one mutated set, so its identity
   *  cannot key a memo. */
  readonly selectionVersion: () => number;
  readonly portrait: () => PortraitBox | null;
  readonly flaggedFlagIds: () => ReadonlySet<number>;
  /** The green/red workplace-assignment wash for the render building-highlight layer, or null when the
   *  player isn't choosing a workplace. Read each frame by the game loop. */
  readonly assignHighlight: () => readonly BuildingHighlightItem[] | null;
  /** Whether the player is choosing a signpost spot ("Erect Signpost" mode) - the game loop shows the
   *  placement overlay (dim where the erect click would be refused) while this is true. */
  readonly signpostPlacementActive: () => boolean;
  readonly tick: (snapshot: WorldSnapshot) => void;
  readonly claimsPointer: (clientX: number, clientY: number) => boolean;
  readonly dispose: () => void;
}
