import { describe, expect, it } from 'vitest';
import { entrySearch } from '../src/view/params.js';

describe('entrySearch', () => {
  it('records only the world and seat selection, dropping settings and diagnostic pins', () => {
    const current = new URLSearchParams(
      'map=twierdza&player=2&colors=1:3&ai=3&seed=42&lang=pol&speed=3&fog=recon-fow&uiscale=2&postfx=off&debug=perf',
    );
    // The seed rides along: relaunching a save into a fresh world on the default seed would build a
    // different world from the one the save was taken in.
    expect(entrySearch(current)).toBe('?map=twierdza&player=2&colors=1%3A3&ai=3&seed=42');
  });

  it('keeps a scene selection and reports null when nothing selects a world or seat', () => {
    expect(entrySearch(new URLSearchParams('scene=sandbox&sound=off'))).toBe('?scene=sandbox');
    expect(entrySearch(new URLSearchParams('lang=pol&speed=3'))).toBeNull();
  });
});
