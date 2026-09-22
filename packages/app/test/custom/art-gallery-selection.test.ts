import { describe, expect, it } from 'vitest';
import { galleryEntries, loadGalleryCatalog } from '../../src/custom/art-gallery/catalog.js';
import { gallerySelection } from '../../src/custom/art-gallery/selection.js';
import { readGalleryState } from '../../src/custom/art-gallery/state.js';

const entries = galleryEntries(loadGalleryCatalog());
const select = (query: string) => gallerySelection(entries, readGalleryState(new URLSearchParams(query)));

describe('gallery selection from review links', () => {
  it('does not substitute another asset for a stale link', () => {
    expect(select('tab=buildings&asset=buildings/removed').selected).toBeUndefined();
  });
  it('starts filtered terrain links on the requested category', () => {
    expect(select('tab=terrain&terrainKind=prop').selected?.kind).toBe('prop');
    expect(select('tab=terrain&terrainKind=material').selected?.kind).toBe('material');
  });
  it('uses search text for the initial preview without rewriting explicit selections', () => {
    expect(select('tab=buildings&q=house-2').selected?.id).toBe('buildings/house-2');
    expect(select('tab=buildings&q=not-present').selected).toBeUndefined();
    expect(select('tab=buildings&q=house-2&asset=buildings/farm').selected?.id).toBe('buildings/farm');
  });
  it('preserves comparison order and reports missing pinned assets', () => {
    const result = select(
      'tab=buildings&asset=buildings/farm&compare=buildings/house-2,buildings/house-1,buildings/removed',
    );
    expect(result.compared.map((entry) => entry.id)).toEqual(['buildings/house-2', 'buildings/house-1']);
    expect(result.missing).toEqual(['buildings/removed']);
  });
});
