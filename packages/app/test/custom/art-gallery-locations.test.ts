import { describe, expect, it } from 'vitest';
import { galleryMapDestination } from '../../src/custom/art-gallery/locations.js';

describe('gallery map destinations', () => {
  it('opens the documented real farm placement using custom assets at world review scale', () => {
    const destination = galleryMapDestination({ id: 'buildings/farm', kind: 'building' });
    const params = new URLSearchParams(destination.href);
    expect(Object.fromEntries(params)).toEqual({
      map: 'straznicypolnocy',
      assets: 'custom',
      intro: 'off',
      zoom: '2',
      center: '26,162',
      fog: 'off',
    });
    expect(destination.exact).toBe(true);
  });

  it('distinguishes family context and unknown assets from verified placements', () => {
    const fern = galleryMapDestination({ id: 'props/fern-02', kind: 'prop' });
    expect(new URLSearchParams(fern.href).get('center')).toBe('188,28');
    expect(fern.exact).toBe(false);
    expect(fern.note).toContain('selected variant');
    const unknown = galleryMapDestination({ id: 'terrain/new-material', kind: 'material' });
    expect(new URLSearchParams(unknown.href).get('map')).toBe('magiczny_las');
    expect(unknown.exact).toBe(false);
    expect(unknown.note).toContain('no verified placement');
    expect(galleryMapDestination({ id: 'buildings/house-10', kind: 'building' }).exact).toBe(false);
  });

  it('uses the existing appearance override only when a character is selected', () => {
    const character = galleryMapDestination({ id: 'characters/man-silver', kind: 'character' }, 'man-silver');
    expect(new URLSearchParams(character.href).get('customHead')).toBe('man-silver');
    const normal = galleryMapDestination({ id: 'characters/man-silver', kind: 'character' });
    expect(new URLSearchParams(normal.href).has('customHead')).toBe(false);
    const building = galleryMapDestination({ id: 'buildings/farm', kind: 'building' }, 'man-silver');
    expect(new URLSearchParams(building.href).has('customHead')).toBe(false);
  });

  it('sends the delivery flag to the sandbox scene, whose gatherer camps plant it', () => {
    const destination = galleryMapDestination({ id: 'props/work-flag', kind: 'prop' });
    expect(Object.fromEntries(new URLSearchParams(destination.href))).toEqual({
      scene: 'sandbox',
      assets: 'custom',
    });
    expect(destination.exact).toBe(true);
  });

  it('states when a workshop must be built before it can be reviewed', () => {
    const destination = galleryMapDestination({ id: 'buildings/stonemason', kind: 'building' });
    expect(destination.exact).toBe(false);
    expect(destination.note).toContain('Build a basic stonemason');
  });
});
