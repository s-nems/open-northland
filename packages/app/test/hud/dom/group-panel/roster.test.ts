import { describe, expect, it } from 'vitest';
import type { GroupMemberModel } from '../../../../src/hud/details-panel/model/index.js';
import { layRoster, rosterRows, rowsInView } from '../../../../src/hud/dom/group-panel/members.js';

let nextId = 0;
const member = (look: GroupMemberModel['look']): GroupMemberModel => ({
  id: nextId++,
  look,
  kind: look,
  name: '',
  kindLabel: '',
  healthPct: null,
  hungerPct: null,
  carriesMead: false,
});
const settlers = (n: number) => Array.from({ length: n }, () => member('settler'));

describe('roster layout', () => {
  it('fills a row with settlers and lets a vehicle with no member after it open the next', () => {
    expect(layRoster([], 8).rows).toBe(0);
    expect(layRoster(settlers(8), 8).rows).toBe(1);
    expect(layRoster(settlers(9), 8).rows).toBe(2);
    expect(layRoster([...settlers(7), member('vehicle')], 8).rows).toBe(2);
    expect(layRoster([...settlers(6), member('vehicle')], 8).rows).toBe(1);
  });

  it('fills the well a crossing vehicle would leave empty with the next member', () => {
    const before = settlers(7);
    const vehicle = member('vehicle');
    const after = member('settler');
    const layout = layRoster([...before, vehicle, after], 8);
    expect(layout.members).toEqual([...before, after, vehicle]);
    expect(layout.rowOf).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(layout.rows).toBe(2);
  });

  it('keeps vehicles that wait together in their order', () => {
    const before = settlers(7);
    const first = member('vehicle');
    const second = member('vehicle');
    const after = member('settler');
    const layout = layRoster([...before, first, second, after], 8);
    expect(layout.members).toEqual([...before, after, first, second]);
    expect(layout.rowOf).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('leaves no gap in a mixed army before its last row', () => {
    const army = [...settlers(9), member('vehicle'), member('vehicle'), ...settlers(20), member('vehicle')];
    const layout = layRoster(army, 10);
    const used = new Map<number, number>();
    layout.members.forEach((m, index) => {
      const row = layout.rowOf[index] as number;
      used.set(row, (used.get(row) ?? 0) + (m.look === 'vehicle' ? 2 : 1));
    });
    for (let row = 0; row < layout.rows - 1; row += 1) expect(used.get(row)).toBe(10);
    expect(new Set(layout.members).size).toBe(army.length);
    expect(rosterRows(army, 10)).toBe(layout.rows);
  });
});

describe('roster rows in view', () => {
  const PITCH = { row: 46, gap: 3 };
  const STEP = PITCH.row + PITCH.gap;

  it('takes every row whose box meets the view, as an offset test against the scroll box would', () => {
    expect(rowsInView(PITCH, 4, 0)).toEqual({ first: 0, last: 3 });
    // Scrolled through the gap under the fourth row, the fifth row's top shows at the view's bottom edge.
    expect(rowsInView(PITCH, 4, PITCH.gap)).toEqual({ first: 0, last: 3 });
    expect(rowsInView(PITCH, 4, PITCH.gap + 1)).toEqual({ first: 0, last: 4 });
    // Scrolled past the first row's box, though not its gap.
    expect(rowsInView(PITCH, 4, PITCH.row)).toEqual({ first: 1, last: 4 });
    expect(rowsInView(PITCH, 4, 10 * STEP)).toEqual({ first: 10, last: 13 });
  });

  it('counts every row as shown before the grid has its styles', () => {
    expect(rowsInView({ row: 0, gap: 0 }, 4, 0).first).toBe(0);
    expect(rowsInView({ row: 0, gap: 0 }, 4, 0).last).toBe(Number.MAX_SAFE_INTEGER);
  });
});
