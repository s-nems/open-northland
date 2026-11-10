import { SIGNAL_BURST, SIGNAL_REFILL_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import type { MousePress } from '../../../src/hud/keybindings.js';
import { createMapPingController } from '../../../src/view/map-ping/controller.js';
import type { Tile } from '../../../src/view/picking.js';

const AT: Tile = { col: 12, row: 30 };
const NO_MODS = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
const LEFT: MousePress = { ...NO_MODS, button: 0 };
const RIGHT: MousePress = { ...NO_MODS, button: 2 };

function harness(available = true) {
  const clock = { ms: 0 };
  const pinged: Tile[] = [];
  let refusals = 0;
  let seat = available;
  const controller = createMapPingController({
    available: () => seat,
    ping: (at) => pinged.push(at),
    refused: () => refusals++,
    arming: () => undefined,
    changed: () => undefined,
    now: () => clock.ms,
  });
  return {
    controller,
    clock,
    pinged,
    refusals: () => refusals,
    leaveSeat: () => {
      seat = false;
    },
  };
}

describe('map pings', () => {
  it('pings on the left click after arming, not on a plain click', () => {
    const h = harness();
    expect(h.controller.press(LEFT, AT)).toBe(false);
    h.controller.toggle();
    expect(h.controller.armed()).toBe(true);
    expect(h.controller.press(LEFT, AT)).toBe(true);
    expect(h.controller.armed()).toBe(false);
    expect(h.pinged).toEqual([AT]);
  });

  it('calls an armed ping off on a right click without pinging', () => {
    const h = harness();
    h.controller.toggle();
    expect(h.controller.press(RIGHT, AT)).toBe(true);
    expect(h.controller.armed()).toBe(false);
    expect(h.pinged).toEqual([]);
    expect(h.refusals()).toBe(1);
  });

  it('refuses the pings past the relay allowance until it refills', () => {
    const h = harness();
    const ping = (): void => {
      h.controller.toggle();
      h.controller.press(LEFT, AT);
    };
    for (let i = 0; i < SIGNAL_BURST + 1; i++) ping();
    expect(h.pinged).toHaveLength(SIGNAL_BURST);
    expect(h.refusals()).toBe(1);
    h.clock.ms += SIGNAL_REFILL_MS;
    ping();
    expect(h.pinged).toHaveLength(SIGNAL_BURST + 1);
  });

  it('takes no press and arms nothing without a seat', () => {
    const h = harness();
    h.controller.toggle();
    h.leaveSeat();
    expect(h.controller.press(LEFT, AT)).toBe(false);
    expect(h.controller.armed()).toBe(false);
    expect(h.pinged).toEqual([]);
  });
});
