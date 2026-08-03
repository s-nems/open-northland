import { describe, expect, it } from 'vitest';
import { LOBBY_FOG_MODES } from '../src/entries/main-menu/lobby/model.js';
import { targetSearch } from '../src/entries/main-menu/target-search.js';
import { progressionOverride } from '../src/game/progression.js';

describe('targetSearch', () => {
  it('carries only player-facing game settings into the selected entry', () => {
    const current = new URLSearchParams(
      'lang=eng&uiscale=1.75&speed=6&fog=recon&progression=off&debug=geometry&zoom=2&sound=off&atlas=none&terrain=off&objects=off&nosuchparam=1',
    );

    expect(targetSearch('?scene=sandbox', current)).toBe(
      '?lang=eng&uiscale=1.75&speed=6&fog=recon&progression=off&sound=off&debug=geometry&scene=sandbox',
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
