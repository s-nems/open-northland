import type { BuildingPanelModel, StaffPerson } from '../../details-panel/model/index.js';
import { OVERVIEW_LINES } from '../parts/stock-browser.js';
import { PRODUCTION_FOLD_FROM } from './production.js';

/** One stock line past the overview's, so the overview is full and a category tab lists the rest. */
const WARM_STOCK_LINES = OVERVIEW_LINES + 1;

/**
 * A made-up building that lights every part of the panel at once: the wear bar low, live and refused
 * orders, the lit alarm bell, a site's bill with a line nobody holds, wells of every look with free
 * seats, production lines with short and met ingredients, a tabbed store with both alerts,
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
    name: 'Warm',
    tier: 1,
    foreign: false,
    meta: 'Warm',
    health: { hitpoints: 1, max: 10 },
    status: { label: 'Warm', detail: 'Warm', tone: 'trouble' },
    orders: {
      upgrade: { control: 'warm', cost: [] },
      cancelUpgrade: false,
      alarm: { on: true },
      hire: { jobType: 0, label: 'Warm' },
    },
    construction: {
      rows: [0, 1].map((goodType) => ({
        goodType,
        ...good(goodType),
        label: 'Warm',
        delivered: goodType,
        needed: 2,
        inbound: 1,
        unsourced: goodType === 0,
      })),
      status: 'missing-materials',
      pct: 40,
      upgrade: false,
    },
    staff: {
      kind: 'workers',
      groups: [
        {
          key: 'a',
          label: 'Warm',
          people: [person(1, 'man'), person(2, 'woman')],
          capacity: 3,
          jobType: 0,
        },
        {
          key: 'b',
          label: 'Warm',
          people: [person(3, 'soldier'), person(4, 'child')],
          capacity: null,
          jobType: null,
        },
      ],
      count: { filled: 2, capacity: 3 },
    },
    crew: {
      kind: 'crew',
      groups: [{ key: 'crew', label: '', people: [person(5, 'man')], capacity: null, jobType: null }],
      count: null,
    },
    production: {
      kind: 'recipe',
      // Long enough to fold, one batch in flight.
      rows: Array.from({ length: PRODUCTION_FOLD_FROM }, (_, goodType) => ({
        goodType,
        ...good(goodType),
        label: 'Warm',
        effect: 'Warm',
        pct: 50 * goodType,
        running: goodType === 1,
        inputs: [0, 1].map((input) => ({
          goodType: input,
          ...good(input),
          label: 'Warm',
          have: input,
          need: 1,
        })),
      })),
    },
    stock: Array.from({ length: WARM_STOCK_LINES }, (_, goodType) => ({
      goodType,
      ...good(goodType),
      label: 'Warm',
      amount: goodType % 2,
      capacity: 10,
      category: goodType % 2,
      ...(goodType === 0 ? { alert: 'waiting' as const } : goodType === 1 ? { alert: 'full' as const } : {}),
    })),
    stockLayout: 'tabs',
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
