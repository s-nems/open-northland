import { type BuildingType, type ContentSet, lastByTypeId } from '@open-northland/data';
import type { BuildingHighlightItem, ElevationField } from '@open-northland/render';
import type { Entity, PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import { clampTile, nodeBounds, pickTopAt, worldToTile } from '../picking.js';
import { memoBySnapshot } from '../projections/index.js';
import {
  assignableJobForBuilding,
  computeAssignHighlight,
  computeHouseHighlight,
  drillPick,
  houseAssignableAt,
  sitePick,
} from './highlights/index.js';
import type { UnitOrderController } from './orders.js';
import type { UnitTargets } from './unit-targets.js';

/**
 * Arming one mode replaces whatever was armed; a click of any kind, a right-click, Esc, or a selection
 * change resolves or cancels it. Modes that name one settler carry it, because the selection may change
 * before the click lands.
 */
export type PickMode =
  | { readonly kind: BuildingPickKind; readonly settler: number }
  | { readonly kind: ScoutPickKind; readonly scout: number }
  | { readonly kind: GroundPickKind };

/** The orders one scout resolves by clicking a spot on the map. */
type ScoutPickKind = 'signpost' | 'explore';

/** The orders that resolve by clicking one of the player's own buildings. */
export type BuildingPickKind = 'workplace' | 'home' | 'building-site' | 'learning-place';

/** The orders that resolve against the world under the cursor and apply to the whole selection. */
type GroundPickKind =
  | 'destination'
  | 'work-area'
  | 'attack-move'
  | 'attack-settler'
  | 'attack-building'
  | 'attack-animal';

interface BuildingPick {
  readonly highlight: (
    snapshot: WorldSnapshot,
    settler: number,
    byType: ReadonlyMap<number, BuildingType>,
  ) => BuildingHighlightItem[];
  /** The order a click on `building` issues, or null when that building refuses this settler. */
  readonly order: (
    snapshot: WorldSnapshot,
    settler: number,
    building: number,
    byType: ReadonlyMap<number, BuildingType>,
  ) => PlayerCommand | null;
}

const BUILDING_PICKS: Readonly<Record<BuildingPickKind, BuildingPick>> = {
  workplace: {
    highlight: computeAssignHighlight,
    // This mode places the settler's current trade only; it never re-trades.
    order: (snapshot, settler, building, byType) => {
      const job = assignableJobForBuilding(snapshot, building, settler, byType);
      return job === null
        ? null
        : {
            kind: 'assignWorker',
            entity: settler as Entity,
            building: building as Entity,
            jobPriority: [job],
          };
    },
  },
  home: {
    highlight: computeHouseHighlight,
    order: (snapshot, settler, building, byType) =>
      houseAssignableAt(snapshot, building, settler, byType)
        ? { kind: 'assignHouse', entity: settler as Entity, house: building as Entity }
        : null,
  },
  'building-site': {
    highlight: sitePick.highlight,
    order: (snapshot, settler, building, byType) =>
      sitePick.assignableAt(snapshot, building, settler, byType)
        ? { kind: 'assignBuilder', entity: settler as Entity, site: building as Entity }
        : null,
  },
  'learning-place': {
    highlight: drillPick.highlight,
    order: (snapshot, settler, building, byType) =>
      drillPick.assignableAt(snapshot, building, settler, byType)
        ? { kind: 'trainSoldier', entity: settler as Entity, house: building as Entity }
        : null,
  },
};

const isBuildingPick = (mode: PickMode): mode is Extract<PickMode, { readonly settler: number }> =>
  'settler' in mode;

/** Modes whose target is a point or a unit rather than a lit building, so the cursor carries the prompt. */
const CROSSHAIR_MODES: ReadonlySet<PickMode['kind']> = new Set<GroundPickKind | ScoutPickKind>([
  'destination',
  'work-area',
  'attack-move',
  'attack-settler',
  'attack-building',
  'attack-animal',
  'explore',
]);

export interface PickModeDeps {
  readonly snapshot: () => WorldSnapshot;
  readonly targets: UnitTargets;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  /** The order controller owns every selection-wide order, so a walk fans a group out through the same
   *  formation spread whether it was armed here or right-clicked. Read at click time: it is built after
   *  this controller. */
  readonly orders: () => UnitOrderController;
  /** Named addition: the original signals an armed mode with prompt text, not a cursor. */
  readonly setArmedCursor: (armed: boolean) => void;
}

export interface PickModeController {
  arm(mode: PickMode): void;
  cancel(): void;
  isArmed(): boolean;
  signpostActive(): boolean;
  /** True when a mode was armed: the press resolved or cancelled it, so the caller must not fall through
   *  to selection or an order. */
  handleMouseDown(event: MouseEvent): boolean;
  highlight(): readonly BuildingHighlightItem[] | null;
}

export function createPickModeController(deps: PickModeDeps): PickModeController {
  const buildingsByType = lastByTypeId(deps.content.buildings);
  let pickMode: PickMode | null = null;
  let pickVersion = 0;
  const setMode = (next: PickMode | null): void => {
    pickMode = next;
    pickVersion++;
    deps.setArmedCursor(next !== null && CROSSHAIR_MODES.has(next.kind));
  };
  const cancel = (): void => setMode(null);

  const resolveBuilding = (event: MouseEvent, kind: BuildingPickKind, settler: number): void => {
    const w = deps.toWorld(event.clientX, event.clientY);
    const building = pickTopAt(deps.targets.owned('building'), w.x, w.y);
    if (building === null) return;
    const order = BUILDING_PICKS[kind].order(deps.snapshot(), settler, building, buildingsByType);
    if (order !== null) deps.enqueue(order);
  };

  // Named deviation from the observed original, which erects with a right-click on lit ground: this
  // places with a left-click and dims blocked ground, matching build placement.
  const resolveSignpost = (event: MouseEvent, scout: number): void => {
    deps.enqueue({ kind: 'placeSignpost', entity: scout as Entity, ...clickedNode(event) });
  };

  /** The explore order centres the scout's sweep on the clicked spot, as the original does. */
  const resolveExplore = (event: MouseEvent, scout: number): void => {
    deps.enqueue({ kind: 'exploreArea', entity: scout as Entity, ...clickedNode(event) });
  };

  /** The clicked point as an on-map half-cell node. */
  const clickedNode = (event: MouseEvent): { x: number; y: number } => {
    const { width, height } = nodeBounds(deps.mapSize);
    const w = deps.toWorld(event.clientX, event.clientY);
    const target = clampTile(worldToTile(w.x, w.y, deps.elevation), width, height);
    return { x: target.col, y: target.row };
  };

  const handleMouseDown = (event: MouseEvent): boolean => {
    const mode = pickMode;
    if (mode === null) return false;
    // A selection change cancels any armed mode, so the selection read at click time is still the one
    // this mode was armed for.
    cancel();
    if (event.button !== 0) return true; // any other button just calls the mode off
    switch (mode.kind) {
      case 'workplace':
      case 'home':
      case 'building-site':
      case 'learning-place':
        resolveBuilding(event, mode.kind, mode.settler);
        return true;
      case 'signpost':
        resolveSignpost(event, mode.scout);
        return true;
      case 'explore':
        resolveExplore(event, mode.scout);
        return true;
      case 'destination':
        deps.orders().issueMoveTo(event);
        return true;
      case 'work-area':
        deps.orders().issueSetWorkFlag(event);
        return true;
      case 'attack-move':
        deps.orders().issueAttackMove(event);
        return true;
      case 'attack-settler':
        deps.orders().issueAttackTarget(event, 'settler');
        return true;
      case 'attack-building':
        deps.orders().issueAttackTarget(event, 'building');
        return true;
      case 'attack-animal':
        deps.orders().issueAttackAnimal(event);
        return true;
      default: {
        const unreachable: never = mode;
        throw new Error(`unhandled pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  /** Read every frame, so the O(entities) pass is memoized on everything it reads: the snapshot instance
   *  plus `pickVersion`, which every arm and cancel bumps. */
  const highlightFor = memoBySnapshot(
    (snapshot: WorldSnapshot) => {
      const mode = pickMode;
      // Only the building picks light targets up; the rest show on the ground or the cursor.
      if (mode === null || !isBuildingPick(mode)) return null;
      return BUILDING_PICKS[mode.kind].highlight(snapshot, mode.settler, buildingsByType);
    },
    () => pickVersion,
  );

  return {
    arm: setMode,
    cancel,
    isArmed: () => pickMode !== null,
    signpostActive: () => pickMode?.kind === 'signpost',
    handleMouseDown,
    highlight: () => highlightFor(deps.snapshot()),
  };
}
