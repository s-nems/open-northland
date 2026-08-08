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
import type { EquipPickEntry, PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../../catalog/professions.js';
import type { PortraitBox } from '../../hud/details-panel/index.js';
import type { KeyBindings } from '../../hud/keybindings.js';

export interface UnitControlsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly uiscale?: number;
  readonly camera: () => Camera;
  readonly snapshot: () => WorldSnapshot;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly humanPlayer: number;
  /** In an observer session every player's entities are pickable as if owned and no unit reads as an
   *  enemy. Default false. */
  readonly observer?: boolean;
  readonly lang: string;
  readonly bindings: KeyBindings;
  readonly professions: readonly PickerEntry[];
  readonly content: ContentSet;
  readonly sheet?: SpriteSheet;
  /** Owner slot to team-colour slot; absent means identity. */
  readonly playerColourOf?: (player: number) => number;
  readonly enqueue: (command: PlayerCommand) => void;
  /** Re-centre the main view on a world-px point at the current zoom; the hud layer never reaches the
   *  camera itself. */
  readonly centerOn: (worldX: number, worldY: number) => void;
  /** The last drawn frame's culled, depth-sorted draw list (empty before the first). Clicks hit-test
   *  against it, so picking inherits the frame's viewport and fog culls. */
  readonly drawnItems: () => readonly DrawItem[];
  /** The frame's fog-filtered door badges; absent or empty disables badge picking. */
  readonly doorBadges?: () => readonly DoorBadge[];
  /** The sim's equip pick-list read seam (`Simulation.equipPickList`); absent leaves the equipment
   *  panel's plus/swap buttons inert. */
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
  /** The green/red assignment wash for the render building-highlight layer, or null when no assign mode
   *  is armed. */
  readonly assignHighlight: () => readonly BuildingHighlightItem[] | null;
  readonly signpostPlacementActive: () => boolean;
  readonly tick: (snapshot: WorldSnapshot) => void;
  readonly claimsPointer: (clientX: number, clientY: number) => boolean;
  readonly dispose: () => void;
}
