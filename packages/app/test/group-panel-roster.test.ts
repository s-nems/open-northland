import { describe, expect, it } from 'vitest';
import type { GroupMemberModel } from '../src/hud/details-panel/model/index.js';
import { rosterRows } from '../src/hud/dom/group-panel/members.js';

const member = (look: GroupMemberModel['look']): GroupMemberModel => ({
  id: 0,
  look,
  kind: look,
  name: '',
  kindLabel: '',
  healthPct: null,
  hungerPct: null,
});

describe('roster rows', () => {
  it('fills a row with settlers and lets a vehicle that would cross its end start the next', () => {
    const settlers = (n: number) => Array.from({ length: n }, () => member('settler'));
    expect(rosterRows([], 8)).toBe(0);
    expect(rosterRows(settlers(8), 8)).toBe(1);
    expect(rosterRows(settlers(9), 8)).toBe(2);
    expect(rosterRows([...settlers(7), member('vehicle')], 8)).toBe(2);
    expect(rosterRows([...settlers(6), member('vehicle')], 8)).toBe(1);
  });
});
