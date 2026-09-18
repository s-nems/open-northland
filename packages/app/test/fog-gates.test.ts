import { FOG_MODE, FOG_STATE, type FogView, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createFogGates } from '../src/view/projections/index.js';

/** A FogView whose cells read VISIBLE only where `visible` holds; everything else reads EXPLORED. */
function fogWhere(visible: (cellX: number, cellY: number) => boolean): FogView {
  return {
    mode: FOG_MODE.RECON_FOG_OF_WAR,
    cellsWide: 16,
    cellsHigh: 16,
    generation: 1,
    stateAt: (cx, cy) => (visible(cx, cy) ? FOG_STATE.VISIBLE : FOG_STATE.EXPLORED),
  };
}

describe('FogGates.seesNode', () => {
  it('sees a half-cell node exactly when its cell (via cellOfNode) is VISIBLE', () => {
    const node = { col: 3, row: 5 };
    const cell = systems.cellOfNode(node.col, node.row);
    const gates = createFogGates();
    gates.setFrame(fogWhere((cx, cy) => cx === cell.cx && cy === cell.cy));

    expect(gates.seesNode(node.col, node.row)).toBe(true);
    // A node whose cell is only EXPLORED is not seen (the node→cell mapping is consulted, not col/row raw).
    const elsewhere = { col: 12, row: 1 };
    expect(systems.cellOfNode(elsewhere.col, elsewhere.row)).not.toEqual(cell);
    expect(gates.seesNode(elsewhere.col, elsewhere.row)).toBe(false);
  });

  it('treats EXPLORED ground as unseen (only VISIBLE counts)', () => {
    const gates = createFogGates();
    gates.setFrame(fogWhere(() => false));
    expect(gates.seesNode(4, 4)).toBe(false);
  });

  it('sees every node when fog is off', () => {
    const gates = createFogGates();
    gates.setFrame(null);
    expect(gates.seesNode(0, 0)).toBe(true);
    expect(gates.seesNode(99, 99)).toBe(true);
  });
});
