import type { BuildingPanelModel, StaffPerson } from '../../details-panel/model/index.js';
import { STOCK_TABS_FROM } from './stock.js';

/**
 * A made-up building that lights every part of the panel at once: the wear bar low, live, lit and
 * refused orders, a site's bill, wells of every look with free seats, production lines, a tabbed store,
 * household wares and an agreement. The panel paints it once at map start (`BuildingPanel.warm`), so the
 * browser's first raster of these styles happens behind the loading screen, not on the first click.
 * Only the shapes matter; the words are never read.
 */
export function warmBuildingModel(goodIds: readonly string[]): BuildingPanelModel {
  const good = (index: number): { goodId: string } | Record<string, never> => {
    const id = goodIds[index % Math.max(1, goodIds.length)];
    return id === undefined ? {} : { goodId: id };
  };
  const person = (entity: number, look: StaffPerson['look']): StaffPerson => ({
    entity,
    name: 'Warm',
    job: 'Warm',
    look,
  });
  const side = (goodType: number) => ({ amount: 1, goodType, label: 'Warm', ...good(goodType) });
  return {
    kind: 'building',
    entityId: -1,
    typeId: -1,
    tribeId: undefined,
    title: 'Warm',
    kicker: 'Warm',
    foreign: false,
    meta: 'Warm',
    health: { hitpoints: 1, max: 10 },
    status: { label: 'Warm', detail: 'Warm', tone: 'trouble' },
    orders: {
      upgrade: { control: 'warm', cost: [] },
      cancelUpgrade: true,
      alarm: { on: true },
    },
    construction: {
      rows: [0, 1].map((goodType) => ({
        goodType,
        ...good(goodType),
        label: 'Warm',
        delivered: goodType,
        needed: 2,
        inbound: 1,
      })),
      status: 'missing-materials',
      pct: 40,
      upgrade: false,
    },
    staff: {
      kind: 'workers',
      groups: [
        { key: 'a', label: 'Warm', people: [person(1, 'man'), person(2, 'woman')], capacity: 3 },
        { key: 'b', label: 'Warm', people: [person(3, 'soldier'), person(4, 'child')], capacity: null },
      ],
      count: { filled: 2, capacity: 3 },
    },
    production: {
      kind: 'recipe',
      rows: [0, 1].map((goodType) => ({
        goodType,
        ...good(goodType),
        label: 'Warm',
        pct: 50 * goodType,
        inputs: 'Warm',
      })),
    },
    stock: Array.from({ length: STOCK_TABS_FROM }, (_, goodType) => ({
      goodType,
      ...good(goodType),
      label: 'Warm',
      amount: goodType % 2,
      capacity: 10,
      category: goodType % 2,
    })),
    homeQuality: {
      rows: [
        {
          effect: 'cooking',
          goodId: goodIds[0] ?? '',
          label: 'Warm',
          value: 1,
          capacity: 2,
          allowed: true,
          uses: 1,
        },
        {
          effect: 'piety',
          goodId: goodIds[1] ?? '',
          label: 'Warm',
          value: 0,
          capacity: 2,
          allowed: false,
          holyFireActive: false,
        },
      ],
      player: 0,
      control: true,
    },
    offers: [{ give: side(0), take: side(1) }],
  };
}
