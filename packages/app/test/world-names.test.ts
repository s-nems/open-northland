import { describe, expect, it } from 'vitest';
import { worldNameIndex, worldNamesOf } from '../src/view/runtime/save-load/world-names.js';

describe('worldNamesOf', () => {
  const worldName = worldNamesOf([
    { id: 'twierdza', name: 'Twierdza na wzgórzu', minimap: false },
    { id: 'nameless', minimap: false },
  ]);

  it('joins map ids to index display names and passes unknown or nameless ids through', () => {
    expect(worldName('twierdza')).toBe('Twierdza na wzgórzu');
    expect(worldName('nameless')).toBe('nameless');
    expect(worldName('SomeMapId')).toBe('SomeMapId');
    expect(worldName(null)).toBeNull();
  });

  it('resolves scene tokens to localized titles, falling back to the scene id', () => {
    expect(worldName('scene:sandbox')).toBe('Otwarty sandbox');
    expect(worldName('scene:no-such-scene')).toBe('no-such-scene');
  });
});

// Node has no server behind `/maps-index.json`, so the fetched listing degrades to empty pass-through.
describe('worldNameIndex', () => {
  it('degrades to token pass-through without a served maps index', async () => {
    const worldName = await worldNameIndex();
    expect(worldName('SomeMapId')).toBe('SomeMapId');
    expect(worldName('scene:sandbox')).toBe('Otwarty sandbox');
  });
});
