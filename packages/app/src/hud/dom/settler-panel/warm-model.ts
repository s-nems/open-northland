import type { SettlerPanelModel } from '../../details-panel/model/index.js';

/**
 * A made-up person that lights every part of the panel at once: sockets worn and empty, a bag, a
 * status with a carried good, bars at every tone, seat rows with a link, a missing seat and a refused
 * button, craft rows with a live, a stopped and a locked product, the military choices, a trade route
 * with imports and offers, and folded experience. The panel paints it once at map start
 * (`SettlerPanel.warm`), so the browser's first raster of these styles (each a pipeline it compiles
 * on first use) happens behind the loading screen, not on the first click. Only the shapes matter;
 * the words are never read.
 */
export function warmModel(goodIds: readonly string[]): SettlerPanelModel {
  const good = (index: number): { goodId: string } | Record<string, never> => {
    const id = goodIds[index % Math.max(1, goodIds.length)];
    return id === undefined ? {} : { goodId: id };
  };
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
    renamable: true,
    meta: 'Warm',
    status: {
      state: 'idle',
      label: 'Warm',
      detail: 'warm',
      trouble: true,
      carrying: { ...good(0), label: 'Warm', amount: 2 },
    },
    bars: [bar('Warm', 100), bar('Warm', 50, 'hunger'), bar('Warm', 25, 'fatigue'), bar('Warm', 10, 'piety')],
    workplace: { target: { id: 1, label: 'Warm' }, assign: true, remove: 'warm', flag: false },
    home: { target: null, assign: true, remove: null },
    family: { partner: null, child: null, canPickPartner: true },
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
        {
          slot: 0,
          house: 1,
          label: 'Warm',
          foreign: false,
          imports: [{ goodType: 0, ...good(4), label: 'Warm', selected: true }],
        },
        {
          slot: 1,
          house: 2,
          label: 'Warm',
          foreign: true,
          imports: [{ goodType: 1, ...good(5), label: 'Warm', selected: false }],
        },
      ],
      offers: [
        {
          index: 0,
          label: 'Warm',
          give: { amount: 1, goodType: 0, ...good(6), label: 'Warm' },
          take: { amount: 2, goodType: 1, ...good(7), label: 'Warm' },
          selected: true,
        },
      ],
      balance: [],
      status: [],
      destination: null,
      canAttach: true,
      attachFirst: false,
    },
    experience: [
      { label: 'Warm', repeats: 1, bonusPct: 5, own: true },
      { label: 'Warm', repeats: 1, bonusPct: null, own: false },
    ],
    upcomingUnlocks: [{ job: 'Warm', track: 'warm', current: 1, required: 4 }],
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
