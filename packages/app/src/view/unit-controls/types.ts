import type { ContentSet } from '@open-northland/data';
import type {
  BuildingHighlightItem,
  Camera,
  ElevationField,
  EntityBounds,
  SpriteSheet,
} from '@open-northland/render';
import type { Command, WorldSnapshot } from '@open-northland/sim';
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
  readonly lang: string;
  readonly professions: readonly PickerEntry[];
  readonly content: ContentSet;
  readonly sheet?: SpriteSheet;
  /** Owner slot → team-colour slot for the details panel's worker sprites (a map roster's colour
   *  choices); absent = identity. */
  readonly playerColourOf?: (player: number) => number;
  readonly enqueue: (command: Command) => void;
  readonly boundsOf?: (ref: number) => EntityBounds | undefined;
  readonly pixelHitOf?: (ref: number, wx: number, wy: number) => boolean | undefined;
  readonly claimPointer?: (clientX: number, clientY: number) => boolean;
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
  readonly tooltip?: {
    show(clientX: number, clientY: number, text: string): void;
    hide(): void;
  };
}

export interface UnitControls {
  readonly selectedIds: () => ReadonlySet<number>;
  readonly portrait: () => PortraitBox | null;
  readonly flaggedFlagIds: () => ReadonlySet<number>;
  /** The green/red workplace-assignment wash for the render building-highlight layer, or null when the
   *  player isn't choosing a workplace. Read each frame by the game loop. */
  readonly assignHighlight: () => readonly BuildingHighlightItem[] | null;
  /** Whether the player is choosing a signpost spot ("Erect Signpost" mode) — the game loop shows the
   *  placement overlay (dim where the erect click would be refused) while this is true. */
  readonly signpostPlacementActive: () => boolean;
  readonly tick: (snapshot: WorldSnapshot) => void;
  readonly claimsPointer: (clientX: number, clientY: number) => boolean;
  readonly dispose: () => void;
}
