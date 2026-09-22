import { describe, expect, it } from 'vitest';
import { galleryQuery, readGalleryState } from '../../src/custom/art-gallery/state.js';

describe('gallery links', () => {
  it('roundtrips comparison and playback state', () => {
    const state = readGalleryState(
      new URLSearchParams(
        'tab=animations&asset=characters/man-silver&compare=characters/woman,characters/man&direction=3&clip=atomic-4&frame=7&pause=1&zoom=1&background=checker&terrainKind=material&time=1.234567',
      ),
    );
    expect(readGalleryState(new URLSearchParams(galleryQuery(state)))).toEqual(state);
  });
  it('roundtrips the building overlay and assets switch', () => {
    const state = readGalleryState(new URLSearchParams('tab=buildings&geometry=1&assets=original'));
    expect(state).toMatchObject({ geometry: true, assets: 'original' });
    expect(readGalleryState(new URLSearchParams(galleryQuery(state)))).toEqual(state);
    const plain = readGalleryState(new URLSearchParams('tab=buildings'));
    expect(plain).toMatchObject({ geometry: false, assets: 'custom' });
    expect(galleryQuery(plain)).not.toMatch(/geometry|assets/);
  });
  it('treats an explicit frame as a paused review', () => {
    expect(readGalleryState(new URLSearchParams('frame=4')).playing).toBe(false);
  });
  it('bounds external values and limits unique comparison entries', () => {
    const state = readGalleryState(
      new URLSearchParams('tab=unknown&direction=999&speed=NaN&progress=-2&frame=-1&compare=a,a,b,c,d,e'),
    );
    expect(state).toMatchObject({
      tab: 'animations',
      direction: 7,
      speed: 1,
      progress: 0,
      frame: 0,
      compare: ['a', 'b', 'c', 'd'],
    });
  });
});
