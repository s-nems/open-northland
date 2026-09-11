import { describe, expect, it } from 'vitest';
import { galleryQuery, readGalleryState } from '../src/entries/art-gallery/state.js';

describe('gallery links', () => {
  it('roundtrips comparison and playback state', () => {
    const state = readGalleryState(
      new URLSearchParams(
        'tab=animations&asset=characters/man-silver&compare=characters/woman,characters/man&direction=3&clip=atomic-4&frame=7&pause=1&zoom=1&background=checker&terrainKind=material',
      ),
    );
    expect(readGalleryState(new URLSearchParams(galleryQuery(state)))).toEqual(state);
  });
  it('bounds external values and limits unique comparison entries', () => {
    const state = readGalleryState(
      new URLSearchParams('tab=unknown&direction=999&speed=NaN&progress=-2&frame=-1&compare=a,a,b,c,d'),
    );
    expect(state).toMatchObject({
      tab: 'animations',
      direction: 7,
      speed: 1,
      progress: 0,
      frame: 0,
      compare: ['a', 'b', 'c'],
    });
  });
});
