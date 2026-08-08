import type { Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { assistantGrantsSeam, grantAssistantDefaults } from '../src/view/assistant-grants.js';

/** The seam translating the four chest-window switches to `setAssistantGrant` commands and back -
 *  good ids resolved from the live content by slug, so the fixture uses arbitrary ids. */

const CONTENT = {
  goods: [
    { typeId: 30, id: 'shoes' },
    { typeId: 31, id: 'tool_wooden' },
    { typeId: 32, id: 'tool_iron' },
    { typeId: 43, id: 'mead' },
  ],
};

const SHOES = 30;
const TOOL_WOODEN = 31;
const TOOL_IRON = 32;
const MEAD = 43;

describe('assistantGrantsSeam', () => {
  it('reads a switch as ON exactly when its content-resolved good is granted', () => {
    const seam = assistantGrantsSeam({ assistantGrants: () => [SHOES, MEAD] }, CONTENT, 0, () => {});
    expect(seam.read()).toEqual({
      giveBoots: true,
      giveWoodenTools: false,
      giveIronTools: false,
      giveMead: true,
    });
  });

  it('writes one command per mapped good, carrying the seat and the flip', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam({ assistantGrants: () => [] }, CONTENT, 2, (c) => sent.push(c));
    expect(seam.set('giveBoots', false)).toBe(true);
    expect(sent).toEqual([{ kind: 'setAssistantGrant', player: 2, goodType: SHOES, enabled: false }]);
  });

  it('a switch whose slug the content lacks reads OFF and rejects writes', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      { assistantGrants: () => [SHOES] },
      { goods: [{ typeId: SHOES, id: 'shoes' }] },
      0,
      (c) => sent.push(c),
    );
    expect(seam.read().giveMead).toBe(false);
    expect(seam.set('giveMead', true)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('a read-only session rejects every write', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam({ assistantGrants: () => [] }, CONTENT, 0, (c) => sent.push(c), false);
    expect(seam.set('giveBoots', true)).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('grantAssistantDefaults', () => {
  it('switches all four grants ON for the seat at world start', () => {
    const sent: Command[] = [];
    grantAssistantDefaults({ enqueueSetup: (c) => sent.push(c) }, CONTENT, [1]);
    const grants = sent.filter((c) => c.kind === 'setAssistantGrant');
    expect(grants.map((c) => c.goodType).sort((a, b) => a - b)).toEqual([
      SHOES,
      TOOL_WOODEN,
      TOOL_IRON,
      MEAD,
    ]);
    expect(grants.every((c) => c.enabled && c.player === 1)).toBe(true);
  });

  it('gives every played seat all four grants, a repeated seat only once', () => {
    const sent: Command[] = [];
    grantAssistantDefaults({ enqueueSetup: (c) => sent.push(c) }, CONTENT, [0, 2, 0]);
    const perSeat = new Map<number, number[]>();
    for (const c of sent.filter((c) => c.kind === 'setAssistantGrant')) {
      perSeat.set(
        c.player,
        [...(perSeat.get(c.player) ?? []), c.goodType].sort((a, b) => a - b),
      );
    }
    const all = [SHOES, TOOL_WOODEN, TOOL_IRON, MEAD].sort((a, b) => a - b);
    expect([...perSeat.keys()].sort((a, b) => a - b)).toEqual([0, 2]);
    expect(perSeat.get(0)).toEqual(all);
    expect(perSeat.get(2)).toEqual(all);
  });
});
