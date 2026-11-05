// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import type { VehiclePanelModel } from '../../../../src/hud/details-panel/model/index.js';
import { createCrewSection } from '../../../../src/hud/dom/vehicle-panel/crew.js';
import { warmVehicleModel } from '../../../../src/hud/dom/vehicle-panel/warm-model.js';

const TRADER = 4;

afterEach(() => document.body.replaceChildren());

/** The crew section of a ship pinned to the trader, or of one nobody pinned, and what its presses took. */
function crewOf(pinned: boolean) {
  const pressed: string[] = [];
  const unused = (): never => {
    throw new Error('unexpected vehicle action');
  };
  const model: VehiclePanelModel = {
    ...warmVehicleModel([]),
    tradePin: pinned ? { entity: TRADER, name: 'Ragnar' } : null,
  };
  const section = createCrewSection(
    {
      actions: {
        select: (id) => pressed.push(`select ${id}`),
        unpinTradeShip: (id) => pressed.push(`unpin ${id}`),
      },
      vehicle: {
        order: unused,
        setStance: unused,
        seatRider: unused,
        leave: unused,
        unloadPeople: unused,
        loadVehicle: unused,
        unloadVehicle: unused,
        setWanted: unused,
        clearWanted: unused,
      },
      cue: unused,
    },
    () => model,
  );
  document.body.append(section.element);
  section.update(model);
  const merchant = section.element.lastElementChild;
  if (!(merchant instanceof HTMLElement)) throw new Error('expected the merchant row');
  return { pressed, merchant };
}

it("names the pinned ship's merchant, selects it from the link and unpins it from the button", () => {
  const { pressed, merchant } = crewOf(true);
  expect(merchant.hidden).toBe(false);
  expect(merchant.querySelector('.on-ledger__link')?.textContent).toBe('Ragnar');
  merchant.querySelector<HTMLElement>('.on-ledger__link')?.click();
  merchant.querySelector<HTMLElement>('.on-round')?.click();
  expect(pressed).toEqual([`select ${TRADER}`, `unpin ${TRADER}`]);
});

it('hides the merchant row on a ship nobody pinned', () => {
  expect(crewOf(false).merchant.hidden).toBe(true);
});
