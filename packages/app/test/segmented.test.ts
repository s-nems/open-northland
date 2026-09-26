import { describe, expect, it } from 'vitest';
import { segmentPicks, segmentView } from '../src/hud/dom/parts/segmented.js';

describe('segmented options', () => {
  it('lights the chosen option and names a tooltipped one by its tooltip', () => {
    expect(segmentView({ label: 'A → B', tooltip: 'Carry into B' }, true)).toEqual({
      text: 'A → B',
      pressed: true,
      disabled: false,
      tip: 'Carry into B',
      ariaLabel: 'Carry into B',
    });
    expect(segmentView({ label: 'Attack' }, false)).toMatchObject({
      tip: '',
      ariaLabel: null,
      disabled: false,
    });
    expect(segmentView({ label: '⇄', enabled: false, tooltip: 'B stores none' }, false).disabled).toBe(true);
  });

  it('picks only on a live option that is not already lit', () => {
    expect(segmentPicks(false, false)).toBe(true);
    expect(segmentPicks(true, false)).toBe(false);
    expect(segmentPicks(false, true)).toBe(false);
  });
});
