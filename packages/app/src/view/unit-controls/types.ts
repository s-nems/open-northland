import type { UiCue } from '@open-northland/audio';
import type { ContentSet, EquipCategory } from '@open-northland/data';
import type {
  BuildingHighlightItem,
  Camera,
  DoorBadge,
  DrawItem,
  ElevationField,
  EntityBounds,
  SpriteSheet,
  WorkAreaRing,
} from '@open-northland/render';
import type {
  EquipPickEntry,
  PlayerCommand,
  TradeOffer,
  TraderView,
  WorldSnapshot,
} from '@open-northland/sim';
import type { Application, Texture } from 'pixi.js';
import type { PickerEntry } from '../../catalog/professions.js';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import type { PortraitBox } from '../../hud/details-panel/index.js';
import type { KeyBindings } from '../../hud/keybindings.js';
import type { OverviewPress } from './overview-orders.js';

export interface UnitControlsOptions {
  readonly technologyStatus?: import('@open-northland/sim').Simulation['unlockStatus'];
  /** The sim's own answer to whether a settler may take a trade; the picker offers a row when a selected
   *  settler the profession order reaches may, and changes only those who may. */
  readonly canChooseJob: (entity: number, jobType: number) => boolean;
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly uiscale?: number;
  readonly camera: () => Camera;
  readonly snapshot: () => WorldSnapshot;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  /** Whose entities are pickable and orderable; while it names no seat, every player's are pickable as
   *  if owned and no unit reads as an enemy. */
  readonly viewer: ViewerSeat;
  /** Whether the viewer's seat holds an `enemy` stance toward `owner`; gates the right-click attack set. */
  readonly hostileToward: (owner: number) => boolean;
  readonly lang: string;
  readonly bindings: KeyBindings;
  readonly professions: readonly PickerEntry[];
  readonly content: ContentSet;
  readonly sheet?: SpriteSheet;
  /** The presentation pack's goods icons for the details panel, by good id. */
  readonly packGoods?: ReadonlyMap<string, Texture>;
  /** Owner slot to team-colour slot; absent means identity. */
  readonly playerColourOf?: (player: number) => number;
  readonly enqueue: (command: PlayerCommand) => void;
  /** The map's own string by id, for the names a map gives its settlers. */
  readonly mapText?: (stringId: number) => string | undefined;
  /** Re-centre the main view on a world-px point at the current zoom; the hud layer never reaches the
   *  camera itself. */
  readonly centerOn: (worldX: number, worldY: number) => void;
  /** The last drawn frame's culled, depth-sorted draw list (empty before the first). Clicks hit-test
   *  against it, so picking inherits the frame's viewport and fog culls. */
  readonly drawnItems: () => readonly DrawItem[];
  /** Whether a resource's live tile is currently visible rather than only remembered through fog. */
  readonly resourceVisible?: (tileX: number, tileY: number) => boolean;
  /** The frame's fog-filtered door badges; absent or empty disables badge picking. */
  readonly doorBadges?: () => readonly DoorBadge[];
  /** The sim's equip pick-list read seam (`Simulation.equipPickList`); absent leaves the equipment
   *  panel's plus/swap buttons inert. */
  readonly equipPickList?: (entity: number, group: EquipCategory) => readonly EquipPickEntry[];
  /** The sim's battle-alert read seam (`Simulation.standsTo`); absent leaves a unit holding its ground
   *  under fire captioned as idle. */
  readonly standsTo?: (entity: number) => boolean;
  /** The sim's trader read seams (`Simulation.traderView` / `tradeOffersAt`); absent hides trade. */
  readonly traderView?: (entity: number) => TraderView | undefined;
  readonly tradeOffersAt?: (house: number) => readonly TradeOffer[];
  /** The sim's vehicle rules (`Simulation.canAttachToVehicle` / `mooringProbe`), which light the
   *  "Assign Vehicle" and dock picks' targets and gate their clicks; absent, the picks light nothing
   *  and the sim alone refuses. */
  readonly canAttachToVehicle?: (settler: number, vehicle: number) => boolean;
  readonly canMoorAt?: (vehicle: number, x: number, y: number) => boolean;
  readonly boundsOf?: (ref: number) => EntityBounds | undefined;
  readonly pixelHitOf?: (ref: number, wx: number, wy: number) => boolean | undefined;
  readonly claimPointer?: (clientX: number, clientY: number) => boolean;
  /** The GUI click feedback: a pressed button, a taken selection or an accepted order confirms, a
   *  cancelled pick fails. Absent, silent. */
  readonly onUiCue?: (cue: UiCue) => void;
  readonly tooltip?: {
    show(clientX: number, clientY: number, text: string): void;
    hide(): void;
  };
}

export interface UnitControls {
  readonly selectedIds: () => ReadonlySet<number>;
  readonly selectionVersion: () => number;
  /** Replace the selection with one entity, as a click on it would. */
  readonly selectEntity: (id: number) => void;
  /** Take a press on the map overview as an order at the world spot it depicts. */
  readonly overviewPress: OverviewPress;
  /** Replace the selection, as a map script's `SelectHuman` does. */
  readonly select: (ids: Iterable<number>) => void;
  readonly portrait: () => PortraitBox | null;
  readonly flaggedFlagIds: () => ReadonlySet<number>;
  /** The work-area circles the "Show Work Area" order has switched on. */
  readonly workAreaRings: () => readonly WorkAreaRing[];
  /** The green/red assignment wash for the render building-highlight layer, or null when no assign mode
   *  is armed. */
  readonly assignHighlight: () => readonly BuildingHighlightItem[] | null;
  readonly signpostPlacementActive: () => boolean;
  /** True while an Escape would land here: the job list is open, a pick is armed or units are selected. */
  readonly claimsEscape: () => boolean;
  /** The ship whose dock pick is armed, whose mooring spots the frame loop washes onto the map. */
  readonly dockPickVehicle: () => number | null;
  readonly tick: (snapshot: WorldSnapshot) => void;
  readonly claimsPointer: (clientX: number, clientY: number) => boolean;
  /** Hide the details panel with the rest of the HUD and close the ring; a ring opened while hidden
   *  shows. The selection itself stays. */
  readonly setHudHidden: (hidden: boolean) => void;
  readonly setUiScale: (uiscale: number) => Promise<void>;
  readonly dispose: () => void;
}
