import type { SettlerPanelModel } from '../../details-panel/model/index.js';

/**
 * A made-up person that lights every part of the panel at once: sockets worn and empty, a bag, a
 * status with a carried good and the lost goal's jump, bars at every tone, seat rows with a link, a
 * missing seat and a refused button, craft rows with a live, a stopped and a locked product, the
 * military choices, a trade route with transfers and a running agreement, and experience with an
 * unlock. The panel paints it once at map start (`SettlerPanel.warm`), so the browser's first raster
 * of these styles (each a pipeline it compiles on first use) happens behind the loading screen, not on
 * the first click. Only the shapes matter; the words are never read.
 */
export function warmModel(goodIds: readonly string[]): SettlerPanelModel {
  const good = (index: number): { goodId: string } | Record<string, never> => {
    const id = goodIds[index % Math.max(1, goodIds.length)];
    return id === undefined ? {} : { goodId: id };
  };
  const stockRow = (index: number, amount: number) => ({
    goodType: index,
    ...good(index),
    label: 'Warm',
    category: 0,
    amount,
    capacity: 5,
  });
  const transfer = (index: number, direction: 'toB' | 'both') => ({
    goodType: index,
    ...good(index),
    label: 'Warm',
    category: 0,
    direction,
    upTo: 3,
    keep: 1,
  });
  const bar = (label: string, pct: number, need?: 'hunger' | 'fatigue' | 'enjoyment' | 'piety') => ({
    label,
    pct,
    hover: `${pct}%`,
    ...(need !== undefined ? { need } : {}),
  });
  return {
    kind: 'settler',
    entityId: -1,
    name: 'Warm',
    profession: 'Warm',
    jobType: null,
    role: 'worker',
    foreign: false,
    inside: null,
    renamable: true,
    meta: 'Warm',
    status: {
      state: 'idle',
      label: 'Warm',
      detail: 'warm',
      trouble: true,
      lostGoal: 0,
      carrying: { ...good(0), label: 'Warm', amount: 2 },
    },
    bars: [bar('Warm', 100), bar('Warm', 50, 'hunger'), bar('Warm', 25, 'fatigue'), bar('Warm', 10, 'piety')],
    workplace: {
      target: { id: 1, label: 'Warm' },
      assign: true,
      remove: 'warm',
      flag: false,
      centreFlag: null,
    },
    workArea: { flag: 1, assign: true, remove: true },
    buildRun: 'roads',
    home: { target: null, assign: true, remove: null },
    vehicle: { target: { id: 2, label: 'Warm', load: 'Warm' }, assign: true, remove: true },
    family: { partner: null, child: null, marry: true, childOnHold: null },
    production: {
      kind: 'craft',
      rows: [
        { goodType: 0, ...good(1), label: 'Warm', locked: null, count: 11 },
        { goodType: 1, ...good(2), label: 'Warm', locked: null, count: 0 },
        { goodType: 2, ...good(3), label: 'Warm', locked: 'warm', count: 11 },
      ],
    },
    military: { stance: null, regeneration: true },
    trade: {
      stops: [
        { slot: 0, house: 1, label: 'Warm', foreign: false, heading: true },
        { slot: 1, house: 2, label: 'Warm', foreign: true, heading: false },
      ],
      attachSlot: null,
      // Goods and an agreement at once, which no route has, so one paint lights both.
      foreign: true,
      stock: { a: [stockRow(4, 3), stockRow(5, 0)], b: [stockRow(4, 0), stockRow(5, 2)] },
      transfers: [transfer(4, 'toB'), transfer(5, 'both')],
      offers: [
        {
          index: 0,
          label: 'Warm',
          give: { amount: 1, goodType: 0, ...good(6), label: 'Warm' },
          take: { amount: 2, goodType: 1, ...good(7), label: 'Warm' },
          selected: true,
          progress: { given: 1, received: 0 },
        },
      ],
      agreementHolds: true,
    },
    experience: [
      { label: 'Warm', repeats: 1, bonusPct: 5, own: true },
      { label: 'Warm', repeats: 1, bonusPct: null, own: false },
    ],
    upcomingUnlocks: [{ unlocks: 'Warm', track: 'warm', current: 1, required: 4 }],
    equipmentRows: [
      {
        slotLabel: 'Warm',
        group: 'weapon',
        slots: [{ occupied: false, conditionPct: null }],
        wearable: true,
      },
      {
        slotLabel: 'Warm',
        group: 'tool',
        slots: [{ occupied: true, ...good(8), label: 'Warm', conditionPct: 20 }],
        wearable: true,
      },
      {
        slotLabel: 'Warm',
        group: 'boots',
        slots: [{ occupied: true, ...good(9), label: 'Warm', conditionPct: 80 }],
        wearable: true,
      },
      {
        slotLabel: 'Warm',
        group: 'misc',
        slots: [
          { occupied: true, ...good(10), label: 'Warm', conditionPct: null },
          { occupied: false, conditionPct: null },
        ],
        wearable: true,
      },
    ],
  };
}
