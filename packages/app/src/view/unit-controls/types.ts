import type { UiCue, VoiceCall } from '@open-northland/audio';
import type { ContentSet, EquipCategory } from '@open-northland/data';
import type {
  Camera,
  DoorBadge,
  DrawItem,
  ElevationField,
  EntityBounds,
  LostGoalMarker,
  OrderMarker,
  RangeRing,
  SpriteSheet,
  TargetFlash,
  TargetMark,
} from '@open-northland/render';
import type {
  Entity,
  EquipPickEntry,
  EquipSelectionPick,
  FormationOrder,
  FormationSlotGroup,
  HalfCellNode,
  PlayerCommand,
  SignpostReachView,
  TradeOffer,
  TraderView,
  UnlockKind,
  UnlockStatus,
  WorldSnapshot,
} from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../../catalog/professions.js';
import type { UiString } from '../../content/gui/gfx.js';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import type { PortraitBox, UnitPanelModelContext } from '../../hud/details-panel/index.js';
import type { DiplomacyStance, SettlerWorkStatus } from '../../hud/details-panel/model/index.js';
import type { BuildingPanelWindows } from '../../hud/dom/building-panel/actions.js';
import type { CentralWindows } from '../../hud/dom/trade-window/window.js';
import type { FigureFrames } from '../../hud/figures/figure-frames.js';
import type { KeyBindings } from '../../hud/keybindings.js';
import type { ResidentRow } from '../../hud/tool-panel/residents/rows.js';
import type { PresentationPack } from '../../presentation/pack.js';
import type { CameraGestures } from '../camera/index.js';
import type { MapPingController } from '../map-ping/controller.js';
import type { Tile } from '../picking.js';
import type { ControlGroupMembers } from './control-groups.js';
import type { Berth, MooringRule } from './orders/berths.js';
import type { OverviewPress } from './orders/overview.js';
import type { TradeStances } from './orders/trade-refusal.js';

/** The sim's technology read (`SessionHost.unlockStatus`) as its last answer; undefined until one
 *  landed. */
export type TechnologyStatusRead = (
  kind: UnlockKind,
  typeId: number,
  tribe: number,
  player?: number,
) => UnlockStatus | undefined;

