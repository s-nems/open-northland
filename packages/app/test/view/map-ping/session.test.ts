// @vitest-environment jsdom
import type { SignalNode } from '@open-northland/net-protocol';
import type { DiplomacyState } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_BINDINGS } from '../../../src/hud/keybindings.js';
import { createMapPingSession } from '../../../src/view/map-ping/session.js';

const ME = 0;
const ALLY = 1;
const RIVAL = 2;
const AT: SignalNode = { hx: 10, hy: 20 };
const NODES = { width: 64, height: 64 };
const LEFT = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, button: 0 };

function harness() {
  const sent: { at: SignalNode; to: readonly number[] }[] = [];
  const shown: SignalNode[] = [];
  let hear: (seat: number, at: SignalNode) => void = () => undefined;
  let seat: number | null = ME;
  let toolHeld = false;
  const stance = (from: number, to: number): DiplomacyState =>
    (from === ALLY && to === ME) || (from === ME && to === ALLY) ? 'friend' : 'enemy';
  const session = createMapPingSession({
    source: {
      send: (at, to) => sent.push({ at, to }),
      listen: (onSignal) => {
        hear = onSignal;
        return () => undefined;
      },
    },
    bindings: DEFAULT_KEY_BINDINGS,
    canvas: document.createElement('canvas'),
    seat: () => seat,
    roster: [ME, ALLY, RIVAL],
    stance,
    nodes: NODES,
    colourSlot: (s) => s,
    minimap: () => ({ signal: (at) => shown.push(at), setSignal: () => undefined }),
    toolHeld: () => toolHeld,
    callOffTools: () => {
      toolHeld = false;
    },
    rang: () => undefined,
    refused: () => undefined,
    now: () => 0,
  });
  return {
    session,
    sent,
    shown,
    hear: (from: number, at: SignalNode) => hear(from, at),
    watch: () => {
      seat = null;
    },
    holdTool: () => {
      toolHeld = true;
    },
  };
}

describe('map ping session', () => {
  it('sends a ping to the seats the player is a friend of and shows it', () => {
    const h = harness();
    h.session.controller.toggle();
    h.session.controller.press(LEFT, { col: AT.hx, row: AT.hy });
    expect(h.sent).toEqual([{ at: AT, to: [ALLY] }]);
    expect(h.shown).toEqual([AT]);
  });

  it('shows a heard ping only from a friend, clamped onto the map', () => {
    const h = harness();
    h.hear(RIVAL, AT);
    h.hear(ALLY, { hx: NODES.width + 5, hy: AT.hy });
    expect(h.shown).toEqual([{ hx: NODES.width - 1, hy: AT.hy }]);
  });

  it('drops an armed ping when the player starts watching or takes a tool up', () => {
    for (const lose of ['watch', 'holdTool'] as const) {
      const h = harness();
      h.session.controller.toggle();
      h.session.refresh();
      expect(h.session.controller.armed()).toBe(true);
      h[lose]();
      h.session.refresh();
      expect(h.session.controller.armed()).toBe(false);
    }
  });

  it('puts a held tool down when a ping is armed', () => {
    const h = harness();
    h.holdTool();
    h.session.controller.toggle();
    h.session.refresh();
    expect(h.session.controller.armed()).toBe(true);
  });
});
