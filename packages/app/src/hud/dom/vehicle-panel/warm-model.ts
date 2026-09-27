import type { VehiclePanelModel, VehicleRiderModel } from '../../details-panel/model/index.js';

/**
 * A made-up vehicle that lights every part of the panel at once: the wear bar low, live, refused and
 * attack orders, the stance strip, a commander walking to the door, seat wells of every look with a
 * free and an offered seat, a carried vehicle, and a hold with lines coming, leaving and at target.
 * The panel paints it once at map start (`VehiclePanel.warm`), so the browser's first raster of these
 * styles happens behind the loading screen, not on the first click. Only the shapes matter; the words
 * are never read.
 */
export function warmVehicleModel(goodIds: readonly string[]): VehiclePanelModel {
  const good = (index: number): { goodId: string } | Record<string, never> => {
    const id = goodIds[index % Math.max(1, goodIds.length)];
    return id === undefined ? {} : { goodId: id };
  };
  const rider = (entity: number, look: VehicleRiderModel['look'], inside: boolean): VehicleRiderModel => ({
    entity,
    name: 'Warm',
    job: 'Warm',
    inside,
    look,
  });
  const cargo = (goodType: number, current: number, wanted: number, reserved: number) => ({
    goodType,
    ...good(goodType),
    label: 'Warm',
    current,
    wanted,
    reserved,
  });
  return {
    kind: 'vehicle',
    entityId: -1,
    typeId: -1,
    vehicleClass: 'siege',
    title: 'Warm',
    meta: 'Warm',
    foreign: false,
    status: { label: 'Warm', tone: 'trouble', carrier: { id: 1, label: 'Warm' } },
    health: { hitpoints: 1, max: 10 },
    orders: [
      { order: 'goTo', control: true },
      { order: 'stop', control: 'warm' },
      { order: 'boardShip', control: true },
    ],
    attackOrders: [
      { order: 'attackSettler', control: true },
      { order: 'attackBuilding', control: true },
      { order: 'attackVehicle', control: 'warm' },
      { order: 'attackPosition', control: true },
    ],
    stance: 'defence',
    crew: {
      commander: rider(2, 'man', false),
      seats: [rider(3, 'man', true), rider(4, 'woman', false), rider(5, 'soldier', true), null, null],
      count: 4,
      capacity: 6,
      deck: { capacity: 1, vehicles: [{ entity: 6, label: 'Warm' }] },
      assign: true,
      leave: true,
      unload: 'warm',
      load: true,
      unloadVehicle: true,
    },
    trade: null,
    hold: {
      slots: 30,
      rows: [cargo(0, 4, 8, 6), cargo(1, 5, 2, 3), cargo(2, 3, 3, 3)],
      goods: [0, 1, 2, 3].map((goodType) => ({
        goodType,
        ...good(goodType),
        label: 'Warm',
        category: goodType,
      })),
      routed: false,
      cargoHand: false,
    },
  };
}
