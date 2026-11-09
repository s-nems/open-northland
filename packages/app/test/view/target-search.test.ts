import { describe, expect, it } from 'vitest';
import { missionTargetSearch, targetSearch } from '../../src/view/target-search.js';

describe('targetSearch', () => {
  it('carries only player-facing game settings into the selected entry', () => {
    // `uiscale=1.75` is dropped with the other diagnostics: the pin must not outlive its entry.
    const current = new URLSearchParams(
      'lang=eng&uiscale=1.75&speed=6&fog=recon-fow&progression=off&needs=off&weathermode=winter&daynight=off&weather=snow&debug=geometry&zoom=2&sound=off&atlas=none&terrain=off&objects=off&nosuchparam=1',
    );

    expect(targetSearch('?map=blekiny_nurt', current)).toBe(
      '?lang=eng&speed=6&fog=recon-fow&progression=off&needs=off&weathermode=winter&daynight=off&sound=off&debug=geometry&map=blekiny_nurt',
    );
  });

  it('never carries a stale rule choice into a scene', () => {
    // A quit-to-menu carries the last game's rules; a scene's authored fixture owns all.
    const current = new URLSearchParams(
      'lang=pol&fog=classic&progression=off&needs=off&weathermode=map&daynight=on&speed=2',
    );
    expect(targetSearch('?scene=goods-catalog', current)).toBe('?lang=pol&speed=2&scene=goods-catalog');
    // An explicit fog in the entry itself still wins (hand-typed URLs bypass the menu).
    expect(targetSearch('?scene=goods-catalog&fog=off', current)).toBe(
      '?lang=pol&speed=2&scene=goods-catalog&fog=off',
    );
  });

  it("starts a campaign mission on its own rules, never the last game's", () => {
    // A quit from a recon room leaves its rules in the menu URL; the mission must not inherit them.
    const current = new URLSearchParams(
      'lang=pol&speed=2&fog=recon-fow&progression=off&needs=off&weathermode=winter&daynight=off&sound=off',
    );
    expect(missionTargetSearch('?map=campaign_1&missions=on&lang=pol', current)).toBe(
      '?lang=pol&speed=2&sound=off&map=campaign_1&missions=on&fog=classic',
    );
  });

  it('defaults maps to classic fog when no mode was selected, or a carried one is not for a lobby', () => {
    expect(targetSearch('?map=blekiny_nurt', new URLSearchParams('lang=pol'))).toBe(
      '?lang=pol&map=blekiny_nurt&fog=classic',
    );
    expect(targetSearch('?map=blekiny_nurt', new URLSearchParams('lang=pol&fog=off'))).toBe(
      '?lang=pol&fog=classic&map=blekiny_nurt',
    );
  });

  it('leaves a scene on its own authored fog when no mode was selected', () => {
    expect(targetSearch('?scene=sandbox', new URLSearchParams('lang=pol'))).toBe('?lang=pol&scene=sandbox');
  });

  it('does not add a fog mode to tools', () => {
    expect(targetSearch('?icons', new URLSearchParams('lang=pol'))).toBe('?lang=pol&icons=');
  });
});