export interface UnitControlsOptions {
  readonly requestFormationSlots?: (
    target: HalfCellNode,
    members: readonly Entity[],
    rowSpacing: 1 | 2,
    order: FormationOrder,
  ) => Promise<readonly FormationSlotGroup[] | null>;
  readonly technologyStatus?: TechnologyStatusRead;
  /** Bumped when a `technologyStatus` answer changes, which rebuilds the school dialog under one
   *  snapshot; absent, only a new snapshot does. */
  readonly technologyVersion?: () => number;
  /** Bumped when an answer the details panel reads changes (technology, battle alert, trader, house
   *  offers). */
  readonly panelAnswersVersion?: () => number;
  /** Bumped when an attach rule's answer changes, which re-lights the picks. */
  readonly attachPicksVersion?: () => number;
  /** The sim's own answer to whether a settler may take a trade; the picker offers a row when a selected
   *  settler the profession order reaches may, and changes only those who may. */
  readonly canChooseJob: (entity: number, jobType: number) => boolean;
  /** `canChooseJob` as of now, which a profession pick awaits before it orders. */
  readonly askCanChooseJob: (entity: number, jobType: number) => Promise<boolean>;
  /** Bumped when a `canChooseJob` answer changes, which redraws an open profession list. */
  readonly jobChoicesVersion: () => number;
  /** The job-choice and attach rules' last answers, undefined while unanswered; the label beside the
   *  cursor reads them, and names the action optimistically without them. */
  readonly jobChoiceAnswer?: (entity: number, jobType: number) => boolean | undefined;
  readonly tradeHouseAttachAnswer?: (trader: number, house: number) => boolean | undefined;
  readonly tradeShipPinAnswer?: (trader: number, ship: number) => boolean | undefined;
  readonly vehicleAttachAnswer?: (settler: number, vehicle: number) => boolean | undefined;
  /** Whether the label beside the cursor yields to a placement mode or a hidden HUD. */
  readonly hintSuppressed?: () => boolean;
  /** The player's cursor-hints setting the label starts with; absent, it shows. */
  readonly cursorHints?: boolean;
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly uiscale?: number;
  readonly camera: () => Camera;
  /** The camera gestures a modal choice (professions, school, equipment) hands on to the map. */
  readonly cameraGestures: CameraGestures;
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
  /** The map pings of a relayed game; an armed ping takes the next press before any order, and gives
   *  way to a pick armed after it. */
  readonly mapPing?: MapPingController;
  /** The control groups a loaded save restores; absent, every group starts empty. */
  readonly controlGroups?: ControlGroupMembers;
  readonly professions: readonly PickerEntry[];
  readonly content: ContentSet;
  /** Owner slot to team-colour slot; absent means identity. */
  readonly playerColourOf?: (player: number) => number;
  readonly enqueue: (command: PlayerCommand) => void;
  /** The session drops every command `enqueue` takes (a spectator); absent, it issues them. */
  readonly readOnly?: () => boolean;
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
  /** The sim's equip pick-list (`SessionHost.equipPickList`), asked as a window opens or a goods heap is
   *  clicked; absent leaves the equipment panel's plus/swap buttons inert and the heap click a walk. */
  readonly requestEquipPicks?: (entity: number, group: EquipCategory) => Promise<readonly EquipPickEntry[]>;
  /** The sim's selection-wide equip menu (`SessionHost.equipPicksForSelection`), asked as the ring's
   *  "Change Equipment" opens; absent with `requestEquipPicks` leaves the picker unmounted. */
  readonly requestSelectionEquipPicks?: (
    entities: readonly number[],
  ) => Promise<readonly EquipSelectionPick[]>;
  /** The sim's battle-alert read seam (`SessionHost.standsTo`); absent leaves a unit holding its ground
   *  under fire captioned as idle. */
  readonly standsTo?: (entity: number) => boolean;
  /** The sim's trader read seams (`SessionHost.traderView` / `tradeOffersAt`); absent hides trade. */
  readonly signpostReach?: (player: number) => SignpostReachView | null;
  readonly traderView?: (entity: number) => TraderView | undefined;
  readonly tradeOffersAt?: (house: number) => readonly TradeOffer[];
  /** The sim's trade-stop rule (`SessionHost.tradeHousesAttachableBy`) as its last answer, which lights
   *  the trade-house pick's targets; absent, the pick lights nothing. */
  readonly canAttachTradeHouse?: (trader: number, house: number) => boolean;
  /** The same rule asked as a click lands, which gates the pick's click and a trader's right-click on a
   *  house; absent, neither puts a house on a route. */
  readonly askAttachTradeHouse?: (trader: number, house: number) => Promise<boolean>;
  /** The sim's ship pin rule (`SessionHost.tradeShipsPinnableBy`) as its last answer, which lights the
   *  trade-ship pick's targets; absent, the pick lights nothing. */
  readonly canPinTradeShip?: (trader: number, ship: number) => boolean;
  /** The same rule asked as the pick's click lands; absent, the pick pins nothing. */
  readonly askPinTradeShip?: (trader: number, ship: number) => Promise<boolean>;
  /** The viewer's stance toward `owner` and `owner`'s back, which explain a refused foreign trade stop;
   *  absent, the refusal is silent. */
  readonly tradeStances?: (owner: number) => TradeStances;
  /** Whether `house` stands and offers agreements, asked as a refusal lands; absent, it is silent. */
  readonly offersTrade?: (house: number) => Promise<boolean>;
  /** Raises the note that a route refused a house of `owner` over the stances; absent, it is silent. */
  readonly noteTradeRefused?: (owner: number, at: HalfCellNode | null) => void;
  /** Fresh signpost placement verdict for a click; absent refuses the placement. */
  readonly askPlaceSignpostAt?: (col: number, row: number) => Promise<boolean>;
  /** The signpost rule's last answer, undefined while unanswered, which the signpost pick's label reads. */
  readonly signpostAnswerAt?: (col: number, row: number) => boolean | undefined;
  /** Bumped when a signpost or mooring answer lands or changes, which re-reads the label. */
  readonly placementAnswersVersion?: () => number;
  /** The sim's vehicle attach rule (`SessionHost.vehiclesAttachableBy`) as its last answer, which lights
   *  the "Assign Vehicle" pick's targets; absent, the pick lights nothing. */
  readonly canAttachToVehicle?: (settler: number, vehicle: number) => boolean;
  /** The attach and mooring rules asked as a click lands; absent, the sim alone refuses. */
  readonly askAttachToVehicle?: (settler: number, vehicle: number) => Promise<boolean>;
  readonly askMooring?: (vehicle: number) => Promise<MooringRule | null>;
  /** The mooring rule's last answer, which the berth preview under the cursor reads. */
  readonly mooring?: (vehicle: number) => MooringRule | null | undefined;
  readonly boundsOf?: (ref: number) => EntityBounds | undefined;
  readonly pixelHitOf?: (ref: number, wx: number, wy: number) => boolean | undefined;
  /** Whether the point is on a claimed wall or road site's work flag; absent, that flag is the site's. */
  readonly siteFlagHitOf?: (ref: number, wx: number, wy: number) => boolean;
  readonly claimPointer?: (clientX: number, clientY: number) => boolean;
  /** The GUI click feedback: a pressed button, a taken selection or an accepted order confirms, a
   *  cancelled pick fails. Absent, silent. */
  readonly onUiCue?: (cue: UiCue) => void;
  /** The settlers' own voices acknowledging the player: a selection taken with a click or a box, and a
   *  walk every member refused. Each plays the call's fallback cue when nobody in it can speak; absent,
   *  the GUI cues alone answer. */
  readonly voices?: {
    readonly select: (call: VoiceCall) => void;
    readonly refuse: (call: VoiceCall) => void;
  };
  /** The DOM plane the settler panel mounts on, and what its icons, hover card and trade browsing read. */
  readonly domHud: {
    readonly plane: HTMLElement;
    /** The plane's current scale, which turns a client point into a design-px one. */
    readonly scale: () => number;
    readonly pack: PresentationPack | null;
    readonly uiString: UiString;
    /** The seat's people, memoized per snapshot by the caller. */
    readonly residents: () => readonly ResidentRow[];
    /** The tool panel's central windows, which the trade window takes turns with and the building
     *  panel opens. */
    readonly centralWindows?: CentralWindows & BuildingPanelWindows;
    /** The map's sprite sheet and its recoloured-frame cache, which draw the panels' live people;
     *  absent, the wells keep their glyphs. */
    readonly figures?: { readonly sheet: SpriteSheet; readonly frames: FigureFrames };
  };
  /** The sim's work-status read seam (`Simulation.workStatus`); absent leaves the status detail out. */
  readonly workStatus?: (entity: number) => SettlerWorkStatus | undefined;
  /** The viewer seat's stance toward another owner, for a foreign person's owner line. */
  readonly diplomacyStance?: (owner: number) => DiplomacyStance;
  /** The roster's authored seat name, for another seat's house card; absent numbers the seat. */
  readonly seatNameOf?: (player: number) => string | undefined;
}

