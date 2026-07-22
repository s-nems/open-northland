import { type ContentSet, indexById } from '@open-northland/data';
import type { BuildingHighlightItem, ElevationField } from '@open-northland/render';
import type { Command, Entity, WorldSnapshot } from '@open-northland/sim';
import { clampTile, nodeBounds, pickTopAt, worldToTile } from '../picking.js';
import {
  assignableJobForBuilding,
  computeAssignHighlight,
  computeHouseHighlight,
  houseAssignableAt,
} from './highlights/index.js';
import type { UnitTargets } from './unit-targets.js';

/**
 * The armed click-to-pick mode, or null when none is. The three are mutually exclusive by construction —
 * arming one replaces whatever was armed:
 *  - `workplace` ("przydziel miejsce pracy") — candidate buildings wash green/red and the next left-click
 *    on a green one binds the settler to its matching slot.
 *  - `home` ("przypisz dom") — the residential twin: homes wash green/red and a green one takes the family.
 *  - `signpost` ("Erect Signpost") — the next left-click on the world orders the first scout to erect there.
 * A click on a red building / terrain, a right-click, Esc, or a selection change cancels any of them.
 */
type PickMode =
  | { readonly kind: 'workplace' | 'home'; readonly settler: number }
  | { readonly kind: 'signpost'; readonly scouts: readonly number[] };

export interface PickModeDeps {
  readonly snapshot: () => WorldSnapshot;
  readonly targets: UnitTargets;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: Command) => void;
}

export interface PickModeController {
  armWorkplace(settler: number): void;
  armHome(settler: number): void;
  armSignpost(scouts: readonly number[]): void;
  cancel(): void;
  isArmed(): boolean;
  signpostActive(): boolean;
  /** Consume a mousedown while a mode is armed. Returns true when one was armed — the caller must then
   *  stop, because the press resolved or cancelled the mode and must not fall through to selection / an
   *  order. Left resolves a mode, any other button cancels it. */
  handleMouseDown(event: MouseEvent): boolean;
  highlight(): readonly BuildingHighlightItem[] | null;
}

/** Own the armed click-to-pick modes (workplace / home / signpost) and resolve their world click. */
export function createPickModeController(deps: PickModeDeps): PickModeController {
  const buildingsByType = indexById(deps.content.buildings);
  let pickMode: PickMode | null = null;
  const cancel = (): void => {
    pickMode = null;
  };

  /** Resolve a world click while in "przydziel miejsce pracy" mode: bind the settler to the building under
   *  the cursor when it offers an open slot (a green building), else cancel. Any resolving click exits the
   *  mode (the chosen UX: assign-and-leave; a red building / terrain click just leaves). */
  const resolveAssign = (event: MouseEvent, settlerId: number): void => {
    cancel();
    const w = deps.toWorld(event.clientX, event.clientY);
    const building = pickTopAt(deps.targets.owned('building'), w.x, w.y);
    if (building === null) return; // clicked terrain / a unit — cancel
    const snapshot = deps.snapshot();
    // The button places the settler's CURRENT trade only (it never re-trades): bind exactly the building's
    // matching slot, or cancel when the building doesn't offer it (a red building).
    const job = assignableJobForBuilding(snapshot, building, settlerId, buildingsByType);
    if (job === null) return; // red — cancel
    deps.enqueue({
      kind: 'assignWorker',
      entity: settlerId as Entity,
      building: building as Entity,
      jobPriority: [job],
    });
  };

  /** Resolve a world click in "przypisz dom" mode: assign the family to the home under the cursor when
   *  it fits (a green home), else cancel. Any resolving click exits the mode (assign-and-leave). */
  const resolveHouseAssign = (event: MouseEvent, settlerId: number): void => {
    cancel();
    const w = deps.toWorld(event.clientX, event.clientY);
    const building = pickTopAt(deps.targets.owned('building'), w.x, w.y);
    if (building === null) return; // clicked terrain / a unit — cancel
    if (!houseAssignableAt(deps.snapshot(), building, settlerId, buildingsByType)) return; // red — cancel
    deps.enqueue({ kind: 'assignHouse', entity: settlerId as Entity, house: building as Entity });
  };

  const handleMouseDown = (event: MouseEvent): boolean => {
    if (pickMode === null) return false;
    const mode = pickMode;
    switch (mode.kind) {
      case 'workplace':
        if (event.button === 0) resolveAssign(event, mode.settler);
        else cancel();
        return true;
      case 'home':
        if (event.button === 0) resolveHouseAssign(event, mode.settler);
        else cancel();
        return true;
      // A left click orders the scout to erect on the clicked node. Legality is the sim command's gate
      // (an illegal spot is a logged no-op), so a bad click simply leaves the scout unmoved.
      // Named deviation (observed original, tutorial_001 briefing): the original erects with RIGHT-click
      // on ground that is "lit up"; we place with LEFT-click and dim blocked ground instead — the same
      // convention as our build placement, so the two placement modes read identically.
      case 'signpost': {
        const scout = mode.scouts[0];
        cancel();
        if (event.button === 0 && scout !== undefined) {
          const { width, height } = nodeBounds(deps.mapSize);
          const w = deps.toWorld(event.clientX, event.clientY);
          const target = clampTile(worldToTile(w.x, w.y, deps.elevation), width, height);
          deps.enqueue({ kind: 'placeSignpost', entity: scout as Entity, x: target.col, y: target.row });
        }
        return true;
      }
      default: {
        const unreachable: never = mode; // exhaustive: a new PickMode kind fails to compile here
        throw new Error(`unhandled pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  /** The green/red building wash for the render layer — the workplace-assign or home-assign candidates,
   *  else null. Recomputed per frame from the live snapshot (an O(entity count) pass) so a slot/house
   *  filling elsewhere re-colours immediately; only runs while a pick mode is armed, a transient gesture. */
  const highlight = (): readonly BuildingHighlightItem[] | null => {
    if (pickMode === null) return null;
    switch (pickMode.kind) {
      case 'workplace':
        return computeAssignHighlight(deps.snapshot(), pickMode.settler, buildingsByType);
      case 'home':
        return computeHouseHighlight(deps.snapshot(), pickMode.settler, buildingsByType);
      case 'signpost':
        return null; // the erect mode washes the ground (placement overlay), not the buildings
      default: {
        const unreachable: never = pickMode;
        return unreachable;
      }
    }
  };

  return {
    armWorkplace: (settler) => {
      pickMode = { kind: 'workplace', settler };
    },
    armHome: (settler) => {
      pickMode = { kind: 'home', settler };
    },
    armSignpost: (scouts) => {
      pickMode = { kind: 'signpost', scouts };
    },
    cancel,
    isArmed: () => pickMode !== null,
    signpostActive: () => pickMode?.kind === 'signpost',
    handleMouseDown,
    highlight,
  };
}
