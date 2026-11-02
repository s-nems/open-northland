import { messages } from '../../../i18n/index.js';
import { SECONDS_PER_TICK } from '../../knowledge/base.js';
import { combatTargets, landed, stepSeconds } from '../../knowledge/combat.js';
import {
  VEHICLE_BLOCKS,
  type VehicleBlock,
  vehicleHolds,
  vehicleWeapon,
} from '../../knowledge/entry-blocks.js';
import { cadenceText, rangeText, speedText, wholeText } from '../../knowledge/entry-format.js';
import type { KnowledgeVehicle, KnowledgeVehicleClass } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import {
  articleLinks,
  type Child,
  type EntryBlock,
  entryPage,
  factList,
  goodHead,
  goodLinks,
  jobLink,
  links,
  originBlock,
  paragraph,
  section,
} from './entry-parts.js';

const copy = () => messages().knowledge.entry;

function purposeOf(vehicleClass: KnowledgeVehicleClass): string {
  const text = copy().vehicle;
  if (vehicleClass === 'ship') return text.purposeShip;
  return vehicleClass === 'siege' ? text.purposeSiege : text.purposeCart;
}

function numbersBlock(context: KnowledgeContext, vehicle: KnowledgeVehicle): EntryBlock {
  const text = copy();
  const row = text.vehicle;
  const tribe = context.tribe();
  const humanTicks = stepSeconds(0) / SECONDS_PER_TICK;
  const holds = vehicleHolds(vehicle);
  const weapon = vehicleWeapon(context.base, vehicle, tribe);
  const building = combatTargets(context.base).find((target) => target.id === 'building');
  const commander: Child =
    vehicle.commanderJob === null || vehicle.commander === null
      ? null
      : jobLink(context, vehicle.commanderJob, vehicle.commander);
  const rows: (readonly [string, Child])[] = [
    ...(holds.cargo ? ([[row.cargo, String(vehicle.stockSlots)]] as const) : []),
    ...(holds.passengers ? ([[row.passengers, String(vehicle.passengerSlots)]] as const) : []),
    [row.health, wholeText(vehicle.hitpoints)],
    ...(commander === null ? [] : ([[row.commander, commander]] as const)),
    [row.speed, speedText(vehicle.moveTicks, humanTicks)],
    ...(weapon === undefined || building === undefined
      ? []
      : ([
          [row.damage, wholeText(landed(weapon, building))],
          [text.strip.cadence, cadenceText(weapon)],
          [text.strip.range, rangeText(weapon)],
        ] as const)),
  ];
  return { node: section(row.numbers, factList(rows)), side: true };
}

function buildBlock(context: KnowledgeContext, vehicle: KnowledgeVehicle): EntryBlock | null {
  const text = copy().vehicle;
  const yard = context.base.buildingById.get(vehicle.id);
  if (yard === undefined) return null;
  return {
    node: section(
      text.build,
      links(goodLinks(context, yard.cost)),
      yard.workers.length === 0
        ? null
        : paragraph(
            text.builtBy,
            ' ',
            links(yard.workers.map((worker) => jobLink(context, worker.jobType, worker.name))),
          ),
    ),
  };
}

export function renderVehicle(context: KnowledgeContext, vehicle: KnowledgeVehicle): HTMLElement {
  const text = copy();
  const good = context.base.goodById.get(vehicle.id);
  const help = good?.help ?? context.base.buildingById.get(vehicle.id)?.help ?? null;
  const render = (block: VehicleBlock): EntryBlock | null => {
    switch (block) {
      case 'purpose':
        return { node: section(text.vehicle.purpose, paragraph(purposeOf(vehicle.vehicleClass))) };
      case 'numbers':
        return numbersBlock(context, vehicle);
      case 'build':
        return buildBlock(context, vehicle);
      case 'links':
        return articleLinks(context, null, ['vehicles']);
      case 'origin':
        return originBlock(help);
    }
  };
  const head =
    good === undefined
      ? { picture: null, title: vehicle.name, kicker: text.kicker.vehicle }
      : goodHead(context, good, text.kicker.vehicle);
  return entryPage(head, VEHICLE_BLOCKS.map(render));
}
