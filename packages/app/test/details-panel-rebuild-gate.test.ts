import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { UnitPanelModel } from '../src/hud/details-panel/index.js';
import { createPanelRebuildGate } from '../src/hud/details-panel/rebuild-gate.js';
import { snapshotOf } from './support/snapshot.js';

const SCREEN = { width: 1600, height: 1200 };

/** A group of `ids` whose members stand at `pct` health: another `pct` is a value change, other ids a
 *  structural one. */
function group(pct: number, ids: readonly number[] = [1, 2]): UnitPanelModel {
  return {
    kind: 'group',
    title: '',
    members: ids.map((id) => ({
      id,
      look: 'settler',
      kind: 'k',
      name: '',
      kindLabel: '',
      healthPct: pct,
      tone: 'ok',
    })),
    scopes: [],
    orders: true,
  };
}
/** The gate's own throttle: a value rebuild is refused until this much wall clock has passed. */
const VALUE_GAP_MS = 250;

/** A gate over a scripted model and a hand-cranked clock: `derive` answers with the model the test set,
 *  and each frame gets a fresh snapshot object unless the case is about snapshot identity. */
function gateOver(model: UnitPanelModel) {
  let current = model;
  let derives = 0;
  let clock = 1000;
  let answers = 0;
  const gate = createPanelRebuildGate({
    derive: () => {
      derives++;
      return current;
    },
    now: () => clock,
    answersVersion: () => answers,
  });
  return {
    gate,
    /** A read the model takes answers anew. */
    land: (next: UnitPanelModel): void => {
      current = next;
      answers++;
    },
    show: (next: UnitPanelModel): void => {
      current = next;
    },
    advance: (ms: number): void => {
      clock += ms;
    },
    derives: (): number => derives,
    /** Decide and report the rebuild back, the way the panel drives it. */
    frame: (snapshot: WorldSnapshot = snapshotOf([]), force = false) => {
      const decision = gate.decide(snapshot, SCREEN, force);
      if (decision !== null) gate.rebuilt();
      return decision;
    },
  };
}

describe('details panel rebuild gate', () => {
  it('derives once per snapshot and rebuilds the first frame', () => {
    const g = gateOver({ kind: 'signpost', entityId: 7 });
    const snapshot = snapshotOf([]);

    expect(g.frame(snapshot)).toEqual({ model: { kind: 'signpost', entityId: 7 }, structural: true });
    expect(g.frame(snapshot)).toBeNull();
    expect(g.frame(snapshot)).toBeNull();
    expect(g.derives()).toBe(1);
  });

  it('re-derives for a new snapshot object under the same tick', () => {
    const g = gateOver(group(2));
    g.frame(snapshotOf([]));
    g.frame(snapshotOf([]));

    expect(g.derives()).toBe(2);
  });

  it('rebuilds a changed selection immediately, values only at the throttle', () => {
    const g = gateOver(group(2));
    g.frame();

    g.show(group(3));
    expect(g.frame()).toBeNull();

    g.advance(VALUE_GAP_MS);
    expect(g.frame()).toEqual({ model: group(3), structural: false });

    g.show({ kind: 'signpost', entityId: 4 });
    expect(g.frame()).toEqual({ model: { kind: 'signpost', entityId: 4 }, structural: true });
  });

  it('treats another member list as a structural change of a group', () => {
    const g = gateOver(group(2));
    g.frame();

    g.show(group(2, [1, 3]));
    expect(g.frame()).toEqual({ model: group(2, [1, 3]), structural: true });
  });

  it('treats another entity of the same kind as a structural change', () => {
    const g = gateOver({ kind: 'signpost', entityId: 4 });
    g.frame();

    g.show({ kind: 'signpost', entityId: 7 });
    expect(g.frame()).toEqual({ model: { kind: 'signpost', entityId: 7 }, structural: true });
  });

  it('retries a throttled value change on a later frame instead of dropping it', () => {
    const g = gateOver(group(2));
    g.frame();
    g.show(group(3));
    expect(g.frame()).toBeNull();

    g.advance(VALUE_GAP_MS);
    expect(g.frame()).not.toBeNull();
  });

  it('throttles from the last rebuild, including one the panel made on its own', () => {
    const g = gateOver(group(2));
    g.frame();
    g.advance(VALUE_GAP_MS);
    // A hover or stock-tab press re-bakes the current model without consulting the gate.
    g.gate.rebuilt();

    g.show(group(3));
    expect(g.frame()).toBeNull();
  });

  it("fills in a new selection's landed answers at once, under the snapshot it was baked from", () => {
    const g = gateOver(group(2));
    const snapshot = snapshotOf([]);
    g.frame(snapshot);
    g.land(group(3));
    expect(g.frame(snapshot)).toEqual({ model: group(3), structural: false });
    // A value change the next snapshot brings keeps the throttle.
    g.show(group(4));
    expect(g.frame(snapshotOf([]))).toBeNull();
  });

  it('re-anchors on a resize, at the same throttle as a value change', () => {
    const g = gateOver({ kind: 'signpost', entityId: 7 });
    const snapshot = snapshotOf([]);
    const small = { width: 1280, height: 720 };
    g.frame(snapshot);

    expect(g.gate.decide(snapshot, small, false)).toBeNull();

    g.advance(VALUE_GAP_MS);
    expect(g.gate.decide(snapshot, small, false)).toEqual({
      model: { kind: 'signpost', entityId: 7 },
      structural: false,
    });
  });

  it('forces a structural rebuild for a re-selection of the same entity', () => {
    const g = gateOver({ kind: 'signpost', entityId: 7 });
    const snapshot = snapshotOf([]);
    g.frame(snapshot);

    expect(g.frame(snapshot, true)).toEqual({
      model: { kind: 'signpost', entityId: 7 },
      structural: true,
    });
    // The forced pass re-derives rather than trusting the snapshot memo: the selection changed under it.
    expect(g.derives()).toBe(2);
  });
});
