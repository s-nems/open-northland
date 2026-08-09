import { describe, expect, it } from 'vitest';
import { entrySearch } from '../src/view/params.js';

describe('entrySearch', () => {
  it('records only the world and seat selection, dropping settings and diagnostic pins', () => {
    const current = new URLSearchParams(
      'map=twierdza&player=2&colors=1:3&ai=3&lang=pol&speed=3&fog=recon&uiscale=2&postfx=off&debug=perf',
    );
    expect(entrySearch(current)).toBe('?map=twierdza&player=2&colors=1%3A3&ai=3');
  });

  it('keeps a scene selection and reports null when nothing selects a world or seat', () => {
    expect(entrySearch(new URLSearchParams('scene=sandbox&sound=off'))).toBe('?scene=sandbox');
    expect(entrySearch(new URLSearchParams('lang=pol&speed=3'))).toBeNull();
  });
});
