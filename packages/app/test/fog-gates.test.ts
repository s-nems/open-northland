import { FOG_MODE, FOG_STATE, type FogView, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createFogGates } from '../src/view/projections/index.js';

/** A FogView whose cells read VISIBLE only where `visible` holds; everything else reads EXPLORED. */
function fogWhere(visible: (cellX: number, cellY: number) => boolean): FogView {
  return {
    player: 0,
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

describe('FogGates.exploredTile', () => {
  const SEEN = { x: 2, y: 2 };
  const GREY = { x: 6, y: 2 };
  const BLACK = { x: 10, y: 2 };
  /** VISIBLE at the seen cell, UNEXPLORED from the black cell's column on, EXPLORED between. */
  const tiered: FogView = {
    ...fogWhere(() => false),
    stateAt: (cx, cy) =>
      cx === SEEN.x && cy === SEEN.y
        ? FOG_STATE.VISIBLE
        : cx >= BLACK.x
          ? FOG_STATE.UNEXPLORED
          : FOG_STATE.EXPLORED,
  };

  it('answers for explored and visible ground alike, and not for ground never explored', () => {
    const gates = createFogGates();
    gates.setFrame(tiered);
    expect(gates.exploredTile(SEEN.x, SEEN.y)).toBe(true);
    expect(gates.exploredTile(GREY.x, GREY.y)).toBe(true);
    expect(gates.visibleTile(GREY.x, GREY.y)).toBe(false);
    expect(gates.exploredTile(BLACK.x, BLACK.y)).toBe(false);
  });

  it('bumps its revision only when the mask, the seat or the fog switch changes', () => {
    const gates = createFogGates();
    const start = gates.revision();
    gates.setFrame(null);
    expect(gates.revision()).toBe(start);
    gates.setFrame(tiered);
    const fogged = gates.revision();
    expect(fogged).not.toBe(start);
    gates.setFrame({ ...tiered });
    expect(gates.revision()).toBe(fogged);
    gates.setFrame({ ...tiered, generation: tiered.generation + 1 });
    const stamped = gates.revision();
    expect(stamped).not.toBe(fogged);
    gates.setFrame({ ...tiered, generation: tiered.generation + 1, player: tiered.player + 1 });
    expect(gates.revision()).not.toBe(stamped);
  });
});