export interface UnitControls {
  /** The content and sim reads the details panels' models are built from, for other views of a unit. */
  readonly panelModelContext: UnitPanelModelContext;
  readonly selectedIds: () => ReadonlySet<number>;
  readonly selectionVersion: () => number;
  /** Replace the selection with one entity, as a click on it would. */
  readonly selectEntity: (id: number) => void;
  /** Take a press on the map overview as an order at the world spot it depicts. */
  readonly overviewPress: OverviewPress;
  /** Arm a map ping for the next click, calling off an armed pick, or call an armed ping off. */
  readonly toggleMapPing: () => void;
  /** Replace the selection, as a map script's `SelectHuman` does. */
  readonly select: (ids: Iterable<number>) => void;
  /** The live cutouts the frame paints: the selection's portrait and the trade window's houses. */
  readonly portraits: () => readonly PortraitBox[];
  readonly flaggedFlagIds: () => ReadonlySet<number>;
  /** The selected unit the HUD points at, whose ring the map lights over the green one. */
  readonly focusedIds: () => ReadonlySet<number>;
  /** Control-group member id → the numbers of its groups the map marks it with. */
  readonly groupNumbers: () => ReadonlyMap<number, readonly string[]>;
  readonly controlGroupMembers: () => ControlGroupMembers;
  /** The range circles of the selection and of the settlers "Show Work Area" switched on. */
  readonly rangeRings: () => readonly RangeRing[];
  /** The ground acknowledgements of the latest walk and march orders still playing. */
  readonly orderMarkers: () => readonly OrderMarker[];
  /** The order targets still playing their one-time flash. */
  readonly targetFlashes: () => ReadonlyMap<number, TargetFlash>;
  /** The refused goals of the selected lost settlers; the same list while they stand still. */
  readonly lostGoals: () => readonly LostGoalMarker[];
  /** The armed pick's verdicts on its targets, or null when no pick that judges targets is armed. */
  readonly targetMarks: () => readonly TargetMark[] | null;
  /** Aims the armed pick at the client point (null off the world view): the candidate a press there
   *  would order, or null. The pointer refuses over a refused target. */
  readonly aimTarget: (
    pointer: { readonly clientX: number; readonly clientY: number } | null,
  ) => number | null;
  /** The viewer's own wall or gate drawn on top under each client point, or null there. */
  readonly ownWallsAt: (points: readonly { readonly x: number; readonly y: number }[]) => (number | null)[];
  readonly signpostPlacementActive: () => boolean;
  /** A flag trade's workplace pick is armed: the placement ghost shows its flag under the cursor. */
  readonly workFlagPlacementActive: () => boolean;
  /** A barracks' rally-point pick is armed: the ghost shows the tinted rally flag, not the work one. */
  readonly rallyPickActive: () => boolean;
  /** True while an Escape would land here: the job list is open, a pick is armed or units are selected. */
  readonly claimsEscape: () => boolean;
  /** True while the trade window stands, which these controls close on Escape. */
  readonly windowOpen: () => boolean;
  /** The ship whose dock pick is armed, whose mooring spots the frame loop washes onto the map. */
  readonly dockPickVehicle: () => number | null;
  /** Where a dock click at `tile` would moor the ships it orders: the armed dock pick's ship, or the
   *  selected ships a right-click docks. Empty where it docks nothing. */
  readonly berthPreview: (tile: Tile) => readonly Berth[];
  readonly tick: (snapshot: WorldSnapshot) => void;
  /** Once a frame, after `tick`: the details panel's wells show their people live; `alpha` is the
   *  frame's inter-tick fraction. */
  readonly presentFigures: (snapshot: WorldSnapshot, alpha: number) => void;
  /** Refresh hit feedback after the renderer has rebuilt its screen-space targets. */
  readonly refreshCursor: (snapshot: WorldSnapshot) => void;
  readonly claimsPointer: (clientX: number, clientY: number) => boolean;
  /** Hide the details panel with the rest of the HUD and close the ring; a ring opened while hidden
   *  shows. The selection itself stays. */
  readonly setHudHidden: (hidden: boolean) => void;
  /** Shows or hides the label beside the cursor; it starts as `cursorHints` says. */
  readonly setCursorHints: (shown: boolean) => void;
  readonly setUiScale: (uiscale: number) => Promise<void>;
  readonly dispose: () => void;
}
