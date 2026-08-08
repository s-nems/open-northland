import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { BuildingHighlightItem, ElevationField } from '@open-northland/render';
import type { Entity, PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import { clampTile, nodeBounds, pickTopAt, worldToTile } from '../picking.js';
import { memoBySnapshot } from '../projections/index.js';
import {
  assignableJobForBuilding,
  computeAssignHighlight,
  computeHouseHighlight,
  houseAssignableAt,
} from './highlights/index.js';
import type { UnitTargets } from './unit-targets.js';

/**
 * Arming one mode replaces whatever was armed; a red-building or terrain click, a right-click, Esc, or
 * a selection change cancels the armed one.
 */
type PickMode =
  | { readonly kind: 'workplace' | 'home'; readonly settler: number }
  | { readonly kind: 'signpost'; readonly scouts: readonly number[] }
  | { readonly kind: 'attack-move' };

export interface PickModeDeps {
  readonly snapshot: () => WorldSnapshot;
  readonly targets: UnitTargets;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  /** The order controller owns the attack-move so both walks fan a group out through the same formation
   *  spread. */
  readonly issueAttackMove: (event: MouseEvent) => void;
  /** Only attack-move uses the armed crosshair. Named addition: the original signals an armed mode with
   *  prompt text (`misc/31`), not a cursor. */
  readonly setArmedCursor: (armed: boolean) => void;
}

export interface PickModeController {
  armWorkplace(settler: number): void;
  armHome(settler: number): void;
  armSignpost(scouts: readonly number[]): void;
  armAttackMove(): void;
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
    deps.setArmedCursor(next?.kind === 'attack-move');
  };
  const cancel = (): void => setMode(null);

  const resolveAssign = (event: MouseEvent, settlerId: number): void => {
    cancel();
    const w = deps.toWorld(event.clientX, event.clientY);
    const building = pickTopAt(deps.targets.owned('building'), w.x, w.y);
    if (building === null) return;
    const snapshot = deps.snapshot();
    // This mode places the settler's current trade only; it never re-trades.
    const job = assignableJobForBuilding(snapshot, building, settlerId, buildingsByType);
    if (job === null) return;
    deps.enqueue({
      kind: 'assignWorker',
      entity: settlerId as Entity,
      building: building as Entity,
      jobPriority: [job],
    });
  };

  const resolveHouseAssign = (event: MouseEvent, settlerId: number): void => {
    cancel();
    const w = deps.toWorld(event.clientX, event.clientY);
    const building = pickTopAt(deps.targets.owned('building'), w.x, w.y);
    if (building === null) return;
    if (!houseAssignableAt(deps.snapshot(), building, settlerId, buildingsByType)) return;
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
      // Named deviation from the observed original, which erects with a right-click on lit ground: this
      // places with a left-click and dims blocked ground, matching build placement.
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
      // A selection change cancels any armed mode, so the selection read at click time is still the one
      // this mode was armed for.
      case 'attack-move':
        cancel();
        if (event.button === 0) deps.issueAttackMove(event);
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
      if (pickMode === null) return null;
      switch (pickMode.kind) {
        case 'workplace':
          return computeAssignHighlight(snapshot, pickMode.settler, buildingsByType);
        case 'home':
          return computeHouseHighlight(snapshot, pickMode.settler, buildingsByType);
        case 'signpost':
          return null; // the erect mode washes the ground, not the buildings
        case 'attack-move':
          return null; // the attack-move mode shows on the cursor, not on the buildings
        default: {
          const unreachable: never = pickMode;
          return unreachable;
        }
      }
    },
    () => pickVersion,
  );

  const highlight = (): readonly BuildingHighlightItem[] | null => highlightFor(deps.snapshot());

  return {
    armWorkplace: (settler) => setMode({ kind: 'workplace', settler }),
    armHome: (settler) => setMode({ kind: 'home', settler }),
    armSignpost: (scouts) => setMode({ kind: 'signpost', scouts }),
    armAttackMove: () => setMode({ kind: 'attack-move' }),
    cancel,
    isArmed: () => pickMode !== null,
    signpostActive: () => pickMode?.kind === 'signpost',
    handleMouseDown,
    highlight,
  };
}
