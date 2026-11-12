import type { Entity, GroupMember, GroupWorker, UnitSelectionCommand } from '@open-northland/sim';
import type { Tile } from '../../picking.js';
import type { BuildingIntent } from '../right-click/building-rungs.js';
import type { UnitOrderDeps } from './controller.js';
import type { FormationUnit } from './formation.js';
import { enqueueUnitSelection } from './group.js';

/** What the right-click ladder's building rungs need from the order controller. */
export interface BuildingOrderDeps extends Pick<UnitOrderDeps, 'enqueue' | 'flashTarget'> {
  readonly onOrderLimit: () => void;
  /** A walk to `tile`, behind each unit's current order when `queued`. */
  readonly walkTo: (tile: Tile, units: readonly FormationUnit[], queued: boolean) => boolean;
  readonly openSchool: (house: number, units: readonly number[]) => boolean;
}

/** Issues a building rung's order; true when it opened the school dialog or enqueued an order, so a
 *  building that takes none of the selection stays silent. A site or a Shift click always answers. */
export type IssueBuildingIntent = (intent: BuildingIntent, event: MouseEvent, queued: boolean) => boolean;

export function createBuildingOrders(deps: BuildingOrderDeps): IssueBuildingIntent {
  const { onOrderLimit, walkTo, openSchool } = deps;

  const builderCommands = (builders: readonly FormationUnit[], site: number, queued: boolean) =>
    builders.map(
      (unit): UnitSelectionCommand => ({
        kind: 'assignBuilder',
        entity: unit.ref as Entity,
        site: site as Entity,
        ...(queued ? { queued } : {}),
      }),
    );

  /** Send `commands` as one gesture and flash `target` when they went out. */
  const send = (commands: readonly UnitSelectionCommand[], target: number): boolean => {
    const sent = enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
    if (sent) deps.flashTarget?.(target, 'assign');
    return sent;
  };

  const trainCommands = (recruits: readonly FormationUnit[], house: number, queued: boolean) =>
    recruits.map(
      (unit): UnitSelectionCommand => ({
        kind: 'trainSoldier',
        entity: unit.ref as Entity,
        house: house as Entity,
        ...(queued ? { queued } : {}),
      }),
    );

  const drillCommands = (drillers: readonly FormationUnit[], house: number) =>
    drillers.map(
      (unit): UnitSelectionCommand => ({
        kind: 'orderCoinDrill',
        entity: unit.ref as Entity,
        house: house as Entity,
      }),
    );

  return (intent, event, queued) => {
    switch (intent.kind) {
      case 'school': {
        const ordered = send(builderCommands(intent.crew, intent.building, false), intent.building);
        if (intent.learners.length === 0) return ordered;
        const opened = openSchool(
          intent.building,
          intent.learners.map((unit) => unit.ref),
        );
        // The press's default would pull focus off the modal it just opened.
        if (opened) event.preventDefault();
        return opened || ordered;
      }
      case 'building': {
        const { building } = intent;
        let ordered = enqueueUnitSelection(
          [
            ...builderCommands(intent.crew, building, false),
            ...trainCommands(intent.trainees, building, false),
            ...drillCommands(intent.drillers, building),
          ],
          deps.enqueue,
          onOrderLimit,
        );
        if (intent.household.length > 0) {
          const members = intent.household.map((unit): GroupMember => ({ entity: unit.ref as Entity }));
          deps.enqueue({ kind: 'assignHouseGroup', members, house: building as Entity });
          ordered = true;
        }
        if (intent.workers.length > 0) {
          const members = intent.workers.map(
            ({ unit, jobPriority }): GroupWorker => ({ entity: unit.ref as Entity, jobPriority }),
          );
          deps.enqueue({ kind: 'assignWorkerGroup', building: building as Entity, members });
          ordered = true;
        }
        if (ordered) deps.flashTarget?.(building, 'assign');
        return ordered;
      }
      case 'queueAtBuilding':
        send(builderCommands(intent.crew, intent.building, true), intent.building);
        send(trainCommands(intent.recruits, intent.building, true), intent.building);
        if (intent.walkers.length > 0) walkTo(intent.tile, intent.walkers, true);
        return true;
      case 'site':
        send(builderCommands(intent.builders, intent.site, queued), intent.site);
        if (intent.walkers.length > 0) walkTo(intent.tile, intent.walkers, queued);
        return true;
    }
  };
}
