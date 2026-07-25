import type { Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { assistantGrantsSeam, grantAssistantDefaults } from '../src/view/assistant-grants.js';

/**
 * The switch-to-good content join: the seam translates the four chest-window switches to
 * `setAssistantGrant` commands and back from the sim's granted-goods list. Good type ids are
 * resolved from the live content BY SLUG (sandbox and real content number the same goods
 * differently), so the fixture uses arbitrary ids on the shared slugs.
 */

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
    seam.set('giveBoots', false);
    expect(sent).toEqual([{ kind: 'setAssistantGrant', player: 2, goodType: SHOES, enabled: false }]);
  });

  it('a switch whose slug the content lacks reads OFF and writes nothing', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      { assistantGrants: () => [SHOES] },
      { goods: [{ typeId: SHOES, id: 'shoes' }] },
      0,
      (c) => sent.push(c),
    );
    expect(seam.read().giveMead).toBe(false);
    seam.set('giveMead', true);
    expect(sent).toEqual([]);
  });
});

describe('grantAssistantDefaults', () => {
  it('switches all four grants ON for the seat at world start', () => {
    const sent: Command[] = [];
    grantAssistantDefaults({ enqueue: (c) => sent.push(c) }, CONTENT, 1);
    const grants = sent.filter((c) => c.kind === 'setAssistantGrant');
    expect(grants.map((c) => c.goodType).sort((a, b) => a - b)).toEqual([
      SHOES,
      TOOL_WOODEN,
      TOOL_IRON,
      MEAD,
    ]);
    expect(grants.every((c) => c.enabled && c.player === 1)).toBe(true);
  });
});
