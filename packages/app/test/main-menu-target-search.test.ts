import { describe, expect, it } from 'vitest';
import { LOBBY_FOG_MODES } from '../src/entries/main-menu/lobby/model.js';
import { targetSearch } from '../src/entries/main-menu/target-search.js';
import { progressionOverride } from '../src/game/progression.js';

describe('targetSearch', () => {
  it('carries only player-facing game settings into the selected entry', () => {
    // `uiscale=1.75` is dropped with the other diagnostics: the pin must not outlive its entry.
    const current = new URLSearchParams(
      'lang=eng&uiscale=1.75&speed=6&fog=recon&progression=off&debug=geometry&zoom=2&sound=off&atlas=none&terrain=off&objects=off&nosuchparam=1',
    );

    expect(targetSearch('?map=blekiny_nurt', current)).toBe(
      '?lang=eng&speed=6&fog=recon&progression=off&sound=off&debug=geometry&map=blekiny_nurt',
    );
  });

  it('never carries a stale fog or progression choice into a scene', () => {
    // A quit-to-menu carries the last game's fog/progression; a scene's authored fixture owns both.
    const current = new URLSearchParams('lang=pol&fog=reveal&progression=off&speed=2');
    expect(targetSearch('?scene=goods-catalog', current)).toBe('?lang=pol&speed=2&scene=goods-catalog');
    // An explicit fog in the entry itself still wins (hand-typed URLs bypass the menu).
    expect(targetSearch('?scene=goods-catalog&fog=off', current)).toBe(
      '?lang=pol&speed=2&scene=goods-catalog&fog=off',
    );
  });

  it('offers only the three player-facing fog modes', () => {
    expect(LOBBY_FOG_MODES).toEqual(['off', 'reveal', 'recon']);
  });

  it('parses the two profession-progression modes, defaulting to the world rule', () => {
    expect(progressionOverride(new URLSearchParams(''))).toBeNull(); // absent = keep the world's rule
    expect(progressionOverride(new URLSearchParams('progression=on'))).toBe(true); // explicit re-enable
    expect(progressionOverride(new URLSearchParams('progression=off'))).toBe(false);
    expect(progressionOverride(new URLSearchParams('progression=nonsense'))).toBeNull();
  });

  it('defaults maps to classic fog when no mode was selected', () => {
    expect(targetSearch('?map=blekiny_nurt', new URLSearchParams('lang=pol'))).toBe(
      '?lang=pol&map=blekiny_nurt&fog=reveal',
    );
  });

  it('leaves a scene on its own authored fog when no mode was selected', () => {
    expect(targetSearch('?scene=sandbox', new URLSearchParams('lang=pol'))).toBe('?lang=pol&scene=sandbox');
  });

  it('does not add a fog mode to tools', () => {
    expect(targetSearch('?icons', new URLSearchParams('lang=pol'))).toBe('?lang=pol&icons=');
  });
});
